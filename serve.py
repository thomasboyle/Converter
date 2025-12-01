from waitress import serve
import os
import threading
import subprocess
import sys
import argparse
from app import create_app

def start_cleanup_service():
    """Start the file cleanup service in the background"""
    try:
        # Start cleanup service as a subprocess
        cleanup_script = os.path.join(os.path.dirname(__file__), 'file_cleardown.py')
        subprocess.Popen([sys.executable, cleanup_script],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                        cwd=os.path.dirname(__file__))
        print("File cleanup service started in background")
    except Exception as e:
        print(f"Failed to start cleanup service: {e}")

def main():
    parser = argparse.ArgumentParser(description='Run the video converter server')
    parser.add_argument('--dev', action='store_true',
                       help='Run in development mode with hot reloading')
    parser.add_argument('--port', type=int, default=int(os.environ.get('PORT', 5000)),
                       help='Port to run the server on (default: 5000)')

    args = parser.parse_args()

    app = create_app()

    # Start cleanup service in background thread
    cleanup_thread = threading.Thread(target=start_cleanup_service, daemon=True)
    cleanup_thread.start()

    if args.dev:
        print(f"Starting Flask development server on port {args.port} with hot reloading enabled")
        print("Hot reloading will automatically restart the server when you make changes to:")
        print("  - Python files (.py)")
        print("  - HTML templates")
        print("  - CSS files")
        print("  - Other Flask-tracked files")
        print("\nPress Ctrl+C to stop the server")

        # Enable Flask's development server with hot reloading
        app.run(
            host='127.0.0.1',
            port=args.port,
            debug=True,
            use_reloader=True,  # Enable hot reloading
            threaded=True
        )
    else:
        print(f"Starting Waitress production server on port {args.port} with background cleanup service")
        serve(
            app,
            host='127.0.0.1',
            port=args.port,
            max_request_body_size=2 * 1024 * 1024 * 1024,
        )

if __name__ == '__main__':
    main()