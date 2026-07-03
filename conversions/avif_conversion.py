from typing import Callable, Dict, Optional, Sequence, Tuple

from .encode_estimations import ConversionError
from .ffmpeg_av1 import available_av1_encoder
from .ffmpeg_subprocess import svtav1_preset
from .size_encode import encode_video_under_size

_CRF_CANDIDATES = (28, 32, 36, 40, 44, 48, 52)


def _build_avif_cmd(
    input_video_path: str,
    output_avif_path: str,
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
            "-an",
            "-c:v",
            "libsvtav1",
            "-pix_fmt",
            "yuv420p10le",
            "-preset",
            preset,
            "-crf",
            str(crf),
            "-b:v",
            "0",
            output_avif_path,
        ]
    if encoder == "libaom-av1":
        return [
            "ffmpeg",
            "-y",
            "-i",
            input_video_path,
            "-vf",
            vf,
            "-an",
            "-c:v",
            "libaom-av1",
            "-pix_fmt",
            "yuv420p10le",
            "-cpu-used",
            "4",
            "-crf",
            str(crf),
            "-b:v",
            "0",
            output_avif_path,
        ]
    raise ConversionError(f"Unsupported AV1 encoder: {encoder}")


def convert_video_to_avif_under_size(
    input_video_path: str,
    output_avif_path: str,
    max_bytes: int,
    fps: float = 12,
    progress_cb: Optional[Callable] = None,
    cancel_check: Optional[Callable[[], bool]] = None,
) -> Tuple[str, Dict]:
    encoder = available_av1_encoder()

    def build_cmd(inp: str, out: str, vf: str, crf: int) -> Sequence[str]:
        return _build_avif_cmd(inp, out, vf, crf, encoder)

    return encode_video_under_size(
        input_video_path,
        output_avif_path,
        max_bytes,
        fps,
        "avif",
        _CRF_CANDIDATES,
        "crf",
        build_cmd,
        f"Encoding AVIF ({encoder})",
        progress_cb=progress_cb,
        cancel_check=cancel_check,
        extra_result={"encoder": encoder},
    )
