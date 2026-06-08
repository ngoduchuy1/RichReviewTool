from fastapi import APIRouter, BackgroundTasks, HTTPException
from ..models.schemas import AISummaryRequest, AIProjectRequest, AISceneDetectRequest, AITitleRequest, AIHashtagRequest
from ..services.ai_service import (
    generate_summary,
    generate_recap_from_transcript,
    detect_characters,
    detect_speakers,
    generate_title,
    generate_hashtags,
)
from ..services.scene_detect import detect_scenes
from ..services.whisper_stt import transcribe_file
from ..database import db_cursor

router = APIRouter()


@router.post("/scene-detect")
def scene_detect(data: AISceneDetectRequest, bg: BackgroundTasks):
    bg.add_task(detect_scenes, data.video_path, data.threshold, data.project_id)
    return {"message": "Đã đưa tiến trình tách phân cảnh vào hàng đợi", "project_id": data.project_id}


@router.post("/summary")
def summarize(data: AISummaryRequest):
    result = generate_summary(data.text, data.max_length, data.engine)
    return {"summary": result or "Summary generation unavailable"}


@router.post("/recap")
def recap(data: AIProjectRequest, bg: BackgroundTasks):
    video_path = data.video_path or ""
    if not video_path:
        with db_cursor() as cur:
            row = cur.execute(
                "SELECT source FROM subtitles WHERE project_id=? ORDER BY created_at DESC LIMIT 1",
                (data.project_id,),
            ).fetchone()
            if row:
                video_path = row["source"]
    transcript = ""
    if video_path:
        try:
            transcript = transcribe_file(video_path)
        except Exception:
            pass
    result = generate_recap_from_transcript(transcript or "No transcript available.", "review", "vi")
    return {"recap": result}


@router.post("/characters")
def characters(data: AIProjectRequest, bg: BackgroundTasks):
    if not data.video_path:
        raise HTTPException(400, "Yêu cầu cung cấp video_path")
    result = detect_characters(data.video_path)
    chars = []
    for i, c in enumerate(result[:20]):
        chars.append({
            "name": f"Character_{i+1}",
            "confidence": round(float(c.get("confidence", 0)), 3),
            "frame": c.get("frame", 0),
            "bbox": {"x": c.get("x", 0), "y": c.get("y", 0), "w": c.get("w", 0), "h": c.get("h", 0)},
        })
    if not chars:
        chars.append({"name": "No faces detected", "confidence": 0, "frame": 0, "bbox": {"x": 0, "y": 0, "w": 0, "h": 0}})
    return {"characters": chars}


@router.post("/speakers")
def speakers(data: AIProjectRequest, bg: BackgroundTasks):
    if not data.video_path:
        raise HTTPException(400, "Yêu cầu cung cấp video_path")
    result = detect_speakers(data.video_path)
    speaker_map = {}
    for s in result[:20]:
        spk = s.get("speaker", "unknown")
        if spk not in speaker_map:
            speaker_map[spk] = []
        speaker_map[spk].append({"start": s.get("start", 0), "end": s.get("end", 0)})
    if not speaker_map:
        speaker_map["No speakers detected"] = []
    return {"speakers": speaker_map}


@router.post("/title")
def title_gen(data: AITitleRequest):
    t = generate_title(data.video_path or "", data.style)
    return {"titles": [t, f"{t} - Phân tích chi tiết", f"{t} - Đánh giá chân thực"]}


@router.post("/hashtags")
def hashtags(data: AIHashtagRequest):
    h = generate_hashtags(data.text, data.count)
    return {"hashtags": h or ["review", "movie", "phim"]}
