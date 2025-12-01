import subprocess
import os
import math
import tempfile
from typing import Dict, Tuple, Optional, Callable

from .encode_estimations import get_video_info, calculate_target_resolution, ConversionError


def convert_video_to_gif_simple(input_video_path: str, output_gif_path: str,
                               max_bytes: int, fps: float = 12,
                               progress_cb: Optional[Callable] = None) -> Tuple[str, Dict]:

    if progress_cb:
        progress_cb({"phase": "analyze", "message": "Analyzing video..."})

    orig_width, orig_height, duration = get_video_info(input_video_path)

    if duration <= 0:
        raise ConversionError("Could not determine video duration")

    width, height = calculate_target_resolution(orig_width, orig_height, max_bytes, duration, fps, "gif")

    if progress_cb:
        progress_cb({
            "phase": "settings",
            "message": f"Target: {width}x{height} @ {fps}fps"
        })

    with tempfile.TemporaryDirectory() as tmp_dir:
        palette_path = os.path.join(tmp_dir, "palette.png")

        if progress_cb:
            progress_cb({"phase": "palette", "message": "Generating palette..."})

        palette_cmd = [
            "ffmpeg", "-y", "-i", input_video_path,
            "-vf", f"fps={fps},scale={width}:{height}:flags=lanczos,palettegen",
            palette_path
        ]

        result = subprocess.run(
            palette_cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=False,
        )
        if result.returncode != 0:
            stderr_text = result.stderr.decode('utf-8', errors='replace') if result.stderr else ""
            stderr_tail = "\n".join(stderr_text.strip().splitlines()[-15:])
            raise ConversionError(f"Palette generation failed: {stderr_tail or 'Unknown error'}")

        if progress_cb:
            progress_cb({"phase": "encode", "message": "Encoding GIF..."})

        encode_cmd = [
            "ffmpeg", "-y", "-i", input_video_path, "-i", palette_path,
            "-filter_complex",
            f"fps={fps},scale={width}:{height}:flags=lanczos[x];[x][1:v]paletteuse",
            output_gif_path
        ]

        result = subprocess.run(
            encode_cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=False,
        )
        if result.returncode != 0:
            alt_encode_cmd = [
                "ffmpeg", "-y", "-i", input_video_path,
                "-filter_complex",
                f"[0:v]fps={fps},scale={width}:{height}:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse",
                output_gif_path,
            ]
            alt = subprocess.run(
                alt_encode_cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=False,
            )
            if alt.returncode != 0:
                stderr_text_main = result.stderr.decode('utf-8', errors='replace') if result.stderr else ""
                stderr_text_alt = alt.stderr.decode('utf-8', errors='replace') if alt.stderr else ""
                stderr_tail_main = "\n".join(stderr_text_main.strip().splitlines()[-15:])
                stderr_tail_alt = "\n".join(stderr_text_alt.strip().splitlines()[-15:])
                raise ConversionError(
                    "GIF encoding failed: primary and fallback encoders failed.\n"
                    f"Primary: {stderr_tail_main or 'Unknown error'}\n"
                    f"Fallback: {stderr_tail_alt or 'Unknown error'}"
                )

    final_size = os.path.getsize(output_gif_path)

    if final_size > max_bytes:
        if progress_cb:
            progress_cb({"phase": "retry", "message": "Retrying with smaller size..."})

        scale_factor = math.sqrt(max_bytes * 0.9 / final_size)
        new_width = max(2, int((width * scale_factor) // 2) * 2)
        new_height = max(2, int((height * scale_factor) // 2) * 2)

        with tempfile.TemporaryDirectory() as tmp_dir:
            palette_path = os.path.join(tmp_dir, "palette.png")

            palette_cmd = [
                "ffmpeg", "-y", "-i", input_video_path,
                "-vf", f"fps={fps},scale={new_width}:{new_height}:flags=lanczos,palettegen",
                palette_path
            ]
            result = subprocess.run(
                palette_cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=False,
            )
            if result.returncode != 0:
                stderr_text = result.stderr.decode('utf-8', errors='replace') if result.stderr else ""
                stderr_tail = "\n".join(stderr_text.strip().splitlines()[-15:])
                raise ConversionError(f"Palette generation failed (retry): {stderr_tail or 'Unknown error'}")

            encode_cmd = [
                "ffmpeg", "-y", "-i", input_video_path, "-i", palette_path,
                "-filter_complex",
                f"fps={fps},scale={new_width}:{new_height}:flags=lanczos[x];[x][1:v]paletteuse",
                output_gif_path
            ]
            result = subprocess.run(
                encode_cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=False,
            )
            if result.returncode != 0:
                alt_encode_cmd = [
                    "ffmpeg", "-y", "-i", input_video_path,
                    "-filter_complex",
                    f"[0:v]fps={fps},scale={new_width}:{new_height}:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse",
                    output_gif_path,
                ]
                alt = subprocess.run(
                    alt_encode_cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=False,
                )
                if alt.returncode != 0:
                    stderr_text_main = result.stderr.decode('utf-8', errors='replace') if result.stderr else ""
                    stderr_text_alt = alt.stderr.decode('utf-8', errors='replace') if alt.stderr else ""
                    stderr_tail_main = "\n".join(stderr_text_main.strip().splitlines()[-15:])
                    stderr_tail_alt = "\n".join(stderr_text_alt.strip().splitlines()[-15:])
                    raise ConversionError(
                        "GIF encoding failed (retry): primary and fallback encoders failed.\n"
                        f"Primary: {stderr_tail_main or 'Unknown error'}\n"
                        f"Fallback: {stderr_tail_alt or 'Unknown error'}"
                    )

        final_size = os.path.getsize(output_gif_path)
        width, height = new_width, new_height

    params = {
        "fps": fps,
        "width": width,
        "height": height,
        "output_size_bytes": final_size,
        "output_size_mb": round(final_size / (1024 * 1024), 3),
        "utilization": round((final_size / max_bytes) * 100, 1)
    }

    if progress_cb:
        progress_cb({"phase": "done", **params})

    return output_gif_path, params


def convert_video_to_gif_under_size(input_video_path: str, output_gif_path: str,
                                  max_bytes: int, progress_cb: Optional[Callable] = None) -> Tuple[str, Dict]:
    return convert_video_to_gif_simple(input_video_path, output_gif_path, max_bytes, 12, progress_cb)
