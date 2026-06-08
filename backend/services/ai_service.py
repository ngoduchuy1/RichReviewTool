from ..config import OPENAI_API_KEY
import requests


def generate_summary(text: str, max_length: int = 200, engine: str = "gpt") -> str:
    if engine == "gpt" and OPENAI_API_KEY:
        return _gpt_summary(text, max_length)
    try:
        from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
        model_name = "facebook/bart-large-cnn"
        tokenizer = AutoTokenizer.from_pretrained(model_name)
        model = AutoModelForSeq2SeqLM.from_pretrained(model_name)
        inputs = tokenizer(text, return_tensors="pt", truncation=True, max_length=1024)
        outputs = model.generate(**inputs, max_length=max_length, min_length=30, num_beams=4, no_repeat_ngram_size=3)
        return tokenizer.decode(outputs[0], skip_special_tokens=True)
    except ImportError:
        return _simple_summary(text, max_length)


def generate_recap(video_path: str, style: str = "review", language: str = "vi") -> str:
    """Alias for generate_recap_from_transcript — transcribes then recaps."""
    try:
        from .whisper_stt import transcribe_file
        transcript = transcribe_file(video_path)
        return generate_recap_from_transcript(transcript, style, language)
    except Exception:
        return _simple_summary(f"Recap of video at {video_path}", 300)


def generate_recap_from_transcript(transcript: str, style: str = "review", language: str = "vi") -> str:
    if OPENAI_API_KEY:
        prompt = f"Write a {style} recap in {language} based on this transcript:\n\n{transcript[:4000]}"
        return _gpt_chat(prompt)
    return _simple_summary(transcript, 300)


def detect_characters(video_path: str):
    """Detect characters/faces using YOLOv11 + InsightFace or MediaPipe."""
    try:
        import cv2
        import mediapipe as mp
        mp_face = mp.solutions.face_detection
        face_detection = mp_face.FaceDetection(model_selection=1, min_detection_confidence=0.5)
        cap = cv2.VideoCapture(video_path)
        characters = []
        frame_idx = 0
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
            if frame_idx % 30 == 0:
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                results = face_detection.process(rgb)
                if results.detections:
                    for det in results.detections:
                        bbox = det.location_data.relative_bounding_box
                        characters.append({
                            "frame": frame_idx,
                            "confidence": det.score[0],
                            "x": bbox.xmin, "y": bbox.ymin, "w": bbox.width, "h": bbox.height,
                        })
            frame_idx += 1
        cap.release()
        return characters
    except ImportError:
        return []


def detect_speakers(video_path: str):
    """Detect speakers using pyannote-audio."""
    try:
        from pyannote.audio import Pipeline
        pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1")
        diarization = pipeline(video_path)
        speakers = []
        for turn, _, speaker in diarization.itertracks(yield_label=True):
            speakers.append({
                "speaker": speaker,
                "start": turn.start,
                "end": turn.end,
            })
        return speakers
    except ImportError:
        return []


def generate_thumbnail(video_path: str, time_sec: float = 0.0, output_path: str = None):
    """Extract a frame from the video as thumbnail."""
    import subprocess
    if not output_path:
        output_path = video_path.replace(".mp4", "_thumb.jpg")
    cmd = ["ffmpeg", "-ss", str(time_sec), "-i", video_path, "-vframes", "1", "-q:v", "2", "-y", output_path]
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True, creationflags=subprocess.CREATE_NO_WINDOW)
    except Exception:
        pass
    return output_path


def generate_title(video_path: str, style: str = "review") -> str:
    if OPENAI_API_KEY:
        prompt = f"Generate a clickbait YouTube title for a {style} video in Vietnamese. Return only the title."
        return _gpt_chat(prompt)
    return f"[Video {style.upper()}] Hấp dẫn - Đừng bỏ lỡ!"


def generate_hashtags(text: str, count: int = 5) -> list:
    if OPENAI_API_KEY:
        prompt = f"Generate {count} hashtags for this content in Vietnamese and English:\n{text[:1000]}"
        result = _gpt_chat(prompt)
        return [h.strip() for h in result.split() if h.startswith("#")]
    return ["#review", "#movie", "#phim", "#reviewphim", "#hot"]


def _gpt_summary(text, max_length):
    prompt = f"Summarize the following text in Vietnamese (max {max_length} words):\n\n{text[:4000]}"
    return _gpt_chat(prompt)


def _gpt_chat(prompt: str) -> str:
    try:
        resp = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"},
            json={
                "model": "gpt-4o-mini",
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.5,
            },
            timeout=30,
        )
        data = resp.json()
        tokens = data.get("usage", {}).get("total_tokens", 0)
        from .translator import _log_usage
        _log_usage("gpt", tokens, 0, tokens * 0.00015 / 1000)
        return data["choices"][0]["message"]["content"].strip()
    except Exception as e:
        return f"[GPT unavailable: {e}]"


def _simple_summary(text, max_length):
    sentences = text.replace("\n", " ").split(". ")
    result = ""
    for s in sentences:
        if len(result) + len(s) < max_length * 5:
            result += s + ". "
    return result.strip()
