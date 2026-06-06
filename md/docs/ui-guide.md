### 1. Design System
* **Màu sắc (Color Variables):**
  * `--bg-app`: `#131722` (Nền chính)
  * `--bg-panel`: `#1b202d` (Nền các khu vực chức năng)
  * `--bg-header`: `#232a3b`
  * `--text`: `#e2e8f0` (Màu chữ chính)
  * `--text-dim`, `--text-muted`: Màu chữ phụ/nhạt.
  * `--orange`: `#f97316` (Accent color)
  * `--border`: `#2e3648`
* **Typography:** Sử dụng Font hệ thống mặc định (Segou UI, San Francisco) tối ưu tốc độ. Kích thước text rất nhỏ gọn (`10.5px` - `12px`), phù hợp với mật độ hiển thị cao của các phần mềm Desktop/IDE.
* **Spacing:** Padding và Gap sử dụng thông số nhỏ (2px, 4px, 8px) theo kiến trúc layout lưới (Flex/Grid).
* **Radius:** `--radius-sm` (4px).

### 2. Danh sách Components / Screens / Panels

* **Sidebar Navigation (`.sidebar`)**
  * Vị trí: Cột cố định ngoài cùng bên trái.
  * Trạng thái: Hover đổi màu logo icon, click đổi class `.active`.
  * Trigger: Chuyển đổi các View chính (Download, Settings, Subtitle, Music...).

* **Video Preview Panel (`#video-preview`)**
  * Vị trí: Khu vực rộng nhất chính giữa phía trên.
  * Elements: `.preview-canvas` hiển thị video, `.preview-sidebar` chứa các nút zoom, split.
  * States: "Chưa có video" hiển thị dòng chữ nghiêng mờ.

* **Timeline (`.multi-track-timeline`)**
  * Vị trí: Cạnh dưới của preview panel.
  * Cấu trúc: Ruler hiển thị thời gian, `.tracks-container` chứa các track Audio, Video, Subtitle.
  * Màu sắc track: Subtitle (Xanh lá), Voice (Tím), Music (Nâu), Video (Xanh dương).

* **Modal Overlay (`.modal-overlay`)**
  * Vị trí: Cấp cao nhất (`z-index: 10000`).
  * Danh sách Modal: `#download-modal`, `#settings-modal`.
  * Animation: `opacity` chuyển từ 0 sang 1, `transform: translateY(0)`.

### 3. Navigation Flow
Toàn bộ là **Single Page Application** không load lại trang.
* Cấu trúc Router ẩn trong JS: Click vào các thẻ `nav-item` có thuộc tính `data-tab`.
* Luồng di chuyển: 
  * Bấm `<li data-tab="subtitle">` → Chuyển Active sang Subtitle, kích hoạt click vào tab điều khiển tương ứng bên dưới (`#processing-tabs`).
  * Bấm `<li data-tab="download">` → Kích hoạt mở Popup Overlay `#download-modal`.

### 4. Danh sách UI Events
* `btn-start-download`: Gắn vào nút Bắt đầu tải. Đọc url, quality, proxy và gọi API `/download/`. Hiển thị thanh tiến trình giả lập chờ hoàn thành.
* `btn-enhance-apply`: Đọc toàn bộ giá trị slider và checkbox ở Tab Enhance, gửi JSON xuống backend, tạo thêm hàng vào danh sách Task Queue.
* `close-modal`: Gắn vào icon 'X'. Tìm element cha gần nhất là `.modal-overlay` và gỡ bỏ class `show`.

### 5. Responsive & Platform
* Giao diện được thiết kế chủ yếu cho **Desktop (Windows/macOS)**.
* Layout Fix Cứng: Do tính chất phần mềm editor, layout sử dụng Flexbox cố định kích thước các Sidebar (Vd: `width: 250px`), panel giữa tự động giãn (`flex: 1`).
* Không có Breakpoint cụ thể cho Mobile do ứng dụng không hướng tới trải nghiệm chỉnh sửa video phức tạp trên màn hình di động.
