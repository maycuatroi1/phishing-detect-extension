# phishing-detect-extension

Chrome MV3 extension cảnh báo trang lừa đảo cho người dùng Việt Nam. Client của
`https://anti-fraud.omelet.tech`.

Trạng thái hiện tại: bộ khung. Repo build ra một extension nạp được, nhưng chưa có tier phát hiện
nào được bật và manifest chưa xin quyền nào.

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
pnpm --filter extension check:no-secrets
pnpm --filter extension lint:no-blocking
pnpm --filter extension typecheck
pnpm --filter extension test
```

## Giấy phép

UNLICENSED.
