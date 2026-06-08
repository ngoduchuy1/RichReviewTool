"""
Integrated queue worker.

Runs inside the FastAPI process, atomically claims waiting jobs, and dispatches
them into a bounded worker pool.
"""
from concurrent.futures import ThreadPoolExecutor
import threading
import time

from ..database import db_cursor, get_conn
from ..services.pipeline_service import run_pipeline
from ..services.queue_manager import reset_stale_running, update_item_status


class QueueWorker:
    """Background worker that processes queue items with a bounded pool."""

    def __init__(self, max_workers: int = 2, poll_interval: float = 2.0):
        self.max_workers = max(1, int(max_workers or 1))
        self.poll_interval = poll_interval
        self._thread = None
        self._running = False
        self._lock = threading.Lock()
        self._active_count = 0
        self._executor = None

    def start(self):
        if self._running:
            return
        self._running = True
        self._executor = ThreadPoolExecutor(max_workers=self.max_workers, thread_name_prefix="queue-job")
        reset_count = reset_stale_running()
        if reset_count:
            print(f"[Worker] Reset {reset_count} stale running job(s)")
        self._thread = threading.Thread(target=self._run, daemon=True, name="queue-dispatcher")
        self._thread.start()
        print(f"[Worker] Started (max_workers={self.max_workers}, poll={self.poll_interval}s)")

    def stop(self):
        self._running = False
        if self._executor:
            self._executor.shutdown(wait=False, cancel_futures=True)
            self._executor = None
        print("[Worker] Stopping...")

    @property
    def is_alive(self) -> bool:
        return self._running and self._thread is not None and self._thread.is_alive()

    @property
    def active_count(self) -> int:
        with self._lock:
            return self._active_count

    def _inc_active(self):
        with self._lock:
            self._active_count += 1

    def _dec_active(self):
        with self._lock:
            self._active_count = max(0, self._active_count - 1)

    def _claim_one(self):
        """Atomically claim the next waiting queue item."""
        conn = get_conn()
        cur = conn.cursor()
        try:
            cur.execute("BEGIN IMMEDIATE")
            row = cur.execute(
                """
                SELECT * FROM queue_items
                WHERE status='waiting'
                ORDER BY priority DESC, created_at ASC
                LIMIT 1
                """
            ).fetchone()
            if not row:
                conn.commit()
                return None
            cur.execute(
                "UPDATE queue_items SET status='running', progress=0, error=NULL, updated_at=datetime('now','localtime') WHERE id=?",
                (row["id"],),
            )
            conn.commit()
            with db_cursor() as log_cur:
                log_cur.execute(
                    "INSERT INTO job_logs (queue_item_id, level, message) VALUES (?,?,?)",
                    (row["id"], "info", "[queue] Claimed by worker"),
                )
            return dict(row)
        except Exception as e:
            try:
                conn.rollback()
            except Exception:
                pass
            print(f"[Worker] claim error: {e}")
            return None
        finally:
            cur.close()

    def _run_item(self, item: dict):
        try:
            print(f"[Worker] Processing item {item['id']}: {item['type']}")
            success = run_pipeline(item)
            if not success:
                update_item_status(item["id"], "failed", error="Pipeline returned error")
            print(f"[Worker] Item {item['id']} {'completed' if success else 'failed'}")
        except Exception as e:
            print(f"[Worker] Error processing item {item.get('id')}: {e}")
            try:
                update_item_status(item["id"], "failed", error=str(e))
            except Exception:
                pass
        finally:
            self._dec_active()

    def _run(self):
        while self._running:
            try:
                if self.active_count >= self.max_workers:
                    time.sleep(0.25)
                    continue

                item = self._claim_one()
                if item is None:
                    time.sleep(self.poll_interval)
                    continue

                self._inc_active()
                self._executor.submit(self._run_item, item)
            except Exception as e:
                print(f"[Worker] dispatcher error: {e}")
                time.sleep(2)


_worker: QueueWorker = None


def get_worker() -> QueueWorker:
    global _worker
    if _worker is None:
        _worker = QueueWorker()
    return _worker
