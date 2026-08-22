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
- `secret-pattern`: chín pattern trong `scripts/secret-patterns.ts`, gồm khoá kiểu OpenAI `sk-`,
  khoá Google `AIza`, client secret Google `GOCSPX-`, token Cloudflare `cfat`, secret key Turnstile
  `0x4AAAAAA`, chuỗi `postgres://` có mật khẩu, private key PEM, JWT, và install token `aft1_` của
  chính API này.

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

Luật khi thêm quyền: mỗi quyền vào manifest cùng lúc với tính năng dùng nó, không sớm hơn, và
commit thêm quyền phải nói rõ tính năng nào cần và tại sao không làm được nếu thiếu. Chrome Web
Store review theo quyền, và một quyền xin trước khi có tính năng là một quyền không giải thích được.

Tier 0 là tính năng đầu tiên, nên nó là lô quyền đầu tiên. Ba quyền, mỗi quyền một lý do:

- `alarms`. Artifact blocklist được cập nhật mỗi ngày một lần bằng `chrome.alarms`. Service worker
  MV3 bị Chrome giết sau vài chục giây rảnh, nên `setInterval` không sống nổi tới lần chạy sau.
  `chrome.alarms` là API duy nhất trong MV3 đánh thức được service worker theo lịch. Không có nó thì
  artifact chỉ được làm mới khi trình duyệt khởi động lại, tức là có máy giữ danh sách cũ hàng tuần.
- `tabs`. Để tra một trang, extension cần **host** của trang đó. Không có `tabs` thì trường `url`
  trong `chrome.tabs.Tab` và trong `changeInfo` của `chrome.tabs.onUpdated` bị Chrome trả về
  `undefined`, nên không có gì để băm. `activeTab` không thay được vì nó chỉ mở ra sau một cú bấm của
  người dùng, mà tier 0 phải cảnh báo lúc trang vừa mở chứ không phải lúc người ta đã kịp nhập mật
  khẩu. `webNavigation` cũng thay được về mặt kỹ thuật nhưng nó rộng hơn: nó phát mọi sự kiện điều
  hướng của mọi frame. Extension chỉ cần URL của tab, nên xin đúng phần đó.
- `host_permissions: https://anti-fraud.omelet.tech/*`. `GET /v1/blocklist` không trả header CORS,
  nên fetch từ service worker sang origin đó bị chặn nếu origin không nằm trong `host_permissions`.
  Đây là một origin duy nhất, không phải `<all_urls>`, và nó chỉ dùng cho một request: tải artifact.
  Nếu ghi đè `PUBLIC_API_BASE_URL` sang origin khác thì phải sửa `host_permissions` cho khớp, nếu
  không fetch sẽ chết ngay khi chạy.

Ba thứ **cố ý vẫn không xin**: không content script, không `storage` (IndexedDB không cần quyền),
không `<all_urls>`. Extension không bao giờ đọc nội dung trang ở tier 0; nó chỉ băm host.

Tier 1 **không thêm quyền nào**. `GET /v1/lookup` nằm trên đúng origin đã có trong
`host_permissions`, và nó cũng không trả header CORS nên `host_permissions` là thứ khiến fetch chạy
được, y như `/v1/blocklist`.

Tier 2 **cũng không thêm quyền nào**, và đó là một lựa chọn có chủ ý chứ không phải may mắn. Ba thứ
tier 2 cần đều đã có sẵn:

- URL đầy đủ của tab đang mở. `chrome.tabs.query({active: true, currentWindow: true})` trong popup
  đọc được nó bằng đúng quyền `tabs` mà tier 0 đã xin. Không cần `activeTab`, không cần content
  script, và popup vẫn chỉ đọc `tab.url` chứ không bao giờ đọc nội dung trang.
- Fetch tới `/v1/install`, `/v1/scan` và `/v1/scan/{scan_id}`. Cả ba nằm trên đúng origin đã có
  trong `host_permissions`.
- Chỗ lưu install token. Nó nằm trong **IndexedDB**, database riêng `anti-fraud-install`, và
  IndexedDB **không cần quyền nào** trong MV3. `chrome.storage.local` cũng lưu được nhưng nó đòi
  quyền `storage`, tức là một dòng quyền mới trong bản review của Chrome Web Store để đổi lấy đúng
  một bản ghi. Không đáng.

Lô quyền tiếp theo chỉ mở ra khi tier 3 cần, không sớm hơn.

Bốn tier của plan `anti-fraud-he-thong-song`:

- Tier 0 `GET /v1/blocklist`, tra cục bộ, không chạm mạng khi duyệt web. **Đã có.**
- Tier 1 `GET /v1/lookup`, k-anonymity trên 20 bit đầu của `SHA256(host)`, không gắn auth. **Đã có.**
- Tier 2 `POST /v1/scan` cộng `GET /v1/scan/{scan_id}`, chỉ chạy khi người dùng bấm. **Đã có.**
- Tier 3 `POST /v1/report`, khai báo của người dùng, không bao giờ là nhãn.

`POST /v1/install` cấp install token cho tier 2 và tier 3, không thuộc tier nào.

## Tier 0

Tier 0 tải một artifact nhị phân về máy rồi tra hoàn toàn cục bộ. Duyệt web **không phát ra request
nào**. Đó là toàn bộ lý do extension này qua được review, nên đừng đổi nó thành một lần gọi mạng cho
tiện.

Đường đi:

1. `chrome.alarms` đánh thức service worker mỗi 1440 phút, cộng một lần lúc `onInstalled` và một lần
   lúc `onStartup`.
2. `syncBlocklist` gọi `GET /v1/blocklist?format=1&since=<version đang giữ>`. Tên tham số là
   **`since`**, không phải `have`; `have` bị server bỏ qua và trả về nguyên artifact.
3. 304 nghĩa là byte không đổi: giữ nguyên entry, chỉ làm mới `etag`, `pinnedUrl` và `fetchedAt`.
4. 200 thì decode 18 byte header, so `x-blocklist-format` và `x-blocklist-version` với byte 4 và
   byte 6. Lệch là từ chối.
5. Ghi vào IndexedDB `anti-fraud-blocklist`, object store `artifact`, đúng một bản ghi khoá
   `current`, entry là hai `BigUint64Array` đã sắp xếp.
6. `chrome.tabs.onUpdated` và `onActivated` lấy URL, `hostOfUrl` rút host, `hostEntryOf` băm
   SHA-256 rồi lấy 16 ký tự hex đầu thành uint64, `afblContains` tìm nhị phân, `paintBadge` sơn badge
   theo tab.

### Artifact hỏng thì giữ bản cũ

Đây là chữ trong plan và có test cho cả ba đường trong `tests/contract/blocklist-refuse.test.ts`:

- Từ chối và **giữ bản cũ**: bản ghi trong IndexedDB không đổi một byte, kể cả `fetchedAt`.
- **Không fail open**: sau khi từ chối, host lừa đảo trong bản cũ vẫn ra `phishing`. Coi như sạch là
  cách tệ nhất để hỏng.
- **Không fail closed**: sau khi từ chối, host lạ vẫn ra `unknown`. Cảnh báo tất cả cũng là hỏng, chỉ
  hỏng theo hướng làm người dùng gỡ extension.

Sáu mã từ chối: `too_short`, `bad_magic`, `unsupported_format`, `truncated_body`, `trailing_bytes`,
`unsorted_entries`. Mạng chết hoặc HTTP 4xx/5xx cũng là giữ bản cũ, không phải xoá bản cũ.

Artifact **rỗng** (đúng 18 byte, 0 entry) là một câu trả lời hợp lệ chứ không phải lỗi, và decoder
phải chịu được nó. Production từng trả đúng thế khi cả corpus còn `pending`: dự đoán của model không
phải nhãn, nhãn chỉ sinh ra qua moderation console. Từ 22/08/2026 artifact production **đã có dữ
liệu thật**: 19594 byte, 1406 entry phish và 1041 entry legit.

### Version là số thứ tự thay đổi nội dung, không phải đồng hồ

Từ commit `7d22fe4` của `phishing-detect-web`, version của artifact **derive từ byte của artifact**,
không derive từ timestamp của corpus. Vẫn là uint32 tăng dần ở byte 6, layout không đổi một byte.

Hai điều client phải tôn trọng:

- Chỉ được so **mới hơn hoặc bằng**. Không được suy ra thời điểm dựng, không được tính tuổi artifact
  từ version. Muốn biết bản đang giữ cũ bao lâu thì đọc `fetchedAt`, là đồng hồ của máy người dùng.
- Corpus quay về nội dung cũ sẽ nhận **version mới cao hơn**, không quay lại version cũ. Client phải
  nhận bản đó chứ không được đòi version cũ.

`tests/contract/blocklist-version.test.ts` khoá cả hai lại, và nó có một vế quét toàn bộ `src/`: bất
kỳ dòng nào vừa nhắc `version` vừa có `new Date(`, `Date.now()`, `Date.parse(`, `toISOString(`,
`getTime()`, `* 1000` hay `/ 1000` đều làm test đỏ kèm tên file và số dòng. Nếu bạn đang đọc dòng này
vì test đó vừa đỏ: version không phải timestamp, đừng sửa test.

## Tier 1

Tier 1 chỉ chạy khi tier 0 nói `unknown` hoặc `no_artifact`, tức host không có trong artifact cục bộ.
Nó hỏi server đúng **20 bit đầu** của `SHA256(host)` và tự so hash đầy đủ ở máy mình.

Đây là mức 2 trong ba mức privacy, và là cách Safe Browsing v4 cùng Have I Been Pwned làm. Mức 3,
gửi full URL mọi lần, là tự dựng một máy ghi lịch sử duyệt web rồi phải bảo vệ nó. Full URL chỉ rời
khỏi máy khi người dùng bấm, và đó là tier 2.

Đường đi:

1. `hostSha256Hex(host)` cho 64 ký tự hex, `prefixOfHashHex` lấy **5 ký tự đầu**. `lookup_prefix_bits`
   bên server là 20, và 20 bit đúng bằng 5 ký tự hex.
2. `createLookupBatcher` xếp prefix vào hàng đợi, gộp **tối đa 16 prefix một request**, và chỉ bắn đi
   sau một khoảng trễ có jitter.
3. `GET /v1/lookup?p=<prefix>&p=<prefix>...`. Tên tham số là **`p`**, lặp lại một lần cho mỗi host.
4. Server trả **cả bucket**: mọi entry của corpus rơi vào 20 bit đó, mỗi entry là một hash đầy đủ 64
   ký tự.
5. `matchFullHash` so hash đầy đủ **trong extension**. Server không bao giờ biết host nào trong bucket
   là host client quan tâm.

### Không gắn install token, và đó là chủ ý

Request tier 1 đi ra với `credentials: "omit"`, `referrerPolicy: "no-referrer"` và **không một header
nào** do client tự đặt. Không `Authorization`, không cookie, không install token dưới bất kỳ hình
thức nào.

Lý do không phải là lười. Một token nối luồng prefix về một danh tính duy nhất và phá đúng tính chất
mà endpoint này tồn tại để giữ: gộp 2447 host thật vào 2^20 bucket chỉ có nghĩa khi không ai biết
chuỗi prefix nào là của cùng một máy. Gắn token vào là biến k-anonymity thành một cuốn nhật ký duyệt
web có tên người.

Rủi ro tương ứng ở phía server, ghi ở đây để đừng ai vô tình dựng lại nó: **một dòng log gộp prefix
với IP xoá sạch tính chất k-anonymity mà endpoint vẫn chạy bình thường nên không ai nhận ra.** Spec
vendor cấm thẳng điều đó và production đáp lại bằng header
`x-lookup-anonymity: k-anonymity; no authentication; client identifiers not logged`.

Client giữ phần của mình bằng ba thứ: không danh tính, gộp lô nên một request không tương ứng một lần
điều hướng, và jitter nên thời điểm request không trỏ về thời điểm mở trang.

### Jitter phải tiêm được từ ngoài

`createLookupBatcher` nhận `random: () => number` làm tham số bắt buộc, và `jitterDelayMs` là hàm
thuần. Không file nào trong `src/lib/lookup*.ts` hay `src/lib/tier1.ts` được gọi `Math.random()`;
`tests/kanon/batching-jitter.test.ts` khoá lại bằng cách cho `Math.random` nổ tung rồi bắt đường tier
1 vẫn phải chạy. Chỗ duy nhất nối vào nguồn ngẫu nhiên thật là `src/background/tier1.ts`.

Trễ nằm trong `[200ms, 1000ms]`. Hàng đợi đầy 16 prefix thì bắn ngay, vì giữ thêm chỉ làm người dùng
chờ chứ không thêm được gì cho privacy.

### Bốn câu trả lời của tier 1, và chúng không được gộp

- `phishing`, `legit`: hash đầy đủ khớp một entry trong bucket, `c === 1` nghĩa là đã xác nhận.
- `unknown`: corpus **có** host này nhưng chưa quyết định. Đây là một câu trả lời thật.
- `absent`: bucket không chứa hash đầy đủ của host, dù prefix trùng. Corpus không có host này.
- `unavailable`: mạng chết, server 400 hoặc 500, hoặc server bỏ sót bucket vừa hỏi. Không kết luận.

`unknown` và `absent` là hai chuyện khác nhau và spec vendor nói thẳng như vậy. Gộp chúng lại là làm
mất thông tin mà moderation console đã bỏ công tạo ra.

### Hợp đồng đo thẳng trên production

Đo ngày 22/08/2026, không phải suy đoán:

- `GET /v1/lookup?p=00000` trả 200 với `{"buckets":{"00000":[]}}`, không cần header auth nào.
- Khoá của `buckets` là **đúng chuỗi client gửi**, giữ nguyên hoa thường: gửi `00A1F` thì nhận
  `00A1F`. Client này luôn gửi hex thường và vẫn chuẩn hoá khoá về thường khi đọc.
- Thiếu `p` là 400 `missing_prefix`. `p` không phải 5 hex là 400 `invalid_prefix`, và **giá trị bị
  từ chối không được vọng lại trong message**. 17 prefix là 400 `too_many_prefixes`.
- `/v1/lookup` **không** trả header CORS, y hệt `/v1/blocklist`.

`tests/contract/lookup-seam.test.ts` khoá client vào bản vendor, và
`tests/kanon/production-anonymity.test.ts` chứng minh tính chất trên corpus production thật: nó dựng
16 host chỉ trùng đúng 20 bit đầu với entry thật, hỏi cả 16 trong **một** request không auth, rồi bắt
extension kết luận `absent` cho từng cái. Server đã đưa đủ ứng viên; thứ duy nhất quyết định nằm ở
máy người dùng.

## Tier 2

Tier 2 gửi **URL đầy đủ** lên server và tiêu một lượt LLM thật. Nó chỉ chạy khi người dùng bấm nút
"Quét sâu trang này" trong popup. Không listener điều hướng, không alarm, không chạy nền, không
prefetch, không "quét trước cho nhanh".

Ràng buộc đó là ràng buộc **chi phí**, không phải một tối ưu. Mỗi lần quét là một lần gọi model tính
tiền vào tài khoản chủ dự án. Nối tier 2 vào lưu lượng duyệt web là để hoá đơn trôi theo số tab người
ta mở.

### "Chỉ khi bấm" được khoá bằng cấu trúc chứ không bằng ý định

Service worker **không import được** một dòng nào của tier 2. `src/background/index.ts` chỉ với tới
`background/tier0.ts` và `background/tier1.ts`; `lib/tier2.ts`, `lib/scan.ts`, `lib/install.ts` và
`lib/token-store.ts` nằm ngoài đồ thị import đó, và `tests/tier2/no-auto-scan.test.ts` đi bộ đồ thị
import để bắt lỗi ngay khi ai đó nối vào. `pnpm --filter extension build` cũng chứng minh điều này ở
mức bundle: `dist/background.js` không chứa chuỗi `/v1/scan` nào.

Vế động của cùng một tính chất: bài test mô phỏng điều hướng qua **20 trang lạ**, stub luôn cả
`globalThis.fetch` để không đường nào lọt, rồi assert số request `/v1/scan` đúng bằng **không**. Sau
đó gọi `runManualScan` đúng một lần và assert đúng một `POST /v1/scan`.

Bốn file tier 2 cũng không được nhắc `chrome.tabs`, `chrome.alarms`, `chrome.webNavigation`,
`chrome.runtime`, `addListener` hay `setInterval`. Một hàm không có cách nào tự chạy thì nó không thể
tự chạy.

### Install token

`POST /v1/install` với thân đúng hai byte `{}` trả 201 `{install_token, rotate_after_days}`. Token
dài 48 ký tự, hình `aft1_` cộng 43 ký tự base64url. Nó là **credential lấy lúc chạy**, nên nó nằm
trong IndexedDB của extension và **không bao giờ nằm trong bundle**. `check-no-secrets` chỉ chặn biến
build-time, nên nó không phải là thứ bảo vệ điều này; thứ bảo vệ điều này là không có chỗ nào trong
`src/` viết ra một token.

Token xin **một lần** rồi dùng lại. Không xin token mới mỗi lần quét: mỗi token mang hạn mức riêng,
nên xin mới mỗi lần là biến hạn mức 20 lần thành vô hạn, tức là tự phá đúng thứ hạn mức tồn tại để
làm. Chỉ hai trường hợp mint lại, cả hai đều bị chặn số lần:

- Token quá `rotate_after_days` ngày kể từ lúc mint.
- Server trả 401 `missing_token` hoặc `invalid_token`. Đúng **một** lần mint lại rồi thử lại một
  lần, có cờ chặn, không lặp.

Thêm một lớp nữa cho chắc: `scripts/secret-patterns.ts` có pattern `install-token` bắt
`aft1_` cộng 43 ký tự, nên một token hardcode lọt vào `dist/` sẽ làm `pnpm --filter extension build`
đỏ.

### Token gắn tier 2, tuyệt đối không gắn tier 1

Token là thứ nối mọi lần quét về một danh tính. Tier 2 đã gửi full URL rồi nên gắn token vào không
mất thêm gì; tier 1 thì ngược lại, một token ở đó xoá sạch k-anonymity (xem mục "Không gắn install
token, và đó là chủ ý" ở trên).

`tests/kanon/token-isolation.test.ts` khoá vế này: nó chạy hết một lượt tier 2 để token thật sự nằm
trong kho, rồi chạy một lượt tier 1 và bắt request đó phải đi ra với `headerNames` rỗng, không
`Authorization`, không `Cookie`, và không byte nào của token trong toàn bộ request. Nó cũng đi bộ đồ
thị import của bốn file tier 1 để chứng minh chúng không chạm tới `lib/install.ts` hay
`lib/token-store.ts`.

### `/v1/scan` nhận đúng một trường `url`

Không `prompt`, không `html`, không `model`, không `system`, không `options`. Server tự fetch trang,
tự strip, tự dựng prompt. Đây là hàng rào cấu trúc chống biến endpoint thành một LLM proxy miễn phí
cho cả internet, nên một trường thừa là **400 `unknown_field`** chứ không phải một cảnh báo.

`scanRequestBody()` là chỗ duy nhất dựng thân request và nó chỉ dựng được đúng một trường.

### Hợp đồng đo thẳng trên production, ngày 22/08/2026

Đo bằng một install token mới, không phải suy đoán:

- `POST /v1/install` thân `{}` trả **201** `{"install_token":"aft1_...","rotate_after_days":90}`,
  token 48 ký tự.
- `POST /v1/scan` kèm `Authorization: Bearer <token>` và `{"url":"https://example.com"}` trả **202**
  `{"scan_id":"...","status":"queued","poll_after_seconds":2,"quota_remaining":19}`.
- `GET /v1/scan/{id}` cùng token trả **200** verdict envelope. Một scan thật xong sau khoảng 3,4
  giây, `status: "done"`, `confidence_basis: "uncalibrated_single_vote"`, `model: "gpt-5-mini"`.
- Không token là **401** `missing_token`. Thêm trường `prompt` là **400** `unknown_field`, và mã 400
  này được trả **trước** khi hạn mức bị trừ.
- Hạn mức là **20 lần một install token trong 86400 giây**. Lần thứ 21 là 429.

**Hình dạng thật của 429**, vì plan đòi UI hiện thời điểm reset nên phải biết server để nó ở đâu:

```
HTTP/1.1 429 Too Many Requests
cache-control: no-store
retry-after: 86395

{"error":{"code":"quota_exceeded",
          "message":"One install token may request 20 scans per 86400 seconds. ...",
          "retry_after":86395,
          "reset_at":"2026-08-23T16:11:10.783Z"}}
```

Server trả thời điểm reset ở **cả hai chỗ**: `error.reset_at` trong thân là một mốc ISO 8601, và
`retry-after` là số giây, lặp lại trong `error.retry_after`. Gọi tiếp lần nữa vẫn 429, `reset_at`
**đứng yên** còn `retry_after` giảm dần, nên `reset_at` là thứ đáng hiển thị.

Client **chỉ đọc `reset_at`**, không bao giờ tự cộng `Date.now()` với `retry_after` để dựng ra một
mốc. Nếu một ngày nào đó server trả 429 mà thiếu `reset_at` thì UI nói thẳng "server không trả thời
điểm mở lại" chứ không bịa; `tests/tier2/quota-exceeded.test.ts` khoá cả nhánh đó.

### Hết quota là dừng hẳn

Không backoff, không retry ngầm, không hẹn giờ thử lại. `runManualScan` gặp `quota_exceeded` là trả
về ngay, và test assert số request phát ra **sau** 429 đúng bằng 0 cũng như không có một lần
`sleep()` nào được gọi. Nút quét bị disable và popup ghi rõ mốc mở lại.

Lý do: retry tự động khi hết quota không bao giờ thành công trước `reset_at`, nên nó chỉ đốt pin, đốt
băng thông và đốt log của server. Người dùng bấm lại là đủ.

### Poll chứ không chờ

`POST /v1/scan` trả 202 ngay, verdict đến sau. Client chờ `poll_after_seconds` rồi `GET
/v1/scan/{scan_id}`, lặp tối đa `SCAN_POLL_MAX_ATTEMPTS` lần. Envelope có **một hình duy nhất** ở mọi
trạng thái, kể cả lúc còn `queued`, nên chỉ có một parser. Hết trần poll thì trả `pending` kèm
`scan_id` chứ không poll mãi.

`status: "done"` cộng `parse_ok: true` mới có verdict. Mọi trạng thái khác mang ba null và popup hiển
thị đúng như vậy, không suy ra "sạch" từ một scan chưa xong.

`confidence` **không phải phép đo**. Seam `llm_output.v1` chỉ mang `{is_scam: bool}` và server chưa
được hiệu chuẩn trên corpus nào, nên `confidence_basis: "uncalibrated_single_vote"` phải hiện thành
một lưu ý mềm chứ không phải một con số đáng tin.

## Hai file seam vendor

`vendor/openapi/public.yaml` và `vendor/schemas/verdict.schema.json` là **byte copy** của hợp đồng
thật trong `phishing-detect-web`. Từ tier 0 trở đi, bản vendor là thứ code theo, không phải trí nhớ.

`vendor/VENDORED.json` là sổ ghi digest. `pnpm --filter extension check:vendor` rehash và fail nếu
lệch; nó là bước đầu tiên của cả `build` lẫn `test:contract`, nên không có đường build xanh mà seam
đã đổi.

Thư mục tên `vendor/` là có chủ ý: `.gitattributes` có dòng `vendor/** -text`, nên git không được
normalise hai file này sang CRLF trên Windows. Repo web đã mất nửa ngày vì Nixpacks nuốt CRLF làm
digest lệch; đừng đặt file seam ra ngoài `vendor/` mà không kèm luật `-text` tương ứng.

Đổi digest trong `vendor/VENDORED.json` chỉ hợp lệ trong đúng commit copy lại file từ repo owner, và
chỉ cho thay đổi additive. Một digest lệch nghĩa là seam đã đổi: đọc diff của bản upstream trước.

## Hợp đồng API

Hợp đồng thật nằm ở `openapi/public.yaml` và `schemas/verdict.schema.json` trong
`phishing-detect-web`, và repo này giữ một byte copy trong `vendor/` kèm check băm. Xem mục "Hai file
seam vendor" ở trên.

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
pnpm --filter extension build             # check băm vendor, vite build, post-check chặn secret
pnpm --filter extension check:vendor      # chỉ rehash hai file seam trong vendor/
pnpm --filter extension check:no-secrets  # chỉ chạy post-check trên dist/ hiện có
pnpm --filter extension lint:no-blocking  # manifest và source không được chặn điều hướng
pnpm --filter extension typecheck         # tsc --noEmit
pnpm --filter extension test              # vitest, toàn bộ
pnpm --filter extension test:contract     # check băm vendor cộng tests/contract
pnpm --filter extension test:kanon        # chứng minh k-anonymity của tier 1
```

Repo đứng một mình nhưng vẫn có `pnpm-workspace.yaml` với `packages: [.]` và `name: "extension"`
trong `package.json`, để lệnh `pnpm --filter extension ...` mà plan và CI viết chạy đúng nguyên văn
ở đây cũng như khi repo được mount vào một workspace lớn hơn.

## Nạp thử trong Chrome

`chrome://extensions` bật Developer mode, "Load unpacked", trỏ vào `dist/`. Không phải gốc repo:
`manifest.json` nằm trong `public/` và chỉ trở thành gốc extension sau khi build copy nó ra `dist/`.

Muốn tự tay xem badge đổi: `pnpm --filter extension test` đã chứng minh vế đó bằng artifact fixture
trong `tests/tier0-badge.test.ts`. Trên production, artifact đã có 1406 entry phish và 1041 entry
legit, nên hai ca dưới đây phân biệt được thật.

**Tier 0, host có trong artifact.** Mở `chrome://extensions`, xem service worker, chạy
`refreshBlocklist()`, ghé một domain nằm trong blocklist rồi mở tab Network: badge đổi mà Network
trống. Không một byte nào rời khỏi máy.

**Tier 1, host lạ.** Ghé một domain **không** có trong artifact. Tab Network hiện đúng một request
tới `/v1/lookup`, và ba thứ phải đúng cùng lúc:

- Request headers **không có** `Authorization` và **không có** `Cookie`.
- Query chỉ gồm tham số `p`, mỗi giá trị đúng 5 ký tự hex. Không host, không URL, không gì dài hơn.
- Mở vài tab lạ liền nhau thì chúng gộp vào cùng một request nhiều `p`, không phải mỗi tab một
  request, và request bắn đi trễ vài trăm mili giây so với lúc mở trang.

**Tier 2, chỉ khi bấm.** Mở tab Network của popup (chuột phải vào icon, "Inspect popup"), rồi điều
hướng qua chục trang lạ: Network **không có** một request `/v1/scan` nào, chỉ có `/v1/lookup`. Bấm
"Quét sâu trang này" mới thấy `POST /v1/install` lần đầu, rồi `POST /v1/scan`, rồi vài
`GET /v1/scan/{id}` cách nhau hai giây. Bấm lần thứ hai không có `/v1/install` nữa vì token đã nằm
trong IndexedDB `anti-fraud-install`.

Bấm đủ 20 lần trên cùng một install token thì lần 21 là 429 và popup ghi mốc mở lại lấy từ
`error.reset_at`; sau đó Network đứng im, không có request nào nữa cho tới khi bấm lại.

## Bố cục

```
public/manifest.json          manifest MV3, copy nguyên trạng vào dist/
public/icons/                 icon 16, 48, 128
vendor/VENDORED.json          sổ digest của hai file seam
vendor/openapi/public.yaml    byte copy hợp đồng API, LF thuần
vendor/schemas/               byte copy schema verdict, LF thuần
src/config.ts                 origin API, đọc PUBLIC_API_BASE_URL
src/lib/afbl.ts               layout AFBL, decode, tìm nhị phân
src/lib/host.ts               URL thành host, host thành entry uint64
src/lib/blocklist-store.ts    IndexedDB, đúng một bản ghi
src/lib/blocklist-sync.ts     tải, kiểm, quyết định nhận hay giữ bản cũ
src/lib/tier0.ts              tra cục bộ, có cache trong bộ nhớ
src/lib/lookup.ts             hợp đồng /v1/lookup, dựng URL, so hash đầy đủ
src/lib/lookup-batch.ts       gộp tối đa 16 prefix, jitter tiêm từ ngoài, cache bucket
src/lib/tier1.ts              host thành prefix, bucket thành verdict
src/lib/api-error.ts          bộ mã lỗi dùng chung của install, scan và report
src/lib/install.ts            hợp đồng /v1/install, hình dạng install token
src/lib/token-store.ts        IndexedDB riêng cho install token, đúng một bản ghi
src/lib/scan.ts               hợp đồng /v1/scan và /v1/scan/{id}, parser verdict envelope
src/lib/tier2.ts              lấy token, gửi scan, poll, dừng hẳn khi hết quota
src/background/tier0.ts       alarm, listener tab, sơn badge
src/background/tier1.ts       leo thang khi tier 0 nói unknown, nối vào nguồn ngẫu nhiên
src/background/index.ts       service worker MV3, chỉ đăng ký, không chạm tier 2
src/popup/popup.ts            popup action, chỗ duy nhất gọi runManualScan
src/popup/scan-panel.ts       outcome thành chữ hiện lên, hàm thuần
scripts/check-vendor-hash.ts  rehash vendor/, cổng của build và test:contract
scripts/vendor-ledger.ts      đọc và kiểm sổ digest
scripts/check-no-secrets.ts   post-check sau build
scripts/secret-patterns.ts    chín pattern secret, có test riêng
scripts/lint-no-blocking.ts   cưỡng chế invariant no-blocking
tests/contract/               hợp đồng seam, layout AFBL, version, production thật
tests/kanon/                  k-anonymity tier 1: không credential, so ở client, gộp lô, token không rò
tests/tier2/                  không tự quét, hết quota là dừng, vòng đời một lần bấm
tests/helpers/imports.ts      đi bộ đồ thị import của src/, dùng để khoá ranh giới tier
tests/                        vitest phần còn lại
```
