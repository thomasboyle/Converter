"""Local API + React static (production) for the Electron desktop app."""
from __future__ import annotations

import argparse
import os
import socket
import sys
import pathlib

if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
    APP_DIR = pathlib.Path(sys._MEIPASS)
else:
    APP_DIR = pathlib.Path(__file__).resolve().parent
    repo_root = APP_DIR.parent
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))

from app import create_app

DIST_DIR = APP_DIR / "frontend" / "dist"


def _pick_port(preferred: int) -> int:
    if preferred != 0:
        return preferred
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--electron",
        action="store_true",
        help="Bind an ephemeral port and print DESKTOP_PORT=<n> for Electron",
    )
    args = parser.parse_args()
    preferred = 0 if args.electron else int(os.environ.get("PORT", "8742"))
    port = _pick_port(preferred)
    spa_dist = DIST_DIR if DIST_DIR.is_dir() else None
    app = create_app(desktop=True, spa_dist=spa_dist)
    if args.electron:
        print(f"DESKTOP_PORT={port}", flush=True)
    try:
        from waitress import serve

        serve(app, host="127.0.0.1", port=port, threads=4)
    except ImportError:
        app.run(host="127.0.0.1", port=port, threaded=True, use_reloader=False)


if __name__ == "__main__":
    main()
