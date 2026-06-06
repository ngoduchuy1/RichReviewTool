import os
from pathlib import Path

import sys

# If frozen (PyInstaller), use executable folder for user data
if getattr(sys, 'frozen', False):
    EXE_DIR = Path(sys.executable).resolve().parent
else:
    EXE_DIR = Path(__file__).resolve().parent.parent

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = EXE_DIR / "data"
DB_DIR = DATA_DIR / "db"
PROJECTS_DIR = DATA_DIR / "projects"
DOWNLOADS_DIR = DATA_DIR / "downloads"
SUBTITLES_DIR = DATA_DIR / "subtitles"
VOICES_DIR = DATA_DIR / "voices"
EXPORTS_DIR = DATA_DIR / "exports"
TEMPLATES_DIR = DATA_DIR / "templates"
PRESETS_DIR = DATA_DIR / "presets"
CACHE_DIR = DATA_DIR / "cache"
ASSETS_DIR = DATA_DIR / "downloads"

DB_PATH = DB_DIR / "app.db"

FFMPEG_PATH = os.environ.get("FFMPEG_PATH", "ffmpeg")
FFPROBE_PATH = os.environ.get("FFPROBE_PATH", "ffprobe")
YTDLP_PATH = os.environ.get("YTDLP_PATH", "yt-dlp")
LIBOPENSHOT_PATH = os.environ.get("LIBOPENSHOT_PATH", "")

WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "base")
WHISPER_DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
AZURE_TTS_KEY = os.environ.get("AZURE_TTS_KEY", "")
AZURE_TTS_REGION = os.environ.get("AZURE_TTS_REGION", "eastus")
ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY", "")

MAX_QUEUE_WORKERS = int(os.environ.get("MAX_QUEUE_WORKERS", "2"))
PORT = int(os.environ.get("PORT", "7860"))
HOST = os.environ.get("HOST", "127.0.0.1")
DEFAULT_FPS = 30
DEFAULT_RESOLUTION = "1920x1080"

for d in [DB_DIR, PROJECTS_DIR, DOWNLOADS_DIR, SUBTITLES_DIR, VOICES_DIR, EXPORTS_DIR, TEMPLATES_DIR, PRESETS_DIR, CACHE_DIR, ASSETS_DIR]:
    d.mkdir(parents=True, exist_ok=True)
