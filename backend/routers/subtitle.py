from fastapi import APIRouter, HTTPException, BackgroundTasks, UploadFile, File
from ..models.schemas import SubtitleRequest, TranslateRequest
from ..services.whisper_stt import transcribe
from ..services.translator import translate_text, translate_srt_async, get_job
from ..database import db_cursor
from ..config import SUBTITLES_DIR
import json

router = APIRouter()


@router.post("/transcribe")
def transcribe_subtitle(data: SubtitleRequest, bg: BackgroundTasks):
    bg.add_task(transcribe, data.source_path, data.language, data.project_id)
    return {"message": "Transcription queued", "project_id": data.project_id}


@router.post("/import")
async def import_subtitle(project_id: int = 0, file: UploadFile = File(...)):
    content = await file.read()
    text = content.decode("utf-8", errors="replace")
    import os
    if os.path.exists(text.strip()):
        try:
            with open(text.strip(), "r", encoding="utf-8", errors="replace") as f:
                text = f.read()
        except Exception:
            pass
    sub_path = SUBTITLES_DIR / f"sub_{project_id}_{file.filename}"
    sub_path.write_text(text, encoding="utf-8")
    with db_cursor() as cur:
        cur.execute(
            "INSERT INTO subtitles (project_id, source, content) VALUES (?,?,?)",
            (project_id, file.filename, text),
        )
        sid = cur.lastrowid
    return {"id": sid, "path": str(sub_path)}


@router.post("/import-path")
async def import_subtitle_path(data: dict):
    """Import subtitle by file path — more reliable than UploadFile for local paths."""
    import os
    file_path = data.get("path", "")
    project_id = data.get("project_id", 0)
    if not file_path or not os.path.exists(file_path):
        raise HTTPException(400, f"File not found: {file_path}")
    filename = os.path.basename(file_path)
    with open(file_path, "r", encoding="utf-8", errors="replace") as f:
        text = f.read()
    sub_path = SUBTITLES_DIR / f"sub_{project_id}_{filename}"
    sub_path.write_text(text, encoding="utf-8")
    with db_cursor() as cur:
        cur.execute(
            "INSERT INTO subtitles (project_id, source, content) VALUES (?,?,?)",
            (project_id, filename, text),
        )
        sid = cur.lastrowid
    return {"id": sid, "path": str(sub_path)}


@router.get("/{project_id}")
def get_subtitles(project_id: int):
    with db_cursor() as cur:
        rows = cur.execute(
            "SELECT * FROM subtitles WHERE project_id=? ORDER BY created_at DESC",
            (project_id,),
        ).fetchall()
        return [dict(r) for r in rows]


@router.post("/read-file")
def read_subtitle_file(data: dict):
    """Read an SRT/ASS file from a local path and return its content."""
    import os
    path = (data.get("path") or "").strip()
    if not path:
        raise HTTPException(400, "path is required")
    if not os.path.exists(path):
        raise HTTPException(404, f"File not found: {path}")
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
        return {"content": content, "filename": os.path.basename(path)}
    except Exception as e:
        raise HTTPException(500, f"Failed to read file: {e}")


@router.post("/translate")
def translate_subtitle(data: TranslateRequest):
    """Start async translation, return job_id for progress polling."""
    import os
    text = data.text
    # If text is a local file path, read it
    if os.path.exists(text.strip()):
        try:
            with open(text.strip(), "r", encoding="utf-8", errors="replace") as f:
                text = f.read()
        except Exception:
            pass
    # Decide SRT vs plain text
    if "-->" in text:
        job_id = translate_srt_async(
            text, data.source_lang, data.target_lang, data.engine,
            project_id=data.project_id
        )
    else:
        # For plain text use blocking translate (fast)
        result = translate_text(text, data.source_lang, data.target_lang, data.engine)
        return {"job_id": None, "translated": result, "status": "done", "progress": 100}
    return {"job_id": job_id, "status": "running", "progress": 0}


@router.get("/translate-progress/{job_id}")
def translate_progress(job_id: str):
    """Poll translation job status and progress."""
    job = get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return {
        "job_id": job_id,
        "status": job.get("status", "unknown"),
        "progress": job.get("progress", 0),
        "translated": job.get("result") if job.get("status") == "done" else None,
        "error": job.get("error"),
    }


@router.post("/export")
def export_subtitle(project_id: int, fmt: str = "srt", font: str = "Arial", size: int = 42, color: str = "#FFFFFF", shadow: str = "Soft"):
    from ..services.ffmpeg_utils import export_subtitle_file
    with db_cursor() as cur:
        row = cur.execute(
            "SELECT content FROM subtitles WHERE project_id=? ORDER BY created_at DESC LIMIT 1",
            (project_id,),
        ).fetchone()
        if not row:
            raise HTTPException(404, "No subtitles found")
    
    style = {"font": font, "size": size, "color": color, "shadow": shadow}
    try:
        out = export_subtitle_file(row["content"], fmt, project_id, style)
        return {"path": out}
    except Exception as e:
        raise HTTPException(500, f"Export failed: {e}")
