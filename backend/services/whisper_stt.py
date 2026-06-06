import os
from pathlib import Path
from ..config import WHISPER_MODEL, WHISPER_DEVICE, SUBTITLES_DIR
from ..database import db_cursor
import time


def transcribe(audio_path: str, language: str = "vi", project_id: int = 0) -> dict:
    """Transcribe audio file to SRT. Returns {srt_path, text, segments}."""
    try:
        import whisper
        model = whisper.load_model(WHISPER_MODEL, device=WHISPER_DEVICE)
        result = model.transcribe(audio_path, language=language, task="transcribe")

        srt_content = _to_srt(result["segments"])
        sub_path = SUBTITLES_DIR / f"project_{project_id}_stt.srt"
        sub_path.write_text(srt_content, encoding="utf-8")

        with db_cursor() as cur:
            cur.execute(
                "INSERT INTO subtitles (project_id, source, content) VALUES (?,?,?)",
                (project_id, f"whisper_{language}", srt_content),
            )

        return {"srt_path": str(sub_path), "text": result["text"], "segments": len(result["segments"])}
    except ImportError:
        _fallback_transcribe(audio_path, project_id)
        return {"srt_path": "", "text": "[whisper not installed]", "segments": 0}


def transcribe_video(video_path: str, language: str = "vi", project_id: int = 0) -> dict:
    """Extract audio from video, then transcribe. Returns SRT path + text."""
    from .ffmpeg_utils import extract_audio
    audio_path = extract_audio(video_path, sample_rate=16000)
    return transcribe(audio_path, language, project_id)


def transcribe_file(audio_path: str) -> str:
    """Transcribe and return raw text only."""
    try:
        import whisper
        model = whisper.load_model(WHISPER_MODEL, device=WHISPER_DEVICE)
        result = model.transcribe(audio_path, task="transcribe")
        return result["text"]
    except ImportError:
        return "[whisper not installed]"


def _to_srt(segments):
    lines = []
    for i, seg in enumerate(segments, 1):
        start = _fmt_time(seg["start"])
        end = _fmt_time(seg["end"])
        text = seg["text"].strip()
        lines.append(f"{i}\n{start} --> {end}\n{text}\n")
    return "\n".join(lines)


def _fmt_time(secs):
    h = int(secs // 3600)
    m = int((secs % 3600) // 60)
    s = int(secs % 60)
    ms = int((secs - int(secs)) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _fallback_transcribe(audio_path, project_id):
    with db_cursor() as cur:
        cur.execute(
            "INSERT INTO subtitles (project_id, source, content) VALUES (?,?,?)",
            (project_id, "whisper_fallback", "Whisper not installed. Install with: pip install openai-whisper"),
        )
