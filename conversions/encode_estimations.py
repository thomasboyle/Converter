import json
import math
from typing import Tuple

from .ffmpeg_subprocess import run_ffprobe
from .subprocess_win import win_hide_console_kwargs

_ERROR_MAP = (
    ("No such file or directory", "Video file not found or inaccessible: {}"),
    ("Invalid data found when processing input", "Corrupted or invalid video file. The file may be damaged: {}"),
    ("Permission denied", "Permission denied accessing video file: {}"),
    ("moov atom not found", "Invalid MP4/MOV file structure. The file may be incomplete or corrupted: {}"),
    ("codec not supported", "Video codec not supported by ffprobe. The file may use an unusual codec: {}"),
)
_FORMAT_FACTORS = {"gif": 2.5, "avif": 5.0, "webp": 3.0, "mp4": 1.0, "av1": 5.0}
_MB_DIVISOR = 1048576.0


class ConversionError(Exception):
    __slots__ = ()


def _duration_from_stream(stream: dict) -> float:
    raw = stream.get("duration")
    if raw is not None:
        try:
            d = float(raw)
            if d > 0:
                return d
        except (TypeError, ValueError):
            pass
    nb, rfr = stream.get("nb_frames"), stream.get("r_frame_rate")
    if nb and rfr:
        try:
            num, den = map(int, str(rfr).split("/"))
            if den:
                d = float(nb) * den / num
                if d > 0:
                    return d
        except (ValueError, ZeroDivisionError):
            pass
    return 0.0


def get_video_info(path: str) -> Tuple[int, int, float]:
    result = run_ffprobe(
        [
            "ffprobe",
            "-v",
            "error",
            "-of",
            "json",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height,duration,nb_frames,r_frame_rate",
            "-show_entries",
            "format=duration",
            path,
        ]
    )
    if result.returncode != 0 or not result.stdout:
        stderr = result.stderr.decode("utf-8", errors="replace") if result.stderr else ""
        sl = stderr.lower()
        for pat, msg in _ERROR_MAP:
            if pat.lower() in sl:
                raise ConversionError(msg.format(path))
        raise ConversionError(f"ffprobe failed: {stderr.strip()}")

    info = json.loads(result.stdout)
    streams = info.get("streams") or []
    if not streams:
        raise ConversionError(
            f"Could not determine video duration from any source. "
            f"The file may be corrupted or use an unsupported format: {path}"
        )

    s = streams[0]
    w, h = int(s["width"]), int(s["height"])
    duration = _duration_from_stream(s)
    if duration <= 0:
        fmt = info.get("format") or {}
        try:
            duration = float(fmt.get("duration") or 0)
        except (TypeError, ValueError):
            duration = 0.0

    if duration <= 0:
        raise ConversionError(
            f"Could not determine video duration from any source. "
            f"The file may be corrupted or use an unsupported format: {path}"
        )
    return w, h, duration


def calculate_target_resolution(
    orig_width: int, orig_height: int, max_bytes: int, duration: float, fps: float = 12, format_type: str = "gif"
) -> Tuple[int, int]:
    max_pix = max_bytes / (duration * fps)
    cur_pix = orig_width * orig_height
    scale = math.sqrt(max_pix / cur_pix) if cur_pix > max_pix else 1.0
    scale = min(scale * _FORMAT_FACTORS.get(format_type.lower(), 4.0), 1.0)
    w = max(2, (int(orig_width * scale) >> 1) << 1)
    h = max(2, (int(orig_height * scale) >> 1) << 1)
    return w, h
