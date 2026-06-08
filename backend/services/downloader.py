import subprocess
import re
from pathlib import Path
from ..config import YTDLP_PATH, DOWNLOADS_DIR
from ..database import db_cursor


def _publish_download(dl_id: int):
    try:
        from .event_bus import event_bus
        with db_cursor() as cur:
            row = cur.execute("SELECT * FROM downloads WHERE id=?", (dl_id,)).fetchone()
            if row:
                event_bus.publish("download_updated", dict(row))
    except Exception:
        pass


def download_video(dl_id: int, url: str, quality: str = "best", cookie_file: str = None, proxy: str = None, output_dir: str = None):
    out_dir = Path(output_dir) if output_dir and output_dir.strip() else DOWNLOADS_DIR / f"dl_{dl_id}"
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

    cmd.extend(["--newline", "--restrict-filenames", url])

    try:
        with db_cursor() as cur:
            cur.execute("UPDATE downloads SET status='running', error=NULL WHERE id=?", (dl_id,))
        _publish_download(dl_id)

        process = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace",
            creationflags=subprocess.CREATE_NO_WINDOW
        )

        for line in process.stdout:
            line = line.strip()
            match = re.search(r"(\d+(?:\.\d+)?)%", line)
            if match:
                pct = float(match.group(1))
                with db_cursor() as cur:
                    cur.execute("UPDATE downloads SET progress=? WHERE id=?", (pct, dl_id))
                _publish_download(dl_id)

        process.wait()

        if process.returncode == 0:
            files = [p for p in out_dir.iterdir() if p.is_file()]
            files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
            out_path = str(files[0]) if files else ""
            with db_cursor() as cur:
                cur.execute("UPDATE downloads SET status='completed', output_path=?, progress=100 WHERE id=?", (out_path, dl_id))
            _publish_download(dl_id)
        else:
            with db_cursor() as cur:
                cur.execute("UPDATE downloads SET status='failed', error=? WHERE id=?", ("yt-dlp failed", dl_id))
            _publish_download(dl_id)

    except Exception as e:
        with db_cursor() as cur:
            cur.execute("UPDATE downloads SET status='failed', error=? WHERE id=?", (str(e), dl_id))
        _publish_download(dl_id)
