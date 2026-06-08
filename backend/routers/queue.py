import asyncio
import json
import queue as qmod
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from ..services.queue_manager import get_queue, add_queue_item, update_item_status, retry_failed, pause_all, resume_all, clear_all
from ..services.event_bus import event_bus
from ..database import db_cursor

router = APIRouter()


@router.get("/events")
async def queue_events(request: Request):
    q = event_bus.register()
    try:
        async def generate():
            try:
                yield "data: {\"type\":\"connected\"}\n\n"
                while True:
                    if await request.is_disconnected():
                        break
                    try:
                        payload = await asyncio.to_thread(q.get, timeout=5)
                        try:
                            event = json.loads(payload)
                        except Exception:
                            event = {"type": "queue_changed", "data": None}

                        if event.get("type") == "queue_changed":
                            with db_cursor() as cur:
                                rows = cur.execute("SELECT * FROM queue_items ORDER BY priority DESC, created_at").fetchall()
                            event["data"] = [dict(r) for r in rows]

                        yield f"data: {json.dumps(event)}\n\n"
                    except qmod.Empty:
                        yield ": heartbeat\n\n"
            finally:
                event_bus.unregister(q)
        return StreamingResponse(generate(), media_type="text/event-stream", headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        })
    except Exception:
        event_bus.unregister(q)
        raise


@router.post("/clear-all")
def clear():
    clear_all()
    return {"message": "Đã xóa sạch hàng đợi"}


@router.post("/")
def create_queue_item(data: dict):
    project_id = data.get("project_id")
    ptype = data.get("type", "render")
    input_path = data.get("input_path", "")
    params = data.get("params", {})
    if not project_id:
        raise HTTPException(400, "Yêu cầu cung cấp project_id")
    item_id = add_queue_item(project_id, ptype, input_path, params, data.get("priority", 0))
    return {"id": item_id, "message": "Đã đưa phần tử vào hàng đợi"}


@router.get("/")
def list_queue(status: str = None):
    with db_cursor() as cur:
        if status:
            rows = cur.execute("SELECT * FROM queue_items WHERE status=? ORDER BY priority DESC, created_at", (status,)).fetchall()
        else:
            rows = cur.execute("SELECT * FROM queue_items ORDER BY priority DESC, created_at").fetchall()
        return [dict(r) for r in rows]


@router.get("/stats")
def queue_stats():
    with db_cursor() as cur:
        cur.execute("SELECT status, COUNT(*) as cnt FROM queue_items GROUP BY status")
        stats = {r["status"]: r["cnt"] for r in cur.fetchall()}
    return {
        "running": stats.get("running", 0),
        "waiting": stats.get("waiting", 0),
        "completed": stats.get("completed", 0),
        "failed": stats.get("failed", 0),
    }


@router.get("/worker")
def worker_status():
    from ..workers.ffmpeg_worker import get_worker
    worker = get_worker()
    return {
        "alive": worker.is_alive,
        "active": worker.active_count,
        "max_workers": worker.max_workers,
    }


@router.post("/{item_id}/retry")
def retry(item_id: int):
    retry_failed(item_id)
    return {"message": "Đang thử lại"}


@router.post("/retry-all")
def retry_all():
    retry_failed()
    return {"message": "Đang thử lại tất cả tệp lỗi"}


@router.post("/pause-all")
def pause():
    count = pause_all()
    return {"message": f"Đã tạm dừng {count} phần tử"}


@router.post("/resume-all")
def resume():
    count = resume_all()
    return {"message": f"Đã tiếp tục {count} phần tử"}


@router.get("/logs")
def get_logs(queue_item_id: int = None, limit: int = 100):
    with db_cursor() as cur:
        if queue_item_id:
            rows = cur.execute(
                "SELECT * FROM job_logs WHERE queue_item_id=? ORDER BY timestamp DESC LIMIT ?",
                (queue_item_id, limit),
            ).fetchall()
        else:
            rows = cur.execute(
                "SELECT * FROM job_logs ORDER BY timestamp DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [dict(r) for r in rows]


@router.post("/log")
def add_log(data: dict):
    """Client-side log endpoint — stores frontend errors in job_logs."""
    level = data.get("level", "info")
    message = data.get("message", "")
    item_id = data.get("queue_item_id")
    try:
        with db_cursor() as cur:
            if item_id:
                cur.execute(
                    "INSERT INTO job_logs (queue_item_id, level, message) VALUES (?,?,?)",
                    (item_id, level, message),
                )
            else:
                cur.execute(
                    "INSERT INTO job_logs (queue_item_id, level, message) VALUES (NULL,?,?)",
                    (level, message),
                )
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}
