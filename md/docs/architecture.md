## Tổng quan hệ thống
Review Studio Pro được thiết kế như một **Local Desktop Application** chạy trên nền tảng web technology (Local Server + Web Client). Thay vì dùng Electron bọc toàn bộ, dự án tách bạch Frontend (giao diện tĩnh) và Backend (FastAPI). Mô hình này cho phép tận dụng tối đa sức mạnh của hệ thống nội bộ (thực thi FFmpeg, chạy model AI cục bộ) trong khi vẫn giữ UI mượt mà, độc lập.

## Trách nhiệm từng module/layer
1. **Presentation Layer (Frontend - Vanilla JS/CSS):** 
   - Hiển thị giao diện người dùng, cung cấp các control (slider, checkbox, input).
   - Xử lý trạng thái local (current project, progress bar giả lập).
   - Gọi API qua lớp wrapper `fetch`.
2. **Controller Layer (Backend - FastAPI Routers):** 
   - Nhận request, validate payload qua `Pydantic` schemas.
   - Trả về HTTP Response lập tức và đẩy tác vụ nặng vào Background Queue.
3. **Service Layer (Backend - Business Logic):** 
   - `ffmpeg_utils.py`: Tạo filter graph phức tạp và thực thi lệnh qua subprocess.
   - `audio_processor.py`: Cắt ghép, tính toán sidechain compression cho audio.
   - `downloader.py`: Quản lý quy trình tải bằng yt-dlp.
4. **Data Layer (SQLite):** 
   - Lưu trữ trạng thái Project, lịch sử Subtitle, và các tác vụ Download đang chạy. Quản lý qua Custom Context Manager (`db_cursor`).

## Luồng dữ liệu chính
*Ví dụ: Luồng thêm hiệu ứng (Enhance)*
1. Người dùng kéo slider (Vignette, Zoom) và bấm "Apply" trên giao diện.
2. `app.js` gửi `POST /api/enhance/apply` với payload JSON chứa thông số.
3. `routers/enhance.py` nhận request, nội suy ra danh sách FFmpeg filters tương ứng (`vignette`, `zoompan`, `drawtext`).
4. FastAPI đưa lệnh gọi `run_ffmpeg` vào `BackgroundTasks`.
5. API trả về `200 OK` (hoặc thông tin file đầu ra) để Frontend hiển thị tiến trình.
6. Worker chạy ngầm subprocess gọi system FFmpeg, render ra file video mới.

## Quyết định thiết kế & lý do
* **Dùng Vanilla JS thay vì React/Vue:** Tối giản hóa dependencies, không cần Build Tool, lý tưởng cho một dự án cá nhân chạy local siêu nhẹ.
* **Dùng FastAPI thay vì Flask/Django:** Hỗ trợ Asynchronous (bắt buộc khi làm việc với file media dung lượng lớn) và auto-generate API document.
* **Dùng Raw SQLite thay vì ORM (SQLAlchemy):** Triển khai nhanh, kiểm soát hoàn toàn câu lệnh SQL, tránh overhead không cần thiết cho một local app.
* **Dùng FFmpeg Subprocess:** Thư viện xử lý video Python thường có hiệu năng kém hơn so với việc bọc trực tiếp các lệnh CLI của FFmpeg.
