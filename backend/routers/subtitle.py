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
    return {"message": "Đã đưa tiến trình chuyển âm vào hàng đợi", "project_id": data.project_id}


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
    from ..services.timeline_service import sync_timeline_subtitle
    raw_path = (data.get("path") or "").strip()
    project_id = data.get("project_id", 0)
    
    # Try user-provided path first, then fallback to project_id-based path
    file_path = _resolve_path(raw_path) if raw_path else ""
    if (not file_path or not os.path.exists(file_path)) and project_id:
        candidate = str(SUBTITLES_DIR / f"project_{project_id}_stt.srt")
        if os.path.exists(candidate):
            file_path = candidate
    
    if not file_path or not os.path.exists(file_path):
        raise HTTPException(400, f"Không tìm thấy tệp: {raw_path or '(empty)'}")
    
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
    try:
        sync_timeline_subtitle(project_id, text)
    except Exception as e:
        print(f"Error syncing timeline subtitle: {e}")
    return {"id": sid, "path": str(sub_path)}


@router.get("/{project_id}")
def get_subtitles(project_id: int):
    with db_cursor() as cur:
        rows = cur.execute(
            "SELECT * FROM subtitles WHERE project_id=? ORDER BY created_at DESC",
            (project_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def _resolve_path(path: str) -> str:
    """Resolve a potentially relative path against SUBTITLES_DIR."""
    import os
    p = path.strip()
    if os.path.isabs(p):
        return p
    # If path starts with "data/subtitles/", strip to just the filename
    # and resolve against SUBTITLES_DIR directly
    parts = p.replace("\\", "/").split("/")
    # Take just the filename (last component)
    filename = parts[-1]
    candidate = str(SUBTITLES_DIR / filename)
    if os.path.exists(candidate):
        return candidate
    return os.path.abspath(p)


@router.post("/read-file")
def read_subtitle_file(data: dict):
    """Read an SRT/ASS file from a local path and return its content."""
    import os
    path = (data.get("path") or "").strip()
    project_id = data.get("project_id", 0)
    if path:
        path = _resolve_path(path)
    # Fallback: build path from project_id
    if (not path or not os.path.exists(path)) and project_id:
        candidate = str(SUBTITLES_DIR / f"project_{project_id}_stt.srt")
        if os.path.exists(candidate):
            path = candidate
    if not path or not os.path.exists(path):
        raise HTTPException(404, f"Không tìm thấy tệp: {path or '(empty)'}")
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
        return {"content": content, "filename": os.path.basename(path)}
    except Exception as e:
        raise HTTPException(500, f"Đọc tệp thất bại: {e}")


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
        raise HTTPException(404, "Không tìm thấy tiến trình")
    return {
        "job_id": job_id,
        "status": job.get("status", "unknown"),
        "progress": job.get("progress", 0),
        "translated": job.get("result") if job.get("status") == "done" else None,
        "error": job.get("error"),
    }


@router.post("/detect-streams")
def detect_streams(data: dict):
    import subprocess
    import json
    import os
    from ..config import FFPROBE_PATH
    
    video_path = data.get("path", "")
    if not video_path or not os.path.exists(video_path):
        raise HTTPException(400, "Đường dẫn video không hợp lệ")
        
    cmd = [
        FFPROBE_PATH, "-v", "quiet",
        "-print_format", "json",
        "-show_streams", "-select_streams", "s",
        video_path
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10, creationflags=subprocess.CREATE_NO_WINDOW)
        info = json.loads(result.stdout)
        streams = info.get("streams", [])
        
        detected = []
        for i, s in enumerate(streams):
            tags = s.get("tags", {})
            lang = tags.get("language", "und")
            title = tags.get("title", f"Track {i+1}")
            index = s.get("index", i)
            detected.append({
                "index": index,
                "language": lang,
                "title": f"{title} ({lang})"
            })
        return {"streams": detected}
    except Exception as e:
        print(f"[Subtitle] Error detecting subtitle streams: {e}")
        return {"streams": []}


@router.post("/extract-stream")
def extract_stream(data: dict):
    import subprocess
    import os
    from ..config import FFMPEG_PATH, SUBTITLES_DIR
    from ..database import db_cursor
    
    video_path = data.get("path", "")
    stream_index = data.get("index", 0)
    project_id = data.get("project_id", 0)
    
    if not video_path or not os.path.exists(video_path):
        raise HTTPException(400, "Đường dẫn video không hợp lệ")
        
    filename = os.path.basename(video_path)
    output_name = os.path.splitext(filename)[0] + f"_extracted_{stream_index}.srt"
    output_path = str(SUBTITLES_DIR / f"sub_{project_id}_{output_name}")
    
    cmd = [
        FFMPEG_PATH, "-y",
        "-i", video_path,
        "-map", f"0:{stream_index}",
        output_path
    ]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=15, creationflags=subprocess.CREATE_NO_WINDOW)
        if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
            cmd_conv = [
                FFMPEG_PATH, "-y",
                "-i", video_path,
                "-map", f"0:{stream_index}",
                "-f", "srt",
                output_path
            ]
            subprocess.run(cmd_conv, capture_output=True, timeout=15, creationflags=subprocess.CREATE_NO_WINDOW)
            
        if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
            with open(output_path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
                
            with db_cursor() as cur:
                cur.execute(
                    "INSERT INTO subtitles (project_id, source, content) VALUES (?,?,?)",
                    (project_id, f"extracted_{stream_index}", content),
                )
                sid = cur.lastrowid
            return {"id": sid, "path": output_path, "content": content}
        else:
            raise RuntimeError(f"Trích xuất phụ đề thất bại. File đầu ra rỗng hoặc không hỗ trợ.")
    except Exception as e:
        raise HTTPException(500, f"Lỗi khi trích xuất phụ đề: {str(e)}")


@router.post("/transcribe-video")
def transcribe_video_endpoint(data: dict, bg: BackgroundTasks):
    import os
    video_path = data.get("path", "")
    project_id = data.get("project_id", 0)
    language = data.get("language", "vi")
    
    if not video_path or not os.path.exists(video_path):
        raise HTTPException(400, "Đường dẫn video không hợp lệ")
        
    from ..services.whisper_stt import transcribe_video
    bg.add_task(transcribe_video, video_path, language, project_id)
    return {"message": "Đã bắt đầu nhận dạng giọng nói (STT) từ video. Tiến trình đang chạy ngầm..."}


@router.post("/export")
def export_subtitle(project_id: int, fmt: str = "srt", font: str = "Arial", size: int = 42, color: str = "#FFFFFF", shadow: str = "Soft"):
    from ..services.ffmpeg_utils import export_subtitle_file
    with db_cursor() as cur:
        row = cur.execute(
            "SELECT content FROM subtitles WHERE project_id=? ORDER BY created_at DESC LIMIT 1",
            (project_id,),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Không tìm thấy phụ đề nào")
    
    style = {"font": font, "size": size, "color": color, "shadow": shadow}
    try:
        out = export_subtitle_file(row["content"], fmt, project_id, style)
        return {"path": out}
    except Exception as e:
        raise HTTPException(500, f"Xuất phụ đề thất bại: {e}")
