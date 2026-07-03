"""Run ffmpeg/ffprobe with optional cancellation and desktop fast presets."""
from __future__ import annotations

import os
import subprocess
import time
from typing import Callable, Optional, Sequence

from .subprocess_win import win_hide_console_kwargs

_POLL_INTERVAL = 0.25
_WIN_KWARGS = win_hide_console_kwargs()


def fast_mode() -> bool:
    return os.environ.get("CONVERTER_FAST", "").strip().lower() in ("1", "true", "yes")


def x264_preset() -> str:
    return "veryfast" if fast_mode() else "fast"


def svtav1_preset() -> str:
    return "10" if fast_mode() else "8"


def run_ffmpeg(
    cmd: Sequence[str],
    *,
    cancel_check: Optional[Callable[[], bool]] = None,
    error_prefix: str = "FFmpeg failed",
    format_error: Optional[Callable[[str], str]] = None,
) -> None:
    from .encode_estimations import ConversionError

    proc = subprocess.Popen(
        list(cmd),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        **_WIN_KWARGS,
    )
    try:
        while proc.poll() is None:
            if cancel_check and cancel_check():
                proc.kill()
                proc.wait()
                raise ConversionError("Conversion cancelled by user")
            time.sleep(_POLL_INTERVAL)
    except Exception:
        if proc.poll() is None:
            proc.kill()
            proc.wait()
        raise

    if proc.returncode != 0:
        err = proc.stderr.read().decode("utf-8", errors="replace") if proc.stderr else ""
        if format_error:
            raise ConversionError(format_error(err))
        tail = "".join(err.strip().splitlines()[-15:]) or "Unknown error"
        raise ConversionError(f"{error_prefix}: {tail}")
    if proc.stderr:
        proc.stderr.close()


def run_ffprobe(cmd: Sequence[str]) -> subprocess.CompletedProcess:
    return subprocess.run(
        list(cmd),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=False,
        **_WIN_KWARGS,
    )
