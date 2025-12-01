import subprocess
import os
from typing import Dict, Tuple, Optional, Callable

from .encode_estimations import get_video_info, ConversionError


def _run_ffmpeg(cmd: list) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=False,
    )


def clip_video_to_timestamps(
    input_video_path: str,
    output_video_path: str,
    start_time: float,
    end_time: float,
    progress_cb: Optional[Callable] = None,
) -> Tuple[str, Dict]:
    """
    Clip a video to specific start and end timestamps.

    Args:
        input_video_path: Path to the input video file
        output_video_path: Path where the clipped video should be saved
        start_time: Start time in seconds
        end_time: End time in seconds
        progress_cb: Optional callback for progress updates

    Returns:
        Tuple of (output_path, params_dict)
    """

    if progress_cb:
        progress_cb({"phase": "analyze", "message": "Analyzing video..."})

    # Get original video info
    orig_width, orig_height, duration = get_video_info(input_video_path)
    if duration <= 0:
        raise ConversionError("Could not determine video duration")

    # Validate time parameters
    if start_time < 0:
        start_time = 0
    if end_time > duration:
        end_time = duration
    if start_time >= end_time:
        raise ConversionError("Start time must be before end time")
    if end_time - start_time < 0.1:  # Minimum 100ms clip
        raise ConversionError("Clip duration must be at least 0.1 seconds")

    clip_duration = end_time - start_time

    if progress_cb:
        progress_cb({"phase": "clip", "message": "Clipping video..."})

    # FFmpeg command for precise clipping
    cmd = [
        "ffmpeg", "-y",  # -y to overwrite output file
        "-i", input_video_path,
        "-ss", str(start_time),  # Start time
        "-t", str(clip_duration),  # Duration
        "-c", "copy",  # Copy streams without re-encoding (fastest)
        "-avoid_negative_ts", "make_zero",  # Handle negative timestamps
        output_video_path,
    ]

    result = _run_ffmpeg(cmd)

    if result.returncode != 0:
        stderr_text = result.stderr.decode('utf-8', errors='replace') if result.stderr else ""
        stdout_text = result.stdout.decode('utf-8', errors='replace') if result.stdout else ""

        # Provide more specific error messages based on common issues
        error_msg = stderr_tail = "\n".join(stderr_text.strip().splitlines()[-10:])

        if "No such file or directory" in stderr_text:
            error_msg = f"Input file not found or inaccessible: {input_video_path}"
        elif "Invalid data found when processing input" in stderr_text:
            if input_video_path.lower().endswith('.mov'):
                error_msg = f"Corrupted MOV file or unsupported codec. MOV files with ProRes/DNxHD codecs are not supported. Convert to MP4 with H.264: {input_video_path}"
            else:
                error_msg = f"Corrupted or invalid video file. The file may be damaged or use an unsupported codec: {input_video_path}"
        elif "Permission denied" in stderr_text:
            error_msg = f"Permission denied accessing file: {input_video_path}"
        elif "codec not supported" in stderr_text.lower():
            if input_video_path.lower().endswith('.mov'):
                error_msg = f"MOV codec not supported. MOV files often use ProRes or other professional codecs. Convert to MP4 with H.264: {input_video_path}"
            else:
                error_msg = f"Video codec not supported. Try using MP4 with H.264 codec instead: {input_video_path}"
        elif "moov atom not found" in stderr_text:
            if input_video_path.lower().endswith('.mov'):
                error_msg = f"Invalid MOV file structure. The MOV file may be corrupted, incomplete, or use an unsupported codec: {input_video_path}"
            else:
                error_msg = f"Invalid MP4/MOV file structure. The file may be corrupted or incomplete: {input_video_path}"
        elif "Stream map" in stderr_text and "does not match" in stderr_text:
            if input_video_path.lower().endswith('.mov'):
                error_msg = f"MOV stream mapping issue. This MOV likely uses ProRes or another codec that doesn't support stream copying. Try re-encoding to H.264: {input_video_path}"
            else:
                error_msg = f"Stream mapping issue. This may be due to unusual codec or container combinations: {input_video_path}"
        else:
            error_msg = f"Video clipping failed: {stderr_tail or 'Unknown error'}"

        raise ConversionError(error_msg)

    # Verify output file exists and get its size
    if not os.path.exists(output_video_path):
        raise ConversionError("Output file was not created")

    final_size = os.path.getsize(output_video_path)

    # Get output video info to verify
    try:
        output_width, output_height, output_duration = get_video_info(output_video_path)
    except Exception:
        output_width, output_height, output_duration = orig_width, orig_height, clip_duration

    params = {
        "original_duration": duration,
        "original_width": orig_width,
        "original_height": orig_height,
        "clip_start_time": start_time,
        "clip_end_time": end_time,
        "clip_duration": clip_duration,
        "output_width": output_width,
        "output_height": output_height,
        "output_duration": output_duration,
        "output_size_bytes": final_size,
        "output_size_mb": round(final_size / (1024 * 1024), 3),
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
    """
    Clip a video to specific start and end timestamps with re-encoding.
    Use this if stream copying fails (e.g., with certain codecs or timestamps).

    Args:
        input_video_path: Path to the input video file
        output_video_path: Path where the clipped video should be saved
        start_time: Start time in seconds
        end_time: End time in seconds
        progress_cb: Optional callback for progress updates

    Returns:
        Tuple of (output_path, params_dict)
    """

    if progress_cb:
        progress_cb({"phase": "analyze", "message": "Analyzing video for re-encoding..."})

    # Get original video info
    orig_width, orig_height, duration = get_video_info(input_video_path)
    if duration <= 0:
        raise ConversionError("Could not determine video duration")

    # Validate time parameters
    if start_time < 0:
        start_time = 0
    if end_time > duration:
        end_time = duration
    if start_time >= end_time:
        raise ConversionError("Start time must be before end time")
    if end_time - start_time < 0.1:  # Minimum 100ms clip
        raise ConversionError("Clip duration must be at least 0.1 seconds")

    clip_duration = end_time - start_time

    if progress_cb:
        progress_cb({"phase": "clip", "message": "Re-encoding and clipping video..."})

    # FFmpeg command with re-encoding for problematic files
    cmd = [
        "ffmpeg", "-y",
        "-i", input_video_path,
        "-ss", str(start_time),  # Start time
        "-t", str(clip_duration),  # Duration
        "-c:v", "libx264",  # Re-encode video
        "-c:a", "aac",  # Re-encode audio
        "-preset", "fast",  # Fast encoding preset
        "-crf", "23",  # Good quality
        "-pix_fmt", "yuv420p",  # Ensure compatibility
        "-movflags", "+faststart",  # Web optimization
        output_video_path,
    ]

    result = _run_ffmpeg(cmd)

    if result.returncode != 0:
        stderr_text = result.stderr.decode('utf-8', errors='replace') if result.stderr else ""
        stdout_text = result.stdout.decode('utf-8', errors='replace') if result.stdout else ""

        # Provide more specific error messages for re-encoding issues
        stderr_tail = "\n".join(stderr_text.strip().splitlines()[-10:])

        if "codec not supported" in stderr_text.lower():
            if input_video_path.lower().endswith('.mov'):
                error_msg = f"MOV codec not supported for re-encoding. MOV files often use ProRes or other professional codecs. Try converting to MP4 with H.264 first: {input_video_path}"
            else:
                error_msg = f"Video codec not supported for re-encoding. The file may use an unusual codec: {input_video_path}"
        elif "Invalid data found" in stderr_text:
            if input_video_path.lower().endswith('.mov'):
                error_msg = f"Corrupted MOV file or unsupported codec. MOV files with ProRes/DNxHD codecs need conversion to H.264 first: {input_video_path}"
            else:
                error_msg = f"Corrupted or invalid video file that cannot be re-encoded: {input_video_path}"
        elif "No space left on device" in stderr_text:
            error_msg = "No space left on device. Please free up some disk space and try again."
        elif "Cannot allocate memory" in stderr_text:
            error_msg = "Not enough memory to process this video. Try using a smaller file or more RAM."
        elif "Permission denied" in stderr_text:
            error_msg = f"Permission denied writing to output location: {output_video_path}"
        else:
            error_msg = f"Video clipping with re-encoding failed: {stderr_tail or 'Unknown error'}"

        raise ConversionError(error_msg)

    # Verify output file exists and get its size
    if not os.path.exists(output_video_path):
        raise ConversionError("Output file was not created")

    final_size = os.path.getsize(output_video_path)

    # Get output video info
    try:
        output_width, output_height, output_duration = get_video_info(output_video_path)
    except Exception:
        output_width, output_height, output_duration = orig_width, orig_height, clip_duration

    params = {
        "original_duration": duration,
        "original_width": orig_width,
        "original_height": orig_height,
        "clip_start_time": start_time,
        "clip_end_time": end_time,
        "clip_duration": clip_duration,
        "output_width": output_width,
        "output_height": output_height,
        "output_duration": output_duration,
        "output_size_bytes": final_size,
        "output_size_mb": round(final_size / (1024 * 1024), 3),
        "reencoded": True,
    }

    if progress_cb:
        progress_cb({"phase": "done", **params})

    return output_video_path, params
