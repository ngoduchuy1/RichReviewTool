import subprocess
import json
import os
from pathlib import Path
from ..config import FFMPEG_PATH, FFPROBE_PATH, EXPORTS_DIR


def run_ffmpeg(cmd: list, timeout: int = 3600) -> bool:
    full_cmd = [FFMPEG_PATH, "-y"] + cmd
    print(f"[FFmpeg] {' '.join(str(a) for a in full_cmd)}")
    try:
        result = subprocess.run(full_cmd, check=True, capture_output=True, text=True, timeout=timeout)
        return True
    except subprocess.CalledProcessError as e:
        err = (e.stderr or "")
        tail = err[-2000:] if len(err) > 2000 else err
        print(f"[FFmpeg] ERROR (rc={e.returncode}): {tail}")
        return False
    except FileNotFoundError:
        print("[FFmpeg] NOT FOUND — install FFmpeg or set FFMPEG_PATH env")
        return False


def get_video_info(path: str) -> dict:
    cmd = [FFPROBE_PATH, "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", path]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        data = json.loads(result.stdout)
        video_stream = next((s for s in data.get("streams", []) if s["codec_type"] == "video"), {})
        audio_stream = next((s for s in data.get("streams", []) if s["codec_type"] == "audio"), {})
        fmt = data.get("format", {})
        return {
            "width": int(video_stream.get("width", 0)),
            "height": int(video_stream.get("height", 0)),
            "fps": eval(video_stream.get("r_frame_rate", "0/1")) if "/" in video_stream.get("r_frame_rate", "0/1") else 0,
            "duration": float(fmt.get("duration", 0)),
            "size": int(fmt.get("size", 0)),
            "video_codec": video_stream.get("codec_name", ""),
            "audio_codec": audio_stream.get("codec_name", ""),
        }
    except Exception:
        return {}


def render_video(input_path: str, output_path: str, params: dict = None):
    p = params or {}
    cmd = ["-i", input_path]

    vf = []
    if p.get("width") and p.get("height"):
        vf.append(f"scale={p['width']}:{p['height']}")
    if p.get("fps"):
        cmd.extend(["-r", str(p["fps"])])
    if vf:
        cmd.extend(["-vf", ",".join(vf)])

    codec = p.get("codec", "h264")
    codec_map = {"h264": "libx264", "h265": "libx265", "av1": "libaom-av1"}
    cmd.extend(["-c:v", codec_map.get(codec, "libx264")])

    if p.get("bitrate"):
        cmd.extend(["-b:v", p["bitrate"]])

    cmd.extend(["-c:a", "aac", "-b:a", p.get("audio_bitrate", "192k"), "-y", output_path])
    return run_ffmpeg(cmd)


def export_audio(input_path: str, output_path: str, fmt: str = "mp3"):
    codec_map = {"mp3": "libmp3lame", "wav": "pcm_s16le", "flac": "flac", "ogg": "libvorbis"}
    cmd = ["-i", input_path, "-vn", "-c:a", codec_map.get(fmt, "libmp3lame"), "-y", output_path]
    return run_ffmpeg(cmd)


def export_subtitle_file(content: str, fmt: str, project_id: int, style: dict = None) -> str:
    out = str(EXPORTS_DIR / f"sub_project_{project_id}.{fmt}")
    if fmt == "srt":
        Path(out).write_text(content, encoding="utf-8")
    elif fmt == "ass":
        font = style.get("font", "Arial") if style else "Arial"
        size = style.get("size", 42) if style else 42
        color = style.get("color", "#FFFFFF").replace("#", "") if style else "FFFFFF"
        # ASS color format is &HAABBGGRR. We get #RRGGBB. So reverse it: &H00 + BB + GG + RR
        if len(color) == 6:
            color = f"&H00{color[4:6]}{color[2:4]}{color[0:2]}"
        else:
            color = "&H00FFFFFF"
            
        shadow = style.get("shadow", "Soft") if style else "Soft"
        shadow_val = "2" if shadow.lower() == "soft" else "4" if shadow.lower() == "hard" else "0"
        
        ass_header = f"[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow\nStyle: Default,{font},{size},{color},&H00000000,0,0,1,2,{shadow_val}\n\n[Events]\nFormat: Layer, Start, End, Style, Text\n"
        
        blocks = content.strip().split("\n\n")
        lines = []
        for block in blocks:
            parts = block.split("\n")
            if len(parts) >= 3:
                time_line = parts[1]
                if "-->" in time_line:
                    t_parts = time_line.split("-->")
                    # SRT: 00:00:00,000 -> ASS: 0:00:00.00
                    def srt_to_ass_time(t_str):
                        t_str = t_str.strip().replace(",", ".")
                        if t_str.startswith("0") and len(t_str) >= 12: t_str = t_str[1:]
                        if len(t_str) > 10: t_str = t_str[:10]
                        return t_str
                    
                    start = srt_to_ass_time(t_parts[0])
                    end = srt_to_ass_time(t_parts[1])
                    text = "\\N".join(parts[2:])
                    lines.append(f"Dialogue: 0,{start},{end},Default,,0,0,0,,{text}")
                    
        Path(out).write_text(ass_header + "\n".join(lines), encoding="utf-8")
    return out


def split_video(input_path: str, output_path: str, start: float, end: float):
    cmd = ["-i", input_path, "-ss", str(start), "-to", str(end), "-c", "copy", "-y", output_path]
    return run_ffmpeg(cmd)


def merge_videos(file_paths: list, output_path: str):
    list_path = Path(output_path).parent / "_merge_list.txt"
    list_path.write_text("\n".join(f"file '{p}'" for p in file_paths), encoding="utf-8")
    cmd = ["-f", "concat", "-safe", "0", "-i", str(list_path), "-c", "copy", "-y", output_path]
    result = run_ffmpeg(cmd)
    list_path.unlink(missing_ok=True)
    return result


def _temp_copy(path: str) -> str:
    """Copy file to %TEMP% to avoid special chars in path (e.g. &)."""
    import shutil
    import tempfile
    ext = Path(path).suffix
    tmp = os.path.join(tempfile.gettempdir(), f"sub_burn_{os.getpid()}_{os.urandom(4).hex()}{ext}")
    shutil.copy2(path, tmp)
    return tmp

def _filter_path(path: str) -> str:
    """Return POSIX path with colon escaped for use inside filename='...'."""
    return path.replace("\\", "/").replace(":", "\\:")

def burn_subtitle(video_path: str, subtitle_path: str, output_path: str = None) -> str:
    """Burn subtitles into video using FFmpeg subtitles filter."""
    if not output_path:
        output_path = video_path.replace(".mp4", "_subbed.mp4")

    # copy to %TEMP% to avoid & etc in the path
    safe_src = _temp_copy(subtitle_path)
    sub_ext = Path(subtitle_path).suffix.lower()

    if sub_ext == ".srt":
        safe_path = _filter_path(safe_src)
        cmd = [
            "-i", video_path,
            "-vf", f"subtitles=filename='{safe_path}'",
            "-c:a", "copy",
            "-y", output_path,
        ]
    elif sub_ext == ".ass":
        safe_path = _filter_path(safe_src)
        cmd = [
            "-i", video_path,
            "-vf", f"ass=filename='{safe_path}'",
            "-c:a", "copy",
            "-y", output_path,
        ]
    else:
        cmd = ["-i", video_path, "-c", "copy", "-y", output_path]

    if not run_ffmpeg(cmd):
        raise RuntimeError(f"FFmpeg burn_subtitle failed for {video_path}")
    if not os.path.exists(output_path):
        raise RuntimeError(f"burn_subtitle output not created: {output_path}")
    return output_path


def replace_audio(video_path: str, audio_path: str, output_path: str = None) -> str:
    """Replace video audio track with a new audio file."""
    if not output_path:
        output_path = video_path.replace(".mp4", "_newaudio.mp4")
    cmd = ["-i", video_path, "-i", audio_path, "-c:v", "copy", "-map", "0:v:0", "-map", "1:a:0", "-shortest", "-y", output_path]
    if not run_ffmpeg(cmd):
        raise RuntimeError(f"FFmpeg replace_audio failed for {video_path}")
    if not os.path.exists(output_path):
        raise RuntimeError(f"replace_audio output not created: {output_path}")
    return output_path


def mix_audio(video_path: str, audio_path: str, volume: float = 0.3, output_path: str = None) -> str:
    """Mix background audio with existing video audio."""
    if not output_path:
        output_path = video_path.replace(".mp4", "_mixed.mp4")
    cmd = [
        "-i", video_path, "-i", audio_path,
        "-filter_complex",
        f"[1:a]volume={volume}[bga];[0:a][bga]amix=inputs=2:duration=first[outa]",
        "-map", "0:v:0", "-map", "[outa]",
        "-c:v", "copy",
        "-y", output_path,
    ]
    run_ffmpeg(cmd)
    return output_path


def extract_audio(video_path: str, output_path: str = None, sample_rate: int = 16000) -> str:
    """Extract audio from video, useful for STT."""
    if not output_path:
        output_path = video_path.replace(".mp4", ".wav")
    cmd = ["-i", video_path, "-vn", "-ac", "1", "-ar", str(sample_rate), "-y", output_path]
    run_ffmpeg(cmd)
    return output_path
