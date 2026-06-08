# ForgeX

<div align="center">

### End-to-End AI Video Localization Platform

OCR • Subtitle • Translation • AI Voice • Dubbing • Video Processing

</div>

---

## Giới thiệu

ForgeX là nền tảng mã nguồn mở giúp tự động hóa toàn bộ quy trình bản địa hóa video bằng AI.

Từ một video gốc, ForgeX có thể hỗ trợ:

* Trích xuất phụ đề
* Nhận diện phụ đề cứng (HardSub OCR)
* Dịch phụ đề đa ngôn ngữ
* Tạo giọng đọc AI
* Đồng bộ giọng đọc theo timeline
* Thay thế âm thanh video
* Xuất video hoàn chỉnh

Mục tiêu của ForgeX là cung cấp một quy trình xử lý video tập trung, đơn giản và dễ mở rộng.

---

## Tính năng

### Subtitle Processing

* Nhập và xuất SRT
* Chỉnh sửa phụ đề
* Burn Subtitle vào video
* Tùy chỉnh font, màu sắc và vị trí hiển thị
* Quản lý subtitle theo dự án

### OCR & HardSub

* OCR phụ đề cứng từ video
* Trích xuất phụ đề từ vùng chỉ định
* Phát hiện và xử lý khu vực chứa phụ đề
* Hỗ trợ workflow HardSub

### AI Translation

* Dịch phụ đề đa ngôn ngữ
* Hỗ trợ nhiều engine dịch
* Bảo toàn cấu trúc timeline của SRT

### AI Voice Generation

* Edge TTS
* Azure TTS
* Google TTS
* FPT AI TTS
* Voice Clone
* Đồng bộ giọng đọc theo timeline phụ đề

### Video Processing

* Thay thế âm thanh video
* Xuất video hoàn chỉnh
* Tách âm thanh
* Chia nhỏ video
* Xử lý nhạc nền
* Batch Processing

### Queue System

* Queue Worker
* Xử lý nền
* Theo dõi tiến độ tác vụ
* Quản lý hàng đợi
* Nhật ký xử lý

---

## Workflow

```text
Video
 │
 ├── OCR HardSub
 ├── Whisper / WhisperX
 │
 ▼
 Subtitle
 │
 ▼
 Translation
 │
 ▼
 AI Voice Generation
 │
 ▼
 Timeline Alignment
 │
 ▼
 Audio Replacement
 │
 ▼
 Video Rendering
 │
 ▼
 Export
```

---

## Công nghệ sử dụng

### Backend

* Python
* FastAPI
* SQLite

### AI

* Whisper
* WhisperX
* Edge TTS
* Azure Speech
* Google TTS

### Media Processing

* FFmpeg
* FFprobe
* RapidOCR

---

## Cài đặt

### Clone dự án

```bash
git clone https://github.com/0xHuyVN/ForgeX.git

cd ForgeX
```

### Cài đặt thư viện

```bash
pip install -r requirements.txt
```

### Khởi động ứng dụng

```bash
python app.py
```

---

## Cấu trúc dự án

```text
ForgeX
├── backend
│   ├── services
│   ├── routes
│   ├── workers
│   ├── models
│   └── database
│
├── frontend
│
├── subtitles
├── voices
├── exports
├── downloads
│
└── app.py
```

---

## Trường hợp sử dụng

### Dịch video sang ngôn ngữ khác

```text
Video
↓
Whisper
↓
Dịch phụ đề
↓
TTS
↓
Xuất video
```

### Tạo giọng đọc AI từ phụ đề có sẵn

```text
SRT
↓
AI Voice
↓
Đồng bộ timeline
↓
Ghép vào video
```

### OCR phụ đề cứng

```text
Video
↓
OCR HardSub
↓
Xuất SRT
```

---

## Mục tiêu dự án

ForgeX hướng tới việc trở thành nền tảng mã nguồn mở cho:

* AI Video Localization
* AI Dubbing
* Subtitle Processing
* Voice Generation
* Video Automation

Tất cả trong một workflow thống nhất.

---

## Đóng góp

Mọi đóng góp, báo lỗi hoặc đề xuất tính năng đều được hoan nghênh.

Nếu dự án hữu ích với bạn, hãy cho repository một ⭐.

---

## Tác giả

**0xHuyVN**

GitHub: https://github.com/0xHuyVN
