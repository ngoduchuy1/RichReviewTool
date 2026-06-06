from fastapi import APIRouter, HTTPException, BackgroundTasks
from ..models.schemas import DownloadRequest
from ..services.downloader import download_video
from ..database import db_cursor

router = APIRouter()


@router.post("/")
def start_download(data: DownloadRequest, bg: BackgroundTasks):
    with db_cursor() as cur:
        cur.execute(
            "INSERT INTO downloads (url, platform, status) VALUES (?,?,?)",
            (data.url, data.platform or "auto", "waiting"),
        )
        dl_id = cur.lastrowid
    bg.add_task(download_video, dl_id, data.url, data.quality, data.cookie_file, data.proxy)
    return {"id": dl_id, "message": "Download queued"}


@router.get("/")
def list_downloads():
    with db_cursor() as cur:
        rows = cur.execute("SELECT * FROM downloads ORDER BY created_at DESC").fetchall()
        return [dict(r) for r in rows]


@router.get("/{dl_id}")
def get_download(dl_id: int):
    with db_cursor() as cur:
        row = cur.execute("SELECT * FROM downloads WHERE id=?", (dl_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Download not found")
        return dict(row)


@router.post("/{dl_id}/cancel")
def cancel_download(dl_id: int):
    with db_cursor() as cur:
        cur.execute("UPDATE downloads SET status='cancelled' WHERE id=?", (dl_id,))
    return {"message": "Download cancelled"}
