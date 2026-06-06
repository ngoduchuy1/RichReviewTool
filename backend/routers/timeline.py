"""
Timeline API — /api/timeline/*
Manage multi-track timelines: tracks, clips, markers, transitions.
"""
from fastapi import APIRouter, HTTPException
from ..services.timeline_service import (
    create_track, get_tracks, update_track, delete_track,
    create_clip, get_clips, update_clip, delete_clip, move_clip,
    create_marker, get_markers, delete_marker,
    create_transition, get_transitions,
    timeline_to_json, timeline_from_json, timeline_to_ffmpeg,
)
from ..database import db_cursor

router = APIRouter()


# ─── Timeline export/import ───

@router.get("/{project_id}")
def get_timeline(project_id: int):
    with db_cursor() as cur:
        row = cur.execute("SELECT id FROM projects WHERE id=?", (project_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Project not found")
    return timeline_to_json(project_id)


@router.put("/{project_id}")
def set_timeline(project_id: int, data: dict):
    timeline_from_json(project_id, data)
    return {"message": "Timeline updated"}


@router.get("/{project_id}/ffmpeg")
def get_ffmpeg_commands(project_id: int):
    return {"commands": timeline_to_ffmpeg(project_id)}


# ─── Tracks ───

@router.post("/{project_id}/tracks")
def add_track(project_id: int, track_type: str = "video", name: str = None):
    t = create_track(project_id, track_type, name)
    return t


@router.get("/{project_id}/tracks")
def list_tracks(project_id: int):
    return get_tracks(project_id)


@router.put("/tracks/{track_id}")
def edit_track(track_id: int, name: str = None, muted: int = None, locked: int = None):
    kwargs = {}
    if name is not None: kwargs["name"] = name
    if muted is not None: kwargs["muted"] = muted
    if locked is not None: kwargs["locked"] = locked
    if kwargs:
        update_track(track_id, **kwargs)
    return {"message": "Track updated"}


@router.delete("/tracks/{track_id}")
def remove_track(track_id: int):
    delete_track(track_id)
    return {"message": "Track deleted"}


# ─── Clips ───

@router.post("/tracks/{track_id}/clips")
def add_clip(track_id: int, source_path: str = "", name: str = None,
             start_frame: int = 0, end_frame: int = 0, position_frame: int = 0):
    c = create_clip(track_id, source_path, name, start_frame, end_frame, position_frame)
    return c


@router.get("/tracks/{track_id}/clips")
def list_clips(track_id: int):
    return get_clips(track_id)


@router.put("/clips/{clip_id}")
def edit_clip(clip_id: int, source_path: str = None, name: str = None,
              start_frame: int = None, end_frame: int = None,
              position_frame: int = None, speed: float = None,
              volume: float = None, opacity: float = None):
    kwargs = {}
    if source_path is not None: kwargs["source_path"] = source_path
    if name is not None: kwargs["name"] = name
    if start_frame is not None: kwargs["start_frame"] = start_frame
    if end_frame is not None: kwargs["end_frame"] = end_frame
    if position_frame is not None: kwargs["position_frame"] = position_frame
    if speed is not None: kwargs["speed"] = speed
    if volume is not None: kwargs["volume"] = volume
    if opacity is not None: kwargs["opacity"] = opacity
    if kwargs:
        update_clip(clip_id, **kwargs)
    return {"message": "Clip updated"}


@router.delete("/clips/{clip_id}")
def remove_clip(clip_id: int):
    delete_clip(clip_id)
    return {"message": "Clip deleted"}


@router.put("/clips/{clip_id}/move")
def move_clip_endpoint(clip_id: int, track_id: int = None, position: int = None):
    move_clip(clip_id, track_id, position)
    return {"message": "Clip moved"}


# ─── Markers ───

@router.post("/{project_id}/markers")
def add_marker(project_id: int, frame: int, label: str = "", color: str = "#f8b400"):
    m = create_marker(project_id, frame, label, color)
    return m


@router.get("/{project_id}/markers")
def list_markers(project_id: int):
    return get_markers(project_id)


@router.delete("/markers/{marker_id}")
def remove_marker(marker_id: int):
    delete_marker(marker_id)
    return {"message": "Marker deleted"}


# ─── Transitions ───

@router.post("/{project_id}/transitions")
def add_transition(project_id: int, clip_a_id: int, clip_b_id: int,
                   trans_type: str = "crossfade", duration_frames: int = 15):
    t = create_transition(project_id, clip_a_id, clip_b_id, trans_type, duration_frames)
    return t


@router.get("/{project_id}/transitions")
def list_transitions(project_id: int):
    return get_transitions(project_id)
