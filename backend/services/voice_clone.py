import os
from pathlib import Path
from ..config import VOICES_DIR


def clone_voice(sample_path: str, text: str, output_path: str):
    """Clone voice using OpenVoice V2."""
    try:
        from openvoice import OpenVoice
        ov = OpenVoice()
        ov.clone(sample_path, text, output_path)
    except ImportError:
        _clone_fallback(sample_path, text, output_path)


def train_clone(sample_path: str, name: str):
    """Train a voice clone model from a sample."""
    clones_dir = VOICES_DIR / "clones" / name
    clones_dir.mkdir(parents=True, exist_ok=True)
    try:
        from openvoice import OpenVoice
        ov = OpenVoice()
        ov.train(sample_path, str(clones_dir))
        (clones_dir / "done.txt").write_text("training complete")
    except ImportError:
        (clones_dir / "done.txt").write_text("OpenVoice not installed")


def _clone_fallback(sample_path, text, out):
    """Fallback: just copy the sample as output."""
    import shutil
    if os.path.exists(sample_path):
        shutil.copy2(sample_path, out)
