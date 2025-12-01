import subprocess
import os
from typing import Dict, Tuple, Optional, Callable

from .encode_estimations import get_video_info, calculate_target_resolution, ConversionError


def _run_ffmpeg(cmd: list) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=False,
    )


def convert_video_to_webp_under_size(
    input_video_path: str,
    output_webp_path: str,
    max_bytes: int,
    fps: float = 12,
    progress_cb: Optional[Callable] = None,
) -> Tuple[str, Dict]:

    if progress_cb:
        progress_cb({"phase": "analyze", "message": "Analyzing video..."})

    orig_width, orig_height, duration = get_video_info(input_video_path)
    if duration <= 0:
        raise ConversionError("Could not determine video duration")

    width, height = calculate_target_resolution(orig_width, orig_height, max_bytes, duration, fps, "webp")

    quality_candidates = [85, 75, 65, 55, 45, 35, 25]
    scale_step = 0.86
    min_w = max(2, int((width * 0.5) // 2) * 2)
    min_h = max(2, int((height * 0.5) // 2) * 2)

    def encode_attempt(curr_w: int, curr_h: int, quality: int) -> subprocess.CompletedProcess:
        vf = f"fps={fps},scale={curr_w}:{curr_h}:flags=lanczos"
        cmd = [
            "ffmpeg", "-y", "-i", input_video_path,
            "-vf", vf,
            "-an",
            "-c:v", "libwebp_anim",
            "-quality", str(quality),
            "-loop", "0",
            "-b:v", "0",
            output_webp_path,
        ]
        return _run_ffmpeg(cmd)

    while True:
        for quality in quality_candidates:
            if progress_cb:
                progress_cb({
                    "phase": "encode",
                    "message": f"Encoding animated WebP... {width}x{height} @ {fps}fps, quality {quality}",
                })
            result = encode_attempt(width, height, quality)
            if result.returncode != 0:
                stderr_text = result.stderr.decode('utf-8', errors='replace') if result.stderr else ""
                stderr_tail = "\n".join(stderr_text.strip().splitlines()[-15:])
                raise ConversionError(f"WebP encoding failed: {stderr_tail or 'Unknown error'}")

            final_size = os.path.getsize(output_webp_path)
            if final_size <= max_bytes:
                params = {
                    "fps": fps,
                    "width": width,
                    "height": height,
                    "quality": quality,
                    "output_size_bytes": final_size,
                    "output_size_mb": round(final_size / (1024 * 1024), 3),
                    "utilization": round((final_size / max_bytes) * 100, 1),
                }
                if progress_cb:
                    progress_cb({"phase": "done", **params})
                return output_webp_path, params

        if progress_cb:
            progress_cb({"phase": "retry", "message": "Retrying with smaller size..."})
        new_w = max(2, int((width * scale_step) // 2) * 2)
        new_h = max(2, int((height * scale_step) // 2) * 2)
        if new_w < min_w or new_h < min_h:
            raise ConversionError("Could not reach target size; try a shorter clip or increase size limit.")
        width, height = new_w, new_h
