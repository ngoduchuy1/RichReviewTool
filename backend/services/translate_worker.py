import sys
import json
import os as _os


def _load_nllb():
    from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
    import torch
    _local_path = _os.path.expanduser("~/.cache/nllb_manual")
    model_name = _local_path if _os.path.isdir(_local_path) and _os.path.exists(_os.path.join(_local_path, "pytorch_model.bin")) else "facebook/nllb-200-distilled-600M"
    device = "cuda" if torch.cuda.is_available() else "cpu"
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    model = AutoModelForSeq2SeqLM.from_pretrained(model_name, low_cpu_mem_usage=True).to(device)
    return tokenizer, model, device


def _load_marian():
    from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
    import torch
    device = "cuda" if torch.cuda.is_available() else "cpu"
    tokenizer = AutoTokenizer.from_pretrained("Helsinki-NLP/opus-mt-zh-vi")
    model = AutoModelForSeq2SeqLM.from_pretrained("Helsinki-NLP/opus-mt-zh-vi").to(device)
    return tokenizer, model, device


def translate_nllb(text, src, tgt, tokenizer, model, device):
    lang_map = {
        "vi": "vie_Latn", "en": "eng_Latn", "zh": "zho_Hans",
        "ja": "jpn_Jpan", "ko": "kor_Hang", "th": "tha_Thai",
        "fr": "fra_Latn", "de": "deu_Latn", "es": "spa_Latn",
        "ru": "rus_Cyrl", "ar": "ara_Arab", "pt": "por_Latn",
        "id": "ind_Latn", "ms": "zsm_Latn", "tl": "tgl_Latn",
        "lo": "lao_Laoo", "km": "khm_Khmr", "my": "mya_Mymr",
    }
    src_code = lang_map.get(src, src)
    tgt_code = lang_map.get(tgt, tgt)
    import torch
    tokenizer.src_lang = src_code
    tgt_token_id = tokenizer.convert_tokens_to_ids(tgt_code)
    lines = text.split("\n")
    # Translate only non-empty lines; preserve empty ones for alignment
    non_empty_indices = [i for i, l in enumerate(lines) if l.strip()]
    non_empty_texts = [lines[i].strip() for i in non_empty_indices]
    BATCH = 32
    translated_map = {}
    for i in range(0, len(non_empty_texts), BATCH):
        batch = non_empty_texts[i:i+BATCH]
        inputs = tokenizer(batch, return_tensors="pt", padding=True, truncation=True, max_length=512).to(device)
        with torch.no_grad():
            outputs = model.generate(**inputs, forced_bos_token_id=tgt_token_id, max_length=512, num_beams=2, repetition_penalty=1.1)
        decoded = tokenizer.batch_decode(outputs, skip_special_tokens=True)
        for j, d in enumerate(decoded):
            translated_map[non_empty_indices[i + j]] = d.strip()
    # Reconstruct preserving empty lines
    result = []
    for i in range(len(lines)):
        if i in translated_map:
            result.append(translated_map[i])
        else:
            result.append("")
    return "\n".join(result)


def translate_marian(text, src, tgt, tokenizer, model, device):
    import torch
    inputs = tokenizer(text, return_tensors="pt", truncation=True, max_length=512).to(device)
    outputs = model.generate(**inputs, max_length=512)
    return tokenizer.decode(outputs[0], skip_special_tokens=True)


def main():
    # Read first request to decide which engine and load model
    first = json.loads(sys.stdin.readline())
    engine = first["engine"]

    if engine == "nllb":
        tokenizer, model, device = _load_nllb()
        translate = lambda text, src, tgt: translate_nllb(text, src, tgt, tokenizer, model, device)
    elif engine == "marian":
        tokenizer, model, device = _load_marian()
        translate = lambda text, src, tgt: translate_marian(text, src, tgt, tokenizer, model, device)
    else:
        sys.stderr.write(f"Unknown engine: {engine}\n")
        sys.exit(1)

    # Process first request
    try:
        result = translate(first["text"], first["src"], first["tgt"])
        sys.stdout.write(json.dumps({"result": result, "error": None}) + "\n")
        sys.stdout.flush()
    except Exception as e:
        sys.stdout.write(json.dumps({"result": None, "error": str(e)}) + "\n")
        sys.stdout.flush()

    # Process subsequent requests (model stays loaded)
    for line in sys.stdin:
        try:
            req = json.loads(line)
            result = translate(req["text"], req["src"], req["tgt"])
            sys.stdout.write(json.dumps({"result": result, "error": None}) + "\n")
        except Exception as e:
            sys.stdout.write(json.dumps({"result": None, "error": str(e)}) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
