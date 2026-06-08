import os
import sys
import json
import subprocess
from pathlib import Path


def _find_python():
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
        # fallback: search PATH
        for p in os.environ.get("PATH", "").split(os.pathsep):
            candidate = os.path.join(p, "python.exe")
            if os.path.exists(candidate):
                return candidate
    return sys.executable


def _stt_script():
    if getattr(sys, 'frozen', False):
        exe_dir = Path(sys.executable).resolve().parent
        candidate = exe_dir / "backend" / "services" / "transcribe_worker.py"
        if candidate.exists():
            return candidate
    return Path(__file__).parent / "transcribe_worker.py"


def transcribe_subprocess(audio_path: str, language: str = "vi", model: str = "base") -> dict:
    """Run faster-whisper in a subprocess to avoid native DLL conflicts in PyInstaller bundle."""
    python = _find_python()
    script = _stt_script()
    if not script.exists():
        return {"srt_path": "", "text": "", "segments": 0, "error": "worker script not found"}

    try:
        result = subprocess.run(
            [python, str(script), audio_path, "--language", language, "--model", model],
            capture_output=True, text=True, timeout=600,
        )
        if result.returncode != 0:
            err = result.stderr.strip()
            out = result.stdout.strip()
            return {"srt_path": "", "text": "", "segments": 0, "error": err or out}
        return json.loads(result.stdout)
    except subprocess.TimeoutExpired:
        return {"srt_path": "", "text": "", "segments": 0, "error": "transcription timed out"}
    except Exception as e:
        return {"srt_path": "", "text": "", "segments": 0, "error": str(e)}
