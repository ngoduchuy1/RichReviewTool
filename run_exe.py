import sys
import os

# Allow frozen app to load system-installed libraries (like torch, transformers, etc.)
site_packages = r"C:\Program Files\Python312\Lib\site-packages"
if os.path.exists(site_packages) and site_packages not in sys.path:
    sys.path.append(site_packages)

import threading
import time
import socket
import webview

# Redirect stdout and stderr to a log file next to the executable when frozen
if getattr(sys, 'frozen', False):
    exe_dir = os.path.dirname(sys.executable)
    log_path = os.path.join(exe_dir, "app_log.txt")
    try:
        log_file = open(log_path, "w", encoding="utf-8", buffering=1)
        sys.stdout = log_file
        sys.stderr = log_file
    except Exception:
        pass

def kill_port(port):
    try:
        import subprocess
        result = subprocess.run(f'netstat -ano | findstr :{port}', shell=True, capture_output=True, text=True)
        for line in result.stdout.strip().splitlines():
            parts = line.split()
            if parts and parts[-1].isdigit():
                pid = int(parts[-1])
                if pid == os.getpid() or pid == 0:
                    continue
                subprocess.run(f'taskkill /PID {pid} /F', shell=True, capture_output=True)
    except Exception:
        pass

# 1. Start FastAPI server in a background thread
def run_server():
    # Make sure we are in the correct directory
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    
    kill_port(7860)
    
    from backend.main import app
    import uvicorn
    # Run server
    uvicorn.run(app, host="127.0.0.1", port=7860, log_level="warning")

server_thread = threading.Thread(target=run_server, daemon=True)
server_thread.start()

# 2. Function to wait for port to be ready
def is_port_open(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('127.0.0.1', port)) == 0

# Wait for server to start up
for _ in range(50):
    if is_port_open(7860):
        break
    time.sleep(0.1)

# 3. Start PyWebView Application
def main():
    webview.create_window(
        title="RichReviewTool V2.0.0",
        url="http://127.0.0.1:7860/",
        width=1400,
        height=900,
        resizable=True
    )
    webview.start()

if __name__ == "__main__":
    main()
