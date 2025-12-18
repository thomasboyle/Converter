import os
import uuid
import pathlib
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, Any, Callable, Optional
from flask import Flask, render_template, request, send_from_directory, redirect, url_for, jsonify
from werkzeug.utils import secure_filename

from conversions.converter import (
    convert_video_to_avif_under_size,
    convert_video_to_gif_under_size,
    convert_video_to_webp_under_size,
    convert_video_to_mp4_under_size,
    convert_video_to_av1_under_size,
    ConversionError,
)
from conversions.clip_conversion import (
    clip_video_to_timestamps,
    clip_video_to_timestamps_with_reencode,
    ConversionError as ClipConversionError,
)

BASE_DIR = pathlib.Path(__file__).parent.resolve()
UPLOAD_DIR = BASE_DIR / 'uploads'
OUTPUT_DIR = BASE_DIR / 'gifs'
MAX_GIF_BYTES = 8388608
JOB_CLEANUP_AGE_SECONDS = 3600

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_EXTENSIONS = frozenset(("mp4", "mov", "avi", "mkv", "webm", "m4v", "wmv", "flv", "mpeg", "mpg"))
CLIP_EXTENSIONS = frozenset(("mp4", "mov", "avi", "mkv", "webm"))
TERMINAL_STATUSES = frozenset(("done", "error", "cancelled"))

FORMAT_EXTENSION_MAP = {
    "gif": "gif",
    "webp": "webp",
    "mp4": "mp4",
    "av1": "mp4",
    "avif": "avif"
}

VALID_FORMATS = frozenset(FORMAT_EXTENSION_MAP)
DEFAULT_FORMAT = "av1"
DEFAULT_EXT = "avif"

CONVERSION_FUNCTIONS = {
    "gif": convert_video_to_gif_under_size,
    "webp": convert_video_to_webp_under_size,
    "mp4": convert_video_to_mp4_under_size,
    "av1": convert_video_to_av1_under_size,
    "avif": convert_video_to_avif_under_size,
}

SECURITY_HEADERS = (
    ('X-Content-Type-Options', 'nosniff'),
    ('X-Frame-Options', 'DENY'),
    ('X-XSS-Protection', '1; mode=block'),
    ('Referrer-Policy', 'strict-origin-when-cross-origin'),
    ('Permissions-Policy', 'geolocation=(), microphone=(), camera=()'),
    ('Content-Security-Policy', 
     "default-src 'self'; "
     "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com; "
     "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
     "font-src 'self' https://fonts.gstatic.com; "
     "img-src 'self' data: https:; "
     "media-src 'self' blob:; "
     "connect-src 'self' https://www.google-analytics.com; "
     "frame-src 'none'; "
     "object-src 'none'; "
     "base-uri 'self'; "
     "form-action 'self';"),
)

JOBS: Dict[str, Dict[str, Any]] = {}
JOBS_LOCK = threading.Lock()
EXECUTOR = ThreadPoolExecutor(max_workers=1)

_str_upload_dir = str(UPLOAD_DIR)
_str_output_dir = str(OUTPUT_DIR)
_str_base_dir = str(BASE_DIR)
_str_images_dir = str(BASE_DIR / 'images')


def _cleanup_old_jobs() -> None:
    current_time = time.time()
    threshold = current_time - JOB_CLEANUP_AGE_SECONDS
    with JOBS_LOCK:
        to_remove = [jid for jid, j in JOBS.items() 
                     if j.get("status") in TERMINAL_STATUSES and j.get("timestamp", current_time) < threshold]
        for jid in to_remove:
            del JOBS[jid]


def _get_format_extension(fmt: str) -> str:
    return FORMAT_EXTENSION_MAP.get(fmt, DEFAULT_EXT)


def _normalize_format(fmt: Optional[str]) -> str:
    if fmt:
        fmt_lower = fmt.lower()
        if fmt_lower in VALID_FORMATS:
            return fmt_lower
    return DEFAULT_FORMAT


def _prepare_output_filename(user_filename: Optional[str], ext: str) -> str:
    if not user_filename:
        return f'output.{ext}'
    dot_idx = user_filename.rfind('.')
    base_name = user_filename[:dot_idx] if dot_idx > 0 else user_filename
    safe_filename = secure_filename(f"{base_name}.{ext}")
    if not safe_filename or safe_filename[0] == '.':
        return f'output.{ext}'
    return safe_filename


def _update_job_status(job_id: str, updates: Dict[str, Any]) -> None:
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if job:
            job.update(updates)


def _handle_conversion_error(job_id: str, exc: Exception) -> None:
    error_msg = str(exc) if isinstance(exc, ConversionError) else f"Unexpected error: {exc}"
    _update_job_status(job_id, {"status": "error", "message": error_msg, "error": error_msg})


def create_app() -> Flask:
    app = Flask(__name__)
    app.config['SECRET_KEY'] = os.environ.get('FLASK_SECRET_KEY', os.urandom(24))
    app.config['MAX_CONTENT_LENGTH'] = 2147483648

    @app.after_request
    def add_security_headers(response):
        hdrs = response.headers
        for k, v in SECURITY_HEADERS:
            hdrs[k] = v
        return response

    @app.route('/', methods=['GET', 'POST'])
    def index():
        if request.method == 'POST':
            if request.form or request.files:
                app.logger.warning(
                    f"Unexpected POST to root from {request.remote_addr}. "
                    f"Form: {list(request.form.keys())}, Files: {list(request.files.keys())}"
                )
            if 'video' in request.files:
                return jsonify({"error": "Invalid endpoint. Please use the correct conversion endpoint."}), 400
            return redirect(url_for('index'), code=302)
        return render_template('index.html')

    @app.route('/8mb', methods=['GET'])
    def convert_page():
        return render_template('8mb.html')

    @app.route('/clip', methods=['GET'])
    def clip_page():
        return render_template('clip.html')

    seo_routes = ('/convert-video-to-8mb', '/make-video-smaller', '/make-video-under-8mb')
    for route in seo_routes:
        app.add_url_rule(route, f'seo_redirect_{route[1:]}', 
                        lambda: redirect(url_for('convert_page'), code=301), methods=['GET'])

    def allowed_file(filename: str) -> bool:
        idx = filename.rfind('.')
        return idx > 0 and filename[idx + 1:].lower() in ALLOWED_EXTENSIONS

    def _make_progress_callback(job_id: str) -> Callable[[Dict[str, Any]], None]:
        jobs_ref = JOBS
        lock_ref = JOBS_LOCK
        def progress_cb(info: Dict[str, Any]) -> None:
            with lock_ref:
                job = jobs_ref.get(job_id)
                if not job:
                    return
                if job.get("status") == "cancelled":
                    raise ConversionError("Conversion cancelled by user")
                phase = info.get("phase")
                if phase == "attempt":
                    attempt = info.get("attempt")
                    total = info.get("total")
                    job["status"] = "running"
                    job["attempt"] = attempt
                    job["total"] = total
                    job["message"] = f"Attempt {attempt}/{total} — fps {info.get('fps')}, width≤{info.get('width_limit')}, colors {info.get('max_colors')}, dither {info.get('dither')}"
                elif phase == "predict":
                    job["status"] = "predict"
                    job["message"] = info.get("message", "Predicting…")
                elif phase == "convert":
                    job["status"] = "running"
                    job["attempt"] = info.get("attempt")
                    job["total"] = info.get("total")
                    job["message"] = info.get("message", "Converting…")
                elif phase == "done":
                    job["status"] = "done"
                    job["message"] = "Conversion complete"
                    job["params"] = {k: v for k, v in info.items() if k != "phase"}
        return progress_cb

    def _background_convert(job_id: str, input_path: pathlib.Path, output_path: pathlib.Path, fmt: str) -> None:
        try:
            result_path, params = CONVERSION_FUNCTIONS[fmt](
                str(input_path),
                str(output_path),
                MAX_GIF_BYTES,
                progress_cb=_make_progress_callback(job_id),
            )
            out_name = output_path.name
            cache_buster = int(time.time() * 1000)
            _update_job_status(job_id, {
                "status": "done",
                "message": "Conversion complete",
                "gif_url": f"/gifs/{out_name}?v={cache_buster}",
                "format": fmt,
                "params": params
            })
        except (ConversionError, Exception) as exc:
            _handle_conversion_error(job_id, exc)

    def _make_clip_progress_callback(job_id: str, output_path: pathlib.Path) -> Callable[[Dict[str, Any]], None]:
        jobs_ref = JOBS
        lock_ref = JOBS_LOCK
        out_name = output_path.name
        def progress_cb(info: Dict[str, Any]) -> None:
            with lock_ref:
                job = jobs_ref.get(job_id)
                if not job:
                    return
                if job.get("status") == "cancelled":
                    raise ClipConversionError("Clipping cancelled by user")
                phase = info.get("phase")
                if phase in ("analyze", "clip"):
                    job["status"] = "running"
                    job["message"] = info.get("message", f"{phase.capitalize()}ing video...")
                elif phase == "done":
                    job["status"] = "done"
                    job["message"] = "Clipping complete"
                    job["video_url"] = f"/gifs/{out_name}"
                    job["params"] = {k: v for k, v in info.items() if k != "phase"}
        return progress_cb

    def _background_clip(job_id: str, input_path: pathlib.Path, output_path: pathlib.Path, 
                        start_time: float, end_time: float) -> None:
        try:
            in_str = str(input_path)
            out_str = str(output_path)
            progress_cb = _make_clip_progress_callback(job_id, output_path)
            try:
                result_path, params = clip_video_to_timestamps(
                    input_video_path=in_str,
                    output_video_path=out_str,
                    start_time=start_time,
                    end_time=end_time,
                    progress_cb=progress_cb,
                )
            except ClipConversionError:
                result_path, params = clip_video_to_timestamps_with_reencode(
                    input_video_path=in_str,
                    output_video_path=out_str,
                    start_time=start_time,
                    end_time=end_time,
                    progress_cb=progress_cb,
                )
            out_name = output_path.name
            cache_buster = int(time.time() * 1000)
            _update_job_status(job_id, {
                "status": "done",
                "message": "Clipping complete",
                "video_url": f"/gifs/{out_name}?v={cache_buster}",
                "params": params
            })
        except (ClipConversionError, Exception) as exc:
            _handle_conversion_error(job_id, exc)

    @app.route('/start', methods=['POST'])
    def start():
        files = request.files
        if 'video' not in files:
            return jsonify({"error": "No file part in request"}), 400
        file = files['video']
        filename = file.filename
        if not filename:
            return jsonify({"error": "No file selected"}), 400
        if not allowed_file(filename):
            return jsonify({"error": "Unsupported file type"}), 400
        upload_id = uuid.uuid4().hex
        safe_name = secure_filename(filename)
        input_path = UPLOAD_DIR / f"{upload_id}_{safe_name}"
        file.save(str(input_path))
        form = request.form
        fmt = _normalize_format(form.get('format'))
        ext = _get_format_extension(fmt)
        output_name = _prepare_output_filename(form.get('filename'), ext)
        output_path = OUTPUT_DIR / output_name
        ts = time.time()
        with JOBS_LOCK:
            JOBS[upload_id] = {
                "status": "queued",
                "message": "Queued",
                "attempt": 0,
                "total": 0,
                "format": fmt,
                "timestamp": ts
            }
        EXECUTOR.submit(_background_convert, upload_id, input_path, output_path, fmt)
        _cleanup_old_jobs()
        return jsonify({"job_id": upload_id, "format": fmt})

    def _get_progress_payload(job: Dict[str, Any], output_url_key: str = "gif_url") -> Dict[str, Any]:
        payload = job.copy()
        payload.pop("timestamp", None)
        status = job.get("status")
        if status == "cancelled":
            payload["message"] = job.get("message", "Cancelled by user")
        elif status == "done":
            if job.get(output_url_key):
                pass
            else:
                payload["status"] = "running"
                payload["message"] = job.get("message", "Finalizing…")
                payload.pop(output_url_key, None)
                payload.pop("params", None)
                payload.pop("format", None)
        return payload

    @app.route('/progress/<job_id>', methods=['GET'])
    def progress(job_id: str):
        with JOBS_LOCK:
            job = JOBS.get(job_id)
            if not job:
                return jsonify({"error": "Job not found"}), 404
            payload = _get_progress_payload(job)
        return jsonify(payload)

    @app.route('/cancel/<job_id>', methods=['POST'])
    def cancel_job(job_id: str):
        with JOBS_LOCK:
            job = JOBS.get(job_id)
            if not job:
                return jsonify({"error": "Job not found"}), 404
            job["status"] = "cancelled"
            job["message"] = "Conversion cancelled by user"
        return jsonify({"success": True, "message": "Job cancelled"})

    @app.route('/clip/start', methods=['POST'])
    def clip_start():
        files = request.files
        if 'video' not in files:
            return jsonify({"error": "No file part in request"}), 400
        file = files['video']
        filename = file.filename
        if not filename:
            return jsonify({"error": "No file selected"}), 400
        if not allowed_file(filename):
            return jsonify({"error": "Unsupported file type"}), 400
        form = request.form
        try:
            start_time = float(form.get('start_time', 0))
            end_time = float(form.get('end_time', 0))
        except (ValueError, TypeError):
            return jsonify({"error": "Invalid time parameters"}), 400
        if start_time < 0 or end_time <= start_time:
            return jsonify({"error": "Invalid time range"}), 400
        upload_id = uuid.uuid4().hex
        safe_name = secure_filename(filename)
        input_path = UPLOAD_DIR / f"{upload_id}_{safe_name}"
        file.save(str(input_path))
        idx = safe_name.rfind('.')
        file_ext = safe_name[idx + 1:].lower() if idx > 0 else ''
        output_ext = file_ext if file_ext in CLIP_EXTENSIONS else 'mp4'
        output_name = f"{upload_id}_clipped.{output_ext}"
        output_path = OUTPUT_DIR / output_name
        with JOBS_LOCK:
            JOBS[upload_id] = {
                "status": "queued",
                "message": "Queued for clipping",
                "start_time": start_time,
                "end_time": end_time,
                "timestamp": time.time()
            }

        EXECUTOR.submit(_background_clip, upload_id, input_path, output_path, start_time, end_time)
        return jsonify({"job_id": upload_id})

    @app.route('/clip/progress/<job_id>', methods=['GET'])
    def clip_progress(job_id: str):
        with JOBS_LOCK:
            job = JOBS.get(job_id)
            if not job:
                return jsonify({"error": "Job not found"}), 404
            payload = _get_progress_payload(job, "video_url")
        return jsonify(payload)

    def _safe_delete_file(file_path: pathlib.Path) -> bool:
        try:
            if file_path.exists():
                file_path.unlink()
                return True
        except Exception as e:
            app.logger.warning(f"Failed to delete {file_path}: {e}")
        return False

    def _find_job_file(job_id: str, directory: pathlib.Path, job_url_key: Optional[str] = None, 
                       job: Optional[Dict[str, Any]] = None) -> Optional[pathlib.Path]:
        if job and job_url_key:
            url = job.get(job_url_key)
            if url:
                idx = url.find("/gifs/")
                if idx >= 0:
                    filename = url[idx + 6:].split('?', 1)[0]
                    return directory / filename
        is_upload = directory == UPLOAD_DIR
        prefix = f"{job_id}_" if is_upload else job_id
        for file_path in directory.iterdir():
            if file_path.is_file() and file_path.name.startswith(prefix):
                return file_path
        return None

    @app.route('/clip/clear_cache/<job_id>', methods=['POST'])
    def clear_clip_cache(job_id: str):
        try:
            deleted_files = []
            with JOBS_LOCK:
                job = JOBS.get(job_id)
                job_found = job is not None
                input_path = _find_job_file(job_id, UPLOAD_DIR)
                if input_path and _safe_delete_file(input_path):
                    deleted_files.append(str(input_path))
                output_path = _find_job_file(job_id, OUTPUT_DIR, "video_url", job)
                if output_path and _safe_delete_file(output_path):
                    deleted_files.append(str(output_path))
                if job_found:
                    del JOBS[job_id]
            if deleted_files or job_found:
                return jsonify({
                    "success": True,
                    "message": "Cache cleared successfully",
                    "deleted_files": deleted_files,
                    "job_removed": job_found
                })
            return jsonify({"error": "No cached files or job found for this ID"}), 404
        except Exception as e:
            return jsonify({"error": f"Failed to clear cache: {str(e)}"}), 500

    ACTIVE_STATUSES = frozenset(("queued", "running"))

    @app.route('/queue', methods=['GET'])
    def queue_status():
        with JOBS_LOCK:
            jobs_values = JOBS.values()
            queued_jobs = sum(1 for j in jobs_values if j.get("status") in ACTIVE_STATUSES)
            total_jobs = len(JOBS)
        return jsonify({"queued": queued_jobs, "total": total_jobs})

    @app.route('/gifs/<path:filename>')
    def get_gif(filename: str):
        response = send_from_directory(_str_output_dir, filename, as_attachment=False)
        hdrs = response.headers
        hdrs['Cache-Control'] = 'public, max-age=31536000, immutable'
        hdrs.pop('Pragma', None)
        hdrs.pop('Expires', None)
        return response

    @app.route('/images/<path:filename>')
    def get_image(filename: str):
        return send_from_directory(_str_images_dir, filename, as_attachment=False)

    @app.route('/robots.txt')
    def robots_txt():
        return send_from_directory('static', 'robots.txt')

    @app.route('/sitemap.xml')
    def sitemap():
        return send_from_directory('static', 'sitemap.xml')

    @app.route('/llms.txt')
    def llms_txt():
        return send_from_directory('static', 'llms.txt')

    return app


if __name__ == '__main__':
    app = create_app()
    port = int(os.environ.get('PORT', '5000'))
    app.run(host='127.0.0.1', port=port, debug=True, threaded=True)
