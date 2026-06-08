from fastapi import APIRouter, BackgroundTasks, HTTPException
from ..services.downloader import download_video
from ..database import db_cursor
from ..services.queue_manager import add_queue_item

router = APIRouter()


@router.post("/download")
def batch_download(data: dict, bg: BackgroundTasks):
    urls = data.get("urls", [])
    if not urls or not isinstance(urls, list):
        raise HTTPException(400, "urls phải là một danh sách không trống")
    items = []
    for url in urls:
        with db_cursor() as cur:
            cur.execute("INSERT INTO downloads (url, platform, status) VALUES (?,?,?)",
                        (url, data.get("platform", "auto"), "waiting"))
            dl_id = cur.lastrowid
        bg.add_task(download_video, dl_id, url, data.get("quality", "best"), data.get("cookie_file"), data.get("proxy"))
        items.append({"url": url, "id": dl_id})
    return {"message": f"Đã đưa {len(items)} lượt tải về vào hàng đợi", "items": items}


@router.post("/urls")
def batch_urls(data: dict):
    urls = data.get("urls", [])
    if not urls:
        raise HTTPException(400, "Yêu cầu cung cấp urls")
    item_ids = []
    for url in urls:
        item_id = add_queue_item(data.get("project_id", 0), "download", "", {"url": url, "quality": data.get("quality", "best")})
        item_ids.append(item_id)
    return {"message": f"Đã đưa {len(item_ids)} URL vào hàng đợi", "ids": item_ids}
