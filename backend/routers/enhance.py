import tempfile

from fastapi import APIRouter, HTTPException

from ..models.schemas import EnhanceRequest
from ..services.queue_manager import add_queue_item

router = APIRouter()


def _escape_drawtext(text: str) -> str:
    return str(text or "").replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'").replace("\n", " ")


@router.post("/apply")
def apply_enhancements(data: EnhanceRequest):
    filters = []
    if data.brightness is not None:
        filters.append(f"eq=brightness={data.brightness/50 - 1}")
    if data.contrast is not None:
        filters.append(f"eq=contrast={data.contrast/50}")
    if data.saturation is not None:
        filters.append(f"eq=saturation={data.saturation/50}")
    if data.vignette is not None:
        filters.append(f"vignette=PI*{data.vignette/100}")
    if data.temperature is not None:
        filters.append(f"colorbalance=rs={max(-1,(data.temperature-50)/100)}:bs={max(-1,(50-data.temperature)/100)}")
    if getattr(data, "motion_blur", False):
        filters.append("minterpolate=mi_mode=mci:mc_mode=aobmc:vsbmc=1:fps=60")
    if getattr(data, "zoom", False):
        filters.append("zoompan=z='min(zoom+0.0015,1.5)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'")
    if getattr(data, "shake", False):
        filters.append("crop=in_w-20:in_h-20:10+10*sin(t*10):10+10*cos(t*10)")
    if getattr(data, "transition", False):
        filters.append("fade=t=in:st=0:d=1")
    if getattr(data, "watermark", False):
        text = _escape_drawtext(getattr(data, "watermark_text", "0xForge"))
        filters.append(f"drawtext=text='{text}':fontcolor=white@0.5:fontsize=48:x=w-tw-20:y=h-th-20")
    if getattr(data, "speed_ramp", False) or getattr(data, "fast_motion", False):
        filters.append("setpts=0.5*PTS")
    if getattr(data, "slow_motion", False):
        filters.append("setpts=2.0*PTS")
    if getattr(data, "particles", False):
        filters.append("drawtext=text=':fontsize=1:shadowcolor=white@0.3:shadowx=1:shadowy=1:x=random(1)*w:y=random(1)*h")

    out_path = data.video_path.replace(".mp4", "_enhanced.mp4")
    item_id = None
    if filters:
        cmd = ["-i", data.video_path, "-vf", ",".join(filters), "-c:a", "copy", "-y", out_path]
        item_id = add_queue_item(data.project_id, "ffmpeg_command", data.video_path, {"cmd": cmd, "output_path": out_path})
    return {"id": item_id, "output": out_path, "filters": filters}


@router.post("/branding/logo")
def logo_overlay(data: dict):
    video_path = data.get("video_path", "")
    logo_path = data.get("logo_path", "")
    position = data.get("position", "top_right")
    opacity = data.get("opacity", 0.7)
    if not video_path or not logo_path:
        raise HTTPException(400, "Yeu cau cung cap video_path va logo_path")
    pos_map = {"top_right": "(W-w-20):20", "bottom_right": "(W-w-20):(H-h-20)", "center": "(W-w)/2:(H-h)/2", "top_left": "20:20", "bottom_left": "20:(H-h-20)"}
    pos = pos_map.get(position, "(W-w-20):20")
    out = video_path.replace(".mp4", "_logo.mp4")
    cmd = ["-i", video_path, "-i", logo_path, "-filter_complex", f"[1:v]format=rgba,colorchannelmixer=aa={opacity}[logo];[0:v][logo]overlay={pos}", "-c:a", "copy", "-y", out]
    item_id = add_queue_item(data.get("project_id", 0), "ffmpeg_command", video_path, {"cmd": cmd, "output_path": out})
    return {"id": item_id, "output": out}


@router.post("/branding/text")
def text_overlay(data: dict):
    video_path = data.get("video_path", "")
    text = _escape_drawtext(data.get("text", "0xForge"))
    position = data.get("position", "bottom")
    font_size = data.get("font_size", 48)
    color = data.get("color", "white")
    if not video_path:
        raise HTTPException(400, "Yeu cau cung cap video_path")
    pos_map = {"top": "x=(w-text_w)/2:y=20", "bottom": "x=(w-text_w)/2:y=h-th-20", "center": "x=(w-text_w)/2:y=(h-text_h)/2"}
    pos = pos_map.get(position, "x=(w-text_w)/2:y=h-th-20")
    out = video_path.replace(".mp4", "_text.mp4")
    cmd = ["-i", video_path, "-vf", f"drawtext=text='{text}':fontcolor={color}@0.8:fontsize={font_size}:{pos}", "-c:a", "copy", "-y", out]
    item_id = add_queue_item(data.get("project_id", 0), "ffmpeg_command", video_path, {"cmd": cmd, "output_path": out, "temp_files": [qr_file]})
    return {"id": item_id, "output": out}


@router.post("/branding/qr")
def qr_overlay(data: dict):
    video_path = data.get("video_path", "")
    content = data.get("content", "https://example.com")
    position = data.get("position", "bottom_right")
    size = data.get("size", 120)
    if not video_path:
        raise HTTPException(400, "Yeu cau cung cap video_path")
    qr_file = tempfile.NamedTemporaryFile(suffix=".png", delete=False).name
    try:
        import qrcode
        img = qrcode.make(content)
        img.save(qr_file)
    except ImportError:
        try:
            import os
            os.remove(qr_file)
        except Exception:
            pass
        return {"error": "qrcode not installed"}
    pos_map = {"top_right": "(W-w-20):20", "bottom_right": "(W-w-20):(H-h-20)", "center": "(W-w)/2:(H-h)/2"}
    pos = pos_map.get(position, "(W-w-20):(H-h-20)")
    out = video_path.replace(".mp4", "_qr.mp4")
    cmd = ["-i", video_path, "-i", qr_file, "-filter_complex", f"[1:v]scale={size}:{size}[qr];[0:v][qr]overlay={pos}", "-c:a", "copy", "-y", out]
    item_id = add_queue_item(data.get("project_id", 0), "ffmpeg_command", video_path, {"cmd": cmd, "output_path": out})
    return {"id": item_id, "output": out}
