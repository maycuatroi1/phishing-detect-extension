# phishing-detect-extension

Chrome MV3 extension cảnh báo trang lừa đảo cho người dùng Việt Nam. Client của
`https://anti-fraud.omelet.tech`.

Trạng thái hiện tại: tier 0, tier 1 và tier 2 đã chạy.

- **Tier 0** tải một artifact blocklist nhị phân về máy, lưu vào IndexedDB, làm mới mỗi ngày một lần,
  rồi tra bằng tìm nhị phân hoàn toàn cục bộ. Không một byte nào rời khỏi máy.
- **Tier 1** chỉ mở ra cho host không có trong artifact. Nó hỏi server đúng 20 bit đầu của
  `SHA256(host)`, không gắn auth, rồi so hash đầy đủ ngay trong extension.
- **Tier 2** gửi URL đầy đủ và tiêu một lượt LLM, nên nó **chỉ chạy khi bạn bấm nút trong popup**.
  Không bao giờ tự chạy lúc điều hướng hay chạy nền. Hạn mức là 20 lần một bản cài; hết lượt thì
  popup hiện mốc mở lại do server trả về và extension dừng hẳn, không thử lại.

Lưu ý về production: artifact hiện đang **rỗng** vì cả corpus còn ở trạng thái `pending`. Dự đoán của
model không phải nhãn; nhãn chỉ sinh ra qua moderation console. Artifact rỗng là câu trả lời hợp lệ,
không phải lỗi, và extension xử lý đúng như vậy.

## Repo này public, bundle này public

Không secret nào được vào đây. Chỉ biến môi trường có tiền tố `PUBLIC_` mới được phép vào bundle, và
`pnpm --filter extension build` sẽ fail nếu bắt được biến nào khác hoặc một pattern secret đã biết
trong `dist/`. Chi tiết đầy đủ trong `AGENTS.md`.

## Bắt đầu

```sh
./init.sh          # POSIX, Git Bash trên Windows cũng chạy được
```

```powershell
.\init.ps1         # Windows PowerShell
```

Rồi nạp thư mục `dist/` qua `chrome://extensions` với Developer mode và "Load unpacked".

## Lệnh

```sh
pnpm --filter extension build
pnpm --filter extension check:vendor
pnpm --filter extension check:no-secrets
pnpm --filter extension lint:no-blocking
pnpm --filter extension typecheck
pnpm --filter extension test
pnpm --filter extension test:contract
pnpm --filter extension test:kanon
```

## Quyền

`alarms` để làm mới danh sách mỗi ngày, `tabs` để lấy host của tab đang mở, và host permission cho
đúng một origin `https://anti-fraud.omelet.tech`. Không content script, không đọc nội dung trang.
Tier 1 và tier 2 không thêm quyền nào: install token của tier 2 nằm trong IndexedDB, thứ không đòi
quyền `storage`. Lý do từng quyền nằm trong `AGENTS.md`.

## Giấy phép

UNLICENSED.
