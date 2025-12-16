import subprocess
import os
import math
import tempfile
from typing import Dict, Tuple, Optional, Callable

from .encode_estimations import get_video_info, calculate_target_resolution, ConversionError

_SUBPROCESS_FLAGS = {"stdout": subprocess.PIPE, "stderr": subprocess.PIPE, "text": False}
_MB_DIV = 1048576.0


def _run_encode(input_path: str, palette_path: str, output_path: str, fps: float, w: int, h: int) -> subprocess.CompletedProcess:
    vf = f"fps={fps},scale={w}:{h}:flags=lanczos"
    cmd = [
        "ffmpeg", "-y", "-i", input_path, "-i", palette_path,
        "-filter_complex", f"{vf}[x];[x][1:v]paletteuse",
        output_path,
    ]
    r = subprocess.run(cmd, **_SUBPROCESS_FLAGS)
    if r.returncode:
        alt_cmd = [
            "ffmpeg", "-y", "-i", input_path,
            "-filter_complex", f"[0:v]{vf},split[a][b];[a]palettegen[p];[b][p]paletteuse",
            output_path,
        ]
        r = subprocess.run(alt_cmd, **_SUBPROCESS_FLAGS)
    return r


def _gen_palette(input_path: str, palette_path: str, fps: float, w: int, h: int) -> subprocess.CompletedProcess:
    cmd = ["ffmpeg", "-y", "-i", input_path, "-vf", f"fps={fps},scale={w}:{h}:flags=lanczos,palettegen", palette_path]
    return subprocess.run(cmd, **_SUBPROCESS_FLAGS)


def _encode_pass(input_path: str, output_path: str, fps: float, w: int, h: int, tmp_dir: str) -> int:
    palette_path = os.path.join(tmp_dir, "palette.png")
    r = _gen_palette(input_path, palette_path, fps, w, h)
    if r.returncode:
        err = r.stderr.decode("utf-8", errors="replace") if r.stderr else ""
        raise ConversionError(f"Palette generation failed: {''.join(err.strip().splitlines()[-15:]) or 'Unknown error'}")
    r = _run_encode(input_path, palette_path, output_path, fps, w, h)
    if r.returncode:
        err = r.stderr.decode("utf-8", errors="replace") if r.stderr else ""
        raise ConversionError(f"GIF encoding failed: {''.join(err.strip().splitlines()[-15:]) or 'Unknown error'}")
    return os.path.getsize(output_path)


def convert_video_to_gif_simple(
    input_video_path: str,
    output_gif_path: str,
    max_bytes: int,
    fps: float = 12,
    progress_cb: Optional[Callable] = None,
) -> Tuple[str, Dict]:
    if progress_cb:
        progress_cb({"phase": "analyze", "message": "Analyzing video..."})

    orig_w, orig_h, duration = get_video_info(input_video_path)
    if duration <= 0:
        raise ConversionError("Could not determine video duration")

    w, h = calculate_target_resolution(orig_w, orig_h, max_bytes, duration, fps, "gif")
    if progress_cb:
        progress_cb({"phase": "settings", "message": f"Target: {w}x{h} @ {fps}fps"})

    with tempfile.TemporaryDirectory() as tmp_dir:
        if progress_cb:
            progress_cb({"phase": "palette", "message": "Generating palette..."})
        if progress_cb:
            progress_cb({"phase": "encode", "message": "Encoding GIF..."})
        sz = _encode_pass(input_video_path, output_gif_path, fps, w, h, tmp_dir)

    if sz > max_bytes:
        if progress_cb:
            progress_cb({"phase": "retry", "message": "Retrying with smaller size..."})
        sf = math.sqrt(max_bytes * 0.9 / sz)
        w = max(2, (int(w * sf) >> 1) << 1)
        h = max(2, (int(h * sf) >> 1) << 1)
        with tempfile.TemporaryDirectory() as tmp_dir:
            sz = _encode_pass(input_video_path, output_gif_path, fps, w, h, tmp_dir)

    params = {
        "fps": fps, "width": w, "height": h,
        "output_size_bytes": sz, "output_size_mb": round(sz / _MB_DIV, 3),
        "utilization": round(sz * 100.0 / max_bytes, 1),
    }
    if progress_cb:
        progress_cb({"phase": "done", **params})
    return output_gif_path, params


def convert_video_to_gif_under_size(
    input_video_path: str,
    output_gif_path: str,
    max_bytes: int,
    progress_cb: Optional[Callable] = None,
) -> Tuple[str, Dict]:
    return convert_video_to_gif_simple(input_video_path, output_gif_path, max_bytes, 12, progress_cb)
