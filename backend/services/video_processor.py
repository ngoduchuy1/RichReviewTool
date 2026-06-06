from .ffmpeg_utils import run_ffmpeg


def crop_video(input_path: str, output_path: str, x: int, y: int, w: int, h: int):
    cmd = ["-i", input_path, "-vf", f"crop={w}:{h}:{x}:{y}", "-c:a", "copy", "-y", output_path]
    return run_ffmpeg(cmd)


def resize_video(input_path: str, output_path: str, width: int, height: int):
    cmd = ["-i", input_path, "-vf", f"scale={width}:{height}", "-c:a", "copy", "-y", output_path]
    return run_ffmpeg(cmd)


def rotate_video(input_path: str, output_path: str, angle: float):
    angle_map = {90: "transpose=1", 180: "hflip,vflip", 270: "transpose=2"}
    if angle in angle_map:
        cmd = ["-i", input_path, "-vf", angle_map[angle], "-c:a", "copy", "-y", output_path]
    else:
        cmd = ["-i", input_path, "-vf", f"rotate={angle * 3.14159 / 180}:fillcolor=black", "-c:a", "copy", "-y", output_path]
    return run_ffmpeg(cmd)


def apply_lut(input_path: str, output_path: str, lut_path: str):
    cmd = ["-i", input_path, "-vf", f"lut3d={lut_path}", "-c:a", "copy", "-y", output_path]
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
        cmd = ["-i", input_path, "-vf", ",".join(filters), "-c:a", "copy", "-y", output_path]
        return run_ffmpeg(cmd)
    return True


def apply_vignette(input_path: str, output_path: str, amount: float = 0.3):
    cmd = ["-i", input_path, "-vf", f"vignette=PI*{amount}", "-c:a", "copy", "-y", output_path]
    return run_ffmpeg(cmd)
