import sqlite3
import threading
from contextlib import contextmanager
from .config import DB_PATH

_local = threading.local()


def get_conn():
    if not hasattr(_local, "conn") or _local.conn is None:
        _local.conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
        _local.conn.row_factory = sqlite3.Row
        _local.conn.execute("PRAGMA journal_mode=WAL")
        _local.conn.execute("PRAGMA foreign_keys=ON")
    return _local.conn


@contextmanager
def db_cursor():
    conn = get_conn()
    cursor = conn.cursor()
    try:
        yield cursor
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cursor.close()


def init_db():
    with db_cursor() as cur:
        cur.executescript("""
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            path TEXT,
            preset TEXT DEFAULT 'Movie Review',
            resolution TEXT DEFAULT '1920x1080',
            fps INTEGER DEFAULT 30,
            created_at TEXT DEFAULT (datetime('now','localtime')),
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS queue_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER REFERENCES projects(id),
            type TEXT NOT NULL,
            status TEXT DEFAULT 'waiting',
            input_path TEXT,
            output_path TEXT,
            params TEXT DEFAULT '{}',
            progress REAL DEFAULT 0,
            error TEXT,
            priority INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now','localtime')),
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS subtitles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER REFERENCES projects(id),
            source TEXT,
            language TEXT DEFAULT 'vi',
            content TEXT,
            created_at TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS downloads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT NOT NULL,
            platform TEXT,
            status TEXT DEFAULT 'waiting',
            output_path TEXT,
            progress REAL DEFAULT 0,
            error TEXT,
            created_at TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS presets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            config TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS api_usage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            service TEXT NOT NULL,
            tokens INTEGER DEFAULT 0,
            seconds REAL DEFAULT 0,
            cost REAL DEFAULT 0,
            date TEXT DEFAULT (date('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS scenes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER REFERENCES projects(id),
            scene_index INTEGER,
            start_time REAL,
            end_time REAL,
            thumbnail TEXT
        );

        CREATE TABLE IF NOT EXISTS assets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL,
            name TEXT NOT NULL,
            path TEXT NOT NULL,
            size INTEGER DEFAULT 0,
            duration REAL,
            tags TEXT DEFAULT '[]',
            created_at TEXT DEFAULT (datetime('now','localtime'))
        );

        -- Track: a timeline track (video, audio, subtitle, etc.)
        CREATE TABLE IF NOT EXISTS tracks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
            type TEXT NOT NULL DEFAULT 'video',
            name TEXT,
            track_index INTEGER DEFAULT 0,
            muted INTEGER DEFAULT 0,
            locked INTEGER DEFAULT 0,
            config TEXT DEFAULT '{}',
            created_at TEXT DEFAULT (datetime('now','localtime'))
        );

        -- Clip: a clip on a track
        CREATE TABLE IF NOT EXISTS clips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            track_id INTEGER REFERENCES tracks(id) ON DELETE CASCADE,
            source_path TEXT,
            name TEXT,
            start_frame INTEGER DEFAULT 0,
            end_frame INTEGER DEFAULT 0,
            position_frame INTEGER DEFAULT 0,
            speed REAL DEFAULT 1.0,
            volume REAL DEFAULT 1.0,
            opacity REAL DEFAULT 1.0,
            effects TEXT DEFAULT '[]',
            config TEXT DEFAULT '{}',
            created_at TEXT DEFAULT (datetime('now','localtime'))
        );

        -- Marker: timeline markers / cue points
        CREATE TABLE IF NOT EXISTS markers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
            frame INTEGER NOT NULL,
            label TEXT,
            color TEXT DEFAULT '#f8b400',
            type TEXT DEFAULT 'note',
            created_at TEXT DEFAULT (datetime('now','localtime'))
        );

        -- Transition: transition between clips
        CREATE TABLE IF NOT EXISTS transitions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
            clip_a_id INTEGER REFERENCES clips(id) ON DELETE CASCADE,
            clip_b_id INTEGER REFERENCES clips(id) ON DELETE CASCADE,
            type TEXT DEFAULT 'crossfade',
            duration_frames INTEGER DEFAULT 15,
            config TEXT DEFAULT '{}'
        );

        -- Voices: voice profiles and clones
        CREATE TABLE IF NOT EXISTS voices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            provider TEXT DEFAULT 'edge',
            gender TEXT,
            language TEXT DEFAULT 'vi',
            sample_path TEXT,
            model_path TEXT,
            is_clone INTEGER DEFAULT 0,
            config TEXT DEFAULT '{}',
            created_at TEXT DEFAULT (datetime('now','localtime'))
        );

        -- Job logs: detailed execution logs
        CREATE TABLE IF NOT EXISTS job_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            queue_item_id INTEGER REFERENCES queue_items(id) ON DELETE CASCADE,
            level TEXT DEFAULT 'info',
            message TEXT,
            timestamp TEXT DEFAULT (datetime('now','localtime'))
        );

        -- Settings: app-wide key-value settings
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        );

        -- Exports: export history
        CREATE TABLE IF NOT EXISTS exports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
            input_path TEXT,
            output_path TEXT,
            format TEXT DEFAULT 'mp4',
            resolution TEXT,
            codec TEXT DEFAULT 'h264',
            bitrate TEXT,
            file_size INTEGER DEFAULT 0,
            duration REAL,
            status TEXT DEFAULT 'completed',
            created_at TEXT DEFAULT (datetime('now','localtime'))
        );
        """)
        _ensure_column(cur, "downloads", "error", "TEXT")


def _ensure_column(cur, table: str, column: str, definition: str):
    existing = [row["name"] for row in cur.execute(f"PRAGMA table_info({table})").fetchall()]
    if column not in existing:
        cur.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
