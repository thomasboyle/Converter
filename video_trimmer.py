#!/usr/bin/env python3
"""
Video Trimmer - Comprehensive Video Clipping Tool
==============================================

A powerful programmatic video trimming utility that supports:
- Precise time-based trimming
- Multiple output formats
- Batch processing
- Advanced FFmpeg options
- Progress tracking
- Quality preservation
- Format conversion during trim

This module provides the VideoTrimmer class for programmatic video trimming operations.
"""

import os
import sys
import json

import subprocess
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Union, Callable
from dataclasses import dataclass
from datetime import datetime


@dataclass
class VideoInfo:
    """Container for video information."""
    width: int
    height: int
    duration: float
    fps: float = 0.0
    codec: str = ""
    bitrate: str = ""
    file_size: int = 0
    format_name: str = ""


@dataclass
class TrimConfig:
    """Configuration for video trimming operation."""
    start_time: float
    end_time: float
    output_format: str = "copy"
    quality: str = "auto"
    reencode: bool = False
    preserve_audio: bool = True
    fast_start: bool = True
    crf: int = 23
    preset: str = "fast"
    audio_codec: str = "copy"
    video_codec: str = "copy"


class VideoTrimmerError(Exception):
    """Custom exception for video trimming operations."""
    pass


class ProgressTracker:
    """Track and display progress for video operations."""

    def __init__(self, total_steps: int = 100, show_progress: bool = True):
        self.total_steps = total_steps
        self.current_step = 0
        self.show_progress = show_progress
        self.start_time = time.time()

    def update(self, step: int = 1, message: str = ""):
        """Update progress."""
        self.current_step += step
        if self.show_progress:
            progress = min(100, (self.current_step / self.total_steps) * 100)
            elapsed = time.time() - self.start_time
            eta = (elapsed / max(self.current_step, 1)) * (self.total_steps - self.current_step)

            bar = "=" * int(progress / 2) + " " * (50 - int(progress / 2))
            print(".1f"
                  ".1f", flush=True)

    def complete(self, message: str = "Complete!"):
        """Mark progress as complete."""
        if self.show_progress:
            print(f"\r[{message}] {'=' * 50} 100.0% | ETA: 0.0s", flush=True)


class VideoTrimmer:
    """Main video trimming utility class."""

    SUPPORTED_FORMATS = {
        'mp4': {'ext': '.mp4', 'video_codec': 'libx264', 'audio_codec': 'aac'},
        'avi': {'ext': '.avi', 'video_codec': 'libx264', 'audio_codec': 'mp3'},
        'mov': {'ext': '.mov', 'video_codec': 'libx264', 'audio_codec': 'aac'},
        'mkv': {'ext': '.mkv', 'video_codec': 'libx264', 'audio_codec': 'aac'},
        'webm': {'ext': '.webm', 'video_codec': 'libvpx-vp9', 'audio_codec': 'opus'},
        'gif': {'ext': '.gif', 'video_codec': 'gif', 'audio_codec': None},
        'copy': {'ext': None, 'video_codec': 'copy', 'audio_codec': 'copy'}
    }

    QUALITY_PRESETS = {
        'low': {'crf': 35, 'preset': 'ultrafast'},
        'medium': {'crf': 28, 'preset': 'fast'},
        'high': {'crf': 20, 'preset': 'slow'},
        'auto': {'crf': 23, 'preset': 'fast'}
    }

    def __init__(self, ffmpeg_path: str = "ffmpeg", ffprobe_path: str = "ffprobe"):
        """Initialize the video trimmer.

        Args:
            ffmpeg_path: Path to ffmpeg executable
            ffprobe_path: Path to ffprobe executable
        """
        self.ffmpeg_path = ffmpeg_path
        self.ffprobe_path = ffprobe_path
        self._check_ffmpeg()

    def _check_ffmpeg(self):
        """Check if FFmpeg and FFprobe are available."""
        try:
            subprocess.run([self.ffmpeg_path, "-version"],
                         capture_output=True, check=True)
            subprocess.run([self.ffprobe_path, "-version"],
                         capture_output=True, check=True)
        except (subprocess.CalledProcessError, FileNotFoundError):
            raise VideoTrimmerError(
                "FFmpeg or FFprobe not found. Please install FFmpeg and ensure it's in your PATH."
            )

    def _run_command(self, cmd: List[str]) -> subprocess.CompletedProcess:
        """Run a command and return the result."""
        return subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

    def get_video_info(self, input_path: str) -> VideoInfo:
        """Get detailed information about a video file.

        Args:
            input_path: Path to the video file

        Returns:
            VideoInfo object with video details
        """
        if not os.path.exists(input_path):
            raise VideoTrimmerError(f"Input file not found: {input_path}")

        cmd = [
            self.ffprobe_path, "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height,codec_name,avg_frame_rate,bit_rate",
            "-show_entries", "format=duration,size,format_name",
            "-of", "json",
            input_path
        ]

        result = self._run_command(cmd)

        if result.returncode != 0:
            raise VideoTrimmerError(f"Failed to get video info: {result.stderr}")

        try:
            info = json.loads(result.stdout)
            stream = info.get("streams", [{}])[0]
            format_info = info.get("format", {})

            # Parse frame rate
            fps_str = stream.get("avg_frame_rate", "0/1")
            if "/" in fps_str:
                num, den = map(int, fps_str.split("/"))
                fps = num / den if den != 0 else 0
            else:
                fps = float(fps_str)

            return VideoInfo(
                width=int(stream.get("width", 0)),
                height=int(stream.get("height", 0)),
                duration=float(format_info.get("duration", 0)),
                fps=fps,
                codec=stream.get("codec_name", ""),
                bitrate=stream.get("bit_rate", ""),
                file_size=int(format_info.get("size", 0)),
                format_name=format_info.get("format_name", "")
            )

        except (json.JSONDecodeError, KeyError, ValueError) as e:
            raise VideoTrimmerError(f"Failed to parse video info: {e}")

    def parse_time(self, time_str: str) -> float:
        """Parse time string to seconds.

        Supports formats:
        - Seconds: "10.5", "30"
        - MM:SS: "01:30", "2:45"
        - HH:MM:SS: "01:02:30", "1:2:30"

        Args:
            time_str: Time string to parse

        Returns:
            Time in seconds
        """
        if ":" in time_str:
            parts = time_str.split(":")
            if len(parts) == 2:
                minutes, seconds = map(float, parts)
                return minutes * 60 + seconds
            elif len(parts) == 3:
                hours, minutes, seconds = map(float, parts)
                return hours * 3600 + minutes * 60 + seconds
            else:
                raise VideoTrimmerError(f"Invalid time format: {time_str}")
        else:
            return float(time_str)

    def format_time(self, seconds: float) -> str:
        """Format seconds to HH:MM:SS string."""
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = seconds % 60

        if hours > 0:
            return "02d"
        else:
            return "02d"

    def _build_ffmpeg_command(self, input_path: str, output_path: str,
                             config: TrimConfig) -> List[str]:
        """Build FFmpeg command for trimming.

        Args:
            input_path: Input video path
            output_path: Output video path
            config: Trimming configuration

        Returns:
            List of FFmpeg command arguments
        """
        cmd = [self.ffmpeg_path, "-y"]

        # Input file
        cmd.extend(["-i", input_path])

        # Time parameters
        cmd.extend(["-ss", str(config.start_time)])
        cmd.extend(["-t", str(config.end_time - config.start_time)])

        # Video codec
        if config.video_codec == "copy":
            cmd.extend(["-c:v", "copy"])
        else:
            cmd.extend(["-c:v", config.video_codec])
            cmd.extend(["-crf", str(config.crf)])
            cmd.extend(["-preset", config.preset])

        # Audio codec
        if config.audio_codec == "copy":
            cmd.extend(["-c:a", "copy"])
        elif config.audio_codec is None:
            cmd.extend(["-an"])  # No audio
        else:
            cmd.extend(["-c:a", config.audio_codec])

        # Additional options
        if config.fast_start:
            cmd.extend(["-movflags", "+faststart"])

        # Pixel format for compatibility
        if config.video_codec != "copy":
            cmd.extend(["-pix_fmt", "yuv420p"])

        # Output file
        cmd.append(output_path)

        return cmd

    def trim_video(self, input_path: str, output_path: str,
                  start_time: Union[str, float], end_time: Union[str, float],
                  progress_callback: Optional[Callable] = None,
                  **kwargs) -> Dict:
        """Trim a video with advanced options.

        Args:
            input_path: Path to input video
            output_path: Path for output video
            start_time: Start time (string or float)
            end_time: End time (string or float)
            progress_callback: Optional progress callback
            **kwargs: Additional options (format, quality, reencode, etc.)

        Returns:
            Dictionary with trim results and metadata
        """
        # Parse times
        if isinstance(start_time, str):
            start_time = self.parse_time(start_time)
        if isinstance(end_time, str):
            end_time = self.parse_time(end_time)

        # Get video info
        if progress_callback:
            progress_callback({"phase": "analyze", "message": "Analyzing video..."})

        video_info = self.get_video_info(input_path)

        # Validate times
        if start_time < 0:
            start_time = 0
        if end_time > video_info.duration:
            end_time = video_info.duration
        if start_time >= end_time:
            raise VideoTrimmerError("Start time must be before end time")
        if end_time - start_time < 0.1:
            raise VideoTrimmerError("Clip duration must be at least 0.1 seconds")

        # Build configuration
        config = TrimConfig(
            start_time=start_time,
            end_time=end_time,
            output_format=kwargs.get("format", "copy"),
            quality=kwargs.get("quality", "auto"),
            reencode=kwargs.get("reencode", False),
            preserve_audio=kwargs.get("preserve_audio", True),
            fast_start=kwargs.get("fast_start", True),
            crf=kwargs.get("crf", 23),
            preset=kwargs.get("preset", "fast")
        )

        # Apply quality preset
        if config.quality in self.QUALITY_PRESETS:
            preset = self.QUALITY_PRESETS[config.quality]
            config.crf = preset["crf"]
            config.preset = preset["preset"]

        # Determine codecs
        if config.reencode or config.output_format != "copy":
            format_info = self.SUPPORTED_FORMATS.get(config.output_format, self.SUPPORTED_FORMATS["copy"])
            config.video_codec = format_info["video_codec"]
            config.audio_codec = format_info["audio_codec"] if config.preserve_audio else None
        else:
            config.video_codec = "copy"
            config.audio_codec = "copy" if config.preserve_audio else None

        # Set output extension if not specified
        if config.output_format != "copy" and not output_path.endswith(format_info["ext"]):
            output_path = str(Path(output_path).with_suffix(format_info["ext"]))

        # Trim video
        if progress_callback:
            progress_callback({"phase": "trim", "message": "Trimming video..."})

        cmd = self._build_ffmpeg_command(input_path, output_path, config)
        result = self._run_command(cmd)

        if result.returncode != 0:
            raise VideoTrimmerError(f"FFmpeg error: {result.stderr}")

        # Verify output
        if not os.path.exists(output_path):
            raise VideoTrimmerError("Output file was not created")

        output_info = self.get_video_info(output_path)
        output_size = os.path.getsize(output_path)

        results = {
            "input_file": input_path,
            "output_file": output_path,
            "start_time": start_time,
            "end_time": end_time,
            "clip_duration": end_time - start_time,
            "original_info": {
                "duration": video_info.duration,
                "width": video_info.width,
                "height": video_info.height,
                "codec": video_info.codec,
                "size": video_info.file_size
            },
            "output_info": {
                "duration": output_info.duration,
                "width": output_info.width,
                "height": output_info.height,
                "codec": output_info.codec,
                "size": output_size
            },
            "config": {
                "format": config.output_format,
                "quality": config.quality,
                "reencoded": config.reencode,
                "crf": config.crf,
                "preset": config.preset
            },
            "success": True
        }

        if progress_callback:
            progress_callback({"phase": "complete", "message": "Trim complete!", **results})

        return results

    def batch_trim(self, input_files: List[str], output_dir: str,
                  start_time: Union[str, float], end_time: Union[str, float],
                  progress_callback: Optional[Callable] = None,
                  **kwargs) -> List[Dict]:
        """Trim multiple videos with the same settings.

        Args:
            input_files: List of input video paths
            output_dir: Directory for output files
            start_time: Start time for all clips
            end_time: End time for all clips
            progress_callback: Optional progress callback
            **kwargs: Additional options

        Returns:
            List of trim results
        """
        os.makedirs(output_dir, exist_ok=True)
        results = []

        total_files = len(input_files)
        for i, input_file in enumerate(input_files):
            if progress_callback:
                progress_callback({
                    "phase": "batch",
                    "current": i + 1,
                    "total": total_files,
                    "file": os.path.basename(input_file)
                })

            try:
                # Generate output path
                basename = Path(input_file).stem
                ext = kwargs.get("format", "copy")
                if ext != "copy":
                    output_ext = self.SUPPORTED_FORMATS.get(ext, {"ext": ".mp4"})["ext"]
                else:
                    output_ext = Path(input_file).suffix

                output_path = os.path.join(output_dir, f"{basename}_trimmed{output_ext}")

                # Trim the video
                result = self.trim_video(input_file, output_path, start_time, end_time, **kwargs)
                results.append(result)

            except Exception as e:
                if progress_callback:
                    progress_callback({
                        "phase": "error",
                        "file": input_file,
                        "error": str(e)
                    })
                results.append({"input_file": input_file, "error": str(e), "success": False})

        return results






