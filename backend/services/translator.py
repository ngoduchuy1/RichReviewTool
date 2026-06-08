import os
import json
import subprocess
import sys
from pathlib import Path
from ..config import OPENAI_API_KEY, GEMINI_API_KEY
from ..database import db_cursor
import requests


_TRANSLATION_ERROR_PREFIXES = ("[GPT error:", "[Gemini error:", "[NLLB error:", "[NLLB unavailable",
                              "[MarianMT error:", "[MarianMT unavailable", "[Translation error:",
                              "[GPT translation unavailable", "[Gemini translation unavailable")


def _is_translation_error(result: str) -> bool:
    return result.startswith(_TRANSLATION_ERROR_PREFIXES)


def translate_text(text: str, source_lang: str = "zh", target_lang: str = "vi", engine: str = "nllb") -> str:
    if engine == "gpt":
        return _translate_gpt(text, source_lang, target_lang)
    elif engine == "gemini":
        return _translate_gemini(text, source_lang, target_lang)
    elif engine == "google":
        return _translate_google(text, source_lang, target_lang)
    elif engine == "nllb":
        return _translate_nllb(text, source_lang, target_lang)
    elif engine == "marian":
        return _translate_marian(text, source_lang, target_lang)
    return text


import uuid
import threading

# ── Job tracker: job_id -> {status, progress, result, error} ─────────────────
_JOBS: dict = {}
_JOBS_LOCK = threading.Lock()

def _job_set(job_id, **kwargs):
    with _JOBS_LOCK:
        if job_id not in _JOBS:
            _JOBS[job_id] = {}
        _JOBS[job_id].update(kwargs)

def get_job(job_id: str) -> dict:
    with _JOBS_LOCK:
        return dict(_JOBS.get(job_id, {}))


def translate_srt(srt_content: str, source_lang: str = "zh", target_lang: str = "vi", engine: str = "nllb") -> str:
    """Blocking translate — used internally / by API models."""
    job_id = str(uuid.uuid4())
    _job_set(job_id, status="running", progress=0, result=None, error=None)
    _translate_srt_sync(job_id, srt_content, source_lang, target_lang, engine)
    job = _JOBS.get(job_id, {})
    if job.get("status") == "error":
        raise RuntimeError(job.get("error", "Translation failed"))
    return job.get("result") or ""


def translate_srt_async(srt_content: str, source_lang: str = "zh", target_lang: str = "vi", engine: str = "nllb", project_id=None) -> str:
    """Async translate — starts a background thread, returns job_id immediately."""
    job_id = str(uuid.uuid4())
    _job_set(job_id, status="running", progress=0, result=None, error=None, project_id=project_id)
    t = threading.Thread(
        target=_translate_srt_sync,
        args=(job_id, srt_content, source_lang, target_lang, engine),
        daemon=True,
    )
    t.start()
    return job_id


def _translate_srt_sync(job_id: str, srt_content: str, source_lang: str, target_lang: str, engine: str):
    """Parse SRT, translate block-by-block with progress updates, store result."""
    try:
        lines = srt_content.strip().split("\n")
        text_blocks = []  # list of (idx, time_line, text)
        i = 0
        while i < len(lines):
            line = lines[i].strip()
            if line.isdigit():
                idx = line
                i += 1
                time_line = lines[i].strip() if i < len(lines) else ""
                i += 1
                text_parts = []
                while i < len(lines) and lines[i].strip():
                    text_parts.append(lines[i].strip())
                    i += 1
                text = " ".join(text_parts)
                text_blocks.append((idx, time_line, text))
            else:
                i += 1

        if not text_blocks:
            _job_set(job_id, status="done", progress=100, result=srt_content)
            return

        total = len(text_blocks)
        result_blocks = []

        # ── NLLB / Marian: batch by 8 blocks, update progress per batch ───────
        if engine in ("nllb", "marian"):
            BATCH = 8
            done = 0
            for start in range(0, total, BATCH):
                chunk = text_blocks[start:start + BATCH]
                texts = [blk[2] for blk in chunk]
                joined = "\n".join(texts)
                if joined.strip():
                    translated_joined = translate_text(joined, source_lang, target_lang, engine)
                    if _is_translation_error(translated_joined):
                        raise RuntimeError(translated_joined)
                    parts = translated_joined.split("\n")
                    # Handle misalignment: truncate extra lines, pad missing lines
                    if len(parts) > len(chunk):
                        parts = parts[:len(chunk)]
                    elif len(parts) < len(chunk):
                        parts += [""] * (len(chunk) - len(parts))
                else:
                    parts = [""] * len(chunk)
                for (idx, time_line, _), translated in zip(chunk, parts):
                    result_blocks.append(f"{idx}\n{time_line}\n{(translated or '').strip()}\n")
                done += len(chunk)
                pct = int(done / total * 100)
                _job_set(job_id, progress=pct)

        # ── API models (gpt, gemini, google): per-block with progress ─────────
        else:
            for n, (idx, time_line, text) in enumerate(text_blocks):
                translated = translate_text(text, source_lang, target_lang, engine) if text else ""
                if _is_translation_error(translated):
                    raise RuntimeError(translated)
                result_blocks.append(f"{idx}\n{time_line}\n{translated}\n")
                _job_set(job_id, progress=int((n + 1) / total * 100))

        final = "\n".join(result_blocks)

        # Save to DB if project_id provided
        proj = get_job(job_id).get("project_id")
        if proj:
            try:
                with db_cursor() as cur:
                    cur.execute(
                        "INSERT INTO subtitles (project_id, source, content) VALUES (?,?,?)",
                        (proj, f"translated_{engine}.srt", final),
                    )
            except Exception:
                pass

        _job_set(job_id, status="done", progress=100, result=final)
    except Exception as e:
        _job_set(job_id, status="error", error=str(e))




def _find_system_python():
    """Find system Python (not the PyInstaller EXE)."""
    if getattr(sys, 'frozen', False):
        candidates = [
            os.path.join(os.path.dirname(sys.executable), "python.exe"),
            r"C:\Program Files\Python312\python.exe",
            r"C:\Python312\python.exe",
        ]
        for p in candidates:
            if os.path.exists(p):
                return p
        for p in os.environ.get("PATH", "").split(os.pathsep):
            candidate = os.path.join(p, "python.exe")
            if os.path.exists(candidate):
                return candidate
    return sys.executable


def _translate_worker_script():
    if getattr(sys, 'frozen', False):
        exe_dir = Path(sys.executable).resolve().parent
        candidate = exe_dir / "backend" / "services" / "translate_worker.py"
        if candidate.exists():
            return candidate
    return Path(__file__).parent / "translate_worker.py"


# Persistent translate worker process
_translate_proc = None
_translate_proc_lock = threading.Lock()
_translate_proc_engine = None


def _get_translate_worker(engine: str):
    """Get or create a persistent translate worker subprocess."""
    global _translate_proc, _translate_proc_engine
    with _translate_proc_lock:
        if _translate_proc is not None and _translate_proc.poll() is not None:
            _translate_proc = None
        if _translate_proc is None or _translate_proc_engine != engine:
            if _translate_proc is not None:
                _translate_proc.stdin.close()
                _translate_proc.wait(timeout=5)
            python = _find_system_python()
            script = _translate_worker_script()
            if not script.exists():
                return None
            _translate_proc = subprocess.Popen(
                [python, str(script)],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, text=True,
                creationflags=subprocess.CREATE_NO_WINDOW
            )
            _translate_proc_engine = engine
            # Send first request to trigger model loading
            _translate_proc.stdin.write(json.dumps({"engine": engine, "text": "", "src": "zh", "tgt": "vi"}) + "\n")
            _translate_proc.stdin.flush()
            _translate_proc.stdout.readline()  # discard warmup response
        return _translate_proc


def _call_translate_worker(engine: str, text: str, src: str, tgt: str) -> str:
    """Send a translation request to the persistent worker subprocess."""
    try:
        proc = _get_translate_worker(engine)
        if proc is None:
            return f"[NLLB unavailable - worker script not found]"
        req = json.dumps({"engine": engine, "text": text, "src": src, "tgt": tgt})
        proc.stdin.write(req + "\n")
        proc.stdin.flush()
        line = proc.stdout.readline()
        if not line:
            return "[NLLB error: worker process died]"
        data = json.loads(line)
        if data.get("error"):
            return f"[NLLB error: {data['error']}]"
        return data["result"]
    except Exception as e:
        return f"[NLLB error: {e}]"


def _translate_nllb(text, src, tgt):
    """Translate using Meta's NLLB-200 model via persistent subprocess."""
    return _call_translate_worker("nllb", text, src, tgt)


def _translate_marian(text, src, tgt):
    """Translate using Helsinki-NLP MarianMT via persistent subprocess."""
    return _call_translate_worker("marian", text, src, tgt)


def _translate_gpt(text, src, tgt):
    if not OPENAI_API_KEY:
        return f"[GPT translation unavailable - set OPENAI_API_KEY]"
    try:
        resp = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"},
            json={
                "model": "gpt-4o-mini",
                "messages": [
                    {"role": "system", "content": f"Translate from {src} to {tgt}. Return only translation."},
                    {"role": "user", "content": text},
                ],
                "temperature": 0.3,
            },
            timeout=30,
        )
        data = resp.json()
        tokens = data.get("usage", {}).get("total_tokens", 0)
        _log_usage("gpt", tokens, 0, tokens * 0.00015 / 1000)
        return data["choices"][0]["message"]["content"].strip()
    except Exception as e:
        return f"[GPT error: {e}]"


def _translate_gemini(text, src, tgt):
    if not GEMINI_API_KEY:
        return f"[Gemini translation unavailable - set GEMINI_API_KEY]"
    try:
        resp = requests.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={GEMINI_API_KEY}",
            json={
                "contents": [{"parts": [{"text": f"Translate from {src} to {tgt}: {text}"}]}],
                "generationConfig": {"temperature": 0.3},
            },
            timeout=30,
        )
        data = resp.json()
        result = data["candidates"][0]["content"]["parts"][0]["text"]
        return result.strip()
    except Exception as e:
        return f"[Gemini error: {e}]"


def _translate_google(text, src, tgt):
    try:
        from googletrans import Translator
        t = Translator()
        result = t.translate(text, src=src, dest=tgt)
        return result.text
    except ImportError:
        return _translate_free(text, src, tgt)


def _translate_free(text, src, tgt):
    try:
        resp = requests.get(
            "https://translate.googleapis.com/translate_a/single",
            params={"client": "gtx", "sl": src, "tl": tgt, "dt": "t", "q": text},
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=10,
        )
        data = resp.json()
        return "".join(part[0] for part in data[0])
    except Exception as e:
        return f"[Translation error: {e}]"


def _log_usage(service, tokens, seconds, cost):
    try:
        with db_cursor() as cur:
            cur.execute(
                "INSERT INTO api_usage (service, tokens, seconds, cost) VALUES (?,?,?,?)",
                (service, tokens, seconds, cost),
            )
    except Exception:
        pass
