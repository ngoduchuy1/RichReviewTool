from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager

from .config import HOST, PORT, BASE_DIR, MAX_QUEUE_WORKERS
from .database import init_db
from .services.preset_service import init_presets
from .workers.ffmpeg_worker import get_worker
from .routers import (
    project_router,
    download_router,
    subtitle_router,
    voice_router,
    music_router,
    enhance_router,
    edit_router,
    ai_router,
    export_router,
    queue_router,
    asset_router,
    preset_router,
    timeline_router,
    pipeline_router,
    publish_router,
    template_router,
    batch_router,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    from .config import DB_PATH
    print(f"[Server] Database path: {DB_PATH}")
    print(f"[Server] Database exists: {DB_PATH.exists()}")
    
    # Delete database file to clear all stale data
    if DB_PATH.exists():
        import os
        os.remove(DB_PATH)
        print(f"[Server] Deleted old database file: {DB_PATH}")
    
    init_db()
    init_presets()
    
    worker = get_worker()
    worker.max_workers = MAX_QUEUE_WORKERS
    worker.start()
    app.state.worker = worker
    print(f"[Server] Queue worker started with {MAX_QUEUE_WORKERS} workers")
    yield
    worker.stop()
    print("[Server] Queue worker stopped")


app = FastAPI(title="RichReviewTool API", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(project_router, prefix="/api/projects", tags=["Project"])
app.include_router(download_router, prefix="/api/download", tags=["Download"])
app.include_router(subtitle_router, prefix="/api/subtitle", tags=["Subtitle"])
app.include_router(voice_router, prefix="/api/voice", tags=["Voice"])
app.include_router(music_router, prefix="/api/music", tags=["Music"])
app.include_router(enhance_router, prefix="/api/enhance", tags=["Enhance"])
app.include_router(edit_router, prefix="/api/edit", tags=["Edit"])
app.include_router(ai_router, prefix="/api/ai", tags=["AI"])
app.include_router(export_router, prefix="/api/export", tags=["Export"])
app.include_router(queue_router, prefix="/api/queue", tags=["Queue"])
app.include_router(asset_router, prefix="/api/assets", tags=["Assets"])
app.include_router(preset_router, prefix="/api/presets", tags=["Presets"])
app.include_router(timeline_router, prefix="/api/timeline", tags=["Timeline"])
app.include_router(pipeline_router, prefix="/api/pipeline", tags=["Pipeline"])
app.include_router(publish_router, prefix="/api/publish", tags=["Publish"])
app.include_router(template_router, prefix="/api/templates", tags=["Templates"])
app.include_router(batch_router, prefix="/api/batch", tags=["Batch"])


@app.get("/api/health")
def health():
    return {"status": "ok", "version": "2.0.0"}

@app.get("/api/system/browse")
async def browse_system(type: str = "file", ext: str = ""):
    import tkinter as tk
    from tkinter import filedialog
    import asyncio
    
    def _open_dialog():
        root = tk.Tk()
        root.attributes("-topmost", True)
        root.withdraw()
        if type == "folder":
            path = filedialog.askdirectory(parent=root)
        else:
            filetypes = [("Subtitle/Video files", "*.srt *.ass *.mp4 *.mkv *.avi")] if ext in ["srt", "video"] else [("All files", "*.*")]
            path = filedialog.askopenfilename(parent=root, filetypes=filetypes)
        root.destroy()
        return path

    path = await asyncio.to_thread(_open_dialog)
    return {"path": path}



@app.get("/api/stats")
def stats():
    from .database import db_cursor
    with db_cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM queue_items WHERE status='running'")
        running = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM queue_items WHERE status='waiting'")
        waiting = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM queue_items WHERE status='completed'")
        completed = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM queue_items WHERE status='failed'")
        failed = cur.fetchone()[0]
        cur.execute("SELECT COALESCE(SUM(tokens),0) FROM api_usage WHERE date=date('now','localtime')")
        tokens = cur.fetchone()[0]
        cur.execute("SELECT COALESCE(SUM(seconds),0) FROM api_usage WHERE date=date('now','localtime')")
        seconds = cur.fetchone()[0]
        cur.execute("SELECT COALESCE(SUM(cost),0) FROM api_usage WHERE date=date('now','localtime')")
        cost = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM projects")
        projects_count = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM assets")
        assets_count = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM tracks")
        tracks_count = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM exports")
        exports_count = cur.fetchone()[0]
    return {
        "queue": {"running": running, "waiting": waiting, "completed": completed, "failed": failed},
        "api_usage": {"tokens": tokens, "tts_seconds": seconds, "cost": round(cost, 2)},
        "projects": projects_count,
        "assets": assets_count,
        "tracks": tracks_count,
        "exports": exports_count,
    }


@app.get("/api/system/gpu")
def detect_gpu():
    import subprocess, re
    result = {"nvidia": False, "amd": False, "intel": False, "primary": "cpu", "details": []}
    try:
        nvidia = subprocess.run(["nvidia-smi", "--query-gpu=name,driver_version,memory.total", "--format=csv,noheader"], capture_output=True, text=True, timeout=10)
        if nvidia.returncode == 0:
            result["nvidia"] = True
            result["primary"] = "nvidia"
            for line in nvidia.stdout.strip().split("\n"):
                if line.strip():
                    parts = [p.strip() for p in line.split(",")]
                    result["details"].append({"type": "nvidia", "name": parts[0] if len(parts) > 0 else "", "driver": parts[1] if len(parts) > 1 else "", "memory": parts[2] if len(parts) > 2 else ""})
    except Exception:
        pass
    if not result["nvidia"]:
        try:
            rocm = subprocess.run(["rocm-smi", "--showproductname"], capture_output=True, text=True, timeout=10)
            if rocm.returncode == 0:
                result["amd"] = True
                result["primary"] = "amd"
                for line in rocm.stdout.split("\n"):
                    if "GPU" in line or "Card" in line:
                        result["details"].append({"type": "amd", "name": line.strip()})
        except Exception:
            pass
    try:
        import torch
        if torch.cuda.is_available():
            result["nvidia"] = True
            result["primary"] = "nvidia"
            for i in range(torch.cuda.device_count()):
                result["details"].append({"type": "cuda", "name": torch.cuda.get_device_name(i), "memory": f"{torch.cuda.get_device_properties(i).total_memory / 1024**3:.0f}GB"})
    except ImportError:
        pass
    try:
        import platform
        if platform.system() == "Windows":
            import ctypes
            class D3DKMT_ADAPTERINFO(ctypes.Structure):
                _fields_ = [("hAdapter", ctypes.c_uint), ("luid", ctypes.c_int64), ("numSources", ctypes.c_uint32), ("numPresentTargets", ctypes.c_uint32), ("AdapterType", ctypes.c_uint32)]
            result["details"].append({"type": "info", "os": platform.system(), "arch": platform.machine()})
    except Exception:
        pass
    return result


@app.get("/api/system/info")
def system_info():
    import platform, psutil
    info = {
        "os": platform.system(),
        "os_version": platform.version(),
        "architecture": platform.machine(),
        "python_version": platform.python_version(),
        "cpu_count": psutil.cpu_count(),
        "cpu_percent": psutil.cpu_percent(interval=0.1),
        "memory_total_gb": round(psutil.virtual_memory().total / 1024**3, 1),
        "memory_available_gb": round(psutil.virtual_memory().available / 1024**3, 1),
        "memory_percent": psutil.virtual_memory().percent,
        "disk_total_gb": round(psutil.disk_usage("/").total / 1024**3, 1),
        "disk_free_gb": round(psutil.disk_usage("/").free / 1024**3, 1),
    }
    try:
        import subprocess
        ffmpeg_ver = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True, timeout=5)
        info["ffmpeg"] = ffmpeg_ver.stdout.split("\n")[0] if ffmpeg_ver.returncode == 0 else "not found"
    except Exception:
        info["ffmpeg"] = "not found"
    return info


@app.get("/api/settings")
def get_settings():
    from .database import db_cursor
    with db_cursor() as cur:
        rows = cur.execute("SELECT key, value FROM settings").fetchall()
        return {r["key"]: r["value"] for r in rows}


@app.put("/api/settings")
def save_settings(data: dict):
    from .database import db_cursor
    with db_cursor() as cur:
        for key, value in data.items():
            cur.execute(
                "INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, str(value)),
            )
    return {"message": "Settings saved"}


@app.get("/api/video/serve")
def serve_video(path: str = ""):
    from fastapi.responses import FileResponse
    import os
    if not path or not os.path.exists(path):
        from fastapi.responses import PlainTextResponse
        return PlainTextResponse("Video not found", status_code=404)
    import mimetypes
    mimetypes.init()
    return FileResponse(path, media_type=mimetypes.guess_type(path)[0] or "video/mp4")


app.mount("/static", StaticFiles(directory=str(BASE_DIR)), name="static")


@app.get("/")
def serve_index():
    return FileResponse(str(BASE_DIR / "index.html"))


@app.get("/style.css")
def serve_style():
    return FileResponse(str(BASE_DIR / "style.css"))


@app.get("/app.js")
def serve_js():
    return FileResponse(str(BASE_DIR / "app.js"))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host=HOST, port=PORT, reload=True)
