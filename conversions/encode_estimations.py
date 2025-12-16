import subprocess
import json
import math
from typing import Tuple

_SUBPROCESS_FLAGS = {"stdout": subprocess.PIPE, "stderr": subprocess.PIPE, "text": False}
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


def get_video_info(path: str) -> Tuple[int, int, float]:
    cmd_base = ["ffprobe", "-v", "error", "-of", "json", path]
    result = subprocess.run(
        cmd_base[:3] + ["-select_streams", "v:0", "-show_entries", "stream=width,height,duration"] + cmd_base[3:],
        **_SUBPROCESS_FLAGS
    )
    if result.returncode == 0 and result.stdout:
        info = json.loads(result.stdout)
        streams = info.get("streams")
        if streams:
            s = streams[0]
            w, h = int(s["width"]), int(s["height"])
            d = float(s.get("duration", 0))
            if d > 0:
                return w, h, d

    result = subprocess.run(
        cmd_base[:3] + ["-show_entries", "format=duration"] + cmd_base[3:],
        **_SUBPROCESS_FLAGS
    )
    if result.returncode == 0 and result.stdout:
        info = json.loads(result.stdout)
        fmt = info.get("format")
        if fmt:
            d = float(fmt.get("duration", 0))
            if d > 0:
                r2 = subprocess.run(
                    cmd_base[:3] + ["-select_streams", "v:0", "-show_entries", "stream=width,height"] + cmd_base[3:],
                    **_SUBPROCESS_FLAGS
                )
                if r2.returncode == 0 and r2.stdout:
                    si = json.loads(r2.stdout)
                    ss = si.get("streams")
                    if ss:
                        return int(ss[0]["width"]), int(ss[0]["height"]), d

    result = subprocess.run(
        cmd_base[:3] + ["-select_streams", "v:0", "-show_entries", "stream=width,height,nb_frames,r_frame_rate"] + cmd_base[3:],
        **_SUBPROCESS_FLAGS
    )
    if result.returncode == 0 and result.stdout:
        info = json.loads(result.stdout)
        streams = info.get("streams")
        if streams:
            s = streams[0]
            w, h = int(s["width"]), int(s["height"])
            nb, rfr = s.get("nb_frames"), s.get("r_frame_rate")
            if nb and rfr:
                try:
                    num, den = map(int, rfr.split("/"))
                    if den:
                        d = float(nb) * den / num
                        if d > 0:
                            return w, h, d
                except (ValueError, ZeroDivisionError):
                    pass

    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="replace") if result.stderr else ""
        sl = stderr.lower()
        for pat, msg in _ERROR_MAP:
            if pat.lower() in sl:
                raise ConversionError(msg.format(path))
        raise ConversionError(f"ffprobe failed: {stderr.strip()}")
    raise ConversionError(f"Could not determine video duration from any source. The file may be corrupted or use an unsupported format: {path}")


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
