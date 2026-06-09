from fastapi import APIRouter, HTTPException

from ..models.schemas import (
    AIHashtagRequest,
    AIProjectRequest,
    AISceneDetectRequest,
    AISummaryRequest,
    AITitleRequest,
)
from ..services.queue_manager import add_queue_item

router = APIRouter()


@router.post("/scene-detect")
def scene_detect(data: AISceneDetectRequest):
    item_id = add_queue_item(
        data.project_id,
        "scene_detect",
        data.video_path,
        {"threshold": data.threshold},
        priority=1,
    )
    return {"id": item_id, "message": "Da dua tien trinh tach phan canh vao hang doi", "project_id": data.project_id}


@router.post("/summary")
def summarize(data: AISummaryRequest):
    item_id = add_queue_item(
        data.project_id,
        "ai_task",
        "",
        {"task": "summary", "text": data.text, "max_length": data.max_length, "engine": data.engine},
        priority=1,
    )
    return {"id": item_id, "message": "Da dua tien trinh tao summary vao hang doi", "project_id": data.project_id}


@router.post("/recap")
def recap(data: AIProjectRequest):
    item_id = add_queue_item(
        data.project_id,
        "ai_recap",
        data.video_path or "",
        {"text": data.text or "", "style": "review", "language": "vi"},
        priority=1,
    )
    return {"id": item_id, "message": "Da dua tien trinh tao recap vao hang doi", "project_id": data.project_id}


@router.post("/characters")
def characters(data: AIProjectRequest):
    if not data.video_path:
        raise HTTPException(400, "Yeu cau cung cap video_path")
    item_id = add_queue_item(data.project_id, "ai_task", data.video_path, {"task": "characters"}, priority=1)
    return {"id": item_id, "message": "Da dua tien trinh nhan dien nhan vat vao hang doi", "project_id": data.project_id}


@router.post("/speakers")
def speakers(data: AIProjectRequest):
    if not data.video_path:
        raise HTTPException(400, "Yeu cau cung cap video_path")
    item_id = add_queue_item(data.project_id, "ai_task", data.video_path, {"task": "speakers"}, priority=1)
    return {"id": item_id, "message": "Da dua tien trinh nhan dien speaker vao hang doi", "project_id": data.project_id}


@router.post("/title")
def title_gen(data: AITitleRequest):
    item_id = add_queue_item(
        data.project_id,
        "ai_task",
        data.video_path or "",
        {"task": "title", "style": data.style},
        priority=1,
    )
    return {"id": item_id, "message": "Da dua tien trinh tao title vao hang doi", "project_id": data.project_id}


@router.post("/titles")
def titles_gen(data: AITitleRequest):
    return title_gen(data)


@router.post("/hashtags")
def hashtags(data: AIHashtagRequest):
    item_id = add_queue_item(
        data.project_id,
        "ai_task",
        "",
        {"task": "hashtags", "text": data.text, "count": data.count},
        priority=1,
    )
    return {"id": item_id, "message": "Da dua tien trinh tao hashtag vao hang doi", "project_id": data.project_id}
