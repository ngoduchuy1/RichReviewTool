import os
import re
import subprocess
import threading
import asyncio
from pathlib import Path
from ..config import AZURE_TTS_KEY, AZURE_TTS_REGION, ELEVENLABS_API_KEY


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
        subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=120)
        return True
    except Exception as e:
        print(f"[TTS] FFmpeg concat error: {e}")
        return False
    finally:
        list_path.unlink(missing_ok=True)


def synthesize(text: str, provider: str, voice: str, speed: float, output_path: str):
    if provider == "edge":
        _edge_tts(text, voice, speed, output_path)
    elif provider == "azure":
        _azure_tts(text, voice, speed, output_path)
    elif provider == "elevenlabs":
        _elevenlabs_tts(text, voice, output_path)
    elif provider == "google":
        _run_with_timeout(_google_tts, (text, voice, output_path))
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
