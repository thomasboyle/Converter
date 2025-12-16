import subprocess
import os
from typing import Dict, Tuple, Optional, Callable

from .encode_estimations import get_video_info, calculate_target_resolution, ConversionError

_SUBPROCESS_FLAGS = {"stdout": subprocess.PIPE, "stderr": subprocess.PIPE, "text": False}
_QUALITY_CANDIDATES = (85, 75, 65, 55, 45, 35, 25)
_SCALE_STEP = 0.86
_MB_DIV = 1048576.0


def convert_video_to_webp_under_size(
    input_video_path: str,
    output_webp_path: str,
    max_bytes: int,
    fps: float = 12,
    progress_cb: Optional[Callable] = None,
) -> Tuple[str, Dict]:
    if progress_cb:
        progress_cb({"phase": "analyze", "message": "Analyzing video..."})

    orig_w, orig_h, duration = get_video_info(input_video_path)
    if duration <= 0:
        raise ConversionError("Could not determine video duration")

    w, h = calculate_target_resolution(orig_w, orig_h, max_bytes, duration, fps, "webp")
    min_w = max(2, (int(w * 0.5) >> 1) << 1)
    min_h = max(2, (int(h * 0.5) >> 1) << 1)

    cmd_template = [
        "ffmpeg", "-y", "-i", input_video_path,
        "-vf", None, "-an",
        "-c:v", "libwebp_anim", "-quality", None,
        "-loop", "0", "-b:v", "0",
        output_webp_path,
    ]

    while True:
        vf = f"fps={fps},scale={w}:{h}:flags=lanczos"
        for q in _QUALITY_CANDIDATES:
            if progress_cb:
                progress_cb({"phase": "encode", "message": f"Encoding animated WebP... {w}x{h} @ {fps}fps, quality {q}"})
            cmd = cmd_template.copy()
            cmd[5] = vf
            cmd[10] = str(q)
            r = subprocess.run(cmd, **_SUBPROCESS_FLAGS)
            if r.returncode:
                err = r.stderr.decode("utf-8", errors="replace") if r.stderr else ""
                raise ConversionError(f"WebP encoding failed: {''.join(err.strip().splitlines()[-15:]) or 'Unknown error'}")
            sz = os.path.getsize(output_webp_path)
            if sz <= max_bytes:
                params = {
                    "fps": fps, "width": w, "height": h, "quality": q,
                    "output_size_bytes": sz, "output_size_mb": round(sz / _MB_DIV, 3),
                    "utilization": round(sz * 100.0 / max_bytes, 1),
                }
                if progress_cb:
                    progress_cb({"phase": "done", **params})
                return output_webp_path, params

        if progress_cb:
            progress_cb({"phase": "retry", "message": "Retrying with smaller size..."})
        nw = max(2, (int(w * _SCALE_STEP) >> 1) << 1)
        nh = max(2, (int(h * _SCALE_STEP) >> 1) << 1)
        if nw < min_w or nh < min_h:
            raise ConversionError("Could not reach target size; try a shorter clip or increase size limit.")
        w, h = nw, nh
