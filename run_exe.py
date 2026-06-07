import sys
import os

_site_candidates = [
    os.path.join(os.path.dirname(sys.executable), "Lib", "site-packages"),
    os.path.join(os.path.dirname(sys.prefix), "Lib", "site-packages"),
    r"C:\Program Files\Python312\Lib\site-packages",
    r"C:\Users\Administrator\AppData\Local\Programs\Python\Python312\Lib\site-packages",
]
for sp in _site_candidates:
    if os.path.exists(sp) and sp not in sys.path:
        sys.path.append(sp)

import threading
import time
import socket
import webview

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

_server_port = [7860]

def is_port_open(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('127.0.0.1', port)) == 0

def run_server():
    global _server_port
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from backend.main import app
    import uvicorn
    for port in range(7860, 7865):
        kill_port(port)
        time.sleep(0.3)
        if not is_port_open(port):
            _server_port[0] = port
            print(f"[run_exe] Starting on 127.0.0.1:{port}")
            uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
            return
        print(f"[run_exe] Port {port} still in use after kill")
    print("[run_exe] No free port found 7860-7864. Exiting.")
    sys.exit(1)

server_thread = threading.Thread(target=run_server, daemon=True)
server_thread.start()

for _ in range(100):
    if is_port_open(_server_port[0]):
        break
    time.sleep(0.1)

def main():
    webview.create_window(
        title="RichReviewTool V2.0.0",
        url=f"http://127.0.0.1:{_server_port[0]}/",
        width=1400,
        height=900,
        resizable=True
    )
    webview.start()

if __name__ == "__main__":
    main()
