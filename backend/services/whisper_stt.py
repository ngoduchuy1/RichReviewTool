import os
import json
from pathlib import Path
from ..config import WHISPER_MODEL, WHISPER_DEVICE, SUBTITLES_DIR
from ..database import db_cursor


def log_to_db(message: str, level: str = "INFO", project_id: int = 0):
    try:
        with db_cursor() as cur:
            cur.execute(
                "INSERT INTO job_logs (queue_item_id, level, message) VALUES (NULL,?,?)",
                (level, f"[Whisper STT] {message}")
            )
    except Exception as e:
        print(f"Error logging to db: {e}")


def transcribe(audio_path: str, language: str = "vi", project_id: int = 0) -> dict:
    """Transcribe audio file to SRT via subprocess worker. Returns {srt_path, text, segments}."""
    log_to_db(f"Bắt đầu nhận dạng giọng nói cho tệp: {os.path.basename(audio_path)} (Ngôn ngữ: {language})", project_id=project_id)

    from .stt_worker import transcribe_subprocess
    result = transcribe_subprocess(audio_path, language, WHISPER_MODEL)

    if result.get("error"):
        log_to_db(f"Lỗi nhận dạng giọng nói: {result['error']}", level="ERROR", project_id=project_id)
        return {"srt_path": "", "text": "", "segments": 0}

    srt_content = result.get("srt_content", "")
    sub_path = SUBTITLES_DIR / f"project_{project_id}_stt.srt"
    sub_path.write_text(srt_content, encoding="utf-8")

    with db_cursor() as cur:
        cur.execute(
            "INSERT INTO subtitles (project_id, source, content) VALUES (?,?,?)",
            (project_id, f"whisper_{language}", srt_content),
        )

    log_to_db(f"Chuyển âm giọng nói hoàn thành! Số phân đoạn: {result.get('segments', 0)}", project_id=project_id)
    return {"srt_path": str(sub_path), "text": result.get("text", ""), "segments": result.get("segments", 0)}


def transcribe_video(video_path: str, language: str = "vi", project_id: int = 0) -> dict:
    """Extract audio from video, then transcribe."""
    from .ffmpeg_utils import extract_audio
    log_to_db(f"Đang trích xuất âm thanh từ video: {os.path.basename(video_path)}...", project_id=project_id)
    audio_path = extract_audio(video_path, sample_rate=16000)
    return transcribe(audio_path, language, project_id)


def transcribe_file(audio_path: str) -> str:
    """Transcribe and return raw text only."""
    from .stt_worker import transcribe_subprocess
    result = transcribe_subprocess(audio_path)
    return result.get("text", "")
