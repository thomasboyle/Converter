import subprocess
import os
from typing import Dict, Tuple, Optional, Callable

from .encode_estimations import get_video_info, calculate_target_resolution, ConversionError

_SUBPROCESS_FLAGS = {"stdout": subprocess.PIPE, "stderr": subprocess.PIPE, "text": False}
_CRF_CANDIDATES = (23, 28, 32, 36, 40, 44, 48, 52)
_SCALE_STEP = 0.86
_MB_DIV = 1048576.0


def convert_video_to_mp4_under_size(
    input_video_path: str,
    output_mp4_path: str,
    max_bytes: int,
    fps: float = 24,
    progress_cb: Optional[Callable] = None,
) -> Tuple[str, Dict]:
    if progress_cb:
        progress_cb({"phase": "analyze", "message": "Analyzing video..."})

    orig_w, orig_h, duration = get_video_info(input_video_path)
    if duration <= 0:
        raise ConversionError("Could not determine video duration")

    w, h = calculate_target_resolution(orig_w, orig_h, max_bytes, duration, fps, "mp4")
    min_w = max(2, (int(w * 0.5) >> 1) << 1)
    min_h = max(2, (int(h * 0.5) >> 1) << 1)

    cmd_template = [
        "ffmpeg", "-y", "-i", input_video_path,
        "-vf", None,
        "-c:v", "libx264", "-c:a", "aac",
        "-pix_fmt", "yuv420p", "-preset", "fast",
        "-crf", None,
        output_mp4_path,
    ]

    while True:
        vf = f"fps={fps},scale={w}:{h}:flags=lanczos"
        for crf in _CRF_CANDIDATES:
            if progress_cb:
                progress_cb({"phase": "encode", "message": f"Encoding MP4... {w}x{h} @ {fps}fps, CRF {crf}"})
            cmd = cmd_template.copy()
            cmd[5] = vf
            cmd[13] = str(crf)
            r = subprocess.run(cmd, **_SUBPROCESS_FLAGS)
            if r.returncode:
                err = r.stderr.decode("utf-8", errors="replace") if r.stderr else ""
                raise ConversionError(f"MP4 encoding failed: {''.join(err.strip().splitlines()[-15:]) or 'Unknown error'}")
            sz = os.path.getsize(output_mp4_path)
            if sz <= max_bytes:
                params = {
                    "fps": fps, "width": w, "height": h, "crf": crf,
                    "output_size_bytes": sz, "output_size_mb": round(sz / _MB_DIV, 3),
                    "utilization": round(sz * 100.0 / max_bytes, 1),
                }
                if progress_cb:
                    progress_cb({"phase": "done", **params})
                return output_mp4_path, params

        if progress_cb:
            progress_cb({"phase": "retry", "message": "Retrying with smaller size..."})
        nw = max(2, (int(w * _SCALE_STEP) >> 1) << 1)
        nh = max(2, (int(h * _SCALE_STEP) >> 1) << 1)
        if nw < min_w or nh < min_h:
            raise ConversionError("Could not reach target size; try a shorter clip or increase size limit.")
        w, h = nw, nh
