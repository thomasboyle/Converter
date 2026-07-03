from typing import Callable, Dict, Optional, Sequence, Tuple

from .size_encode import encode_video_under_size

_QUALITY_CANDIDATES = (85, 75, 65, 55, 45, 35, 25)


def _build_webp_cmd(input_video_path: str, output_webp_path: str, vf: str, quality: int) -> Sequence[str]:
    return [
        "ffmpeg",
        "-y",
        "-i",
        input_video_path,
        "-vf",
        vf,
        "-an",
        "-c:v",
        "libwebp_anim",
        "-quality",
        str(quality),
        "-loop",
        "0",
        "-b:v",
        "0",
        output_webp_path,
    ]


def convert_video_to_webp_under_size(
    input_video_path: str,
    output_webp_path: str,
    max_bytes: int,
    fps: float = 12,
    progress_cb: Optional[Callable] = None,
    cancel_check: Optional[Callable[[], bool]] = None,
) -> Tuple[str, Dict]:
    return encode_video_under_size(
        input_video_path,
        output_webp_path,
        max_bytes,
        fps,
        "webp",
        _QUALITY_CANDIDATES,
        "quality",
        _build_webp_cmd,
        "Encoding animated WebP",
        progress_cb=progress_cb,
        cancel_check=cancel_check,
    )
