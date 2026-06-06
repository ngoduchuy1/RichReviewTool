from ..database import db_cursor
from datetime import datetime


def add_queue_item(project_id: int, item_type: str, input_path: str, params: dict = None, priority: int = 0) -> int:
    import json
    with db_cursor() as cur:
        cur.execute(
            "INSERT INTO queue_items (project_id, type, status, input_path, params, priority) VALUES (?,?,?,?,?,?)",
            (project_id, item_type, "waiting", input_path, json.dumps(params or {}), priority),
        )
        return cur.lastrowid


def update_item_status(item_id: int, status: str, progress: float = None, error: str = None):
    with db_cursor() as cur:
        fields = ["status=?"]
        vals = [status]
        if progress is not None:
            fields.append("progress=?")
            vals.append(progress)
        if error is not None:
            fields.append("error=?")
            vals.append(error)
        vals.append(datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
        vals.append(item_id)
        cur.execute(
            f"UPDATE queue_items SET {', '.join(fields)}, updated_at=? WHERE id=?",
            vals,
        )


def retry_failed(item_id: int = None):
    with db_cursor() as cur:
        if item_id:
            cur.execute("UPDATE queue_items SET status='waiting', error=NULL WHERE id=? AND status='failed'", (item_id,))
        else:
            cur.execute("UPDATE queue_items SET status='waiting', error=NULL WHERE status='failed'")


def pause_all() -> int:
    with db_cursor() as cur:
        cur.execute("UPDATE queue_items SET status='paused' WHERE status='running' OR status='waiting'")
        return cur.rowcount


def resume_all() -> int:
    with db_cursor() as cur:
        cur.execute("UPDATE queue_items SET status='waiting' WHERE status='paused'")
        return cur.rowcount


def get_queue(status: str = None) -> list:
    with db_cursor() as cur:
        if status:
            rows = cur.execute("SELECT * FROM queue_items WHERE status=? ORDER BY priority DESC, created_at", (status,)).fetchall()
        else:
            rows = cur.execute("SELECT * FROM queue_items ORDER BY priority DESC, created_at").fetchall()
        return [dict(r) for r in rows]


def clear_all():
    with db_cursor() as cur:
        cur.execute("DELETE FROM queue_items")
