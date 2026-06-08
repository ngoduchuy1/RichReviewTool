from fastapi import APIRouter, HTTPException, BackgroundTasks, Query
from ..services.publish_service import publish_youtube, publish_tiktok, publish_facebook, list_published
from ..database import db_cursor

router = APIRouter()


@router.post("/youtube")
def youtube(data: dict, bg: BackgroundTasks):
    video_path = data.get("video_path", "")
    if not video_path:
        raise HTTPException(400, "Yêu cầu cung cấp video_path")
    bg.add_task(publish_youtube, video_path, data.get("title", "My Video"), data.get("description", ""), data.get("privacy", "private"))
    return {"message": "Đã đưa tiến trình đăng YouTube vào hàng đợi"}


@router.post("/tiktok")
def tiktok(data: dict, bg: BackgroundTasks):
    video_path = data.get("video_path", "")
    if not video_path:
        raise HTTPException(400, "Yêu cầu cung cấp video_path")
    bg.add_task(publish_tiktok, video_path, data.get("title", "My Video"), data.get("description", ""))
    return {"message": "Đã đưa tiến trình đăng TikTok vào hàng đợi"}


@router.post("/facebook")
def facebook(data: dict, bg: BackgroundTasks):
    video_path = data.get("video_path", "")
    if not video_path:
        raise HTTPException(400, "Yêu cầu cung cấp video_path")
    bg.add_task(publish_facebook, video_path, data.get("title", "My Video"), data.get("description", ""))
    return {"message": "Đã đưa tiến trình đăng Facebook vào hàng đợi"}


@router.get("/history")
def history():
    return list_published()
