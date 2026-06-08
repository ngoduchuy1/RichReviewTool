"""
Pipeline Service — central dispatcher for all processing pipelines.
Types: download, transcribe, translate, tts, render, export_audio, split, process_music, pipeline (full chain)
Each step logs progress and registers outputs in the asset library.
"""
import json
import time
import os
from pathlib import Path
from ..config import DOWNLOADS_DIR, SUBTITLES_DIR, VOICES_DIR, EXPORTS_DIR, ASSETS_DIR
from ..database import db_cursor


def run_pipeline(queue_item: dict) -> bool:
    """Main dispatcher — routes to correct pipeline based on queue item type."""
    item_id = queue_item["id"]
    ptype = queue_item["type"]
    project_id = queue_item["project_id"]
    input_path = queue_item["input_path"] or ""
    params = json.loads(queue_item["params"]) if isinstance(queue_item["params"], str) else (queue_item["params"] or {})

    _update(item_id, "running", 0)
    _log(item_id, "info", f"[{ptype}] Pipeline started for project {project_id}")

    try:
        if ptype == "download":
            return _download(item_id, project_id, params)
        elif ptype == "transcribe":
            return _transcribe(item_id, project_id, input_path, params)
        elif ptype == "translate":
            return _translate(item_id, project_id, params)
        elif ptype == "tts":
            return _tts(item_id, project_id, params)
        elif ptype == "render":
            return _render(item_id, project_id, input_path, params)
        elif ptype == "ocr_hardsub":
            return _ocr_hardsub(item_id, project_id, input_path, params)
        elif ptype == "remove_hardsub":
            return _remove_hardsub(item_id, project_id, input_path, params)
        elif ptype == "export_audio":
            return _export_audio(item_id, project_id, input_path, params)
        elif ptype == "split":
            return _split(item_id, project_id, input_path, params)
        elif ptype == "process_music":
            return _process_music(item_id, project_id, input_path, params)
        elif ptype == "pipeline":
            return _full(item_id, project_id, input_path, params)
        else:
            _log(item_id, "error", f"Unknown type: {ptype}")
            _update(item_id, "failed", error=f"Unknown type: {ptype}")
            return False
    except Exception as e:
        _log(item_id, "error", f"Pipeline failed: {e}")
        _update(item_id, "failed", error=str(e))
        return False


# ─── Download Pipeline ───

def _download(item_id: int, project_id: int, params: dict) -> bool:
    url = params.get("url", "")
    if not url:
        raise ValueError("url required for download pipeline")

    _log(item_id, "info", f"Downloading: {url}")
    from .downloader import download_video

    with db_cursor() as cur:
        cur.execute("INSERT INTO downloads (url, platform, status) VALUES (?,?,?)", (url, params.get("platform", "auto"), "waiting"))
        dl_id = cur.lastrowid

    download_video(dl_id, url, params.get("quality", "best"), params.get("cookie_file"), params.get("proxy"), params.get("output_dir"))

    with db_cursor() as cur:
        row = cur.execute("SELECT * FROM downloads WHERE id=?", (dl_id,)).fetchone()
        if row and row["status"] == "completed" and row["output_path"]:
            out_path = row["output_path"]
            _register_asset("videos", out_path, project_id)
            _log(item_id, "info", f"Downloaded to: {out_path}")
            _set_output_path(item_id, out_path)
            _update(item_id, "completed", 100)
            return True

    _update(item_id, "failed", error="Download failed")
    return False


# ─── Transcribe (STT) Pipeline ───

def _transcribe(item_id: int, project_id: int, video_path: str, params: dict) -> bool:
    if not video_path or not os.path.exists(video_path):
        raise FileNotFoundError(f"Video not found: {video_path}")

    lang = params.get("language", "vi")
    vocal_sep = params.get("vocal_separation", None)
    use_whisperx = params.get("whisperx", False)

    _log(item_id, "info", "Transcribing with Whisper (vocal_separation={}, whisperx={})...".format(vocal_sep, use_whisperx))
    from .whisper_stt import transcribe_video
    result = transcribe_video(video_path, lang, project_id, vocal_separation=vocal_sep, use_whisperx=use_whisperx)

    srt_path = result.get("srt_path", "")
    if srt_path and os.path.exists(srt_path):
        _register_asset("subtitle", srt_path, project_id)
        _log(item_id, "info", f"SRT saved: {srt_path}")
        _update(item_id, "completed", 100)
        return True

    _update(item_id, "failed", error="Transcription failed")
    return False


# ─── Translation Pipeline ───

def _translate(item_id: int, project_id: int, params: dict) -> bool:
    src = params.get("source_lang", "zh")
    tgt = params.get("target_lang", "vi")
    engine = params.get("translate_engine", "nllb")

    with db_cursor() as cur:
        row = cur.execute(
            "SELECT content FROM subtitles WHERE project_id=? ORDER BY created_at DESC LIMIT 1",
            (project_id,),
        ).fetchone()

    if not row:
        raise ValueError("No subtitle found for translation")

    srt_content = row["content"]
    _log(item_id, "info", f"Translating {src}→{tgt} via {engine} ({len(srt_content)} chars)")

    from .translator import translate_srt
    translated = translate_srt(srt_content, src, tgt, engine)

    trans_path = SUBTITLES_DIR / f"project_{project_id}_translated.srt"
    trans_path.write_text(translated, encoding="utf-8")

    with db_cursor() as cur:
        cur.execute(
            "INSERT INTO subtitles (project_id, source, content) VALUES (?,?,?)",
            (project_id, f"translated_{engine}_{src}_to_{tgt}", translated),
        )

    _register_asset("subtitle", str(trans_path), project_id)
    _log(item_id, "info", f"Translated SRT: {trans_path}")
    _update(item_id, "completed", 100)
    return True


# ─── TTS Pipeline ───

def _tts(item_id: int, project_id: int, params: dict) -> bool:
    provider = params.get("tts_provider", "edge")
    voice = params.get("tts_voice", "vi-VN-NamMinhNeural")
    speed = params.get("speed", 1.0)

    with db_cursor() as cur:
        row = cur.execute(
            "SELECT content FROM subtitles WHERE project_id=? ORDER BY created_at DESC LIMIT 1",
            (project_id,),
        ).fetchone()

    if not row:
        raise ValueError("No subtitle found for TTS")

    align = params.get("tts_align", True)
    api_key = params.get("fpt_api_key", None)
    tts_output = str(VOICES_DIR / f"project_{project_id}_tts.wav")

    if align:
        _log(item_id, "info", f"Generating Timeline-aligned TTS via {provider}")
        from .tts_engine import synthesize_timeline
        def _tts_progress(done, total):
            if total:
                pct = 60 + min(15, int((done / total) * 15))
                _update(item_id, "running", pct)
        synthesize_timeline(row["content"], provider, voice, speed, tts_output, api_key=api_key, progress_cb=_tts_progress)
    else:
        text = _extract_text_from_srt(row["content"])
        _log(item_id, "info", f"Generating flat TTS via {provider} ({len(text)} chars)")
        from .tts_engine import synthesize
        synthesize(text, provider, voice, speed, tts_output, api_key=api_key)

    if os.path.exists(tts_output):
        _register_asset("voice", tts_output, project_id)
        _log(item_id, "info", f"TTS saved: {tts_output}")
        _update(item_id, "completed", 100)
        return True

    _update(item_id, "failed", error="TTS generation failed")
    return False


# ─── Render Pipeline ───

def _ocr_hardsub(item_id: int, project_id: int, video_path: str, params: dict) -> bool:
    if not video_path or not os.path.exists(video_path):
        raise FileNotFoundError(f"Video not found: {video_path}")

    _log(item_id, "info", "Running RapidOCR hard-sub extraction")
    _update(item_id, "running", 10)
    from .ocr_service import extract_hard_subtitles

    result = extract_hard_subtitles(video_path, project_id, params.get("region") or params.get("subtitle_region"))
    if result.get("error"):
        _update(item_id, "failed", error=result["error"])
        return False

    out = result.get("srt_path", "")
    if out:
        _set_output_path(item_id, out)
        _register_asset("subtitle", out, project_id)
    _update(item_id, "completed", 100)
    return True


def _remove_hardsub(item_id: int, project_id: int, video_path: str, params: dict) -> bool:
    if not video_path or not os.path.exists(video_path):
        raise FileNotFoundError(f"Video not found: {video_path}")

    output_name = Path(params.get("output_name") or f"project_{project_id}_hardsub_blur.mp4").stem
    output_dir = Path(params.get("output_dir") or (EXPORTS_DIR / f"project_{project_id}"))
    output_dir.mkdir(parents=True, exist_ok=True)
    out_path = str(output_dir / f"{output_name}.mp4")
    region = params.get("region") or params.get("subtitle_region") or {"x": 0.0, "y": 0.75, "width": 1.0, "height": 0.25}

    _log(item_id, "info", "Removing hard subtitle by blur mask")
    _update(item_id, "running", 15)
    from .ffmpeg_utils import blur_subtitle_region

    ok = blur_subtitle_region(video_path, out_path, region)
    if not ok or not os.path.exists(out_path):
        _update(item_id, "failed", error="Hard-sub blur failed")
        return False

    _set_output_path(item_id, out_path)
    _register_asset("videos", out_path, project_id)
    _update(item_id, "completed", 100)
    return True


def _render(item_id: int, project_id: int, video_path: str, params: dict) -> bool:
    if not video_path or not os.path.exists(video_path):
        raise FileNotFoundError(f"Video not found: {video_path}")

    output_name = params.get("output_name", f"output_{project_id}")
    output_format = str(params.get("format", "mp4")).lower().lstrip(".") or "mp4"
    output_dir = params.get("output_dir")
    if output_dir and len(output_dir.strip(" .:\\/")) > 0 and output_dir != "........":
        export_dir = Path(output_dir)
    else:
        export_dir = EXPORTS_DIR / f"project_{project_id}"
    export_dir.mkdir(parents=True, exist_ok=True)
    output_stem = Path(output_name).stem
    final_output = str(export_dir / f"{output_stem}.{output_format}")

    _log(item_id, "info", f"Rendering video to {final_output}")

    # Step 1: Burn subtitles if available
    burn = params.get("burn_subtitle", True)
    if burn:
        with db_cursor() as cur:
            row = cur.execute(
                "SELECT content FROM subtitles WHERE project_id=? ORDER BY created_at DESC LIMIT 1",
                (project_id,),
            ).fetchone()
        if row:
            srt_path = str(SUBTITLES_DIR / f"project_{project_id}_burn.srt")
            Path(srt_path).write_text(row["content"], encoding="utf-8")
            _log(item_id, "info", "Burning subtitles...")

            sub_style = {
                "font": params.get("subtitle_font", "Arial"),
                "size": int(params.get("subtitle_size", 42)),
                "color": params.get("subtitle_color", "#FFFFFF"),
                "shadow": params.get("subtitle_shadow", "soft"),
            }
            sub_region = params.get("subtitle_region", None)
            remove_hardsub = bool(params.get("remove_hardsub", False))

            from .ffmpeg_utils import burn_subtitle
            burned = str(export_dir / f"{output_stem}_subbed.mp4")
            burn_subtitle(video_path, srt_path, burned, region=sub_region, style=sub_style, remove_hardsub=remove_hardsub)
            video_path = burned
            _update(item_id, "running", 40)

    # Step 2: Replace audio with TTS if available
    tts_path = str(VOICES_DIR / f"project_{project_id}_tts.wav")
    if os.path.exists(tts_path):
        _log(item_id, "info", "Replacing audio with TTS...")
        from .ffmpeg_utils import replace_audio
        video_path = replace_audio(video_path, tts_path, final_output)
        _update(item_id, "running", 70)
    else:
        _log(item_id, "info", "No TTS found, copying audio as-is")

    # Step 3: Apply effects (scale, codec, bitrate) — use temp file to avoid same-file conflict
    _log(item_id, "info", "Applying encode settings...")
    from .ffmpeg_utils import render_video
    final_path = Path(final_output)
    encoded_tmp = str(final_path.with_name(f"{final_path.stem}_encoded{final_path.suffix}"))
    if not render_video(video_path, encoded_tmp, params):
        raise RuntimeError(f"FFmpeg render_video failed for {video_path}")
    if not os.path.exists(encoded_tmp):
        raise RuntimeError(f"render_video output not created: {encoded_tmp}")
    os.replace(encoded_tmp, final_output)
    _update(item_id, "running", 90)

    file_size = os.path.getsize(final_output)
    with db_cursor() as cur:
        cur.execute(
            "INSERT INTO exports (project_id, input_path, output_path, format, file_size, status) VALUES (?,?,?,?,?,?)",
            (project_id, video_path, final_output, output_format, file_size, "completed"),
        )

    _register_asset("videos", final_output, project_id)
    _log(item_id, "info", f"Render complete: {final_output}")
    _set_output_path(item_id, final_output)
    _update(item_id, "completed", 100)
    return True


# ─── Full Pipeline (download → transcribe → translate → tts → render) ───

def _full(item_id: int, project_id: int, input_path: str, params: dict) -> bool:
    _log(item_id, "info", "Full pipeline started")

    # Step 1: Download if URL provided
    video_path = input_path
    if params.get("url"):
        _log(item_id, "info", "Step 1/5: Downloading video...")
        _update(item_id, "running", 5)
        from .downloader import download_video
        with db_cursor() as cur:
            cur.execute("INSERT INTO downloads (url, platform, status) VALUES (?,?,?)",
                        (params["url"], params.get("platform", "auto"), "waiting"))
            dl_id = cur.lastrowid
        download_video(dl_id, params["url"], params.get("quality", "best"), params.get("cookie_file"), params.get("proxy"), params.get("output_dir"))
        with db_cursor() as cur:
            row = cur.execute("SELECT * FROM downloads WHERE id=?", (dl_id,)).fetchone()
            if row and row["output_path"]:
                video_path = row["output_path"]
                _register_asset("videos", video_path, project_id)
    _update(item_id, "running", 20)

    # Step 2: Transcribe (skip if SRT already exists for this project)
    with db_cursor() as cur:
        has_srt = cur.execute(
            "SELECT 1 FROM subtitles WHERE project_id=? LIMIT 1", (project_id,)
        ).fetchone() is not None
    if has_srt:
        _log(item_id, "info", "Step 2/5: Skipping transcription (SRT already loaded)")
    else:
        _log(item_id, "info", "Step 2/5: Transcribing audio...")
        if video_path and os.path.exists(video_path):
            from .ffmpeg_utils import extract_audio
            from .whisper_stt import transcribe
            audio_path = extract_audio(video_path)
            lang = params.get("language", "vi")
            result = transcribe(audio_path, lang, project_id)
            srt_path = result.get("srt_path", "")
            _register_asset("subtitle", srt_path, project_id)
    _update(item_id, "running", 40)

    # Step 3: Translate
    src = params.get("source_lang", "vi")
    tgt = params.get("target_lang", "vi")
    _log(item_id, "info", f"Step 3 debug: params={json.dumps(params)}, src={src}, tgt={tgt}")
    if src != tgt:
        _log(item_id, "info", f"Step 3/5: Translating {src}→{tgt}...")
        _translate(item_id, project_id, params)
    else:
        _log(item_id, "info", "Step 3/5: Skipping translation (same language)")
    _update(item_id, "running", 60)

    # Step 4: TTS
    if params.get("tts_enabled", True):
        _log(item_id, "info", "Step 4/5: Generating voice...")
        try:
            _tts(item_id, project_id, params)
        except Exception as e:
            _log(item_id, "warning", f"TTS step failed (continuing): {e}")
    _update(item_id, "running", 75)

    # Step 5: Render
    _log(item_id, "info", "Step 5/5: Rendering final video...")
    try:
        _render(item_id, project_id, video_path, params)
    except Exception as e:
        _log(item_id, "error", f"Render step failed: {e}")
        _update(item_id, "failed", error=str(e))
        return False

    _log(item_id, "info", "Full pipeline complete!")
    _update(item_id, "completed", 100)
    return True


# ─── Export Audio ───

def _export_audio(item_id: int, project_id: int, input_path: str, params: dict) -> bool:
    if not input_path or not os.path.exists(input_path):
        raise FileNotFoundError(f"Input not found: {input_path}")
    fmt = params.get("format", "mp3")
    out = str(EXPORTS_DIR / f"audio_{project_id}_{int(time.time())}.{fmt}")
    _log(item_id, "info", f"Exporting audio to {out}")
    from .ffmpeg_utils import export_audio
    export_audio(input_path, out, fmt)
    _register_asset("audio", out, project_id)
    _set_output_path(item_id, out)
    _update(item_id, "completed", 100)
    return True


# ─── Split Video ───

def _split(item_id: int, project_id: int, input_path: str, params: dict) -> bool:
    if not input_path or not os.path.exists(input_path):
        raise FileNotFoundError(f"Input not found: {input_path}")
    start = params.get("start", 0)
    end = params.get("end", 10)
    out = input_path.replace(".mp4", f"_part_{int(start)}-{int(end)}.mp4")
    _log(item_id, "info", f"Splitting {start}-{end} → {out}")
    from .ffmpeg_utils import split_video
    split_video(input_path, out, start, end)
    _register_asset("videos", out, project_id)
    _update(item_id, "completed", 100)
    return True


# ─── Process Music ───

def _process_music(item_id: int, project_id: int, input_path: str, params: dict) -> bool:
    if not input_path or not os.path.exists(input_path):
        raise FileNotFoundError(f"Input not found: {input_path}")
    _log(item_id, "info", "Processing music track...")
    from .audio_processor import process_music
    out = process_music(input_path, params.get("volume", 1.0), params.get("fade_in", 0), params.get("fade_out", 0), params.get("normalize", False))
    _register_asset("audio", out, project_id)
    _update(item_id, "completed", 100)
    return True


# ─── Helpers ───

def _update(item_id: int, status: str, progress: float = None, error: str = None):
    from .queue_manager import update_item_status
    update_item_status(item_id, status, progress, error)


def _set_output_path(item_id: int, output_path: str):
    with db_cursor() as cur:
        cur.execute("UPDATE queue_items SET output_path=? WHERE id=?", (output_path, item_id))


def _log(item_id: int, level: str, message: str):
    try:
        with db_cursor() as cur:
            cur.execute("INSERT INTO job_logs (queue_item_id, level, message) VALUES (?,?,?)",
                        (item_id, level, message))
    except Exception:
        pass


def _extract_text_from_srt(srt_content: str) -> str:
    lines = []
    for line in srt_content.strip().split("\n"):
        line = line.strip()
        if not line or line.isdigit() or "-->" in line:
            continue
        lines.append(line)
    return " ".join(lines)


def _register_asset(category: str, file_path: str, project_id: int = 0):
    """Register a pipeline output in the assets table."""
    if not file_path or not os.path.exists(file_path):
        return
    try:
        with db_cursor() as cur:
            cur.execute(
                "INSERT INTO assets (type, name, path, size) VALUES (?,?,?,?)",
                (category, Path(file_path).name, file_path, os.path.getsize(file_path)),
            )
    except Exception:
        pass
