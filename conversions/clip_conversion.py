import subprocess
import os
from typing import Dict, Tuple, Optional, Callable

from .encode_estimations import get_video_info, ConversionError

_SUBPROCESS_FLAGS = {"stdout": subprocess.PIPE, "stderr": subprocess.PIPE, "text": False}
_MB_DIV = 1048576.0
_MOV_EXT = ".mov"

_ERROR_PATTERNS_COPY = (
    ("No such file or directory", "Input file not found or inaccessible: {}"),
    ("Invalid data found when processing input", "Corrupted or invalid video file. The file may be damaged or use an unsupported codec: {}"),
    ("Permission denied", "Permission denied accessing file: {}"),
    ("moov atom not found", "Invalid MP4/MOV file structure. The file may be corrupted or incomplete: {}"),
)
_ERROR_PATTERNS_MOV = (
    ("Invalid data found when processing input", "Corrupted MOV file or unsupported codec. MOV files with ProRes/DNxHD codecs are not supported. Convert to MP4 with H.264: {}"),
    ("codec not supported", "MOV codec not supported. MOV files often use ProRes or other professional codecs. Convert to MP4 with H.264: {}"),
    ("moov atom not found", "Invalid MOV file structure. The MOV file may be corrupted, incomplete, or use an unsupported codec: {}"),
    ("Stream map", "MOV stream mapping issue. This MOV likely uses ProRes or another codec that doesn't support stream copying. Try re-encoding to H.264: {}"),
)


def _get_error_msg(stderr: str, path: str, is_mov: bool, is_reencode: bool = False) -> str:
    sl = stderr.lower()
    patterns = _ERROR_PATTERNS_MOV if is_mov else _ERROR_PATTERNS_COPY
    for pat, msg in patterns:
        if pat.lower() in sl:
            return msg.format(path)
    for pat, msg in _ERROR_PATTERNS_COPY:
        if pat.lower() in sl:
            return msg.format(path)
    if is_reencode:
        if "no space left on device" in sl:
            return "No space left on device. Please free up some disk space and try again."
        if "cannot allocate memory" in sl:
            return "Not enough memory to process this video. Try using a smaller file or more RAM."
    tail = "\n".join(stderr.strip().splitlines()[-10:])
    prefix = "Video clipping with re-encoding failed" if is_reencode else "Video clipping failed"
    return f"{prefix}: {tail or 'Unknown error'}"


def clip_video_to_timestamps(
    input_video_path: str,
    output_video_path: str,
    start_time: float,
    end_time: float,
    progress_cb: Optional[Callable] = None,
) -> Tuple[str, Dict]:
    if progress_cb:
        progress_cb({"phase": "analyze", "message": "Analyzing video..."})

    orig_w, orig_h, duration = get_video_info(input_video_path)
    if duration <= 0:
        raise ConversionError("Could not determine video duration")

    start_time = max(0.0, start_time)
    end_time = min(duration, end_time)
    if start_time >= end_time:
        raise ConversionError("Start time must be before end time")
    clip_dur = end_time - start_time
    if clip_dur < 0.1:
        raise ConversionError("Clip duration must be at least 0.1 seconds")

    if progress_cb:
        progress_cb({"phase": "clip", "message": "Clipping video..."})

    cmd = [
        "ffmpeg", "-y", "-i", input_video_path,
        "-ss", str(start_time), "-t", str(clip_dur),
        "-c", "copy", "-avoid_negative_ts", "make_zero",
        output_video_path,
    ]
    r = subprocess.run(cmd, **_SUBPROCESS_FLAGS)
    if r.returncode:
        err = r.stderr.decode("utf-8", errors="replace") if r.stderr else ""
        is_mov = input_video_path.lower().endswith(_MOV_EXT)
        raise ConversionError(_get_error_msg(err, input_video_path, is_mov))

    if not os.path.exists(output_video_path):
        raise ConversionError("Output file was not created")

    sz = os.path.getsize(output_video_path)
    try:
        out_w, out_h, out_dur = get_video_info(output_video_path)
    except Exception:
        out_w, out_h, out_dur = orig_w, orig_h, clip_dur

    params = {
        "original_duration": duration, "original_width": orig_w, "original_height": orig_h,
        "clip_start_time": start_time, "clip_end_time": end_time, "clip_duration": clip_dur,
        "output_width": out_w, "output_height": out_h, "output_duration": out_dur,
        "output_size_bytes": sz, "output_size_mb": round(sz / _MB_DIV, 3),
    }
    if progress_cb:
        progress_cb({"phase": "done", **params})
    return output_video_path, params


def clip_video_to_timestamps_with_reencode(
    input_video_path: str,
    output_video_path: str,
    start_time: float,
    end_time: float,
    progress_cb: Optional[Callable] = None,
) -> Tuple[str, Dict]:
    if progress_cb:
        progress_cb({"phase": "analyze", "message": "Analyzing video for re-encoding..."})

    orig_w, orig_h, duration = get_video_info(input_video_path)
    if duration <= 0:
        raise ConversionError("Could not determine video duration")

    start_time = max(0.0, start_time)
    end_time = min(duration, end_time)
    if start_time >= end_time:
        raise ConversionError("Start time must be before end time")
    clip_dur = end_time - start_time
    if clip_dur < 0.1:
        raise ConversionError("Clip duration must be at least 0.1 seconds")

    if progress_cb:
        progress_cb({"phase": "clip", "message": "Re-encoding and clipping video..."})

    cmd = [
        "ffmpeg", "-y", "-i", input_video_path,
        "-ss", str(start_time), "-t", str(clip_dur),
        "-c:v", "libx264", "-c:a", "aac",
        "-preset", "fast", "-crf", "23",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        output_video_path,
    ]
    r = subprocess.run(cmd, **_SUBPROCESS_FLAGS)
    if r.returncode:
        err = r.stderr.decode("utf-8", errors="replace") if r.stderr else ""
        is_mov = input_video_path.lower().endswith(_MOV_EXT)
        raise ConversionError(_get_error_msg(err, input_video_path, is_mov, is_reencode=True))

    if not os.path.exists(output_video_path):
        raise ConversionError("Output file was not created")

    sz = os.path.getsize(output_video_path)
    try:
        out_w, out_h, out_dur = get_video_info(output_video_path)
    except Exception:
        out_w, out_h, out_dur = orig_w, orig_h, clip_dur

    params = {
        "original_duration": duration, "original_width": orig_w, "original_height": orig_h,
        "clip_start_time": start_time, "clip_end_time": end_time, "clip_duration": clip_dur,
        "output_width": out_w, "output_height": out_h, "output_duration": out_dur,
        "output_size_bytes": sz, "output_size_mb": round(sz / _MB_DIV, 3),
        "reencoded": True,
    }
    if progress_cb:
        progress_cb({"phase": "done", **params})
    return output_video_path, params
