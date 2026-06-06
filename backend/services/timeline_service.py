"""
Timeline Engine — manages multi-track timeline with clips, markers, transitions.
Stores tracks/clips/markers/transitions in database + timeline.json in project folder.
"""
import json
from ..database import db_cursor
from ..config import PROJECTS_DIR
from pathlib import Path
from datetime import datetime


def _timeline_file(project_id: int) -> Path:
    return PROJECTS_DIR / f"project_{project_id}" / "timeline.json"


def save_timeline_to_file(project_id: int):
    """Write current timeline to project's timeline.json."""
    data = timeline_to_json(project_id)
    f = _timeline_file(project_id)
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def load_timeline_from_file(project_id: int) -> dict:
    """Load timeline from project's timeline.json."""
    f = _timeline_file(project_id)
    if f.exists():
        try:
            return json.loads(f.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return {"tracks": [], "markers": [], "transitions": []}


def auto_save(func):
    """Decorator that saves timeline to file after any CRUD operation."""
    def wrapper(*args, **kwargs):
        result = func(*args, **kwargs)
        if hasattr(result, "get") and "project_id" in result:
            save_timeline_to_file(result["project_id"])
        elif args:
            for arg in args:
                if isinstance(arg, int):
                    save_timeline_to_file(arg)
                    break
        return result
    return wrapper


# ─── Track CRUD ───

def create_track(project_id: int, track_type: str = "video", name: str = None, index: int = None) -> dict:
    with db_cursor() as cur:
        if index is None:
            cur.execute("SELECT COALESCE(MAX(track_index), -1) + 1 FROM tracks WHERE project_id=?", (project_id,))
            index = cur.fetchone()[0]
        if not name:
            name = f"{track_type.capitalize()} {index + 1}"
        cur.execute(
            "INSERT INTO tracks (project_id, type, name, track_index) VALUES (?,?,?,?)",
            (project_id, track_type, name, index),
        )
        result = {"id": cur.lastrowid, "project_id": project_id, "type": track_type, "name": name, "track_index": index}
    save_timeline_to_file(project_id)
    return result


def get_tracks(project_id: int) -> list:
    with db_cursor() as cur:
        rows = cur.execute(
            "SELECT * FROM tracks WHERE project_id=? ORDER BY track_index", (project_id,)
        ).fetchall()
        tracks = [dict(r) for r in rows]
        for t in tracks:
            t["clips"] = get_clips(t["id"])
        return tracks


def update_track(track_id: int, **kwargs):
    sets = ", ".join(f"{k}=?" for k in kwargs)
    vals = list(kwargs.values()) + [track_id]
    with db_cursor() as cur:
        cur.execute(f"UPDATE tracks SET {sets} WHERE id=?", vals)


def delete_track(track_id: int):
    with db_cursor() as cur:
        cur.execute("SELECT project_id FROM tracks WHERE id=?", (track_id,))
        row = cur.fetchone()
        cur.execute("DELETE FROM tracks WHERE id=?", (track_id,))
        if row:
            save_timeline_to_file(row["project_id"])


# ─── Clip CRUD ───

def _project_id_for_track(track_id: int) -> int:
    with db_cursor() as cur:
        row = cur.execute("SELECT project_id FROM tracks WHERE id=?", (track_id,)).fetchone()
        return row["project_id"] if row else None


def create_clip(track_id: int, source_path: str = "", name: str = None, start_frame: int = 0,
                end_frame: int = 0, position_frame: int = 0, config: dict = None) -> dict:
    with db_cursor() as cur:
        if not name and source_path:
            name = Path(source_path).stem
        cur.execute(
            """INSERT INTO clips (track_id, source_path, name, start_frame, end_frame, position_frame, config)
               VALUES (?,?,?,?,?,?,?)""",
            (track_id, source_path, name, start_frame, end_frame, position_frame,
             json.dumps(config or {})),
        )
        result = {"id": cur.lastrowid, "track_id": track_id, "name": name}
    pid = _project_id_for_track(track_id)
    if pid:
        save_timeline_to_file(pid)
    return result


def get_clips(track_id: int) -> list:
    with db_cursor() as cur:
        rows = cur.execute(
            "SELECT * FROM clips WHERE track_id=? ORDER BY position_frame", (track_id,)
        ).fetchall()
        return [dict(r) for r in rows]


def update_clip(clip_id: int, **kwargs):
    if "config" in kwargs and isinstance(kwargs["config"], dict):
        kwargs["config"] = json.dumps(kwargs["config"])
    if "effects" in kwargs and isinstance(kwargs["effects"], list):
        kwargs["effects"] = json.dumps(kwargs["effects"])
    sets = ", ".join(f"{k}=?" for k in kwargs)
    vals = list(kwargs.values()) + [clip_id]
    with db_cursor() as cur:
        cur.execute(f"UPDATE clips SET {sets} WHERE id=?", vals)


def delete_clip(clip_id: int):
    with db_cursor() as cur:
        cur.execute("SELECT track_id FROM clips WHERE id=?", (clip_id,))
        row = cur.fetchone()
        track_id = row["track_id"] if row else None
        cur.execute("DELETE FROM clips WHERE id=?", (clip_id,))
    if track_id:
        pid = _project_id_for_track(track_id)
        if pid:
            save_timeline_to_file(pid)


def move_clip(clip_id: int, new_track_id: int = None, new_position: int = None):
    updates = {}
    if new_track_id is not None:
        updates["track_id"] = new_track_id
    if new_position is not None:
        updates["position_frame"] = new_position
    if updates:
        update_clip(clip_id, **updates)


# ─── Marker CRUD ───

def create_marker(project_id: int, frame: int, label: str = "", color: str = "#f8b400", marker_type: str = "note") -> dict:
    with db_cursor() as cur:
        cur.execute(
            "INSERT INTO markers (project_id, frame, label, color, type) VALUES (?,?,?,?,?)",
            (project_id, frame, label, color, marker_type),
        )
        result = {"id": cur.lastrowid, "frame": frame, "label": label, "project_id": project_id}
    save_timeline_to_file(project_id)
    return result


def get_markers(project_id: int) -> list:
    with db_cursor() as cur:
        rows = cur.execute(
            "SELECT * FROM markers WHERE project_id=? ORDER BY frame", (project_id,)
        ).fetchall()
        return [dict(r) for r in rows]


def delete_marker(marker_id: int):
    with db_cursor() as cur:
        cur.execute("SELECT project_id FROM markers WHERE id=?", (marker_id,))
        row = cur.fetchone()
        cur.execute("DELETE FROM markers WHERE id=?", (marker_id,))
        if row:
            save_timeline_to_file(row["project_id"])


# ─── Transition CRUD ───

def create_transition(project_id: int, clip_a_id: int, clip_b_id: int,
                      trans_type: str = "crossfade", duration_frames: int = 15) -> dict:
    with db_cursor() as cur:
        cur.execute(
            "INSERT INTO transitions (project_id, clip_a_id, clip_b_id, type, duration_frames) VALUES (?,?,?,?,?)",
            (project_id, clip_a_id, clip_b_id, trans_type, duration_frames),
        )
        result = {"id": cur.lastrowid, "type": trans_type, "project_id": project_id}
    save_timeline_to_file(project_id)
    return result


def get_transitions(project_id: int) -> list:
    with db_cursor() as cur:
        rows = cur.execute(
            "SELECT * FROM transitions WHERE project_id=? ORDER BY id", (project_id,)
        ).fetchall()
        return [dict(r) for r in rows]


# ─── Timeline serialization ───

def timeline_to_json(project_id: int) -> dict:
    """Export a project's entire timeline to a JSON dict."""
    return {
        "tracks": get_tracks(project_id),
        "markers": get_markers(project_id),
        "transitions": get_transitions(project_id),
    }


def timeline_from_json(project_id: int, data: dict):
    """Import a JSON dict into the project's timeline, replacing existing."""
    with db_cursor() as cur:
        cur.execute("DELETE FROM tracks WHERE project_id=?", (project_id,))
        cur.execute("DELETE FROM markers WHERE project_id=?", (project_id,))
        cur.execute("DELETE FROM transitions WHERE project_id=?", (project_id,))

    for track_data in data.get("tracks", []):
        clips = track_data.pop("clips", [])
        t = create_track(
            project_id,
            track_type=track_data.get("type", "video"),
            name=track_data.get("name"),
            track_index=track_data.get("track_index"),
        )
        for clip_data in clips:
            create_clip(
                t["id"],
                source_path=clip_data.get("source_path", ""),
                name=clip_data.get("name"),
                start_frame=clip_data.get("start_frame", 0),
                end_frame=clip_data.get("end_frame", 0),
                position_frame=clip_data.get("position_frame", 0),
            )

    for marker_data in data.get("markers", []):
        create_marker(project_id, marker_data.get("frame", 0), marker_data.get("label", ""))

    for trans_data in data.get("transitions", []):
        create_transition(project_id, trans_data.get("clip_a_id", 0), trans_data.get("clip_b_id", 0),
                          trans_data.get("type", "crossfade"), trans_data.get("duration_frames", 15))

    save_timeline_to_file(project_id)


# ─── Timeline to FFmpeg filter graph ───
def timeline_to_ffmpeg(project_id: int) -> list:
    """Generate FFmpeg concat/trim commands from timeline clips."""
    tracks = get_tracks(project_id)
    commands = []
    for track in tracks:
        for clip in track.get("clips", []):
            src = clip.get("source_path", "")
            if not src:
                continue
            start = clip.get("start_frame", 0)
            end = clip.get("end_frame", 0)
            cmd = {"input": src}
            if end > start:
                cmd["trim"] = {"start": start, "end": end}
            commands.append(cmd)
    return commands
