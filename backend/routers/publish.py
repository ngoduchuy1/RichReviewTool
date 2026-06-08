from fastapi import APIRouter, HTTPException

from ..services.publish_service import list_published
from ..services.queue_manager import add_queue_item

router = APIRouter()


def _queue_publish(platform: str, data: dict):
    video_path = data.get("video_path", "")
    if not video_path:
        raise HTTPException(400, "Yeu cau cung cap video_path")
    item_id = add_queue_item(
        data.get("project_id", 0),
        "publish",
        video_path,
        {
            "platform": platform,
            "title": data.get("title", "My Video"),
            "description": data.get("description", ""),
            "privacy": data.get("privacy", "private"),
        },
    )
    return {"id": item_id, "message": f"Da dua tien trinh dang {platform} vao hang doi"}


@router.post("/youtube")
def youtube(data: dict):
    return _queue_publish("youtube", data)


@router.post("/tiktok")
def tiktok(data: dict):
    return _queue_publish("tiktok", data)


@router.post("/facebook")
def facebook(data: dict):
    return _queue_publish("facebook", data)


@router.get("/history")
def history():
    return list_published()
