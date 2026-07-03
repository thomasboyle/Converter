"""Binary-search quality/CRF sweeps with resolution backoff until output fits."""
from __future__ import annotations

import os
from typing import Callable, Dict, Optional, Sequence, Tuple

from .encode_estimations import ConversionError, calculate_target_resolution, get_video_info
from .ffmpeg_subprocess import run_ffmpeg

_SCALE_STEP = 0.86
_MB_DIV = 1048576.0


class _NeedsScaleDown(Exception):
    __slots__ = ()


def _binary_search_param(
    candidates: Sequence[int],
    encode: Callable[[int], None],
    output_path: str,
    max_bytes: int,
    progress_cb: Optional[Callable],
    cancel_check: Optional[Callable[[], bool]],
    message_for: Callable[[int], str],
) -> Tuple[int, int]:
    lo, hi = 0, len(candidates) - 1
    best_idx: Optional[int] = None
    best_sz = 0
    sizes: Dict[int, int] = {}

    def size_at(idx: int) -> int:
        if idx not in sizes:
            param = candidates[idx]
            if progress_cb:
                progress_cb({"phase": "encode", "message": message_for(param)})
            encode(param)
            sizes[idx] = os.path.getsize(output_path)
        return sizes[idx]

    while lo <= hi:
        mid = (lo + hi) // 2
        sz = size_at(mid)
        if cancel_check and cancel_check():
            raise ConversionError("Conversion cancelled by user")
        if sz <= max_bytes:
            best_idx = mid
            best_sz = sz
            hi = mid - 1
        else:
            lo = mid + 1

    if best_idx is None:
        raise _NeedsScaleDown()
    return candidates[best_idx], best_sz


def encode_video_under_size(
    input_video_path: str,
    output_path: str,
    max_bytes: int,
    fps: float,
    format_type: str,
    param_candidates: Sequence[int],
    param_key: str,
    build_cmd: Callable[[str, str, str, int], Sequence[str]],
    error_prefix: str,
    progress_cb: Optional[Callable] = None,
    cancel_check: Optional[Callable[[], bool]] = None,
    extra_result: Optional[Dict] = None,
) -> Tuple[str, Dict]:
    if progress_cb:
        progress_cb({"phase": "analyze", "message": "Analyzing video..."})

    orig_w, orig_h, duration = get_video_info(input_video_path)
    if duration <= 0:
        raise ConversionError("Could not determine video duration")

    w, h = calculate_target_resolution(orig_w, orig_h, max_bytes, duration, fps, format_type)
    min_w = max(2, (int(w * 0.5) >> 1) << 1)
    min_h = max(2, (int(h * 0.5) >> 1) << 1)

    while True:
        vf = f"fps={fps},scale={w}:{h}:flags=lanczos"

        def encode(param: int) -> None:
            run_ffmpeg(
                build_cmd(input_video_path, output_path, vf, param),
                cancel_check=cancel_check,
                error_prefix=error_prefix,
            )

        try:
            chosen, sz = _binary_search_param(
                param_candidates,
                encode,
                output_path,
                max_bytes,
                progress_cb,
                cancel_check,
                lambda p: f"{error_prefix}... {w}x{h} @ {fps}fps, {param_key} {p}",
            )
        except _NeedsScaleDown:
            if progress_cb:
                progress_cb({"phase": "retry", "message": "Retrying with smaller size..."})
            nw = max(2, (int(w * _SCALE_STEP) >> 1) << 1)
            nh = max(2, (int(h * _SCALE_STEP) >> 1) << 1)
            if nw < min_w or nh < min_h:
                raise ConversionError("Could not reach target size; try a shorter clip or increase size limit.")
            w, h = nw, nh
            continue

        params = {
            "fps": fps,
            "width": w,
            "height": h,
            param_key: chosen,
            "output_size_bytes": sz,
            "output_size_mb": round(sz / _MB_DIV, 3),
            "utilization": round(sz * 100.0 / max_bytes, 1),
        }
        if extra_result:
            params.update(extra_result)
        if progress_cb:
            progress_cb({"phase": "done", **params})
        return output_path, params
