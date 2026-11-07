<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="app/assets/logo-dark.png">
    <img src="app/assets/logo.png" alt="Synto" width="186">
  </picture>
</p>

# Synto

Ghi chú trên mặt giấy vô tận, phong cách vẽ tay giống Excalidraw, dành cho mọi người:
công thức toán, ký hiệu, nét vẽ có bắt điểm, 63 hình phẳng, ảnh và PDF ngay trên canvas.
Chữ dùng **Patrick Hand** (viết tay) và **Arial**, cả hai đủ dấu tiếng Việt.

Bản desktop là một file `Synto.exe` (~4 MB) chạy hoàn toàn offline trên Windows 10/11.

## Chạy

```
dist\Synto.exe
```

Cần Microsoft Edge WebView2 Runtime (có sẵn trên Windows 11; Windows 10 thường đã có qua Edge).
Nếu thiếu, app sẽ đưa link tải của Microsoft.

Dữ liệu tự lưu tại `%LOCALAPPDATA%\Synto` (mỗi thay đổi, sau ~0,4 giây). Lưu ra file
`.synto` bằng Ctrl+S để mang sang máy khác.

## Build

Không cần cài Node, Rust hay Visual Studio. Chỉ cần PowerShell và .NET Framework 4.8 (có sẵn trong Windows).

```
powershell -ExecutionPolicy Bypass -File build.ps1
```

Script sẽ:
1. Tải thư viện bên thứ ba với phiên bản ghim cứng và kiểm tra SHA-256 (`scripts/fetch-deps.ps1`).
2. Tạo icon từ logo (`scripts/make-icon.ps1`, dùng bộ giải mã WebP có sẵn của Windows).
3. Nén thư mục `app/` và biên dịch `host/Program.cs` bằng `csc.exe` của .NET Framework thành `dist/Synto.exe`.

## Phát triển

Chạy app trong trình duyệt (không cần build lại):

```
powershell -ExecutionPolicy Bypass -File scripts\serve.ps1
```

Rồi mở `http://localhost:5173/app/`. Unit test: `http://localhost:5173/tests/`.

Chạy exe đọc thẳng mã nguồn (có DevTools, F12):

```
dist\Synto.exe --dev app
```

Smoke test giao diện trong exe, dùng hồ sơ dữ liệu riêng để không đụng vào ghi chú thật:

```
dist\Synto.exe --dev app --script tests\e2e-smoke.js --data build\test-profile
```

## Cấu trúc

```
app/                 Ứng dụng web (HTML/CSS/JS thuần, ES modules, không cần bundler)
  src/main.js        Khởi động, nối sự kiện DOM
  src/app.js         Bộ điều khiển: công cụ, chuột/bút/cảm ứng, clipboard, file, lưu tự động
  src/ui.js          Thanh công cụ, bảng thuộc tính, thư viện hình, ký hiệu, khung công thức
  src/renderer.js    Vẽ canvas (roughjs cho nét phác tay, perfect-freehand cho bút)
  src/elements.js    Mô hình phần tử (bất biến), hit test, kiểm tra dữ liệu nhập
  src/shapelib.js    63 hình phẳng (đường SVG trong hộp 24×24) + đa giác/sao có tham số
  src/snapping.js    Bắt điểm: đỉnh, trung điểm, tâm, giao điểm, vuông góc, trên cạnh
  src/transform.js   Co giãn / xoay / sửa điểm
  src/svgpath.js     Đọc, biến đổi, làm phẳng đường SVG
  src/mathrender.js  KaTeX dàn trang → tự vẽ lên canvas (xuất PNG không bị chặn)
  src/pdfdoc.js      pdf.js: đọc trang, vẽ trang theo nhu cầu, cache LRU
  src/textinput.js   Tự thay ký hiệu khi gõ, \tên ký hiệu, cú pháp "gõ nhanh" → LaTeX
  src/storage.js     IndexedDB, định dạng .synto, cầu nối với exe
  vendor/            Thư viện bên thứ ba (tải bằng fetch-deps, không commit)
host/Program.cs      Cửa sổ WinForms + WebView2, hộp thoại lưu/mở, lưu trước khi đóng
tests/               Unit test chạy trong trình duyệt + smoke test cho exe
scripts/             fetch-deps, make-icon, serve
brand/               Logo gốc
```

## Ghi chú thiết kế

- **Font tiếng Việt**: Excalifont thiếu Ơ/Ư và toàn bộ chữ có dấu thanh (U+1EA0–1EF9), nên trình duyệt
  phải mượn chữ từ font khác. Synto chỉ dùng Patrick Hand và Arial (dự phòng: Arimo cùng kích thước),
  và chuẩn hoá mọi chữ nhập/dán về Unicode dựng sẵn (NFC) để dấu không bị tách rời.
- **Phần tử bất biến**: mỗi thay đổi tạo object mới, nên undo/redo chỉ là mảng tham chiếu và cache vẽ
  theo object.
- **Dữ liệu ngoài luôn được kiểm tra**: file `.synto`, clipboard và bản lưu tự động đi qua
  `sanitizeElement` (giới hạn số, màu, kiểu, độ dài). Ảnh/PDF được nhận diện theo nội dung file,
  không theo đuôi.
- **Giao diện luôn sáng**: `color-scheme: only light` (chặn cả chế độ tự làm tối của Chromium) và WebView2
  `PreferredColorScheme = Light`. Logo trong app vì thế luôn là bản đen. Những nơi nền do Windows quyết định
  thì logo đổi theo: taskbar/Alt+Tab dùng bản trắng khi Windows ở chế độ tối (tự cập nhật khi đổi theme),
  icon file exe có viền trắng mảnh để rõ trên cả Explorer sáng và tối, icon tab của bản web theo
  `prefers-color-scheme`. Các biến thể sinh từ `brand/synto-logo.webp` bằng `scripts/make-icon.ps1`.
- **Bảo mật exe**: chỉ cho phép trang nội bộ `https://synto.app/`, chặn cửa sổ mới, tải xuống và mọi
  quyền (camera, vị trí…). CSP chặn script ngoài.

## Giới hạn hiện tại

- Chưa có: nhóm phần tử (Ctrl+G), cắt ảnh, cộng tác thời gian thực, mở file bằng cách bấm đúp trong Explorer.
- Bản exe chỉ chạy trên Windows. Bản web (`app/`) chạy trên mọi trình duyệt hiện đại.
- PDF có mật khẩu chưa hỗ trợ.

## Giấy phép

Mã nguồn Synto: chưa chọn giấy phép. Thư viện bên thứ ba: xem [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
