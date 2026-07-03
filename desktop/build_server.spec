# -*- mode: python ; coding: utf-8 -*-
import pathlib

block_cipher = None

DESKTOP = pathlib.Path(SPECPATH).resolve()
REPO_ROOT = DESKTOP.parent
DIST_UI = DESKTOP / "frontend" / "dist"

if not DIST_UI.is_dir():
    raise SystemExit(
        f"Missing {DIST_UI}. Run: npm run build:ui (from the desktop folder)."
    )

# Keep unrelated site-packages out (common when building with a bloated system Python).
_EXCLUDES = [
    "IPython",
    "PIL",
    "PyQt5",
    "PyQt6",
    "PySide6",
    "PySide2",
    "black",
    "contourpy",
    "cv2",
    "cycler",
    "dateutil",
    "docutils",
    "fontTools",
    "imageio",
    "jupyter",
    "jupyterlab",
    "kiwisolver",
    "lxml",
    "matplotlib",
    "nbformat",
    "notebook",
    "numba",
    "numpy",
    "pandas",
    "parso",
    "playwright",
    "pygments",
    "pygame",
    "pyparsing",
    "pytest",
    "scipy",
    "sklearn",
    "sphinx",
    "sympy",
    "tkinter",
    "torch",
    "tornado",
    "traitlets",
    "tensorflow",
    "webview",
    "zmq",
]

a = Analysis(
    [str(DESKTOP / "server.py")],
    pathex=[str(REPO_ROOT), str(DESKTOP)],
    binaries=[],
    datas=[(str(DIST_UI), "frontend/dist")],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=_EXCLUDES,
    noarchive=False,
    optimize=2,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="converter-server",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="converter-server",
)
