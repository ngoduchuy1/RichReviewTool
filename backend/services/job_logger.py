import threading
from ..database import db_cursor

_job_state = threading.local()

def set_current_job_id(job_id: int):
    _job_state.job_id = job_id

def get_current_job_id() -> int:
    return getattr(_job_state, "job_id", None)

def job_log(level: str, message: str):
    # Clean and format the level and message
    lvl = (level or "info").lower()
    msg = str(message or "").strip()
    if not msg:
        return

    # Print to standard output/console
    print(f"[JobLog] [{lvl.upper()}] {msg}", flush=True)

    job_id = get_current_job_id()
    if job_id:
        try:
            with db_cursor() as cur:
                cur.execute(
                    "INSERT INTO job_logs (queue_item_id, level, message) VALUES (?,?,?)",
                    (job_id, lvl, msg)
                )
        except Exception as e:
            print(f"[Logger Error] Failed to write to database: {e}", flush=True)
