"""
Integrated Queue Worker — runs as a daemon thread inside the FastAPI server.
Polls queue_items for 'waiting' items and dispatches to pipeline_service.
"""
import threading
import time
import json
from ..database import db_cursor
from ..services.pipeline_service import run_pipeline
from ..services.queue_manager import update_item_status


class QueueWorker:
    """Background worker that processes queue items."""

    def __init__(self, max_workers: int = 2, poll_interval: float = 2.0):
        self.max_workers = max_workers
        self.poll_interval = poll_interval
        self._thread = None
        self._running = False
        self._active_count = 0

    def start(self):
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._run, daemon=True, name="queue-worker")
        self._thread.start()
        print(f"[Worker] Started (max_workers={self.max_workers}, poll={self.poll_interval}s)")

    def stop(self):
        self._running = False
        print("[Worker] Stopping...")

    @property
    def is_alive(self) -> bool:
        return self._running and (self._thread is not None and self._thread.is_alive())

    def _run(self):
        while self._running:
            try:
                if self._active_count >= self.max_workers:
                    time.sleep(1)
                    continue

                with db_cursor() as cur:
                    row = cur.execute(
                        "SELECT * FROM queue_items WHERE status='waiting' ORDER BY priority DESC, created_at LIMIT 1"
                    ).fetchone()

                if row is None:
                    time.sleep(self.poll_interval)
                    continue

                item = dict(row)
                self._active_count += 1

                def process(item_copy):
                    try:
                        print(f"[Worker] Processing item {item_copy['id']}: {item_copy['type']}")
                        success = run_pipeline(item_copy)
                        if not success:
                            update_item_status(item_copy["id"], "failed", error="Pipeline returned error")
                        print(f"[Worker] Item {item_copy['id']} {'completed' if success else 'failed'}")
                    except Exception as e:
                        print(f"[Worker] Error processing item {item_copy['id']}: {e}")
                        try:
                            update_item_status(item_copy["id"], "failed", error=str(e))
                        except Exception:
                            pass
                    finally:
                        self._active_count -= 1

                t = threading.Thread(target=process, args=(item,), daemon=True, name=f"worker-{item['id']}")
                t.start()

            except Exception as e:
                print(f"[Worker] Poll error: {e}")
                time.sleep(5)


# Singleton for app-wide use
_worker: QueueWorker = None


def get_worker() -> QueueWorker:
    global _worker
    if _worker is None:
        _worker = QueueWorker()
    return _worker
