#!/usr/bin/env python3
"""
Simple file cleanup service for uploads folder
Deletes files older than 24 hours, checks every hour
"""

import os
import time
import logging
from pathlib import Path

# Configure basic logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(message)s'
)

def cleanup_old_files():
    """Delete files older than 24 hours from uploads folder"""
    uploads_dir = Path("uploads")
    cutoff_time = time.time() - (24 * 3600)  # 24 hours ago

    if not uploads_dir.exists():
        return 0, 0

    deleted_count = 0
    total_size_freed = 0

    try:
        for file_path in uploads_dir.iterdir():
            if file_path.is_file():
                file_mtime = file_path.stat().st_mtime

                if file_mtime < cutoff_time:
                    try:
                        file_size = file_path.stat().st_size
                        file_path.unlink()
                        deleted_count += 1
                        total_size_freed += file_size
                    except Exception as e:
                        logging.error(f"Failed to delete {file_path.name}: {e}")

        if deleted_count > 0:
            size_mb = total_size_freed / (1024 * 1024)
            logging.info(f"Cleaned up {deleted_count} files, freed {size_mb:.2f} MB")

        return deleted_count, total_size_freed

    except Exception as e:
        logging.error(f"Error during cleanup: {e}")
        return 0, 0

def run_cleanup_service():
    """Run cleanup service - check every hour"""
    logging.info("Starting file cleanup service (checks every hour)")

    while True:
        try:
            cleanup_old_files()
            time.sleep(3600)  # Wait 1 hour
        except KeyboardInterrupt:
            logging.info("Cleanup service stopped")
            break
        except Exception as e:
            logging.error(f"Cleanup service error: {e}")
            time.sleep(60)  # Wait 1 minute before retrying

if __name__ == "__main__":
    run_cleanup_service()
