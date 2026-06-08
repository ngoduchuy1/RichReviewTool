from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File
from ..models.schemas import SubtitleRequest, TranslateRequest
from ..services.translator import translate_text, translate_srt_async, get_job
from ..services.queue_manager import add_queue_item
from ..services.path_allowlist import is_allowed_path
from ..database import db_cursor
from ..config import SUBTITLES_DIR, DATA_DIR
import json

router = APIRouter()


@router.post("/transcribe")
def transcribe_subtitle(data: SubtitleRequest):
    item_id = add_queue_item(
        data.project_id,
        "transcribe",
        data.source_path,
        {"language": data.language, "whisperx": False, "vocal_separation": False},
        priority=1,
    )
    return {"id": item_id, "message": "Da dua tien trinh chuyen am vao hang doi", "project_id": data.project_id}


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
    try:
        from ..services.timeline_service import sync_timeline_subtitle
        from ..services.event_bus import event_bus
        sync_timeline_subtitle(project_id, text)
        event_bus.publish("subtitle_updated", {"project_id": project_id, "source": file.filename, "path": str(sub_path)})
    except Exception:
        pass
    return {"id": sid, "path": str(sub_path)}


@router.post("/import-path")
async def import_subtitle_path(data: dict):
    """Import subtitle by file path â€” more reliable than UploadFile for local paths."""
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
        raise HTTPException(400, f"KhÃ´ng tÃ¬m tháº¥y tá»‡p: {raw_path or '(empty)'}")

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
    try:
        from ..services.event_bus import event_bus
        event_bus.publish("subtitle_updated", {"project_id": project_id, "source": filename, "path": str(sub_path)})
    except Exception:
        pass
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
    p = path.strip()
    if not p:
        return ""

    downloads_dir = Path.home() / "Downloads"
    roots = [SUBTITLES_DIR.resolve(), DATA_DIR.resolve(), downloads_dir.resolve()]
    candidates = []
    raw = Path(p).expanduser()
    if raw.is_absolute():
        candidates.append(raw)
    candidates.append(SUBTITLES_DIR / Path(p.replace("\\", "/")).name)

    for candidate in candidates:
        try:
            resolved = candidate.resolve()
        except Exception:
            continue
        if not resolved.exists() or not resolved.is_file():
            continue
        if resolved.suffix.lower() not in {".srt", ".ass", ".vtt", ".ssa"}:
            continue
        if is_allowed_path(str(resolved)):
            return str(resolved)
        for root in roots:
            try:
                resolved.relative_to(root)
                return str(resolved)
            except ValueError:
                pass
    return ""


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
        raise HTTPException(404, f"KhÃ´ng tÃ¬m tháº¥y tá»‡p: {path or '(empty)'}")
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
        return {"content": content, "filename": os.path.basename(path)}
    except Exception as e:
        raise HTTPException(500, f"Äá»c tá»‡p tháº¥t báº¡i: {e}")


@router.post("/translate")
def translate_subtitle(data: TranslateRequest):
    """Start async translation, return job_id for progress polling."""
    import os
    text = data.text
    # If text is a local file path, read it
    resolved_text_path = _resolve_path(text.strip())
    if resolved_text_path and os.path.exists(resolved_text_path):
        try:
            with open(resolved_text_path, "r", encoding="utf-8", errors="replace") as f:
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
        raise HTTPException(404, "KhÃ´ng tÃ¬m tháº¥y tiáº¿n trÃ¬nh")
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
        raise HTTPException(400, "ÄÆ°á»ng dáº«n video khÃ´ng há»£p lá»‡")

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
        raise HTTPException(400, "ÄÆ°á»ng dáº«n video khÃ´ng há»£p lá»‡")

    filename = os.path.basename(video_path)
    output_name = os.path.splitext(filename)[0] + f"_extracted_{stream_index}.srt"
    output_path = str(SUBTITLES_DIR / f"sub_{project_id}_{output_name}")
    item_id = add_queue_item(
        project_id,
        "extract_subtitle_stream",
        video_path,
        {"stream_index": stream_index, "output_path": output_path},
        priority=1,
    )
    return {"id": item_id, "path": output_path, "message": "Da dua trich xuat phu de vao hang doi"}

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
            raise RuntimeError(f"TrÃ­ch xuáº¥t phá»¥ Ä‘á» tháº¥t báº¡i. File Ä‘áº§u ra rá»—ng hoáº·c khÃ´ng há»— trá»£.")
    except Exception as e:
        raise HTTPException(500, f"Lá»—i khi trÃ­ch xuáº¥t phá»¥ Ä‘á»: {str(e)}")


@router.post("/transcribe-video")
def transcribe_video_endpoint(data: dict):
    import os
    video_path = data.get("path", "")
    project_id = data.get("project_id", 0)
    language = data.get("language", "vi")
    vocal_separation = data.get("vocal_separation")
    use_whisperx = data.get("whisperx", False)

    if not video_path or not os.path.exists(video_path):
        raise HTTPException(400, "ÄÆ°á»ng dáº«n video khÃ´ng há»£p lá»‡")

    item_id = add_queue_item(
        project_id,
        "transcribe",
        video_path,
        {"language": language, "vocal_separation": bool(vocal_separation), "whisperx": bool(use_whisperx)},
        priority=1,
    )
    return {"id": item_id, "message": "Da dua Whisper STT vao hang doi"}


@router.post("/export")
def export_subtitle(project_id: int, fmt: str = "srt", font: str = "Arial", size: int = 42, color: str = "#FFFFFF", shadow: str = "Soft"):
    from ..services.ffmpeg_utils import export_subtitle_file
    with db_cursor() as cur:
        row = cur.execute(
            "SELECT content FROM subtitles WHERE project_id=? ORDER BY created_at DESC LIMIT 1",
            (project_id,),
        ).fetchone()
        if not row:
            raise HTTPException(404, "KhÃ´ng tÃ¬m tháº¥y phá»¥ Ä‘á» nÃ o")

    style = {"font": font, "size": size, "color": color, "shadow": shadow}
    try:
        out = export_subtitle_file(row["content"], fmt, project_id, style)
        return {"path": out}
    except Exception as e:
        raise HTTPException(500, f"Xuáº¥t phá»¥ Ä‘á» tháº¥t báº¡i: {e}")


@router.post("/ocr-video")
def ocr_video_endpoint(data: dict):
    import os
    video_path = data.get("path", "")
    project_id = data.get("project_id", 0)
    region = data.get("region")

    if not video_path or not os.path.exists(video_path):
        raise HTTPException(400, "ÄÆ°á»ng dáº«n video khÃ´ng há»£p lá»‡")

    from ..services.ocr_service import is_ocr_available
    if not is_ocr_available():
        raise HTTPException(400, "RapidOCR hoáº·c OpenCV chÆ°a Ä‘Æ°á»£c cÃ i Ä‘áº·t.")

    item_id = add_queue_item(project_id, "ocr_hardsub", video_path, {"region": region}, priority=1)
    return {
        "id": item_id,
        "message": "Da dua RapidOCR sub cung vao hang cho.",
    }
