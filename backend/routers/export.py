import time

from fastapi import APIRouter, HTTPException

from ..config import EXPORTS_DIR
from ..database import db_cursor
from ..models.schemas import QueueItemCreate
from ..services.queue_manager import add_queue_item

router = APIRouter()


@router.post("/render")
def render(data: QueueItemCreate):
    item_id = add_queue_item(data.project_id, "render", data.input_path, data.params)
    return {"id": item_id, "message": "Da dua tien trinh ket xuat vao hang doi"}


@router.post("/export-audio")
def export_audio_route(input_path: str, fmt: str = "mp3", project_id: int = 0):
    if not input_path:
        raise HTTPException(400, "Yeu cau cung cap input_path")

    out = str(EXPORTS_DIR / f"audio_{project_id or 'standalone'}_{int(time.time())}.{fmt}")
    item_id = add_queue_item(project_id, "export_audio", input_path, {"format": fmt, "output_path": out})
    return {
        "id": item_id,
        "path": out,
        "output": out,
        "message": "Da dua xuat am thanh vao hang doi",
    }


@router.post("/audio")
def export_audio_from_project(data: dict):
    project_id = data.get("project_id")
    input_path = data.get("input_path", "")
    if not input_path and project_id:
        input_path = _resolve_project_input_path(project_id)
    if not input_path:
        raise HTTPException(400, "Yeu cau cung cap input_path hoac project_id")
    return export_audio_route(input_path, data.get("format", "mp3"), project_id or 0)


def _resolve_project_input_path(project_id: int) -> str:
    with db_cursor() as cur:
        row = cur.execute(
            """
            SELECT c.source_path AS path
            FROM clips c
            JOIN tracks t ON t.id = c.track_id
            WHERE t.project_id=? AND t.type='video' AND c.source_path IS NOT NULL
            ORDER BY c.id DESC LIMIT 1
            """,
            (project_id,),
        ).fetchone()
        if row and row["path"]:
            return row["path"]

        row = cur.execute(
            "SELECT output_path AS path FROM exports WHERE project_id=? ORDER BY created_at DESC LIMIT 1",
            (project_id,),
        ).fetchone()
        if row and row["path"]:
            return row["path"]

        row = cur.execute(
            "SELECT path FROM assets WHERE type IN ('videos','video') ORDER BY created_at DESC LIMIT 1"
        ).fetchone()
        return row["path"] if row and row["path"] else ""


@router.get("/presets")
def list_export_presets():
    return {
        "Draft Fast": {
            "format": "mp4",
            "codec": "h264",
            "resolution": "1280x720",
            "fps": 30,
            "bitrate": "auto",
            "preset": "veryfast",
            "quality": "draft",
        },
        "NVENC Fast": {
            "format": "mp4",
            "codec": "h264",
            "resolution": "1920x1080",
            "fps": 30,
            "bitrate": "8M",
            "gpu": "nvenc",
            "preset": "fast",
        },
        "Quality": {
            "format": "mp4",
            "codec": "h264",
            "resolution": "1920x1080",
            "fps": 30,
            "bitrate": "auto",
            "preset": "slow",
            "crf": "18",
        },
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
