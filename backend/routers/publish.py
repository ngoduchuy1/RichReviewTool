from fastapi import APIRouter, HTTPException, BackgroundTasks, Query
from ..services.publish_service import publish_youtube, publish_tiktok, publish_facebook, list_published
from ..database import db_cursor

router = APIRouter()


@router.post("/youtube")
def youtube(data: dict, bg: BackgroundTasks):
    video_path = data.get("video_path", "")
    if not video_path:
        raise HTTPException(400, "video_path required")
    bg.add_task(publish_youtube, video_path, data.get("title", "My Video"), data.get("description", ""), data.get("privacy", "private"))
    return {"message": "YouTube publish queued"}


@router.post("/tiktok")
def tiktok(data: dict, bg: BackgroundTasks):
    video_path = data.get("video_path", "")
    if not video_path:
        raise HTTPException(400, "video_path required")
    bg.add_task(publish_tiktok, video_path, data.get("title", "My Video"), data.get("description", ""))
    return {"message": "TikTok publish queued"}


@router.post("/facebook")
def facebook(data: dict, bg: BackgroundTasks):
    video_path = data.get("video_path", "")
    if not video_path:
        raise HTTPException(400, "video_path required")
    bg.add_task(publish_facebook, video_path, data.get("title", "My Video"), data.get("description", ""))
    return {"message": "Facebook publish queued"}


@router.get("/history")
def history():
    return list_published()
