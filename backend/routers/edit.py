from pathlib import Path

from fastapi import APIRouter

from ..database import db_cursor
from ..models.schemas import EditRequest, SceneDetectRequest
from ..services.queue_manager import add_queue_item

router = APIRouter()


@router.post("/scene-detect")
def scene_detect(data: SceneDetectRequest):
    item_id = add_queue_item(data.project_id, "scene_detect", data.video_path, {"threshold": data.threshold}, priority=1)
    return {"id": item_id, "message": "Scene detection queued", "project_id": data.project_id}


@router.get("/scenes/{project_id}")
def get_scenes(project_id: int):
    with db_cursor() as cur:
        rows = cur.execute(
            "SELECT * FROM scenes WHERE project_id=? ORDER BY scene_index",
            (project_id,),
        ).fetchall()
        return [dict(r) for r in rows]


@router.post("/crop")
def crop(data: EditRequest):
    out_path = data.video_path.replace(".mp4", "_cropped.mp4")
    item_id = None
    for op in data.operations:
        if op.get("type") == "crop":
            vf = f"crop={op.get('w', 1920)}:{op.get('h', 1080)}:{op.get('x', 0)}:{op.get('y', 0)}"
        elif op.get("type") == "rotate":
            angle = float(op.get("angle", 90))
            vf = {90.0: "transpose=1", 180.0: "hflip,vflip", 270.0: "transpose=2"}.get(angle, f"rotate={angle * 3.14159 / 180}:fillcolor=black")
        elif op.get("type") == "hflip":
            vf = "hflip"
        elif op.get("type") == "vflip":
            vf = "vflip"
        else:
            continue
        cmd = [
            "-i", data.video_path,
            "-vf", vf,
            "-c:a", "copy",
            "-y", out_path,
        ]
        item_id = add_queue_item(data.project_id, "ffmpeg_command", data.video_path, {"cmd": cmd, "output_path": out_path})
    return {"id": item_id, "output": out_path}


@router.post("/resize")
def resize(data: EditRequest):
    out_path = data.video_path.replace(".mp4", "_resized.mp4")
    item_id = None
    for op in data.operations:
        if op.get("type") == "resize":
            cmd = [
                "-i", data.video_path,
                "-vf", f"scale={op.get('width', 1920)}:{op.get('height', 1080)}",
                "-c:a", "copy",
                "-y", out_path,
            ]
            item_id = add_queue_item(data.project_id, "ffmpeg_command", data.video_path, {"cmd": cmd, "output_path": out_path})
    return {"id": item_id, "output": out_path}


@router.post("/split")
def split(data: EditRequest):
    out_paths = []
    ids = []
    for i, op in enumerate(data.operations):
        if op.get("type") == "split":
            out = data.video_path.replace(".mp4", f"_part{i}.mp4")
            out_paths.append(out)
            ids.append(add_queue_item(data.project_id, "split", data.video_path, {"start": op.get("start", 0), "end": op.get("end", 10), "output_path": out}))
    return {"ids": ids, "outputs": out_paths}


@router.post("/merge")
def merge(data: dict):
    file_paths = data.get("video_paths") or data.get("file_paths") or []
    if not file_paths:
        return {"id": None, "output": None, "error": "video_paths or file_paths required"}
    out = str(Path(file_paths[0]).parent / "merged.mp4")
    item_id = add_queue_item(data.get("project_id", 0), "merge_videos", "", {"file_paths": file_paths, "output_path": out})
    return {"id": item_id, "output": out}


@router.post("/crossfade")
def crossfade_video(data: EditRequest):
    out = data.video_path.replace(".mp4", "_crossfade.mp4")
    item_id = None
    for op in data.operations:
        if op.get("type") == "crossfade":
            duration = op.get("duration", 2)
            cmd = [
                "-i", data.video_path,
                "-vf", f"fade=t=in:st=0:d={duration},fade=t=out:st={duration}:d={duration}",
                "-af", f"afade=t=in:st=0:d={duration},afade=t=out:st={duration}:d={duration}",
                "-y", out,
            ]
            item_id = add_queue_item(data.project_id, "ffmpeg_command", data.video_path, {"cmd": cmd, "output_path": out})
    return {"id": item_id, "output": out}


@router.get("/timeline-data/{project_id}")
def get_timeline_data(project_id: int):
    from ..services.timeline_service import timeline_to_json
    return timeline_to_json(project_id)
