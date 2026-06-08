from fastapi import APIRouter, HTTPException, UploadFile, File

from ..config import DATA_DIR
from ..services.queue_manager import add_queue_item

router = APIRouter()


@router.post("/upload")
async def upload_music(file: UploadFile = File(...)):
    content = await file.read()
    out = DATA_DIR / "downloads" / file.filename
    out.write_bytes(content)
    return {"path": str(out)}


@router.post("/process")
def process_audio(
    input_path: str,
    volume: float = 1.0,
    fade_in: float = 0,
    fade_out: float = 0,
    normalize: bool = False,
    project_id: int = 0,
):
    item_id = add_queue_item(
        project_id,
        "process_music",
        input_path,
        {"volume": volume, "fade_in": fade_in, "fade_out": fade_out, "normalize": normalize},
    )
    return {"id": item_id, "message": "Da dua tien trinh xu ly vao hang doi"}


@router.post("/duck")
def auto_ducking(data: dict):
    music_path = data.get("music_path", "")
    voice_path = data.get("voice_path", "")
    item_id = add_queue_item(data.get("project_id", 0), "duck_music", music_path, {"voice_path": voice_path})
    return {"id": item_id, "message": "Da dua tien trinh ducking vao hang doi"}


@router.get("/files")
def list_music():
    music_dir = DATA_DIR / "downloads"
    music_dir.mkdir(exist_ok=True)
    files = []
    for f in music_dir.iterdir():
        if f.suffix in (".mp3", ".wav", ".m4a", ".flac", ".ogg"):
            files.append({"name": f.name, "path": str(f), "size": f.stat().st_size})
    return files


@router.post("/crossfade")
def crossfade_music(audio_a: str, audio_b: str, duration: float = 2.0, project_id: int = 0):
    import os
    if not os.path.exists(audio_a) or not os.path.exists(audio_b):
        raise HTTPException(400, "Ca hai tep am thanh deu phai ton tai")
    out = str(DATA_DIR / "downloads" / f"crossfade_{os.path.basename(audio_a)}")
    cmd = [
        "-i", audio_a, "-i", audio_b,
        "-filter_complex", f"acrossfade=d={duration}",
        "-y", out,
    ]
    item_id = add_queue_item(project_id, "ffmpeg_command", audio_a, {"cmd": cmd, "output_path": out, "category": "audio"})
    return {"id": item_id, "output": out}


@router.get("/playlist")
def list_playlists():
    playlist_dir = DATA_DIR / "playlists"
    playlist_dir.mkdir(parents=True, exist_ok=True)
    playlists = []
    for f in sorted(playlist_dir.glob("*.json")):
        try:
            import json
            data = json.loads(f.read_text(encoding="utf-8"))
            playlists.append({
                "name": data.get("name", f.stem),
                "file": f.name,
                "tracks": data.get("tracks", []),
                "count": len(data.get("tracks", [])),
            })
        except (json.JSONDecodeError, OSError):
            pass
    return playlists


@router.post("/playlist")
def save_playlist(data: dict):
    name = data.get("name", "Untitled Playlist")
    playlist_dir = DATA_DIR / "playlists"
    playlist_dir.mkdir(parents=True, exist_ok=True)
    import json
    f = playlist_dir / f"{name.lower().replace(' ', '_')}.json"
    f.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    return {"message": f"Da luu Playlist '{name}'", "file": str(f)}


@router.delete("/playlist/{name}")
def delete_playlist(name: str):
    playlist_dir = DATA_DIR / "playlists"
    f = playlist_dir / f"{name.lower().replace(' ', '_')}.json"
    if f.exists():
        f.unlink()
    return {"message": f"Da xoa Playlist '{name}'"}
