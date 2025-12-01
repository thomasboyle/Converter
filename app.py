import os
import uuid
import pathlib
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, Any, Tuple, Callable, Optional
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
MAX_GIF_BYTES = 8 * 1024 * 1024  # 8MB
JOB_CLEANUP_AGE_SECONDS = 3600  # Clean up jobs older than 1 hour

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_EXTENSIONS = {
    "mp4", "mov", "avi", "mkv", "webm", "m4v", "wmv", "flv", "mpeg", "mpg"
}

# Format mappings
FORMAT_EXTENSION_MAP = {
    "gif": "gif",
    "webp": "webp",
    "mp4": "mp4",
    "av1": "mp4",
    "avif": "avif"
}

VALID_FORMATS = set(FORMAT_EXTENSION_MAP.keys())
DEFAULT_FORMAT = "av1"

CONVERSION_FUNCTIONS = {
    "gif": convert_video_to_gif_under_size,
    "webp": convert_video_to_webp_under_size,
    "mp4": convert_video_to_mp4_under_size,
    "av1": convert_video_to_av1_under_size,
    "avif": convert_video_to_avif_under_size,
}

# In-memory job store
JOBS: Dict[str, Dict[str, Any]] = {}
JOBS_LOCK = threading.Lock()
EXECUTOR = ThreadPoolExecutor(max_workers=1)


def _cleanup_old_jobs() -> None:
    """Remove completed/error jobs older than JOB_CLEANUP_AGE_SECONDS."""
    current_time = time.time()
    with JOBS_LOCK:
        jobs_to_remove = [
            job_id for job_id, job in JOBS.items()
            if job.get("status") in ("done", "error", "cancelled")
            and current_time - job.get("timestamp", current_time) > JOB_CLEANUP_AGE_SECONDS
        ]
        for job_id in jobs_to_remove:
            del JOBS[job_id]


def _get_format_extension(fmt: str) -> str:
    """Get file extension for given format."""
    return FORMAT_EXTENSION_MAP.get(fmt, "avif")


def _normalize_format(fmt: Optional[str]) -> str:
    """Normalize and validate format string."""
    fmt = (fmt or DEFAULT_FORMAT).lower()
    return fmt if fmt in VALID_FORMATS else DEFAULT_FORMAT


def _prepare_output_filename(user_filename: Optional[str], ext: str) -> str:
    """Sanitize and prepare output filename with correct extension."""
    if not user_filename:
        return f'output.{ext}'
    
    # Remove existing extension and add correct one
    base_name = user_filename.rsplit('.', 1)[0]
    safe_filename = secure_filename(f"{base_name}.{ext}")
    
    # Ensure we don't have empty filename
    if not safe_filename or safe_filename == f'.{ext}':
        return f'output.{ext}'
    
    return safe_filename


def _update_job_status(job_id: str, updates: Dict[str, Any]) -> None:
    """Thread-safe job status update."""
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if job:
            job.update(updates)


def _handle_conversion_error(job_id: str, exc: Exception) -> None:
    """Centralized error handling for conversion jobs."""
    error_msg = str(exc) if isinstance(exc, ConversionError) else f"Unexpected error: {exc}"
    _update_job_status(job_id, {
        "status": "error",
        "message": error_msg,
        "error": error_msg
    })


def create_app() -> Flask:
    app = Flask(__name__)
    app.config['SECRET_KEY'] = os.environ.get('FLASK_SECRET_KEY', os.urandom(24))
    app.config['MAX_CONTENT_LENGTH'] = 2 * 1024 * 1024 * 1024  # 2 GB

    @app.after_request
    def add_security_headers(response):
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['X-XSS-Protection'] = '1; mode=block'
        response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
        response.headers['Permissions-Policy'] = 'geolocation=(), microphone=(), camera=()'

        response.headers['Content-Security-Policy'] = (
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
            "form-action 'self';"
        )
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

    # SEO-optimized redirect routes
    seo_routes = ['/convert-video-to-8mb', '/make-video-smaller', '/make-video-under-8mb']
    for route in seo_routes:
        app.add_url_rule(route, f'seo_redirect_{route[1:]}', 
                        lambda: redirect(url_for('convert_page'), code=301), methods=['GET'])

    def allowed_file(filename: str) -> bool:
        return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

    def _make_progress_callback(job_id: str) -> Callable[[Dict[str, Any]], None]:
        """Factory for creating progress callbacks."""
        def progress_cb(info: Dict[str, Any]) -> None:
            with JOBS_LOCK:
                job = JOBS.get(job_id)
                if not job:
                    return

                if job.get("status") == "cancelled":
                    raise ConversionError("Conversion cancelled by user")

                phase = info.get("phase")
                if phase == "attempt":
                    job.update({
                        "status": "running",
                        "attempt": info.get("attempt"),
                        "total": info.get("total"),
                        "message": f"Attempt {info.get('attempt')}/{info.get('total')} — "
                                  f"fps {info.get('fps')}, width≤{info.get('width_limit')}, "
                                  f"colors {info.get('max_colors')}, dither {info.get('dither')}",
                    })
                elif phase == "predict":
                    job.update({
                        "status": "predict",
                        "message": info.get("message", "Predicting…"),
                    })
                elif phase == "convert":
                    job.update({
                        "status": "running",
                        "attempt": info.get("attempt"),
                        "total": info.get("total"),
                        "message": info.get("message", "Converting…"),
                    })
                elif phase == "done":
                    job.update({
                        "status": "done",
                        "message": "Conversion complete",
                        "params": {k: v for k, v in info.items() if k != "phase"},
                    })
        return progress_cb

    def _background_convert(job_id: str, input_path: pathlib.Path, output_path: pathlib.Path, fmt: str) -> None:
        try:
            conversion_func = CONVERSION_FUNCTIONS[fmt]
            result_path, params = conversion_func(
                str(input_path),
                str(output_path),
                MAX_GIF_BYTES,
                progress_cb=_make_progress_callback(job_id),
            )
            _update_job_status(job_id, {
                "status": "done",
                "message": "Conversion complete",
                "gif_url": f"/gifs/{output_path.name}",
                "format": fmt,
                "params": params
            })
        except (ConversionError, Exception) as exc:
            _handle_conversion_error(job_id, exc)

    def _make_clip_progress_callback(job_id: str, output_path: pathlib.Path) -> Callable[[Dict[str, Any]], None]:
        """Factory for creating clip progress callbacks."""
        def progress_cb(info: Dict[str, Any]) -> None:
            with JOBS_LOCK:
                job = JOBS.get(job_id)
                if not job:
                    return

                if job.get("status") == "cancelled":
                    raise ClipConversionError("Clipping cancelled by user")

                phase = info.get("phase")
                if phase in ("analyze", "clip"):
                    job.update({
                        "status": "running",
                        "message": info.get("message", f"{phase.capitalize()}ing video..."),
                    })
                elif phase == "done":
                    job.update({
                        "status": "done",
                        "message": "Clipping complete",
                        "video_url": f"/gifs/{output_path.name}",
                        "params": {k: v for k, v in info.items() if k != "phase"},
                    })
        return progress_cb

    def _background_clip(job_id: str, input_path: pathlib.Path, output_path: pathlib.Path, 
                        start_time: float, end_time: float) -> None:
        try:
            progress_cb = _make_clip_progress_callback(job_id, output_path)
            try:
                result_path, params = clip_video_to_timestamps(
                    input_video_path=str(input_path),
                    output_video_path=str(output_path),
                    start_time=start_time,
                    end_time=end_time,
                    progress_cb=progress_cb,
                )
            except ClipConversionError:
                result_path, params = clip_video_to_timestamps_with_reencode(
                    input_video_path=str(input_path),
                    output_video_path=str(output_path),
                    start_time=start_time,
                    end_time=end_time,
                    progress_cb=progress_cb,
                )

            _update_job_status(job_id, {
                "status": "done",
                "message": "Clipping complete",
                "video_url": f"/gifs/{output_path.name}",
                "params": params
            })
        except (ClipConversionError, Exception) as exc:
            _handle_conversion_error(job_id, exc)

    @app.route('/start', methods=['POST'])
    def start():
        if 'video' not in request.files:
            return jsonify({"error": "No file part in request"}), 400

        file = request.files['video']
        if not file.filename:
            return jsonify({"error": "No file selected"}), 400

        if not allowed_file(file.filename):
            return jsonify({"error": "Unsupported file type"}), 400

        upload_id = uuid.uuid4().hex
        safe_name = secure_filename(file.filename)
        input_path = UPLOAD_DIR / f"{upload_id}_{safe_name}"
        file.save(str(input_path))

        fmt = _normalize_format(request.form.get('format'))
        ext = _get_format_extension(fmt)
        output_name = _prepare_output_filename(request.form.get('filename'), ext)
        output_path = OUTPUT_DIR / output_name

        with JOBS_LOCK:
            JOBS[upload_id] = {
                "status": "queued",
                "message": "Queued",
                "attempt": 0,
                "total": 0,
                "format": fmt,
                "timestamp": time.time()
            }

        EXECUTOR.submit(_background_convert, upload_id, input_path, output_path, fmt)
        _cleanup_old_jobs()
        return jsonify({"job_id": upload_id, "format": fmt})

    def _get_progress_payload(job: Dict[str, Any], output_url_key: str = "gif_url") -> Dict[str, Any]:
        """Build progress payload with proper status handling."""
        payload = job.copy()
        payload.pop("timestamp", None)
        
        if job.get("status") == "cancelled":
            payload["message"] = job.get("message", "Cancelled by user")
        elif job.get("status") == "done":
            if job.get(output_url_key):
                for key in [output_url_key, "params", "format"]:
                    if key in job:
                        payload[key] = job[key]
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
        return jsonify(_get_progress_payload(job))

    @app.route('/cancel/<job_id>', methods=['POST'])
    def cancel_job(job_id: str):
        with JOBS_LOCK:
            job = JOBS.get(job_id)
            if not job:
                return jsonify({"error": "Job not found"}), 404
            job.update({"status": "cancelled", "message": "Conversion cancelled by user"})
        return jsonify({"success": True, "message": "Job cancelled"})

    @app.route('/clip/start', methods=['POST'])
    def clip_start():
        if 'video' not in request.files:
            return jsonify({"error": "No file part in request"}), 400

        file = request.files['video']
        if file.filename == '':
            return jsonify({"error": "No file selected"}), 400

        if not allowed_file(file.filename):
            return jsonify({"error": "Unsupported file type"}), 400

        # Parse time parameters
        try:
            start_time = float(request.form.get('start_time', 0))
            end_time = float(request.form.get('end_time', 0))
        except (ValueError, TypeError):
            return jsonify({"error": "Invalid time parameters"}), 400

        if start_time < 0 or end_time <= start_time:
            return jsonify({"error": "Invalid time range"}), 400

        upload_id = uuid.uuid4().hex
        safe_name = secure_filename(file.filename)
        input_path = UPLOAD_DIR / f"{upload_id}_{safe_name}"
        file.save(str(input_path))

        # Determine output format based on input
        file_ext = safe_name.rsplit('.', 1)[-1].lower()
        if file_ext in ['mp4', 'mov', 'avi', 'mkv', 'webm']:
            output_ext = file_ext
        else:
            output_ext = 'mp4'  # Default fallback

        output_name = f"{upload_id}_clipped.{output_ext}"
        output_path = OUTPUT_DIR / output_name

        with JOBS_LOCK:
            JOBS[upload_id] = {
                "status": "queued",
                "message": "Queued for clipping",
                "start_time": start_time,
                "end_time": end_time,
            }

        EXECUTOR.submit(_background_clip, upload_id, input_path, output_path, start_time, end_time)
        return jsonify({"job_id": upload_id})

    @app.route('/clip/progress/<job_id>', methods=['GET'])
    def clip_progress(job_id: str):
        with JOBS_LOCK:
            job = JOBS.get(job_id)
            if not job:
                return jsonify({"error": "Job not found"}), 404
        return jsonify(_get_progress_payload(job, "video_url"))

    def _safe_delete_file(file_path: pathlib.Path) -> bool:
        """Safely delete a file and return True if successful."""
        try:
            if file_path.exists():
                file_path.unlink()
                return True
        except Exception as e:
            app.logger.warning(f"Failed to delete {file_path}: {e}")
        return False

    def _find_job_file(job_id: str, directory: pathlib.Path, job_url_key: Optional[str] = None, 
                       job: Optional[Dict[str, Any]] = None) -> Optional[pathlib.Path]:
        """Find a file associated with a job ID."""
        if job and job_url_key:
            url = job.get(job_url_key)
            if url:
                filename = url.replace("/gifs/", "")
                return directory / filename
        
        for file_path in directory.iterdir():
            if file_path.is_file() and file_path.name.startswith(f"{job_id}_" if directory == UPLOAD_DIR else job_id):
                return file_path
        return None

    @app.route('/clip/clear_cache/<job_id>', methods=['POST'])
    def clear_clip_cache(job_id: str):
        """Clear cached files and job data for a specific clip job."""
        try:
            deleted_files = []
            
            with JOBS_LOCK:
                job = JOBS.get(job_id)
                job_found = job is not None

                # Delete input file
                input_path = _find_job_file(job_id, UPLOAD_DIR)
                if input_path and _safe_delete_file(input_path):
                    deleted_files.append(str(input_path))

                # Delete output file
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

    @app.route('/queue', methods=['GET'])
    def queue_status():
        with JOBS_LOCK:
            queued_jobs = sum(1 for job in JOBS.values() 
                            if job.get("status") in ("queued", "running"))
            total_jobs = len(JOBS)
        return jsonify({"queued": queued_jobs, "total": total_jobs})

    @app.route('/gifs/<path:filename>')
    def get_gif(filename: str):
        return send_from_directory(str(OUTPUT_DIR), filename, as_attachment=False)

    @app.route('/images/<path:filename>')
    def get_image(filename: str):
        return send_from_directory(str(BASE_DIR / 'images'), filename, as_attachment=False)

    @app.route('/robots.txt')
    def robots_txt():
        return send_from_directory(str(BASE_DIR), 'robots.txt', mimetype='text/plain')

    @app.route('/sitemap.xml')
    def sitemap():
        """Generate dynamic sitemap.xml"""
        from datetime import datetime

        current_date = datetime.now().strftime('%Y-%m-%d')
        domain = os.environ.get('SITE_DOMAIN', 'https://www.telinquents.com')

        pages = [
            {'loc': f'{domain}/', 'priority': '1.0', 'changefreq': 'weekly'},
            {'loc': f'{domain}/8mb', 'priority': '0.9', 'changefreq': 'weekly'},
            {'loc': f'{domain}/convert-video-to-8mb', 'priority': '0.8', 'changefreq': 'weekly'},
            {'loc': f'{domain}/make-video-smaller', 'priority': '0.8', 'changefreq': 'weekly'},
            {'loc': f'{domain}/make-video-under-8mb', 'priority': '0.8', 'changefreq': 'weekly'},
        ]

        urls = '\n'.join(
            f'    <url>\n'
            f'        <loc>{p["loc"]}</loc>\n'
            f'        <lastmod>{current_date}</lastmod>\n'
            f'        <changefreq>{p["changefreq"]}</changefreq>\n'
            f'        <priority>{p["priority"]}</priority>\n'
            f'    </url>'
            for p in pages
        )

        xml_content = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n'
            '        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n'
            '        xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9\n'
            '        http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">\n'
            f'{urls}\n'
            '</urlset>'
        )

        return xml_content, 200, {'Content-Type': 'application/xml'}

    return app


if __name__ == '__main__':
    app = create_app()
    port = int(os.environ.get('PORT', '5000'))
    app.run(host='127.0.0.1', port=port, debug=True, threaded=True)
