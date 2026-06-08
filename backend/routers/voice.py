from fastapi import APIRouter, HTTPException, BackgroundTasks, UploadFile, File
from ..models.schemas import TTSRequest
from ..services.tts_engine import synthesize
from ..services.voice_clone import clone_voice
from ..config import VOICES_DIR
import os

router = APIRouter()


@router.post("/tts")
def text_to_speech(data: TTSRequest, bg: BackgroundTasks):
    out = data.output_path or str(VOICES_DIR / f"tts_{hash(data.text)}.wav")
    bg.add_task(synthesize, data.text, data.provider, data.voice, data.speed, out)
    return {"message": "Đã đưa tiến trình TTS vào hàng đợi", "output": out}


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
    return {"path": str(out), "message": "Đã tải lên tệp mẫu"}


@router.post("/clone/train")
def train_voice(sample_path: str, name: str, bg: BackgroundTasks):
    from ..services.voice_clone import train_clone
    bg.add_task(train_clone, sample_path, name)
    return {"message": f"Đã bắt đầu huấn luyện cho {name}"}


@router.get("/clone/list")
def list_clones():
    clones_dir = VOICES_DIR / "clones"
    clones_dir.mkdir(exist_ok=True)
    return [{"name": d.name} for d in clones_dir.iterdir() if d.is_dir()]


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
def play_voice(text: str = "Xin chào, đây là giọng đọc thử nghiệm", provider: str = "edge", voice: str = "vi-VN-NamMinhNeural", fpt_api_key: str = None):
    import tempfile, os
    from ..services.tts_engine import synthesize
    out = str(VOICES_DIR / f"play_test.wav")
    synthesize(text, provider, voice, 1.0, out, api_key=fpt_api_key)
    if os.path.exists(out):
        from fastapi.responses import FileResponse
        return FileResponse(out, media_type="audio/wav", filename="test.wav")
    return {"message": "Đã đưa tiến trình tổng hợp giọng nói vào hàng đợi"}


@router.get("/edge-voices")
def get_edge_voices():
    try:
        import edge_tts
        import asyncio
        async def fetch():
            return await edge_tts.VoicesManager.create()
        manager = asyncio.run(fetch())
        return [
            {
                "short_name": v["ShortName"],
                "gender": "Nam" if v["Gender"] == "Male" else "Nữ",
                "locale": v["Locale"],
                "friendly_name": v["FriendlyName"]
            } for v in manager.voices
        ]
    except Exception as e:
        return [
            {"short_name": "vi-VN-HoaiMyNeural", "gender": "Nữ", "locale": "vi-VN", "friendly_name": "Microsoft HoaiMy Online"},
            {"short_name": "vi-VN-NamMinhNeural", "gender": "Nam", "locale": "vi-VN", "friendly_name": "Microsoft NamMinh Online"}
        ]


@router.get("/providers")
def list_providers():
    return {
        "providers": [
            {"id": "edge", "name": "Edge TTS (free)", "voices": ["vi-VN-NamMinhNeural", "vi-VN-HoaiMyNeural"]},
            {"id": "google", "name": "Google TTS (free)", "voices": ["vi", "en"]},
            {"id": "azure", "name": "Azure TTS", "voices": ["vi-VN-NamMinhNeural", "vi-VN-HoaiMyNeural"]},
            {"id": "elevenlabs", "name": "ElevenLabs", "voices": ["Rachel", "Domi", "Bella"]},
        ]
    }
