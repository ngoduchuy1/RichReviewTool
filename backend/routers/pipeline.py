"""
Pipeline API — /api/pipeline/*
Start full processing pipelines from the frontend.
"""
from fastapi import APIRouter, HTTPException
from ..services.queue_manager import add_queue_item
from ..services.pipeline_service import run_pipeline
from ..workers.ffmpeg_worker import get_worker

router = APIRouter()


@router.post("/start")
def start_pipeline(data: dict):
    """Start a full pipeline. Example body:
    {
        "project_id": 1,
        "input_path": "video.mp4",
        "type": "pipeline",
        "params": {
            "url": "https://...",
            "source_lang": "zh",
            "target_lang": "vi",
            "translate_engine": "gpt",
            "tts_provider": "edge",
            "tts_voice": "vi-VN-NamMinhNeural",
            "burn_subtitle": true,
            "output_name": "my_video"
        }
    }
    """
    project_id = data.get("project_id")
    ptype = data.get("type", "pipeline")
    input_path = data.get("input_path", "")
    params = data.get("params", {})

    if not project_id:
        raise HTTPException(400, "project_id is required")

    item_id = add_queue_item(project_id, ptype, input_path, params, priority=1)
    return {"id": item_id, "message": f"Pipeline '{ptype}' queued"}


@router.post("/{item_id}/process")
def process_now(item_id: int):
    """Immediately process a specific queue item (bypasses worker polling)."""
    from ..database import db_cursor
    with db_cursor() as cur:
        row = cur.execute("SELECT * FROM queue_items WHERE id=?", (item_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Queue item not found")
        item = dict(row)

    if item["status"] != "waiting":
        raise HTTPException(400, f"Item status is '{item['status']}', not 'waiting'")

    success = run_pipeline(item)
    return {"message": "Pipeline completed" if success else "Pipeline failed"}
