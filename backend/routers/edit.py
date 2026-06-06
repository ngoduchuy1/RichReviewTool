from fastapi import APIRouter, HTTPException, BackgroundTasks
from ..models.schemas import EditRequest, SceneDetectRequest
from ..services.scene_detect import detect_scenes
from ..services.video_processor import crop_video, resize_video, rotate_video
from ..services.ffmpeg_utils import split_video, merge_videos
from ..database import db_cursor

router = APIRouter()


@router.post("/scene-detect")
def scene_detect(data: SceneDetectRequest, bg: BackgroundTasks):
    bg.add_task(detect_scenes, data.video_path, data.threshold, data.project_id)
    return {"message": "Scene detection queued", "project_id": data.project_id}


@router.get("/scenes/{project_id}")
def get_scenes(project_id: int):
    with db_cursor() as cur:
        rows = cur.execute(
            "SELECT * FROM scenes WHERE project_id=? ORDER BY scene_index",
            (project_id,),
        ).fetchall()
        return [dict(r) for r in rows]


@router.post("/crop")
def crop(data: EditRequest, bg: BackgroundTasks):
    out_path = data.video_path.replace(".mp4", "_cropped.mp4")
    for op in data.operations:
        if op.get("type") == "crop":
            bg.add_task(crop_video, data.video_path, out_path, op.get("x", 0), op.get("y", 0), op.get("w", 1920), op.get("h", 1080))
    return {"output": out_path}


@router.post("/resize")
def resize(data: EditRequest, bg: BackgroundTasks):
    out_path = data.video_path.replace(".mp4", "_resized.mp4")
    for op in data.operations:
        if op.get("type") == "resize":
            bg.add_task(resize_video, data.video_path, out_path, op.get("width", 1920), op.get("height", 1080))
    return {"output": out_path}


@router.post("/split")
def split(data: EditRequest, bg: BackgroundTasks):
    out_paths = []
    for i, op in enumerate(data.operations):
        if op.get("type") == "split":
            out = data.video_path.replace(".mp4", f"_part{i}.mp4")
            out_paths.append(out)
            bg.add_task(split_video, data.video_path, out, op.get("start", 0), op.get("end", 10))
    return {"outputs": out_paths}


@router.post("/merge")
def merge(file_paths: list[str], bg: BackgroundTasks):
    out = str(Path(file_paths[0]).parent / "merged.mp4")
    bg.add_task(merge_videos, file_paths, out)
    return {"output": out}


@router.post("/crossfade")
def crossfade_video(data: EditRequest, bg: BackgroundTasks):
    out = data.video_path.replace(".mp4", "_crossfade.mp4")
    for op in data.operations:
        if op.get("type") == "crossfade":
            from ..services.ffmpeg_utils import run_ffmpeg
            duration = op.get("duration", 2)
            cmd = [
                "-i", data.video_path,
                "-vf", f"fade=t=in:st=0:d={duration},fade=t=out:st={duration}:d={duration}",
                "-af", f"afade=t=in:st=0:d={duration},afade=t=out:st={duration}:d={duration}",
                "-y", out,
            ]
            bg.add_task(run_ffmpeg, cmd)
    return {"output": out}


@router.get("/timeline-data/{project_id}")
def get_timeline_data(project_id: int):
    from ..services.timeline_service import timeline_to_json
    return timeline_to_json(project_id)


from pathlib import Path
