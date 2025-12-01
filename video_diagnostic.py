#!/usr/bin/env python3
"""
Video Diagnostic Tool
====================

A diagnostic utility to help identify issues with video files that cause
loading errors in the video clipper tool.

Usage:
    python video_diagnostic.py <video_file_path>

This tool will analyze the video file and provide information about:
- File integrity
- Codec information
- Container format
- Potential compatibility issues
- Recommendations for fixing issues
"""

import os
import sys
import subprocess
import json
from pathlib import Path
from typing import Dict, List, Optional


class VideoDiagnosticError(Exception):
    pass


def run_command(cmd: list) -> subprocess.CompletedProcess:
    """Run a command and return the result."""
    return subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )


def get_video_info(filepath: str) -> Dict:
    """Get detailed information about a video file using ffprobe."""
    cmd = [
        "ffprobe", "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=codec_name,codec_type,width,height,bit_rate,duration,pix_fmt,level,profile",
        "-show_entries", "format=format_name,duration,size,bit_rate",
        "-of", "json",
        filepath
    ]

    result = run_command(cmd)

    if result.returncode != 0:
        stderr_text = result.stderr.strip()
        raise VideoDiagnosticError(f"ffprobe failed: {stderr_text}")

    try:
        info = json.loads(result.stdout)
        return info
    except json.JSONDecodeError as e:
        raise VideoDiagnosticError(f"Failed to parse ffprobe output: {e}")


def get_codec_compatibility(codec_name: str) -> Dict:
    """Get compatibility information for a specific codec."""
    compatibility = {
        "h264": {
            "browser_support": "Excellent - supported by all modern browsers",
            "recommended": True,
            "notes": "Best choice for web compatibility"
        },
        "h265": {
            "browser_support": "Limited - Safari supports, others may not",
            "recommended": False,
            "notes": "Convert to H.264 for better browser support"
        },
        "hevc": {
            "browser_support": "Limited - Safari supports, others may not",
            "recommended": False,
            "notes": "Convert to H.264 for better browser support"
        },
        "vp9": {
            "browser_support": "Good - Chrome, Firefox, Edge support",
            "recommended": True,
            "notes": "Good alternative to H.264"
        },
        "vp8": {
            "browser_support": "Good - All browsers except Safari",
            "recommended": False,
            "notes": "Consider VP9 or H.264 for broader support"
        },
        "av1": {
            "browser_support": "Limited - Chrome and Firefox only",
            "recommended": False,
            "notes": "Still emerging, convert to H.264 for now"
        },
        "prores": {
            "browser_support": "None - Not supported by browsers",
            "recommended": False,
            "notes": "Convert to H.264 for browser compatibility. ProRes is common in MOV files from Final Cut Pro and Adobe Premiere"
        },
        "dnxhd": {
            "browser_support": "None - Not supported by browsers",
            "recommended": False,
            "notes": "Convert to H.264 for browser compatibility. DNxHD is common in MOV files from Avid Media Composer"
        },
        "apple_prores": {
            "browser_support": "None - Not supported by browsers",
            "recommended": False,
            "notes": "Convert to H.264 for browser compatibility"
        },
        "h264": {
            "browser_support": "Excellent - supported by all modern browsers",
            "recommended": True,
            "notes": "Best choice for web compatibility. Works well in both MP4 and MOV containers"
        },
        "hevc": {
            "browser_support": "Limited - Safari supports, others may not",
            "recommended": False,
            "notes": "Convert to H.264 for better browser support"
        }
    }

    return compatibility.get(codec_name.lower(), {
        "browser_support": "Unknown",
        "recommended": False,
        "notes": "May not be supported by browsers. Convert to H.264 for best compatibility"
    })


def diagnose_video_file(filepath: str) -> Dict:
    """Perform comprehensive diagnosis of a video file."""
    if not os.path.exists(filepath):
        raise VideoDiagnosticError(f"File not found: {filepath}")

    file_info = {
        "filepath": filepath,
        "filename": os.path.basename(filepath),
        "file_size": os.path.getsize(filepath),
        "file_size_mb": round(os.path.getsize(filepath) / (1024 * 1024), 2)
    }

    try:
        video_info = get_video_info(filepath)
        stream = video_info.get("streams", [{}])[0] if video_info.get("streams") else {}
        format_info = video_info.get("format", {})

        codec_name = stream.get("codec_name", "unknown")
        format_name = format_info.get("format_name", "unknown")

        diagnosis = {
            "status": "success",
            "codec": codec_name,
            "container_format": format_name,
            "width": stream.get("width", "unknown"),
            "height": stream.get("height", "unknown"),
            "duration": stream.get("duration", "unknown"),
            "bitrate": stream.get("bit_rate", "unknown"),
            "pixel_format": stream.get("pix_fmt", "unknown"),
            "codec_profile": stream.get("profile", "unknown"),
            "codec_level": stream.get("level", "unknown"),
            "compatibility": get_codec_compatibility(codec_name),
            "issues": [],
            "recommendations": []
        }

        # Check for potential issues
        if codec_name.lower() not in ["h264", "vp9", "vp8"]:
            if codec_name.lower() in ["prores", "dnxhd", "apple_prores"]:
                diagnosis["issues"].append(f"Codec '{codec_name}' is not supported by browsers. This is common in MOV files from professional editing software")
            else:
                diagnosis["issues"].append(f"Codec '{codec_name}' may not be supported by all browsers")

        if format_name.lower() == "mov":
            if codec_name.lower() in ["prores", "dnxhd", "apple_prores"]:
                diagnosis["issues"].append("MOV file uses ProRes/DNxHD codec which browsers don't support")
                diagnosis["recommendations"].append("Convert to MP4 with H.264 codec for web compatibility")
            elif codec_name.lower() not in ["h264", "hevc"]:
                diagnosis["issues"].append("MOV file uses an uncommon codec that may not be supported by browsers")

        if format_name.lower() not in ["mp4", "mov", "webm", "mkv"]:
            diagnosis["issues"].append(f"Container format '{format_name}' may cause compatibility issues")

        if diagnosis["compatibility"]["recommended"] == False:
            if format_name.lower() == "mov":
                diagnosis["recommendations"].append("Convert MOV to MP4 with H.264 codec for best browser compatibility")
            else:
                diagnosis["recommendations"].append("Convert to MP4 with H.264 codec for best browser compatibility")

        if file_info["file_size_mb"] > 2000:  # 2GB
            diagnosis["issues"].append("Large file size may cause memory issues")
            diagnosis["recommendations"].append("Consider compressing the video or using a smaller file")

        # MOV-specific recommendations
        if format_name.lower() == "mov" and diagnosis["compatibility"]["recommended"]:
            diagnosis["recommendations"].append("MOV files with H.264 work well, but MP4 is more universally supported")
            diagnosis["recommendations"].append("Consider converting MOV to MP4 for better compatibility across all platforms")

        return {**file_info, **diagnosis}

    except VideoDiagnosticError as e:
        return {
            **file_info,
            "status": "error",
            "error": str(e),
            "recommendations": [
                "Check if the file is corrupted",
                "Try playing the file in a media player to verify it's valid",
                "Convert to MP4 with H.264 codec using a video conversion tool",
                "Ensure the file is not password-protected or encrypted"
            ]
        }


def print_diagnosis(diagnosis: Dict):
    """Print formatted diagnosis results."""
    print("=" * 60)
    print("VIDEO FILE DIAGNOSTIC REPORT")
    print("=" * 60)

    print(f"File: {diagnosis['filename']}")
    print(f"Path: {diagnosis['filepath']}")
    print(f"Size: {diagnosis['file_size_mb']} MB")
    print()

    if diagnosis["status"] == "error":
        print("❌ DIAGNOSIS FAILED")
        print(f"Error: {diagnosis['error']}")
        print()
        print("RECOMMENDATIONS:")
        for rec in diagnosis.get("recommendations", []):
            print(f"  • {rec}")
        return

    print("✅ DIAGNOSIS SUCCESSFUL")
    print(f"Codec: {diagnosis['codec']}")
    print(f"Container: {diagnosis['container_format']}")
    print(f"Resolution: {diagnosis['width']}x{diagnosis['height']}")
    print(f"Duration: {diagnosis['duration']} seconds")
    print(f"Browser Support: {diagnosis['compatibility']['browser_support']}")

    # MOV-specific information
    if diagnosis['container_format'].lower() == 'mov':
        print()
        print("🎬 MOV FILE DETECTED")
        if diagnosis['codec'].lower() in ['prores', 'dnxhd', 'apple_prores']:
            print("⚠️  Professional codec detected - not browser compatible")
            print("   This MOV likely comes from Final Cut Pro, Adobe Premiere, or Avid Media Composer")
        elif diagnosis['codec'].lower() == 'h264':
            print("✅ H.264 codec - should work well in browsers")
        elif diagnosis['codec'].lower() == 'hevc':
            print("⚠️  HEVC codec - limited browser support (Safari only)")

    print()

    if diagnosis["issues"]:
        print("⚠️  POTENTIAL ISSUES:")
        for issue in diagnosis["issues"]:
            print(f"  • {issue}")

    if diagnosis["recommendations"]:
        print()
        print("💡 RECOMMENDATIONS:")
        for rec in diagnosis["recommendations"]:
            print(f"  • {rec}")

    print()
    print("📋 CODEC DETAILS:")
    print(f"  Profile: {diagnosis['codec_profile']}")
    print(f"  Level: {diagnosis['codec_level']}")
    print(f"  Pixel Format: {diagnosis['pixel_format']}")
    print(f"  Bitrate: {diagnosis['bitrate']}")

    print()
    print("=" * 60)


def main():
    if len(sys.argv) != 2:
        print("Usage: python video_diagnostic.py <video_file_path>")
        print("Example: python video_diagnostic.py myvideo.mp4")
        sys.exit(1)

    filepath = sys.argv[1]

    try:
        diagnosis = diagnose_video_file(filepath)
        print_diagnosis(diagnosis)
    except Exception as e:
        print(f"Diagnostic failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
