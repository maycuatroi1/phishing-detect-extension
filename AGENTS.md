# AGENTS.md

## Repo này là gì

`phishing-detect-extension` là client Chrome MV3 của cụm `phishing-detect`. Nó tiêu thụ API công
khai của `phishing-detect-web`, đang chạy production tại `https://anti-fraud.omelet.tech`.

Repo này **public**. Bundle sinh ra cũng **public**: bất kỳ ai cài extension đều đọc được toàn bộ
file trong `dist/`, và bất kỳ ai clone repo đều đọc được toàn bộ lịch sử git. Hai điều đó dẫn tới
đúng một luật, và nó là luật quan trọng nhất ở đây.

## Luật số một: không secret nào được vào repo này

Không API key, không client secret, không token, không chuỗi kết nối database, không private key.
Không trong source, không trong `.env.example`, không trong test fixture, không trong commit message,
không trong ảnh chụp màn hình dán vào issue.

Đây không phải lời khuyên vệ sinh. Một khoá lọt vào bundle là một khoá đã bị công bố kể từ lần
publish đầu tiên, và xoá commit không thu hồi được nó. Thứ duy nhất chữa được là rotate khoá.

Nếu một tính năng cần secret thì tính năng đó không thuộc về extension. Nó thuộc về
`phishing-detect-web`, và extension gọi tới một endpoint. Đó là lý do tier 2 và tier 3 dùng install
token do server cấp qua `POST /v1/install` chứ không dùng khoá model.

## Quy ước PUBLIC_

Chỉ biến môi trường có tiền tố `PUBLIC_` mới được phép vào bundle.

Tiền tố không phải trang trí, nó được cưỡng chế ở hai chỗ:

1. `vite.config.ts` đặt `envPrefix: ["PUBLIC_"]`. Vite chỉ thay thế `import.meta.env.PUBLIC_*` vào
   code client. Mọi `import.meta.env.X` khác bị thay bằng `undefined`, nên nó không lọt vào bundle
   một cách vô tình được.
2. Post-check sau build quét lại `dist/` và fail nếu bắt được bất kỳ biến nào ngoài tiền tố đó.

Đọc `PUBLIC_` là "giá trị này tôi chấp nhận in lên tường". Origin của API là ví dụ đúng: nó công
khai từ bản chất, mọi request đều tiết lộ nó. Một khoá là ví dụ sai, dù nó chỉ là khoá "dev".

Biến duy nhất hiện có nằm trong `.env.example`:

```
PUBLIC_API_BASE_URL=https://anti-fraud.omelet.tech
```

## Post-check sau build

`pnpm --filter extension build` chạy `vite build` rồi `tsx scripts/check-no-secrets.ts`. Build chỉ
thoát 0 khi cả hai vế thoát 0. Không có script build nào bỏ qua post-check, và đừng thêm.

Post-check quét mọi file văn bản trong `dist/`, bỏ qua file nhị phân, và áp bốn luật:

- `env-var-name`: tên của một biến môi trường không có tiền tố `PUBLIC_` xuất hiện nguyên văn trong
  output. Nguồn tên là `process.env` lúc build cộng mọi file `.env*` ở gốc repo.
- `env-var-value`: giá trị của một biến như vậy xuất hiện trong output. Giá trị không bao giờ được
  in ra, chỉ in tên biến, chunk và offset.
- `env-var-reference`: output còn sót `process.env.X` hoặc `import.meta.env.X` với `X` ngoài tiền tố
  `PUBLIC_`, tức là bundle định đọc biến môi trường lúc chạy.
- `secret-pattern`: tám pattern trong `scripts/secret-patterns.ts`, gồm khoá kiểu OpenAI `sk-`,
  khoá Google `AIza`, client secret Google `GOCSPX-`, token Cloudflare `cfat`, secret key Turnstile
  `0x4AAAAAA`, chuỗi `postgres://` có mật khẩu, private key PEM, và JWT.

Mỗi phát hiện in ra **tên biến** (hoặc id pattern) và **tên chunk** chứa nó, rồi build thoát 1.

Hai ngưỡng chống báo động giả, ghi ở đây vì chúng là chỗ dễ nới lỏng sai: giá trị lấy từ file `.env`
phải dài từ 8 ký tự, giá trị lấy từ `process.env` phải dài từ 16 ký tự, và giá trị trông như đường
dẫn hệ thống hoặc như biến `PATH` thì bị bỏ qua. Danh sách tên biến hệ điều hành được miễn nằm trong
`NOISE_ENV_NAMES`. Thêm tên vào danh sách đó là mở một lỗ hổng, nên chỉ thêm tên nào chắc chắn vô
hại, và không bao giờ thêm tên có chữ KEY, TOKEN, SECRET hay PASSWORD.

Chạy riêng post-check trên `dist/` đang có:

```sh
pnpm --filter extension check:no-secrets
```

## Diễn tập rò rỉ

Cách tự tay chứng minh post-check còn sống, không cần bất kỳ secret thật nào:

1. Thêm vào `.env` một dòng vô hại: `FAKE_NOT_A_REAL_SECRET_00000=FAKE_NOT_A_REAL_SECRET_00000_VALUE_NOT_USED`
2. Nhét chuỗi giá trị đó vào một file trong `src/`, ví dụ thêm nó làm tham số cuối của
   `console.info` trong `src/background/index.ts`.
3. `pnpm --filter extension build`. Build phải thoát 1 và in `biến=FAKE_NOT_A_REAL_SECRET_00000
   chunk=background.js`.
4. Gỡ cả hai thay đổi ra rồi build lại cho xanh.

Đừng để lại biến giả trong repo và đừng bao giờ dùng giá trị thật cho bài diễn tập này.

## Extension chỉ cảnh báo, không chặn

`pnpm --filter extension lint:no-blocking` cấm manifest xin `webRequestBlocking` hoặc
`declarativeNetRequestWithHostAccess`, cấm khai báo `declarative_net_request`, và cấm một file vừa
nghe `chrome.webNavigation` vừa gọi `chrome.tabs.update`.

Lý do: một false positive mà chặn được điều hướng là chặn ngân hàng thật của người dùng. Cảnh báo
sai làm người ta bực; chặn sai làm người ta gỡ extension và không tin cả dự án nữa. Xem
`principles/invariants.md#no-blocking` ở harness root.

## Quyền trong manifest

`public/manifest.json` hiện **không xin quyền nào**: không `permissions`, không `host_permissions`,
không content script. Đúng như vậy vì chưa có tier phát hiện nào được viết.

Luật khi thêm quyền: mỗi quyền vào manifest cùng lúc với tính năng dùng nó, không sớm hơn, và
commit thêm quyền phải nói rõ tính năng nào cần và tại sao không làm được nếu thiếu. Chrome Web
Store review theo quyền, và một quyền xin trước khi có tính năng là một quyền không giải thích được.

Bốn tier sẽ tới ở các bước sau của plan `anti-fraud-he-thong-song`:

- Tier 0 `GET /v1/blocklist`, tra cục bộ, không chạm mạng khi duyệt web.
- Tier 1 `GET /v1/lookup`, k-anonymity trên 20 bit đầu của `SHA256(host)`, không gắn auth.
- Tier 2 `POST /v1/scan` cộng `GET /v1/scan/{scan_id}`, chỉ chạy khi người dùng bấm.
- Tier 3 `POST /v1/report`, khai báo của người dùng, không bao giờ là nhãn.

`POST /v1/install` cấp install token cho tier 2 và tier 3, không thuộc tier nào.

## Hợp đồng API

Hợp đồng thật nằm ở `openapi/public.yaml` và `schemas/verdict.schema.json` trong
`phishing-detect-web`. Repo này **chưa vendor** chúng. Bước tier 0 mới vendor kèm check băm, và từ
lúc đó bản vendor là thứ code theo, không phải trí nhớ.

Origin production không được hardcode rải rác. Nó là mặc định duy nhất trong `src/config.ts` và bị
`PUBLIC_API_BASE_URL` ghi đè. Nguồn sự thật về nơi service chạy là `deployments.yaml` ở harness root.

## Chạy thế nào

```sh
./init.sh
```

```powershell
.\init.ps1
```

Hai script tương đương: kiểm tra node và pnpm, copy `.env.example` sang `.env` nếu chưa có,
`pnpm install`, rồi build một lần cho chắc. Chạy lần hai không nổ và không ghi đè `.env` đang có.

Sau khi init:

```sh
pnpm --filter extension build             # vite build cộng post-check chặn secret
pnpm --filter extension check:no-secrets  # chỉ chạy post-check trên dist/ hiện có
pnpm --filter extension lint:no-blocking  # manifest và source không được chặn điều hướng
pnpm --filter extension typecheck         # tsc --noEmit
pnpm --filter extension test              # vitest
```

Repo đứng một mình nhưng vẫn có `pnpm-workspace.yaml` với `packages: [.]` và `name: "extension"`
trong `package.json`, để lệnh `pnpm --filter extension ...` mà plan và CI viết chạy đúng nguyên văn
ở đây cũng như khi repo được mount vào một workspace lớn hơn.

## Nạp thử trong Chrome

`chrome://extensions` bật Developer mode, "Load unpacked", trỏ vào `dist/`. Không phải gốc repo:
`manifest.json` nằm trong `public/` và chỉ trở thành gốc extension sau khi build copy nó ra `dist/`.

## Bố cục

```
public/manifest.json      manifest MV3, copy nguyên trạng vào dist/
public/icons/             icon 16, 48, 128
src/config.ts             origin API, đọc PUBLIC_API_BASE_URL
src/background/index.ts   service worker MV3
src/popup/                popup action
scripts/check-no-secrets.ts   post-check sau build
scripts/secret-patterns.ts    tám pattern secret, có test riêng
scripts/lint-no-blocking.ts   cưỡng chế invariant no-blocking
tests/                    vitest
```
