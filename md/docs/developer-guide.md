## Cài đặt môi trường dev
1. Cài đặt Python 3.10+. Khuyến nghị sử dụng `venv`:
   ```bash
   python -m venv .venv
   source .venv/bin/activate  # (hoặc .venv\Scripts\activate trên Windows)
   ```
2. Cài đặt dependencies:
   ```bash
   pip install fastapi uvicorn pydantic pydub openai whisper openvoice
   ```
3. Cài đặt FFmpeg và yt-dlp, cấu hình đường dẫn môi trường.

## Chạy ở chế độ development
Mở 2 terminal:
- **Terminal 1 (Backend):**
  ```bash
  cd backend
  uvicorn main:app --reload
  ```
- **Terminal 2 (Frontend):**
  Mở file `index.html` trực tiếp bằng trình duyệt. Để có trải nghiệm tốt nhất (tránh lỗi CORS cục bộ), có thể dùng Live Server extension trên VS Code.

## Giải thích module chính
* **`app.js`**: Chứa toàn bộ map routing UI. Mọi DOM Element được select bằng `getElementById` hoặc `querySelector`.
* **`backend/services/ffmpeg_utils.py`**: Trái tim của ứng dụng xử lý video. Hàm `run_ffmpeg` là wrapper an toàn cho subprocess.
* **`backend/database.py`**: Chứa context manager `db_cursor()`. Luôn dùng block `with db_cursor() as cur:` để đảm bảo kết nối tự động đóng.

## Code patterns đang dùng
* **Thin UI, Fat Server:** Frontend hiếm khi lưu trạng thái phức tạp, mọi xử lý file và filter đều đẩy xuống backend.
* **Builder Pattern trong FFmpeg:** Xây dựng array `filters = []`, sau đó dùng `",".join(filters)` để truyền vào đối số `-vf` hoặc `-af` của FFmpeg.

## Naming conventions
* **Frontend IDs:** Dùng tiền tố rõ ràng: `btn-` (Button), `inp-` (Input), `chk-` (Checkbox), `sel-` (Select), `slider-` (Range). VD: `btn-start-download`.
* **Python Backend:** Tuân thủ chuẩn PEP-8 (snake_case cho hàm/biến, PascalCase cho Class/Pydantic Models).

## Cách thêm tính năng mới

**Thêm 1 hiệu ứng Video mới:**
1. Mở `backend/models/schemas.py`, thêm field boolean vào `EnhanceRequest`.
   ```python
   glitch: Optional[bool] = False
   ```
2. Mở `backend/routers/enhance.py`, thêm check:
   ```python
   if getattr(data, "glitch", False):
       filters.append("rgbashift=rh=3:bv=3") # Lệnh giả định
   ```
3. Mở `index.html`, thêm Checkbox UI với class `.feature-item`.
4. Mở `app.js`, cập nhật event `btn-enhance-apply` để đọc giá trị checkbox và đính kèm vào payload gửi đi.
