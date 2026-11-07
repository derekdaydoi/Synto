<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="app/assets/logo-dark.png">
    <img src="app/assets/logo.png" alt="Synto" width="300">
  </picture>
</p>

<p align="center">
  Ghi chú trên mặt giấy vô tận, nét vẽ tay kiểu Excalidraw, dành cho mọi người:<br>
  công thức toán, ký hiệu, nét vẽ có bắt điểm, 63 hình phẳng, ảnh và PDF ngay trên canvas.
</p>

<p align="center">
  <a href="https://derekdaydoi.github.io/Synto/download/Synto.exe">
    <img src="https://img.shields.io/badge/T%E1%BA%A3i%20v%E1%BB%81-Windows%2010%20%2F%2011-111111?style=for-the-badge&logo=windows&logoColor=white" alt="Tải về cho Windows" height="48">
  </a>
  &nbsp;
  <a href="https://derekdaydoi.github.io/Synto/">
    <img src="https://img.shields.io/badge/D%C3%B9ng%20b%E1%BA%A3n%20web-Tr%C3%ACnh%20duy%E1%BB%87t-ffffff?style=for-the-badge&logo=googlechrome&logoColor=111111&labelColor=ffffff&color=eeeeee" alt="Dùng bản web" height="48">
  </a>
</p>

<p align="center"><sub>Synto.exe · 64-bit / ARM64 · khoảng 4 MB · chạy offline, không cần tài khoản</sub></p>

---

## Ảnh demo

<sub>Trang mẫu do bài smoke test tự dựng (<code>tests/e2e-smoke.js</code>).</sub>

![Synto](docs/screenshots/editor.png)

## Tính năng

- **Mặt giấy vô tận**: kéo, thu phóng (Ctrl + lăn chuột, hai ngón tay), lưới chấm bật/tắt.
- **63 hình phẳng** trong 7 nhóm (cơ bản, tam giác · tứ giác, đa giác · sao, mũi tên, sơ đồ, chú thích, toán · hình học); đa giác đều và ngôi sao chỉnh được số cạnh, số cánh. Nét phác tay hoặc mượt, tô gạch, chéo hoặc đặc.
- **Nét vẽ**: đoạn thẳng, gấp khúc, đường cong, cung qua 3 điểm, mũi tên, bút tự do, bút dạ quang.
- **Bắt điểm tự động**: đỉnh, trung điểm, tâm, giao điểm, chân đường vuông góc, điểm trên cạnh. Giữ Alt để tạm tắt, Shift để khoá góc 15°.
- **Sơ đồ tư duy** kiểu XMind: chủ đề là hộp có chữ (có viền hoặc không viền), nối bằng đường gắn vào hộp, kéo hộp thì đường đi theo, mỗi đầu đường chọn được mũi tên. Chọn một chủ đề: **Tab** thêm nhánh con, **Space** (nhấn nhả) hoặc **Enter** thêm nhánh ngang hàng, **F2** sửa chữ. Chữ cũng đặt được vào trong mọi hình học (bấm đúp vào hình).
- **Chữ**: Patrick Hand (viết tay) và Arial, đủ dấu tiếng Việt. Gõ `>=` thành ≥, `\delta` rồi dấu cách thành δ.
- **Công thức** KaTeX với chế độ gõ nhanh (`sqrt(x)`, `a/b`, `+-`) hoặc LaTeX, kèm bảng ký hiệu.
- **Ảnh và PDF** trên canvas: kéo thả, dán hoặc mở file. PDF thu phóng, cuộn trong khung, vẽ chú thích lên trang.
- **Tẩy** kiểu Excalidraw, chỉnh được cỡ. **Bút laser** để trình bày.
- **Dữ liệu của bạn**: tự lưu trên máy, lưu ra file `.synto` (Ctrl+S), **Xuất PDF** (nút góc phải, Ctrl+P) hoặc ảnh PNG.

## Cài đặt

1. Bấm **Tải về** ở trên để tải `Synto.exe`.
2. Chạy file. Synto hỏi có cài vào máy không: chọn **Yes** để chép vào thư mục chương trình và tạo lối tắt **Synto** trên Desktop và Start Menu; chọn **No** để chạy luôn mà không cài.

File chưa ký số nên Windows SmartScreen có thể cảnh báo: chọn **More info → Run anyway**.

Cần Microsoft Edge WebView2 Runtime (có sẵn trên Windows 11; Windows 10 thường đã có qua Edge). Nếu thiếu, app sẽ đưa link tải của Microsoft.

Ghi chú tự lưu trên máy tại `%LOCALAPPDATA%\Synto`. Lưu ra file `.synto` bằng Ctrl+S để mang sang máy khác. Tải bản mới rồi chạy là cập nhật, ghi chú giữ nguyên.

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

Đẩy bản web lên GitHub Pages (nhánh `gh-pages`):

```
powershell -ExecutionPolicy Bypass -File scripts\deploy-pages.ps1
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

© derekdaydoi
