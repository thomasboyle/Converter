from typing import Callable, Dict, Optional, Sequence, Tuple

from .ffmpeg_subprocess import x264_preset
from .size_encode import encode_video_under_size

_CRF_CANDIDATES = (23, 28, 32, 36, 40, 44, 48, 52)


def _build_mp4_cmd(input_video_path: str, output_mp4_path: str, vf: str, crf: int) -> Sequence[str]:
    return [
        "ffmpeg",
        "-y",
        "-i",
        input_video_path,
        "-vf",
        vf,
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        "-pix_fmt",
        "yuv420p",
        "-preset",
        x264_preset(),
        "-crf",
        str(crf),
        output_mp4_path,
    ]


def convert_video_to_mp4_under_size(
    input_video_path: str,
    output_mp4_path: str,
    max_bytes: int,
    fps: float = 24,
    progress_cb: Optional[Callable] = None,
    cancel_check: Optional[Callable[[], bool]] = None,
) -> Tuple[str, Dict]:
    return encode_video_under_size(
        input_video_path,
        output_mp4_path,
        max_bytes,
        fps,
        "mp4",
        _CRF_CANDIDATES,
        "crf",
        _build_mp4_cmd,
        "Encoding MP4",
        progress_cb=progress_cb,
        cancel_check=cancel_check,
    )
