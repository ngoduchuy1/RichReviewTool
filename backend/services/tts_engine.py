import os
from ..config import AZURE_TTS_KEY, AZURE_TTS_REGION, ELEVENLABS_API_KEY


def synthesize(text: str, provider: str, voice: str, speed: float, output_path: str):
    if provider == "edge":
        _edge_tts(text, voice, speed, output_path)
    elif provider == "azure":
        _azure_tts(text, voice, speed, output_path)
    elif provider == "elevenlabs":
        _elevenlabs_tts(text, voice, output_path)
    elif provider == "google":
        _google_tts(text, voice, output_path)
    else:
        _edge_tts(text, voice, speed, output_path)


def _edge_tts(text, voice, speed, out):
    try:
        import edge_tts
        import asyncio
        rate = f"+{int((speed - 1) * 100)}%" if speed > 1 else f"{int(speed * 100)}%"
        async def _run():
            communicate = edge_tts.Communicate(text, voice, rate=rate)
            await communicate.save(out)
        asyncio.run(_run())
    except ImportError:
        _fallback_tts(text, out)


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
