"""Hide console windows for child processes on Windows (ffmpeg/ffprobe)."""
from __future__ import annotations

import subprocess
import sys
from typing import Any, Dict

if sys.platform == "win32":
    _FLAGS: Dict[str, Any] = {"creationflags": subprocess.CREATE_NO_WINDOW}
else:
    _FLAGS = {}


def win_hide_console_kwargs() -> Dict[str, Any]:
    return dict(_FLAGS)
