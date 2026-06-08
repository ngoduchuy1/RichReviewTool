from fastapi import APIRouter, HTTPException, BackgroundTasks
from ..services.ffmpeg_utils import render_video, export_audio
from ..models.schemas import QueueItemCreate
from ..services.queue_manager import add_queue_item
from ..database import db_cursor
from ..config import EXPORTS_DIR

router = APIRouter()


@router.post("/render")
def render(data: QueueItemCreate, bg: BackgroundTasks):
    item_id = add_queue_item(data.project_id, "render", data.input_path, data.params)
    bg.add_task(render_video, data.input_path, str(EXPORTS_DIR / f"render_{item_id}.mp4"), data.params)
    return {"id": item_id, "message": "Đã đưa tiến trình kết xuất vào hàng đợi"}


@router.post("/export-audio")
def export_audio_route(input_path: str, fmt: str = "mp3", bg: BackgroundTasks = None):
    if bg is None:
        from fastapi import BackgroundTasks
        bg = BackgroundTasks()
    out = str(EXPORTS_DIR / f"audio_{hash(input_path)}.{fmt}")
    bg.add_task(export_audio, input_path, out, fmt)
    return {"output": out}


@router.post("/audio")
def export_audio_from_project(data: dict, bg: BackgroundTasks = None):
    if bg is None:
        from fastapi import BackgroundTasks
        bg = BackgroundTasks()
    project_id = data.get("project_id")
    input_path = data.get("input_path", "")
    if not input_path and project_id:
        with db_cursor() as cur:
            row = cur.execute("SELECT source FROM subtitles WHERE project_id=? ORDER BY created_at DESC LIMIT 1", (project_id,)).fetchone()
            if row:
                input_path = row["source"]
    if not input_path:
        raise HTTPException(400, "Yêu cầu cung cấp input_path hoặc project_id")
    return export_audio_route(input_path, data.get("format", "mp3"), bg)


@router.get("/presets")
def list_export_presets():
    return {
        "Movie Review": {"format": "mp4", "codec": "h264", "resolution": "1920x1080", "fps": 30, "bitrate": "8M"},
        "TikTok Recap": {"format": "mp4", "codec": "h264", "resolution": "1080x1920", "fps": 30, "bitrate": "6M"},
        "Shorts Auto": {"format": "mp4", "codec": "h264", "resolution": "1080x1920", "fps": 60, "bitrate": "10M"},
        "Reup 9:16": {"format": "mp4", "codec": "h265", "resolution": "1080x1920", "fps": 30, "bitrate": "4M"},
    }


@router.get("/files")
def list_exports():
    EXPORTS_DIR.mkdir(exist_ok=True)
    files = []
    for f in sorted(EXPORTS_DIR.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
        files.append({"name": f.name, "path": str(f), "size": f.stat().st_size, "ext": f.suffix})
    return files
