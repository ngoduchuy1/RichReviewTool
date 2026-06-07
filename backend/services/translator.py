import os
import json
from ..config import OPENAI_API_KEY, GEMINI_API_KEY
from ..database import db_cursor
import requests


_TRANSLATION_ERROR_PREFIXES = ("[GPT error:", "[Gemini error:", "[NLLB error:", "[NLLB unavailable",
                              "[MarianMT error:", "[MarianMT unavailable", "[Translation error:",
                              "[GPT translation unavailable", "[Gemini translation unavailable")


def _is_translation_error(result: str) -> bool:
    return result.startswith(_TRANSLATION_ERROR_PREFIXES)


def translate_text(text: str, source_lang: str = "zh", target_lang: str = "vi", engine: str = "gpt") -> str:
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


def translate_srt(srt_content: str, source_lang: str = "zh", target_lang: str = "vi", engine: str = "gpt") -> str:
    """Blocking translate — used internally / by API models."""
    job_id = str(uuid.uuid4())
    _job_set(job_id, status="running", progress=0, result=None, error=None)
    _translate_srt_sync(job_id, srt_content, source_lang, target_lang, engine)
    job = _JOBS.get(job_id, {})
    if job.get("status") == "error":
        raise RuntimeError(job.get("error", "Translation failed"))
    return job.get("result") or ""


def translate_srt_async(srt_content: str, source_lang: str = "zh", target_lang: str = "vi", engine: str = "gpt", project_id=None) -> str:
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
                joined = "\n".join(t for t in texts if t)
                if joined.strip():
                    translated_joined = translate_text(joined, source_lang, target_lang, engine)
                    if _is_translation_error(translated_joined):
                        raise RuntimeError(translated_joined)
                    parts = translated_joined.split("\n")
                    if len(parts) < len(chunk):
                        parts += [""] * (len(chunk) - len(parts))
                else:
                    parts = [""] * len(chunk)
                for (idx, time_line, _), translated in zip(chunk, parts):
                    result_blocks.append(f"{idx}\n{time_line}\n{translated.strip()}\n")
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




_nllb_tokenizer = None
_nllb_model = None

def _translate_nllb(text, src, tgt):
    """Translate using Meta's NLLB-200 model (runs locally)."""
    global _nllb_tokenizer, _nllb_model
    lang_map = {
        "vi": "vie_Latn", "en": "eng_Latn", "zh": "zho_Hans",
        "ja": "jpn_Jpan", "ko": "kor_Hang", "th": "tha_Thai",
        "fr": "fra_Latn", "de": "deu_Latn", "es": "spa_Latn",
        "ru": "rus_Cyrl", "ar": "ara_Arab", "pt": "por_Latn",
        "id": "ind_Latn", "ms": "zsm_Latn", "tl": "tgl_Latn",
        "lo": "lao_Laoo", "km": "khm_Khmr", "my": "mya_Mymr",
    }
    src_code = lang_map.get(src, src)
    tgt_code = lang_map.get(tgt, tgt)
    try:
        from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
        import torch
        # Ưu tiên load từ local cache đã tải sẵn, fallback về HF nếu không có
        import os as _os
        _local_path = _os.path.expanduser("~/.cache/nllb_manual")
        model_name = _local_path if _os.path.isdir(_local_path) and _os.path.exists(_os.path.join(_local_path, "pytorch_model.bin")) else "facebook/nllb-200-distilled-600M"

        if _nllb_model is None or _nllb_tokenizer is None:
            device = "cuda" if torch.cuda.is_available() else "cpu"
            _nllb_tokenizer = AutoTokenizer.from_pretrained(model_name)
            _nllb_model = AutoModelForSeq2SeqLM.from_pretrained(model_name, low_cpu_mem_usage=True).to(device)
            
        device = next(_nllb_model.parameters()).device
        _nllb_tokenizer.src_lang = src_code
        tgt_token_id = _nllb_tokenizer.convert_tokens_to_ids(tgt_code)
        
        # Split into sentences and batch-translate for speed (max 32 at a time)
        sentences = [s.strip() for s in text.split("\n") if s.strip()]
        results = []
        BATCH = 32
        for i in range(0, len(sentences), BATCH):
            batch = sentences[i:i+BATCH]
            inputs = _nllb_tokenizer(
                batch, return_tensors="pt", padding=True,
                truncation=True, max_length=256
            ).to(device)
            with torch.no_grad():
                outputs = _nllb_model.generate(
                    **inputs,
                    forced_bos_token_id=tgt_token_id,
                    max_length=256,
                    num_beams=2,
                )
            decoded = _nllb_tokenizer.batch_decode(outputs, skip_special_tokens=True)
            results.extend(decoded)
        return "\n".join(results)
    except ImportError:
        return f"[NLLB unavailable - install transformers]"
    except Exception as e:
        return f"[NLLB error: {e}]"


_marian_tokenizer = None
_marian_model = None
_marian_model_name = None

def _translate_marian(text, src, tgt):
    """Translate using Helsinki-NLP MarianMT (runs locally, lightweight)."""
    global _marian_tokenizer, _marian_model, _marian_model_name
    model_map = {
        ("en", "vi"): "Helsinki-NLP/opus-mt-en-vi",
        ("vi", "en"): "Helsinki-NLP/opus-mt-vi-en",
        ("zh", "vi"): "Helsinki-NLP/opus-mt-zh-vi",
    }
    key = (src, tgt)
    model_name = model_map.get(key)
    if not model_name:
        return f"[MarianMT: unsupported pair {src}->{tgt}]"
    try:
        from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
        import torch
        
        if _marian_model is None or _marian_tokenizer is None or _marian_model_name != model_name:
            device = "cuda" if torch.cuda.is_available() else "cpu"
            _marian_tokenizer = AutoTokenizer.from_pretrained(model_name)
            _marian_model = AutoModelForSeq2SeqLM.from_pretrained(model_name).to(device)
            _marian_model_name = model_name
            
        device = next(_marian_model.parameters()).device
        inputs = _marian_tokenizer(text, return_tensors="pt", truncation=True, max_length=512).to(device)
        outputs = _marian_model.generate(**inputs, max_length=512)
        return _marian_tokenizer.decode(outputs[0], skip_special_tokens=True)
    except ImportError:
        return f"[MarianMT unavailable - install transformers]"
    except Exception as e:
        return f"[MarianMT error: {e}]"


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
