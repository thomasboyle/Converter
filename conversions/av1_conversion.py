import os
from typing import Callable, Dict, Optional, Sequence, Tuple

from .encode_estimations import ConversionError
from .ffmpeg_av1 import available_av1_encoder
from .ffmpeg_subprocess import run_ffmpeg, svtav1_preset, x264_preset
from .size_encode import encode_video_under_size

_CRF_CANDIDATES = (23, 28, 32, 36, 40, 44, 48, 52)


def _build_av1_mp4_cmd(
    input_video_path: str,
    output_av1_path: str,
    vf: str,
    crf: int,
    encoder: str,
) -> Sequence[str]:
    preset = svtav1_preset()
    if encoder == "libsvtav1":
        return [
            "ffmpeg",
            "-y",
            "-i",
            input_video_path,
            "-vf",
            vf,
            "-c:v",
            "libsvtav1",
            "-c:a",
            "aac",
            "-pix_fmt",
            "yuv420p10le",
            "-preset",
            preset,
            "-crf",
            str(crf),
            "-b:v",
            "0",
            "-movflags",
            "+faststart",
            "-f",
            "mp4",
            output_av1_path,
        ]
    if encoder == "libaom-av1":
        return [
            "ffmpeg",
            "-y",
            "-i",
            input_video_path,
            "-vf",
            vf,
            "-c:v",
            "libaom-av1",
            "-c:a",
            "aac",
            "-pix_fmt",
            "yuv420p10le",
            "-cpu-used",
            "4",
            "-crf",
            str(crf),
            "-b:v",
            "0",
            "-movflags",
            "+faststart",
            "-f",
            "mp4",
            output_av1_path,
        ]
    raise ConversionError(f"Unsupported AV1 encoder: {encoder}")


def convert_video_to_av1_under_size(
    input_video_path: str,
    output_av1_path: str,
    max_bytes: int,
    fps: float = 24,
    progress_cb: Optional[Callable] = None,
    cancel_check: Optional[Callable[[], bool]] = None,
) -> Tuple[str, Dict]:
    encoder = available_av1_encoder()

    def build_cmd(inp: str, out: str, vf: str, crf: int) -> Sequence[str]:
        return _build_av1_mp4_cmd(inp, out, vf, crf, encoder)

    return encode_video_under_size(
        input_video_path,
        output_av1_path,
        max_bytes,
        fps,
        "av1",
        _CRF_CANDIDATES,
        "crf",
        build_cmd,
        f"Encoding AV1 ({encoder})",
        progress_cb=progress_cb,
        cancel_check=cancel_check,
        extra_result={"encoder": encoder},
    )
