"""Resolve which AV1 encoder the available ffmpeg binary supports."""
from __future__ import annotations

from typing import Optional

from .encode_estimations import ConversionError
from .ffmpeg_subprocess import run_ffprobe

_cached: Optional[str] = None


def available_av1_encoder() -> str:
    global _cached
    if _cached is not None:
        return _cached
    r = run_ffprobe(["ffmpeg", "-hide_banner", "-encoders"])
    blob = (r.stderr or b"") + (r.stdout or b"")
    text = blob.decode("utf-8", errors="replace")
    if "libsvtav1" in text:
        _cached = "libsvtav1"
    elif "libaom-av1" in text:
        _cached = "libaom-av1"
    else:
        raise ConversionError(
            "FFmpeg has no AV1 encoder (need libsvtav1 or libaom-av1). "
            "Use MP4, WebP, or GIF, or install an FFmpeg build with AV1 enabled."
        )
    return _cached
