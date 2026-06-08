from fastapi import APIRouter, UploadFile, File

from ..config import VOICES_DIR
from ..models.schemas import TTSRequest
from ..services.queue_manager import add_queue_item

router = APIRouter()


@router.post("/tts")
def text_to_speech(data: TTSRequest):
    out = data.output_path or str(VOICES_DIR / f"tts_{hash(data.text)}.wav")
    item_id = add_queue_item(data.project_id, "tts_text", "", {
        "text": data.text,
        "provider": data.provider,
        "voice": data.voice,
        "speed": data.speed,
        "output_path": out,
    })
    return {"id": item_id, "message": "Da dua tien trinh TTS vao hang doi", "output": out}


@router.get("/voices")
def list_voices():
    VOICES_DIR.mkdir(exist_ok=True)
    files = [f for f in VOICES_DIR.iterdir() if f.suffix in (".wav", ".mp3")]
    return [{"name": f.stem, "path": str(f), "size": f.stat().st_size} for f in files]


@router.post("/clone/upload")
async def upload_sample(file: UploadFile = File(...)):
    content = await file.read()
    out = VOICES_DIR / f"sample_{file.filename}"
    out.write_bytes(content)
    return {"path": str(out), "message": "Da tai len tep mau"}


@router.post("/clone/train")
def train_voice(data: dict):
    sample_path = data.get("sample_path", "")
    name = data.get("name", "default")
    item_id = add_queue_item(data.get("project_id", 0), "train_voice", "", {"sample_path": sample_path, "name": name})
    return {"id": item_id, "message": f"Da bat dau huan luyen cho {name}"}


@router.get("/clone/list")
def list_clones():
    clones_dir = VOICES_DIR / "clones"
    clones_dir.mkdir(exist_ok=True)
    result = []
    for d in clones_dir.iterdir():
        if d.is_dir():
            has_prompt = (d / "voice_prompt.npz").exists()
            preview_path = str(d / "preview.wav") if (d / "preview.wav").exists() else None
            done_text = ""
            done_file = d / "done.txt"
            if done_file.exists():
                done_text = done_file.read_text()
            result.append({"name": d.name, "ready": has_prompt, "preview": preview_path, "status": done_text})
    return result


@router.post("/clone/generate")
def generate_clone_tts(text: str, clone_name: str, project_id: int = 0):
    out = str(VOICES_DIR / f"clone_{hash(text)}_{clone_name}.wav")
    item_id = add_queue_item(project_id, "tts_text", "", {
        "text": text,
        "provider": "clone",
        "voice": clone_name,
        "speed": 1.0,
        "output_path": out,
    })
    return {"id": item_id, "message": "Da dua tien trinh tao giong clone vao hang doi", "output": out}


@router.get("/clone/export")
def export_clone_voices():
    clones_dir = VOICES_DIR / "clones"
    clones_dir.mkdir(exist_ok=True)
    exports = []
    for d in clones_dir.iterdir():
        if d.is_dir():
            wavs = list(d.glob("*.wav")) + list(d.glob("*.pth"))
            if wavs:
                exports.append({"name": d.name, "path": str(wavs[0]), "files": [str(f) for f in wavs]})
    return {"path": str(clones_dir / "export" / "voice_pack.zip") if exports else None, "clones": exports}


@router.get("/play")
def play_voice(text: str = "Xin chao, day la giong doc thu nghiem", provider: str = "edge", voice: str = "vi-VN-NamMinhNeural", fpt_api_key: str = None, project_id: int = 0):
    out = str(VOICES_DIR / "play_test.wav")
    item_id = add_queue_item(project_id, "tts_text", "", {
        "text": text,
        "provider": provider,
        "voice": voice,
        "speed": 1.0,
        "api_key": fpt_api_key,
        "output_path": out,
    })
    return {"id": item_id, "message": "Da dua tien trinh nghe thu vao hang doi", "output": out}


@router.get("/edge-voices")
def get_edge_voices():
    try:
        import asyncio
        import edge_tts

        async def fetch():
            return await edge_tts.VoicesManager.create()

        manager = asyncio.run(fetch())
        return [
            {
                "short_name": v["ShortName"],
                "gender": "Nam" if v["Gender"] == "Male" else "Nu",
                "locale": v["Locale"],
                "friendly_name": v["FriendlyName"],
            }
            for v in manager.voices
        ]
    except Exception:
        return [
            {"short_name": "vi-VN-HoaiMyNeural", "gender": "Nu", "locale": "vi-VN", "friendly_name": "Microsoft HoaiMy Online"},
            {"short_name": "vi-VN-NamMinhNeural", "gender": "Nam", "locale": "vi-VN", "friendly_name": "Microsoft NamMinh Online"},
        ]


@router.get("/providers")
def list_providers():
    clones_dir = VOICES_DIR / "clones"
    clones_dir.mkdir(exist_ok=True)
    clone_voices = [d.name for d in clones_dir.iterdir() if d.is_dir() and (d / "voice_prompt.npz").exists()]
    return {
        "providers": [
            {"id": "edge", "name": "Edge TTS (free)", "voices": ["vi-VN-NamMinhNeural", "vi-VN-HoaiMyNeural"]},
            {"id": "google", "name": "Google TTS (free)", "voices": ["vi", "en"]},
            {"id": "azure", "name": "Azure TTS", "voices": ["vi-VN-NamMinhNeural", "vi-VN-HoaiMyNeural"]},
            {"id": "elevenlabs", "name": "ElevenLabs", "voices": ["Rachel", "Domi", "Bella"]},
            {"id": "clone", "name": "Voice Clone (Bark)", "voices": clone_voices or ["Chua co giong clone nao"]},
        ]
    }
