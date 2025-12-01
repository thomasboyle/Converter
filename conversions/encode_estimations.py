import subprocess
import json
import math
from typing import Tuple


class ConversionError(Exception):
    pass


def get_video_info(path: str) -> Tuple[int, int, float]:
    cmd = [
        "ffprobe", "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height,duration",
        "-of", "json", path
    ]
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=False)

    if result.returncode == 0:
        stdout_text = result.stdout.decode('utf-8', errors='replace') if result.stdout else ""
        info = json.loads(stdout_text)
        if info.get("streams") and len(info["streams"]) > 0:
            stream = info["streams"][0]
            width = int(stream["width"])
            height = int(stream["height"])
            duration = float(stream.get("duration", 0))

            if duration > 0:
                return width, height, duration

    cmd = [
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "json", path
    ]
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=False)

    if result.returncode == 0:
        stdout_text = result.stdout.decode('utf-8', errors='replace') if result.stdout else ""
        info = json.loads(stdout_text)
        if info.get("format") and info["format"].get("duration"):
            duration = float(info["format"]["duration"])
            if duration > 0:
                stream_cmd = [
                    "ffprobe", "-v", "error",
                    "-select_streams", "v:0",
                    "-show_entries", "stream=width,height",
                    "-of", "json", path
                ]
                stream_result = subprocess.run(stream_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=False)
                if stream_result.returncode == 0:
                    stdout_text = stream_result.stdout.decode('utf-8', errors='replace') if stream_result.stdout else ""
                    stream_info = json.loads(stdout_text)
                    if stream_info.get("streams") and len(stream_info["streams"]) > 0:
                        stream = stream_info["streams"][0]
                        width = int(stream["width"])
                        height = int(stream["height"])
                        return width, height, duration

    cmd = [
        "ffprobe", "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height,nb_frames,r_frame_rate",
        "-of", "json", path
    ]
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=False)

    if result.returncode == 0:
        stdout_text = result.stdout.decode('utf-8', errors='replace') if result.stdout else ""
        info = json.loads(stdout_text)
        if info.get("streams") and len(info["streams"]) > 0:
            stream = info["streams"][0]
            width = int(stream["width"])
            height = int(stream["height"])

            nb_frames = stream.get("nb_frames")
            r_frame_rate = stream.get("r_frame_rate")

            if nb_frames and r_frame_rate:
                try:
                    num, den = map(int, r_frame_rate.split("/"))
                    if den > 0:
                        duration = float(nb_frames) / (num / den)
                        if duration > 0:
                            return width, height, duration
                except (ValueError, ZeroDivisionError):
                    pass

    if result.returncode != 0:
        stderr_text = result.stderr.decode('utf-8', errors='replace') if result.stderr else ""

        # Provide more specific error messages for ffprobe failures
        if "No such file or directory" in stderr_text:
            error_msg = f"Video file not found or inaccessible: {path}"
        elif "Invalid data found when processing input" in stderr_text:
            error_msg = f"Corrupted or invalid video file. The file may be damaged: {path}"
        elif "Permission denied" in stderr_text:
            error_msg = f"Permission denied accessing video file: {path}"
        elif "moov atom not found" in stderr_text:
            error_msg = f"Invalid MP4/MOV file structure. The file may be incomplete or corrupted: {path}"
        elif "codec not supported" in stderr_text.lower():
            error_msg = f"Video codec not supported by ffprobe. The file may use an unusual codec: {path}"
        else:
            error_msg = f"ffprobe failed: {stderr_text.strip()}"

        raise ConversionError(error_msg)
    else:
        raise ConversionError(f"Could not determine video duration from any source. The file may be corrupted or use an unsupported format: {path}")


def calculate_target_resolution(orig_width: int, orig_height: int,
                              max_bytes: int, duration: float, fps: float = 12,
                              format_type: str = "gif") -> Tuple[int, int]:
    bytes_per_pixel_per_second = 1.0
    max_pixels_per_frame = max_bytes / (duration * fps * bytes_per_pixel_per_second)

    current_pixels = orig_width * orig_height
    if current_pixels <= max_pixels_per_frame:
        scale = 1.0
    else:
        scale = math.sqrt(max_pixels_per_frame / current_pixels)

    if format_type.lower() == "gif":
        conservative_factor = 2.5
    elif format_type.lower() == "avif":
        conservative_factor = 5.0
    elif format_type.lower() == "webp":
        conservative_factor = 3.0
    elif format_type.lower() == "mp4":
        conservative_factor = 1.0
    elif format_type.lower() == "av1":
        conservative_factor = 5.0
    else:
        conservative_factor = 4.0

    scale *= conservative_factor
    # Ensure we never exceed the original resolution
    scale = min(scale, 1.0)
    width = max(2, int((orig_width * scale) // 2) * 2)
    height = max(2, int((orig_height * scale) // 2) * 2)

    return width, height
