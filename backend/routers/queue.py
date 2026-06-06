from fastapi import APIRouter, HTTPException
from ..services.queue_manager import get_queue, add_queue_item, update_item_status, retry_failed, pause_all, resume_all, clear_all
from ..database import db_cursor

router = APIRouter()


@router.post("/clear-all")
def clear():
    clear_all()
    return {"message": "Queue cleared"}


@router.post("/")
def create_queue_item(data: dict):
    project_id = data.get("project_id")
    ptype = data.get("type", "render")
    input_path = data.get("input_path", "")
    params = data.get("params", {})
    if not project_id:
        raise HTTPException(400, "project_id required")
    item_id = add_queue_item(project_id, ptype, input_path, params, data.get("priority", 0))
    return {"id": item_id, "message": "Item queued"}


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


@router.post("/{item_id}/retry")
def retry(item_id: int):
    retry_failed(item_id)
    return {"message": "Retrying"}


@router.post("/retry-all")
def retry_all():
    retry_failed()
    return {"message": "Retrying all failed"}


@router.post("/pause-all")
def pause():
    count = pause_all()
    return {"message": f"Paused {count} items"}


@router.post("/resume-all")
def resume():
    count = resume_all()
    return {"message": f"Resumed {count} items"}


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
