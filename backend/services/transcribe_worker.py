#!/usr/bin/env python3
import sys
import json
import argparse
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("audio_path")
    parser.add_argument("--language", default="vi")
    parser.add_argument("--model", default="base")
    args = parser.parse_args()

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print(json.dumps({"error": "faster-whisper not installed. Run: pip install faster-whisper"}))
        sys.exit(1)

    try:
        model = WhisperModel(args.model, device="cpu", compute_type="int8")
        segments, info = model.transcribe(args.audio_path, language=args.language)
        seg_list = list(segments)

        srt_lines = []
        for i, seg in enumerate(seg_list, 1):
            start = _fmt_time(seg.start)
            end = _fmt_time(seg.end)
            text = seg.text.strip()
            srt_lines.append(f"{i}\n{start} --> {end}\n{text}\n")

        srt_content = "\n".join(srt_lines)
        full_text = " ".join(s.text for s in seg_list)

        result = {
            "srt_path": "",
            "text": full_text,
            "segments": len(seg_list),
            "srt_content": srt_content,
            "language": info.language if hasattr(info, "language") else args.language,
        }
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        sys.exit(1)


def _fmt_time(secs):
    h = int(secs // 3600)
    m = int((secs % 3600) // 60)
    s = int(secs % 60)
    ms = int((secs - int(secs)) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


if __name__ == "__main__":
    main()
