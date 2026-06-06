# Review Studio Pro
> Hệ thống pipeline tự động hóa sản xuất video review chuyên nghiệp

![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)
![Python](https://img.shields.io/badge/python-3.10%2B-blue.svg)
![FastAPI](https://img.shields.io/badge/FastAPI-0.100%2B-00a393.svg)

## Tổng quan
Review Studio Pro là một giải pháp desktop mạnh mẽ được thiết kế để tự động hóa toàn bộ quy trình sản xuất video dạng review, tóm tắt phim, và nội dung ngắn (Shorts/TikTok). Thay vì phải sử dụng nhiều công cụ rời rạc, dự án này hợp nhất việc tải video, bóc băng (STT), dịch thuật, lồng tiếng (TTS/Voice Clone), áp dụng hiệu ứng (VFX), và render vào một giao diện duy nhất, liền mạch.

## Tính năng chính
* **Tải Video Tự Động:** Tích hợp `yt-dlp` để tải đa nền tảng, hỗ trợ proxy và chọn chất lượng (1080p, 720p, audio).
* **Xử lý Phụ Đề AI:** Nhận diện giọng nói bằng Whisper, dịch tự động qua nhiều engine (GPT, Gemini, NLLB), xuất file `.ass` có đầy đủ style (font, màu, bóng đổ).
* **Lồng Tiếng & Sao Chép Giọng (Voice Clone):** Tích hợp EdgeTTS, ElevenLabs và OpenVoice để tạo giọng đọc tự nhiên.
* **Xử lý Âm Thanh (Audio Ducking):** Tự động giảm âm lượng nhạc nền khi có giọng đọc bằng sidechain compression.
* **Hiệu Ứng Hình Ảnh (Enhance & VFX):** Hỗ trợ tinh chỉnh màu sắc, Watermark, Motion Blur (nội suy 60fps), Zoompan, và Shake effect qua sức mạnh của FFmpeg.
* **Render Engine:** Tùy chọn render linh hoạt (H264, H265, AV1) với tăng tốc phần cứng (GPU).

## Yêu cầu hệ thống
* **Hệ điều hành:** Windows 10/11, macOS, hoặc Linux.
* **Runtime:** Python 3.10 trở lên.
* **Công cụ bổ trợ bắt buộc:** 
  * `ffmpeg` và `ffprobe` phải được cài đặt và thiết lập trong biến môi trường PATH.
  * `yt-dlp` (được gọi qua subprocess).

## Cài đặt & Khởi chạy

```bash
# 1. Clone repository
git clone https://github.com/your-repo/review-studio-pro.git
cd review-studio-pro

# 2. Cài đặt dependencies cho Backend
pip install -r requirements.txt
# (Hoặc cài thủ công các package chính: fastapi, uvicorn, pydantic, pydub, openai, whisper)

# 3. Khởi chạy Backend Server
cd backend
uvicorn main:app --reload --port 8000

# 4. Mở Frontend
# Mở file index.html ở thư mục root bằng bất kỳ trình duyệt nào (Chrome, Edge).
```

## Cấu trúc thư mục
```text
.
├── index.html                  # Giao diện chính (UI)
├── app.js                      # Logic Frontend, gọi API
├── style.css                   # Thiết kế UI (CSS Variables, Flexbox, Modal)
└── backend/                    # Core Backend Python
    ├── main.py                 # Entry point FastAPI
    ├── config.py               # Biến môi trường và cấu hình path
    ├── database.py             # Kết nối SQLite
    ├── models/                 
    │   └── schemas.py          # Data models (Pydantic)
    ├── routers/                # Các endpoint REST API
    │   ├── enhance.py          # API xử lý hiệu ứng hình ảnh
    │   ├── music.py            # API xử lý âm thanh & ducking
    │   ├── subtitle.py         # API bóc băng & dịch phụ đề
    │   └── voice.py            # API TTS & Voice Clone
    └── services/               # Logic nghiệp vụ (Business logic)
        ├── audio_processor.py  # Xử lý âm thanh (Pydub/FFmpeg)
        ├── downloader.py       # Wrapper gọi yt-dlp
        ├── ffmpeg_utils.py     # Sinh chuỗi filter FFmpeg
        └── whisper_stt.py      # Tích hợp mô hình nhận diện giọng nói
```

## Kiến trúc kỹ thuật
Hệ thống sử dụng mô hình **Local Client-Server Monolith**. 
* **Frontend:** Viết hoàn toàn bằng Vanilla HTML/CSS/JS để đảm bảo tính nhẹ và linh hoạt, hoạt động như một Thin Client.
* **Backend:** Xây dựng bằng FastAPI. Các tác vụ nặng (Tải file, Encode video, Chạy AI) được đẩy vào `BackgroundTasks` để tránh blocking thread chính. Dữ liệu được lưu trữ local bằng SQLite.

## Cấu hình
Có thể tùy chỉnh cấu hình trong file `backend/config.py` và Modal "Settings" trên UI:
* Cấu hình Path cho `FFMPEG_PATH`, `FFPROBE_PATH`, `YTDLP_PATH`.
* Cấu hình API Keys: `OpenAI API Key`, `ElevenLabs API Key`.

## Xử lý lỗi thường gặp
* **Lỗi "FFmpeg not found":** Đảm bảo FFmpeg đã được cài đặt và đường dẫn đến thư mục `bin` đã được thêm vào PATH của hệ điều hành.
* **Task bị treo không phản hồi:** Tác vụ xử lý bằng BackgroundTasks có thể bị ngầm định chấm dứt nếu restart server. Hãy kiểm tra console của Uvicorn để xem log chi tiết.
