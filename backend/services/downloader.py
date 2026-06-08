import subprocess
import json
import os
from pathlib import Path
from ..config import YTDLP_PATH, DOWNLOADS_DIR
from ..database import db_cursor


def download_video(dl_id: int, url: str, quality: str = "best", cookie_file: str = None, proxy: str = None):
    out_dir = DOWNLOADS_DIR / f"dl_{dl_id}"
    out_dir.mkdir(parents=True, exist_ok=True)

    cmd = [YTDLP_PATH, "-o", str(out_dir / "%(title)s.%(ext)s")]
    
    if quality == "best":
        cmd.extend(["-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"])
    elif quality == "1080p":
        cmd.extend(["-f", "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]"])
    elif quality == "720p":
        cmd.extend(["-f", "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]"])
    elif quality == "audio":
        cmd.extend(["-x", "--audio-format", "mp3"])

    if cookie_file:
        cmd.extend(["--cookies", cookie_file])
    if proxy:
        cmd.extend(["--proxy", proxy])

    cmd.extend(["--progress-template", "json", url])

    try:
        with db_cursor() as cur:
            cur.execute("UPDATE downloads SET status='running' WHERE id=?", (dl_id,))

        process = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace",
            creationflags=subprocess.CREATE_NO_WINDOW
        )

        for line in process.stdout:
            line = line.strip()
            try:
                data = json.loads(line)
                pct = data.get("progress", {}).get("percentage", 0)
                with db_cursor() as cur:
                    cur.execute("UPDATE downloads SET progress=? WHERE id=?", (pct, dl_id))
            except json.JSONDecodeError:
                pass

        process.wait()

        if process.returncode == 0:
            files = list(out_dir.iterdir())
            out_path = str(files[0]) if files else ""
            with db_cursor() as cur:
                cur.execute("UPDATE downloads SET status='completed', output_path=?, progress=100 WHERE id=?", (out_path, dl_id))
        else:
            with db_cursor() as cur:
                cur.execute("UPDATE downloads SET status='failed' WHERE id=?", (dl_id,))

    except Exception as e:
        with db_cursor() as cur:
            cur.execute("UPDATE downloads SET status='failed', error=? WHERE id=?", (str(e), dl_id))
