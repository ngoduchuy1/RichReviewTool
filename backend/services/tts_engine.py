import os
import re
import subprocess
import threading
import asyncio
from pathlib import Path
from ..config import AZURE_TTS_KEY, AZURE_TTS_REGION, ELEVENLABS_API_KEY
from .text_normalizer import normalize_for_tts


TTS_TIMEOUT = 300  # seconds (increased for chunked synthesis)
CHUNK_MAX_CHARS = 2000  # max characters per edge-tts request
CHUNK_MAX_RETRIES = 3  # retry attempts per chunk
CHUNK_RETRY_DELAY = 2  # seconds between retries (doubles each attempt)


def _run_with_timeout(fn, args=(), kwargs=None, timeout=TTS_TIMEOUT):
    """Run fn in a thread; if it doesn't finish in `timeout` seconds, return None."""
    if kwargs is None:
        kwargs = {}
    result = [None]
    exc = [None]
    done = threading.Event()

    def worker():
        try:
            result[0] = fn(*args, **kwargs)
        except Exception as e:
            exc[0] = e
        finally:
            done.set()

    t = threading.Thread(target=worker, daemon=True)
    t.start()
    ok = done.wait(timeout)
    if not ok:
        print(f"[TTS] Timeout after {timeout}s — falling back")
        return None
    if exc[0]:
        raise exc[0]
    return result[0]


def _split_text_for_tts(text: str, max_chars: int = CHUNK_MAX_CHARS) -> list:
    """Split text into chunks on sentence boundaries, each <= max_chars."""
    if len(text) <= max_chars:
        return [text]

    chunks = []
    # Split by sentence endings (. ? ! or newline), keeping delimiter attached
    sentences = re.split(r'(?<=[.!?\n])', text)

    current_chunk = ""
    for sentence in sentences:
        if not sentence:
            continue
        if len(current_chunk) + len(sentence) <= max_chars:
            current_chunk += sentence
        else:
            if current_chunk.strip():
                chunks.append(current_chunk.strip())
            # If a single sentence exceeds max_chars, split by words
            if len(sentence) > max_chars:
                words = sentence.strip().split()
                word_chunk = ""
                for word in words:
                    if len(word_chunk) + len(word) + 1 <= max_chars:
                        word_chunk = f"{word_chunk} {word}".strip()
                    else:
                        if word_chunk.strip():
                            chunks.append(word_chunk.strip())
                        word_chunk = word
                current_chunk = word_chunk if word_chunk else ""
            else:
                current_chunk = sentence

    if current_chunk.strip():
        chunks.append(current_chunk.strip())

    return [c for c in chunks if c]


def _concat_audio_ffmpeg(file_paths: list, output_path: str) -> bool:
    """Concatenate multiple audio files using FFmpeg concat demuxer."""
    list_path = Path(output_path).parent / f"_concat_{os.getpid()}.txt"
    try:
        lines = [f"file '{Path(p).resolve().as_posix()}'" for p in file_paths]
        list_path.write_text("\n".join(lines), encoding="utf-8")
        cmd = [
            os.environ.get("FFMPEG_PATH", "ffmpeg"),
            "-y", "-f", "concat", "-safe", "0",
            "-i", str(list_path), "-c", "copy", output_path,
        ]
        subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=120, creationflags=subprocess.CREATE_NO_WINDOW)
        return True
    except Exception as e:
        print(f"[TTS] FFmpeg concat error: {e}")
        return False
    finally:
        list_path.unlink(missing_ok=True)


def synthesize(text: str, provider: str, voice: str, speed: float, output_path: str, api_key: str = None):
    lang = (voice or "vi").split("-")[0].lower()
    text = normalize_for_tts(text, lang=lang)
    if provider == "edge":
        _edge_tts(text, voice, speed, output_path)
    elif provider == "fpt":
        if not api_key:
            from ..config import FPT_API_KEY
            api_key = FPT_API_KEY
        _fpt_tts(text, voice, speed, api_key, output_path)
    elif provider == "azure":
        _azure_tts(text, voice, speed, output_path)
    elif provider == "elevenlabs":
        _elevenlabs_tts(text, voice, output_path)
    elif provider == "google":
        _run_with_timeout(_google_tts, (text, voice, output_path))
    elif provider == "clone":
        _clone_tts(text, voice, output_path)
    else:
        _edge_tts(text, voice, speed, output_path)


def _edge_tts(text, voice, speed, out):
    try:
        import edge_tts
    except ImportError:
        print("[TTS] edge_tts not available, using fallback")
        _fallback_tts(text, out)
        return

    rate = f"+{int((speed - 1) * 100)}%" if speed >= 1 else f"{int((speed - 1) * 100)}%"
    chunks = _split_text_for_tts(text, CHUNK_MAX_CHARS)
    print(f"[TTS] edge_tts: voice={voice}, rate={rate}, text_len={len(text)}, chunks={len(chunks)}")

    # Single chunk — no concat needed
    if len(chunks) == 1:
        _run_with_timeout(
            lambda: asyncio.run(_synth_chunk_with_retry(edge_tts, chunks[0], voice, rate, out)),
            timeout=TTS_TIMEOUT,
        )
        return

    # Multiple chunks — synthesize each, then concat with FFmpeg
    temp_files = []
    base, ext = os.path.splitext(out)
    try:
        for idx, chunk in enumerate(chunks):
            chunk_path = f"{base}_chunk_{idx}{ext}"
            print(f"[TTS] Synthesizing chunk {idx + 1}/{len(chunks)} ({len(chunk)} chars)...")
            _run_with_timeout(
                lambda cp=chunk_path, ch=chunk: asyncio.run(
                    _synth_chunk_with_retry(edge_tts, ch, voice, rate, cp)
                ),
                timeout=TTS_TIMEOUT,
            )
            if not os.path.exists(chunk_path) or os.path.getsize(chunk_path) == 0:
                raise RuntimeError(f"Chunk {idx + 1} synthesis failed (empty output)")
            temp_files.append(chunk_path)

        # Concat all chunks
        if not _concat_audio_ffmpeg(temp_files, out):
            raise RuntimeError("FFmpeg concat failed")
        print(f"[TTS] Saved merged audio to {out} ({os.path.getsize(out)} bytes)")
    except Exception as e:
        print(f"[TTS] _edge_tts error: {e}")
        raise
    finally:
        for f in temp_files:
            try:
                os.remove(f)
            except OSError:
                pass


async def _synth_chunk_with_retry(edge_tts, text, voice, rate, out_path):
    """Synthesize a single text chunk with retry on NoAudioReceived."""
    delay = CHUNK_RETRY_DELAY
    last_err = None
    for attempt in range(1, CHUNK_MAX_RETRIES + 1):
        try:
            communicate = edge_tts.Communicate(text, voice, rate=rate)
            await communicate.save(out_path)
            return  # success
        except Exception as e:
            last_err = e
            if attempt < CHUNK_MAX_RETRIES:
                print(f"[TTS] Chunk attempt {attempt} failed ({e}), retrying in {delay}s...")
                await asyncio.sleep(delay)
                delay *= 2
            else:
                print(f"[TTS] Chunk failed after {CHUNK_MAX_RETRIES} attempts: {e}")
    raise last_err


def _azure_tts(text, voice, speed, out):
    if not AZURE_TTS_KEY:
        return
    try:
        import azure.cognitiveservices.speech as speechsdk
        config = speechsdk.SpeechConfig(subscription=AZURE_TTS_KEY, region=AZURE_TTS_REGION)
        config.speech_synthesis_voice_name = voice
        audio_config = speechsdk.audio.AudioOutputConfig(filename=out)
        synthesizer = speechsdk.SpeechSynthesizer(speech_config=config, audio_config=audio_config)
        synthesizer.speak_text_async(text).get()
    except ImportError:
        _edge_tts(text, "vi-VN-NamMinhNeural", speed, out)


def _elevenlabs_tts(text, voice, out):
    if not ELEVENLABS_API_KEY:
        _fallback_tts(text, out)
        return
    try:
        from elevenlabs import generate, save, Voice
        audio = generate(text=text, voice=voice, api_key=ELEVENLABS_API_KEY)
        save(audio, out)
    except ImportError:
        _fallback_tts(text, out)


def _google_tts(text, voice, out):
    try:
        from gtts import gTTS
        lang = voice.split("-")[0] if "-" in voice else "vi"
        tts = gTTS(text, lang=lang)
        tts.save(out)
    except ImportError:
        _fallback_tts(text, out)


def _clone_tts(text, voice, out):
    """TTS using a trained voice clone (Bark)."""
    try:
        from ..services.voice_clone import clone_voice
        from ..config import VOICES_DIR
        clone_dir = VOICES_DIR / "clones" / voice
        prompt_path = clone_dir / "voice_prompt.npz"
        if prompt_path.exists():
            from bark import generate_audio, SAMPLE_RATE
            import scipy.io.wavfile as wavfile
            audio_arr = generate_audio(text, history_prompt=str(prompt_path))
            wavfile.write(out, SAMPLE_RATE, audio_arr)
        else:
            sample = list(clone_dir.glob("sample_*.wav")) + list(clone_dir.glob("*.wav"))
            if sample:
                clone_voice(str(sample[0]), text, out)
            else:
                _fallback_tts(text, out)
    except Exception as e:
        print(f"[TTS] Clone error: {e}")
        _fallback_tts(text, out)


def _fallback_tts(text, out):
    """Generate a silent placeholder if no TTS engine is available."""
    import wave
    import struct
    import math
    duration = max(len(text) * 0.08, 1.0)
    sample_rate = 22050
    n_samples = int(sample_rate * duration)
    with wave.open(out, "w") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        for i in range(n_samples):
            t = i / sample_rate
            val = int(16000 * math.sin(2 * math.pi * 220 * t) * max(0, 1 - t / duration))
            wf.writeframes(struct.pack("<h", val))


def _parse_srt_time(t_str: str) -> float:
    t_str = t_str.strip().replace(",", ".")
    parts = t_str.split(":")
    h = float(parts[0])
    m = float(parts[1])
    s = float(parts[2])
    return h * 3600 + m * 60 + s


def _parse_srt(srt_content: str) -> list:
    blocks = srt_content.strip().split("\n\n")
    results = []
    for block in blocks:
        lines = [line.strip() for line in block.split("\n") if line.strip()]
        if len(lines) >= 3:
            time_line = lines[1]
            if "-->" in time_line:
                t_parts = time_line.split("-->")
                try:
                    start = _parse_srt_time(t_parts[0])
                    end = _parse_srt_time(t_parts[1])
                    text = " ".join(lines[2:])
                    results.append({"start": start, "end": end, "text": text})
                except Exception:
                    pass
    return results


def _get_audio_duration(path: str) -> float:
    from ..config import FFPROBE_PATH
    import json
    cmd = [
        FFPROBE_PATH,
        "-v", "quiet", "-print_format", "json", "-show_format", path
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10, creationflags=subprocess.CREATE_NO_WINDOW)
        data = json.loads(result.stdout)
        fmt = data.get("format", {})
        return float(fmt.get("duration", 0))
    except Exception:
        try:
            import wave
            with wave.open(path, "rb") as wf:
                return wf.getnframes() / wf.getframerate()
        except Exception:
            return 0.0


def _process_single_segment(idx, seg, provider, voice, speed, base_dir, api_key, sample_rate) -> tuple:
    from ..config import FFMPEG_PATH
    start_time = seg["start"]
    end_time = seg["end"]
    lang = (voice or "vi").split("-")[0].lower()
    text = normalize_for_tts(seg["text"], lang=lang)
    
    temp_raw = os.path.join(base_dir, f"_temp_raw_{idx}_{os.getpid()}.wav")
    temp_norm = os.path.join(base_dir, f"_temp_norm_{idx}_{os.getpid()}.wav")
    
    try:
        synthesize(text, provider, voice, speed, temp_raw, api_key=api_key)
        if not os.path.exists(temp_raw) or os.path.getsize(temp_raw) == 0:
            return idx, None, None, "No raw audio generated"
            
        synth_dur = _get_audio_duration(temp_raw)
        target_dur = end_time - start_time
        
        if synth_dur > target_dur and target_dur > 0.1:
            tempo = min(synth_dur / target_dur, 2.0)
            
            filters = []
            while tempo > 2.0:
                filters.append("atempo=2.0")
                tempo /= 2.0
            if tempo > 0.5:
                filters.append(f"atempo={tempo:.2f}")
                
            filter_str = ",".join(filters)
            cmd = [
                FFMPEG_PATH, "-y",
                "-i", temp_raw,
                "-filter:a", filter_str,
                "-ar", str(sample_rate), "-ac", "1",
                "-c:a", "pcm_s16le", temp_norm
            ]
        else:
            cmd = [
                FFMPEG_PATH, "-y",
                "-i", temp_raw,
                "-ar", str(sample_rate), "-ac", "1",
                "-c:a", "pcm_s16le", temp_norm
            ]
            
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        subprocess.run(cmd, capture_output=True, startupinfo=startupinfo, creationflags=subprocess.CREATE_NO_WINDOW)
        
        if not os.path.exists(temp_norm) or os.path.getsize(temp_norm) == 0:
            return idx, temp_raw, None, "No normalized audio generated"
            
        return idx, temp_raw, temp_norm, None
    except Exception as e:
        return idx, (temp_raw if os.path.exists(temp_raw) else None), (temp_norm if os.path.exists(temp_norm) else None), str(e)


def synthesize_timeline(srt_content: str, provider: str, voice: str, speed: float, output_path: str, api_key: str = None, progress_cb=None):
    """Synthesize each subtitle segment, align it to its timeline start, speed it up if necessary, and mix."""
    import wave
    import json
    from concurrent.futures import ThreadPoolExecutor, as_completed
    from ..config import FFMPEG_PATH
    
    segments = _parse_srt(srt_content)
    if not segments:
        text = " ".join(line for line in srt_content.split("\n") if not line.strip().isdigit() and "-->" not in line)
        synthesize(text, provider, voice, speed, output_path, api_key=api_key)
        return

    temp_files = []
    sample_rate = 22050
    bytes_per_sample = 2
    base_dir = os.path.dirname(output_path)
    
    try:
        # Run synthesis and processing tasks in parallel using a thread pool
        futures = {}
        completed_count = 0
        results = [None] * len(segments)
        
        with ThreadPoolExecutor(max_workers=8) as executor:
            for idx, seg in enumerate(segments):
                f = executor.submit(
                    _process_single_segment,
                    idx, seg, provider, voice, speed, base_dir, api_key, sample_rate
                )
                futures[f] = idx
                
            for f in as_completed(futures):
                idx = futures[f]
                completed_count += 1
                if progress_cb:
                    try:
                        progress_cb(completed_count, len(segments))
                    except Exception:
                        pass
                
                try:
                    res_idx, raw_p, norm_p, err = f.result()
                    if err:
                        print(f"[TTS] Segment {res_idx} failed: {err}")
                    results[res_idx] = (raw_p, norm_p)
                    if raw_p:
                        temp_files.append(raw_p)
                    if norm_p:
                        temp_files.append(norm_p)
                except Exception as e:
                    print(f"[TTS] Segment {idx} threw exception: {e}")

        # Assemble the final wave file sequentially in timeline order
        with wave.open(output_path, "wb") as out_wf:
            out_wf.setnchannels(1)
            out_wf.setsampwidth(bytes_per_sample)
            out_wf.setframerate(sample_rate)
            
            current_frame = 0
            
            for idx, seg in enumerate(segments):
                start_time = seg["start"]
                res = results[idx]
                if not res or not res[1]:
                    continue
                temp_norm = res[1]
                
                start_frame = int(start_time * sample_rate)
                if start_frame > current_frame:
                    silence_frames = start_frame - current_frame
                    out_wf.writeframes(b"\x00" * (silence_frames * bytes_per_sample))
                    current_frame = start_frame
                    
                with wave.open(temp_norm, "rb") as norm_wf:
                    data = norm_wf.readframes(norm_wf.getnframes())
                    out_wf.writeframes(data)
                    current_frame += len(data) // bytes_per_sample
                    
    finally:
        for f in temp_files:
            try:
                if os.path.exists(f):
                    os.remove(f)
            except OSError:
                pass


def _fpt_tts(text: str, voice: str, speed: float, api_key: str, out_path: str):
    import requests
    import time
    if not api_key:
        print("[TTS] FPT API Key is missing, falling back to edge_tts")
        _edge_tts(text, "vi-VN-HoaiMyNeural", speed, out_path)
        return

    fpt_speed = 0
    if speed > 1.4:
        fpt_speed = 2
    elif speed > 1.1:
        fpt_speed = 1
    elif speed < 0.7:
        fpt_speed = -2
    elif speed < 0.9:
        fpt_speed = -1

    headers = {
        "api-key": api_key,
        "voice": voice,
        "speed": str(fpt_speed),
        "format": "mp3"
    }
    url = "https://api.fpt.ai/hmi/tts/v5"
    try:
        response = requests.post(url, headers=headers, data=text.encode("utf-8"), timeout=15)
        if response.status_code != 200:
            raise RuntimeError(f"FPT API returned status code {response.status_code}")
        data = response.json()
        if not data.get("async"):
            raise RuntimeError(f"FPT API failed: {data.get('message', 'Unknown error')}")
        async_url = data["async"]
        
        for _ in range(30):
            time.sleep(1)
            poll_resp = requests.get(async_url, timeout=10)
            if poll_resp.status_code == 200:
                with open(out_path, "wb") as f:
                    f.write(poll_resp.content)
                return
        raise TimeoutError("FPT TTS synthesis timed out")
    except Exception as e:
        print(f"[TTS] FPT error: {e}, falling back to edge_tts")
        _edge_tts(text, "vi-VN-HoaiMyNeural", speed, out_path)
