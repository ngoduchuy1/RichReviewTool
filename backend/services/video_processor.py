from .ffmpeg_utils import run_ffmpeg, has_nvenc


def _get_codec_args() -> list:
    if has_nvenc():
        return ["-c:v", "h264_nvenc", "-preset", "p4", "-rc", "vbr", "-cq", "18"]
    return ["-c:v", "libx264", "-crf", "18", "-preset", "medium"]


def crop_video(input_path: str, output_path: str, x: int, y: int, w: int, h: int):
    codec_args = _get_codec_args()
    cmd = ["-i", input_path, "-vf", f"crop={w}:{h}:{x}:{y}"] + codec_args + ["-c:a", "copy", "-y", output_path]
    return run_ffmpeg(cmd)


def resize_video(input_path: str, output_path: str, width: int, height: int):
    codec_args = _get_codec_args()
    cmd = ["-i", input_path, "-vf", f"scale={width}:{height}"] + codec_args + ["-c:a", "copy", "-y", output_path]
    return run_ffmpeg(cmd)


def rotate_video(input_path: str, output_path: str, angle: float):
    angle_map = {90: "transpose=1", 180: "hflip,vflip", 270: "transpose=2"}
    codec_args = _get_codec_args()
    if angle in angle_map:
        cmd = ["-i", input_path, "-vf", angle_map[angle]] + codec_args + ["-c:a", "copy", "-y", output_path]
    else:
        cmd = ["-i", input_path, "-vf", f"rotate={angle * 3.14159 / 180}:fillcolor=black"] + codec_args + ["-c:a", "copy", "-y", output_path]
    return run_ffmpeg(cmd)


def apply_lut(input_path: str, output_path: str, lut_path: str):
    codec_args = _get_codec_args()
    cmd = ["-i", input_path, "-vf", f"lut3d={lut_path}"] + codec_args + ["-c:a", "copy", "-y", output_path]
    return run_ffmpeg(cmd)


def adjust_color(input_path: str, output_path: str, brightness=0, contrast=1.0, saturation=1.0):
    filters = []
    if brightness != 0:
        filters.append(f"eq=brightness={brightness}")
    if contrast != 1.0:
        filters.append(f"eq=contrast={contrast}")
    if saturation != 1.0:
        filters.append(f"eq=saturation={saturation}")

    if filters:
        codec_args = _get_codec_args()
        cmd = ["-i", input_path, "-vf", ",".join(filters)] + codec_args + ["-c:a", "copy", "-y", output_path]
        return run_ffmpeg(cmd)
    return True


def apply_vignette(input_path: str, output_path: str, amount: float = 0.3):
    codec_args = _get_codec_args()
    cmd = ["-i", input_path, "-vf", f"vignette=PI*{amount}"] + codec_args + ["-c:a", "copy", "-y", output_path]
    return run_ffmpeg(cmd)
