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

Post-check quét mọi file văn bản trong `dist/`, bỏ qua file nhị phân, và áp bốn luật. File `.zip`
trong `dist/` **không** bị coi là nhị phân: nó được mở ra, giải từng entry rồi quét từng entry như
một chunk riêng tên dạng `extension.zip!background.js`. Archive không mở được là lỗi exit 2, vì một
vùng không quét được thì không được coi là vùng sạch. Bốn luật:

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

`pnpm --filter extension lint:no-blocking` cưỡng chế bốn luật, mỗi luật in kèm lý do riêng khi nó
bắt được cái gì:

- `manifest-permission`: manifest không được xin `webRequestBlocking`, `declarativeNetRequest`,
  `declarativeNetRequestWithHostAccess` hay `declarativeNetRequestFeedback`, kể cả ở
  `optional_permissions`.
- `manifest-block-rules`: manifest không được khai báo `declarative_net_request`.
- `runtime-block-rules`: không file nào trong `src/` được gọi `chrome.declarativeNetRequest`. Rule
  nạp lúc chạy chặn y hệt rule tĩnh, chỉ khó soát hơn vì nó không nằm trong manifest.
- `navigation-redirect`: nếu có file nào trong `src/` nghe `chrome.webNavigation` thì không file nào
  trong `src/` được gọi `chrome.tabs.update`. Luật này bắt cả trường hợp listener nằm một file còn
  cú bẻ hướng nằm file khác. `chrome.tabs.update` một mình, không có listener điều hướng nào, vẫn
  hợp lệ.

Luật thuần nằm ở `scripts/no-blocking-rules.ts` và có test fixture riêng trong
`tests/no-blocking.test.ts`, nên phá từng luật một là thấy đỏ ngay.

Lý do: một false positive mà chặn được điều hướng là chặn ngân hàng thật của người dùng. Cảnh báo
sai làm người ta bực một lúc; chặn sai làm hỏng cả buổi làm việc, rồi người ta gỡ extension và không
tin cả dự án nữa. Xem `principles/invariants.md#no-blocking` ở harness root.

Vế người dùng của cùng invariant ấy: cảnh báo nào cũng tắt được bằng đúng một cú bấm. Popup có nút
`dismiss-warning`, bấm một lần là badge im hẳn cho host đó, bấm lần nữa là bật lại. Bản ghi tắt nằm
trong IndexedDB `anti-fraud-dismissals`, không gửi đi đâu và không đổi verdict của server.

### Bốn mức cảnh báo và đúng một thứ tự ưu tiên

Từ 23/08/2026 có bốn thứ chồng lên nhau, và `src/lib/warning-level.ts` là chỗ duy nhất quyết định
thứ tự. `resolveWarningLevel` trả về đúng một trong năm giá trị:

1. `dismissed` - người dùng đã tắt hẳn cảnh báo cho host này. Thắng tất cả.
2. `disputed` - người dùng đã gửi report `false_positive` cho host này. Thắng cả mức cứng lẫn mức
   mềm của server.
3. `hard` - host nằm trong mảng phish, tức một moderator đã xem và kết luận. Badge đỏ, chữ `!`.
4. `machine` - host nằm trong mảng mềm, tức model tự duyệt và chưa người nào kiểm chứng. Badge hổ
   phách `#ef6c00`, chữ `~`.
5. `none` - không có cảnh báo nào.

Bốn mức đó không được gộp. `machine` và `hard` khác nhau ở cả ba trường của `BadgeLook`, và
`tests/soft-warning.test.ts` khoá điều đó bằng một bảng 13 dòng chạy qua cả `resolveWarningLevel`
lẫn đường sơn badge `userAdjustedLook`, để hai đường không trôi ra hai thứ tự khác nhau.

Đừng thêm mức thứ sáu trùng nghĩa. `disputed` đã là "người dùng kêu oan", `machine` đã là "máy nghi
mà chưa ai xác nhận"; một mức mới muốn tồn tại phải khác cả hai.

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

Cổng tự quét cũng **không thêm quyền nào**, và đó là một ràng buộc cứng chứ không phải may mắn.
Chấm điểm rủi ro chỉ đọc **host**, thứ mà quyền `tabs` đã cho từ tier 0. Không content script, không
`scripting`, không `webRequest`. Nếu một tín hiệu rủi ro nào đó cần nội dung trang thì tín hiệu đó
không thuộc về bộ chấm điểm này.

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
2. `syncBlocklist` gọi `GET /v1/blocklist?format=2&since=<version đang giữ>` trước. Tên tham số là
   **`since`**, không phải `have`; `have` bị server bỏ qua và trả về nguyên artifact. `since` chỉ
   được gửi khi format đang giữ ĐÚNG BẰNG format đang hỏi, vì mỗi format đếm version riêng.
3. Server chưa biết format 2 thì nó trả 400 `unsupported_format`, và client hỏi lại
   `?format=1&since=<version>`. Rơi về format 1 là đường bình thường chứ không phải lỗi: mảng mềm
   rỗng và outcome vẫn là `fresh`. 400 ở format cuối cùng mới là `unavailable`, bản cũ giữ nguyên.
4. 304 nghĩa là byte không đổi: giữ nguyên entry, chỉ làm mới `etag`, `pinnedUrl` và `fetchedAt`.
5. 200 thì decode header 18 byte (format 1) hoặc 22 byte (format 2), so `x-blocklist-format`,
   `x-blocklist-version` và `x-blocklist-soft-count` với byte 4, byte 6 và byte 18. Lệch là từ chối.
6. Ghi vào IndexedDB `anti-fraud-blocklist`, object store `artifact`, đúng một bản ghi khoá
   `current`, entry là **ba** `BigUint64Array` đã sắp xếp và giữ rời nhau.
7. `chrome.tabs.onUpdated` và `onActivated` lấy URL, `hostOfUrl` rút host, `hostEntryOf` băm
   SHA-256 rồi lấy 16 ký tự hex đầu thành uint64, `afblContains` tìm nhị phân, `paintBadge` sơn badge
   theo tab. Thứ tự tra là phish, rồi legit, rồi soft: hai kết luận của người đi trước kết luận của
   máy.

### Mảng mềm của AFBL format 2, và một entry mềm không bao giờ thành entry cứng

Từ commit `e001054` của `phishing-detect-web`, artifact có thêm một lớp cảnh báo MỀM. Header format 2
là header format 1 cộng một `uint32 soft_n` ở byte 18, tổng 22 byte, rồi một mảng thứ ba sau mảng
legit. `?format=1` và request thiếu tham số `format` vẫn nhận đúng byte cũ.

Một entry mềm là host mà model tự duyệt, không moderator nào đứng sau. Ngưỡng tự duyệt là "ít nhất
một phiếu scam và không phiếu nào phản đối", đo trên eval-v1 đạt 0.9675, tức khoảng 3 trang trên 100
bị đánh dấu oan. Chính con số đó là lý do đúng MỘT report `false_positive` gỡ được cờ mềm cho mọi
người, không cần moderator; trên mức cứng thì report chỉ vào hàng đợi và không bao giờ tự gỡ.

Luật tuyệt đối trong repo này: **một entry mềm không bao giờ được đối xử như một entry cứng.** Ba
chỗ cưỡng chế:

- `decodeAfbl` trả ba mảng rời nhau và không bao giờ nối `soft` vào `phish`.
- `encodeAfbl` NÉM LỖI nếu ai đưa entry mềm vào format 1, thay vì âm thầm gộp chúng vào `phish`. Đó
  là bản sao của cùng cái khoá bên repo web.
- `lookupHost` trả verdict riêng `soft`, và `badgeLookFor("soft")` khác `badgeLookFor("phishing")` ở
  cả ba trường.

`tests/soft-warning.test.ts` giữ cả ba. Sáu phép đột biến đã thử và cả sáu làm test đỏ: gộp `soft`
vào `phish` khi decode, trả `phishing` cho entry mềm, cho badge mềm mượn chữ và màu của badge cứng,
đảo thứ tự tắt-hẳn với kêu-oan, bỏ `soft` khỏi cổng tự quét, và bỏ cú ném lỗi của `encodeAfbl`.

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

Tier 2 gửi **URL đầy đủ** lên server và tiêu một lượt LLM thật. Nó chạy trong đúng hai trường hợp:
người dùng bấm nút "Quét sâu trang này" trong popup, hoặc cổng lọc tự quét ở `src/lib/auto-scan.ts`
cho phép. Không có trường hợp thứ ba.

Ràng buộc nền vẫn là ràng buộc **chi phí**. Mỗi lần quét là một lần gọi model tính tiền vào tài khoản
chủ dự án. Nối tier 2 thẳng vào lưu lượng duyệt web là để hoá đơn trôi theo số tab người ta mở, nên
đường tự quét đi qua một cổng lọc chứ không đi thẳng.

### Invariant cũ đã bị đảo có chủ ý, đọc mục này trước khi sửa test

Tới commit `a4f0930`, invariant là "tier 2 **không bao giờ** tự chạy", khoá bằng
`tests/tier2/no-auto-scan.test.ts` ở hai tầng: vế runtime không có lời gọi nào, và vế đồ thị import
không có cạnh nào từ `src/background/**` tới `src/lib/tier2.ts`.

Lý do đảo: `mamibet88.cc` là một trang cờ bạc thật, không có trong artifact, bucket tier 1 rỗng, và
tier 2 kết luận `is_scam: true` trong 5 giây. Tức hệ **phát hiện được**, nhưng chỉ khi có người bấm
nút, mà người cần được cảnh báo lại chính là người không nghĩ tới việc bấm.

Invariant mới **chặt hơn chứ không lỏng hơn**, và cùng file test khoá nó:

- Host dưới ngưỡng rủi ro thì tuyệt đối không tự quét.
- Host có verdict `legit` trong artifact thì tuyệt đối không tự quét, kể cả khi điểm rủi ro cao.
- Host đã là `phishing` thì cũng không tự quét, vì cảnh báo đã có rồi, quét thêm chỉ tốn quota.
- Không bao giờ vượt trần `AUTO_SCAN_DAILY_CAP` lượt tự quét mỗi ngày.
- Người dùng tắt công tắc thì không lượt nào chạy.
- Một host đã tự quét rồi thì không tự quét lại trong cùng ngày.
- Chỗ giữ ngân sách nằm **trước** request, không phải sau khi có kết quả.

Mỗi mệnh đề đã được kiểm bằng mutation: phá nó thì test đỏ. Cụ thể, bài kiểm trần **không** lặp qua
chính hằng số nó đang kiểm; nó lái đúng 12 host viết ra nguyên văn rồi assert số `POST /v1/scan` bằng
đúng 6. Nâng trần lên 12 hay hạ xuống 3 đều làm nó đỏ.

### Cổng lọc là thứ duy nhất nối background với tier 2

`src/background/**` vẫn **không được import thẳng** `lib/tier2.ts`, `lib/scan.ts`, `lib/install.ts`
hay `lib/token-store.ts`. Đường duy nhất từ service worker tới tier 2 đi qua `src/lib/auto-scan.ts`,
và trong toàn bộ `src/` chỉ có **đúng hai** file nhắc tới `runManualScan`: `lib/auto-scan.ts` và
`popup/popup.ts`. Test enumerate cả cây `src/` để cưỡng chế con số hai đó, nên một đường tắt thứ ba
không thêm vào được mà không làm test đỏ.

`lib/auto-scan.ts` cũng không bị gọi vòng qua cổng được: hàm duy nhất nó xuất ra để chạy một lượt là
`runGatedAutoScan`, và bên trong nó `decideAutoScan` chạy trước `runManualScan`, không có nhánh nào
đi vòng.

Từ 23/08/2026, verdict `soft` đứng cùng phía với `legit` và `phishing` trong `decideAutoScan`: đã có
kết luận thì không tự quét lại, lý do bỏ qua vẫn là `verdict_known` chứ không thêm lý do mới. Ba
điều làm nên quyết định đó, và không điều nào đụng vào tính chất của cổng lọc (ngưỡng 4, trần 6 một
ngày, `legit` được miễn):

- Cờ mềm đã là kết luận của chính model ấy. Tự quét lại là hỏi lại đúng một oracle về đúng một trang
  và tiêu một trong sáu lượt để không biết thêm gì.
- Cổng lọc tồn tại để biến im lặng thành cảnh báo. Host mềm đã có badge hổ phách, không còn im lặng
  nào để lấp.
- Nếu vẫn quét, một `is_scam` true sẽ sơn `AUTO_SCAN_WARNING_LOOK` đè lên badge mềm. Trước 23/08 look
  đó là **đỏ**, tức là một verdict thuần máy mượn badge của mức đã có người xác nhận. Bước này sửa
  luôn: `AUTO_SCAN_WARNING_LOOK` giờ là badge hổ phách, cùng màu và cùng chữ với mức mềm, vì hai thứ
  đó có cùng một trạng thái nhận thức. Cổng lọc không đổi, chỉ có màu của kết quả là thành thật hơn.

Sáu file (bốn file tier 2 cộng `lib/auto-scan.ts`, `lib/auto-scan-store.ts` và `lib/risk.ts`) không
được nhắc `chrome.tabs`, `chrome.alarms`, `chrome.webNavigation`, `chrome.runtime`, `addListener`
hay `setInterval`. Một hàm không có cách nào tự chạy thì nó không thể tự chạy; thứ duy nhất châm ngòi
là listener tab của tier 0 trong `src/background/tier0.ts`.

Ranh giới tier 1 **không đổi**: `tests/kanon/token-isolation.test.ts` vẫn đi bộ đồ thị import của
`background/tier1.ts` và bắt nó không chạm được một module tier 2 nào. Vì thế cổng tự quét nằm ở
`src/background/auto-scan.ts` chứ không nằm trong `background/tier1.ts`, và `background/index.ts`
mới là chỗ ghép hai vế lại.

### Chấm điểm rủi ro tại máy, ngưỡng 4

`src/lib/risk.ts` là một hàm thuần **không import một module nào khác**, chỉ ăn **host**, và không
chạm mạng, kho, đồng hồ hay số ngẫu nhiên. `tests/risk/local-scoring.test.ts` khoá cả ba vế: đồ thị
import của nó đúng bằng một phần tử, nguồn của nó không chứa `fetch`, `XMLHttpRequest`, `WebSocket`,
`sendBeacon`, `navigator`, `chrome.`, `indexedDB`, `crypto.`, `Math.random`, `Date.now` hay
`new Date`, và nó vẫn chấm được cả trăm host trong khi mọi global mạng đã bị stub cho nổ tung.

Đây là điều làm phương án "lọc trước rồi mới tự quét" khả thi về mặt riêng tư: điểm rủi ro của mọi
host người dùng ghé đều được tính, nhưng chỉ host vượt ngưỡng mới có một byte nào rời khỏi máy.

Hai loại tín hiệu, tổng trọng số từ **4** trở lên là quét:

- Trọng số 4, một mình đã đủ: IP công cộng trần, punycode `xn--`, từ khoá làm bằng giả (`lambang`,
  `bangcap`), từ khoá cờ bạc (`casino`, `nhacai`, `xoso`, `bet` cạnh chữ số), từ khoá dụ nhập tài
  khoản (`otp`, `xacthuc`, `dangnhap`).
- Trọng số 2 hoặc 3, cần một tín hiệu thứ hai: nền tảng host miễn phí, tên thương hiệu gắn vào một
  tên miền không phải của thương hiệu đó, từ khoá đầu tư hoặc crypto hoặc nạp thẻ, chữ `vn` dán vào
  tên miền không phải đuôi `.vn`, đuôi tên miền rẻ, chuỗi số dài, đuôi số may mắn kiểu nhà cái, dấu
  gạch ngang, subdomain sâu, host dài, nhãn thiếu nguyên âm.

Ngưỡng 4 nghĩa là "hoặc một lý do không cãi được, hoặc ít nhất hai lý do độc lập". Các host bị bỏ lỡ
ở điểm 3 gần như đều là host chỉ có đúng một tín hiệu yếu, và đó cũng là chỗ ba false positive duy
nhất của corpus nằm.

**Miễn quét hẳn**, điểm luôn bằng 0: địa chỉ nội bộ và tên máy mạng riêng (`192.168.*`, `10.*`,
`127.*`, `172.16-31.*`, `localhost`, `*.local`, host một nhãn, các TLD dành riêng của RFC 2606), và
đuôi do cơ quan đăng ký cấp có kiểm tra pháp nhân (`gov.vn`, `edu.vn`, `ac.vn`, `org.vn`, `dcs.vn`,
`gov`, `edu`, `mil`, `int`).

Đo trên corpus thật `phishing-detect-web/exports/eval-v1` ngày 23/08/2026, không phải cảm tính:

```sh
pnpm --filter extension eval:risk ../phishing-detect-web/exports/eval-v1
```

- 1406 host lừa đảo: **163 host vượt ngưỡng, 11,6%**.
- 1043 host hợp lệ: **0 host vượt ngưỡng, 0,00%**.

Đọc con số 11,6% cho đúng: đây là một **bộ lọc trước**, không phải một bộ phát hiện. Việc của nó là
giữ 6 lượt tự quét mỗi ngày trỏ vào những host đáng ngờ nhất; kết luận vẫn do tier 2 đưa ra. Phần
lớn corpus là tên miền `.com` trông vô hại như `toolvl.com` hay `crazii.com`, và từ **một mình cái
tên** thì không có cách nào biết chúng lừa đảo.

Đọc con số 0,00% cũng phải cho đúng, vì đây là chỗ dễ tự lừa nhất: whitelist eval-v1 có 951 host
`.vn`, trong đó 700 host `.gov.vn` và 67 host `.edu.vn` được **miễn hẳn**, nên phép đo này rộng lượng
với bộ chấm điểm. Vocabulary tài chính (`trade`, `market`, `finance`, `invest`) được giữ ở trọng số 2
đúng vì lý do đó: trên một whitelist toàn cầu chúng sẽ nổ nhiều hơn nhiều, và ở trọng số 2 chúng
không tự mình vượt ngưỡng được. Ba mươi host hợp lệ sát ngưỡng nhất của corpus được viết nguyên văn
vào `tests/risk/local-scoring.test.ts` cùng 36 trang người ta mở hằng ngày, nên hạ ngưỡng xuống 3
làm test đỏ ngay.

### Trần tự quét là 6, và vì sao không phải 20

Hạn mức production đo thật là **20 lượt một install token trong 86400 giây**. `AUTO_SCAN_DAILY_CAP`
là **6**, để lại **14** lượt cho những lần người dùng tự bấm.

Sáu là con số cho một người bình thường: nó đủ để bắt vài trang lạ đáng ngờ trong một ngày duyệt web,
và nó vẫn để lại phần lớn hạn mức cho việc mà người dùng chủ động làm. Đặt sát 20 nghĩa là một ngày
xui, khi người ta lạc vào một chùm trang cờ bạc, cổng tự quét ăn sạch hạn mức rồi nút bấm tay chết
với 429 mà người dùng không hiểu vì sao. Cổng lọc phải nhường chỗ cho ý định của người dùng, không
tranh chỗ với nó.

Sổ ngân sách nằm trong IndexedDB `anti-fraud-auto-scan`, đúng một bản ghi cho mỗi ngày, và bản ghi
của ngày cũ bị xoá ngay khi ngày mới có lượt tự quét đầu tiên. Nhờ vậy nó không tích lại thành một
lịch sử duyệt web trong máy. Ngày tính theo `YYYY-MM-DD` giờ UTC, lấy từ `dayKeyOf`.

Một lượt tự quét **giữ chỗ trong sổ trước khi bắn request**, không phải sau khi có kết quả, và
`runGatedAutoScan` xếp các lượt vào một hàng nối tiếp. Hai điều đó cộng lại là thứ giữ cho trần không
bị vượt khi mười hai tab lạ mở cùng một lúc; test lái đúng tình huống đó.

### Công tắc trong popup, và lời giải thích đi kèm

Popup có nút `toggle-auto-scan`, mặc định **bật**. Trạng thái nằm trong IndexedDB
`anti-fraud-auto-scan` chứ không nằm trong `chrome.storage`, đúng vì lý do đã dùng cho install token:
`chrome.storage` đòi thêm một dòng quyền trong bản review của Chrome Web Store để đổi lấy một bản
ghi boolean. Không đáng.

Popup còn phải nói **vì sao** nó tự quét trang đang mở: `src/popup/auto-scan-panel.ts` liệt kê đúng
những tín hiệu đã kích hoạt cho host đó, kèm trọng số từng cái. Người dùng thấy cảnh báo mà không
biết vì sao là cảnh báo không dùng được, nên phần đó có test riêng trong
`tests/tier2/auto-scan-panel.test.ts`.

Badge cảnh báo tự động chỉ được sơn khi verdict thật sự là `is_scam: true`. Một lượt tự quét ra
`is_scam: false` **không** sơn badge "OK": một phiếu boolean chưa hiệu chuẩn của một model không phải
giấy chứng nhận sạch, và sơn xanh cho nó là nói dối người dùng.

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

Bản đang pin là `phishing-detect-web@e001054`, bản thêm AFBL format 2 và trường `soft_flag` vào
`ReportQueued`. `verdict.schema.json` không đổi một byte giữa `7d22fe4` và `e001054`, nên digest của
nó giữ nguyên; chỉ `public.yaml` đổi, từ 51886 lên 56229 byte.

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
pnpm --filter extension eval:risk <thư mục>   # đo bộ chấm điểm trên corpus eval-v1 thật
pnpm --filter extension package           # dist/ thành dist/extension.zip, rồi quét lại bên trong zip
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

**Tier 2, khi bấm.** Mở tab Network của popup (chuột phải vào icon, "Inspect popup"), rồi bấm
"Quét sâu trang này": thấy `POST /v1/install` lần đầu, rồi `POST /v1/scan`, rồi vài
`GET /v1/scan/{id}` cách nhau hai giây. Bấm lần thứ hai không có `/v1/install` nữa vì token đã nằm
trong IndexedDB `anti-fraud-install`.

**Tier 2, tự chạy.** Xem Network của service worker rồi điều hướng qua chục trang lạ **dưới ngưỡng**
(ví dụ vài trang tin tức `.vn`): chỉ có `/v1/lookup`, không có `/v1/scan` nào. Rồi ghé một host vượt
ngưỡng, ví dụ `mamibet88.cc`: thấy `POST /v1/scan` tự phát ra, badge đổi sang cảnh báo sau vài giây,
và popup liệt kê đúng những tín hiệu đã kích hoạt. Ghé lại host đó lần thứ hai trong ngày thì
**không** có request `/v1/scan` nào nữa. Bấm "Tắt tự quét trang lạ" rồi ghé một host vượt ngưỡng
khác: cũng không có request nào.

Bấm đủ 20 lần trên cùng một install token thì lần 21 là 429 và popup ghi mốc mở lại lấy từ
`error.reset_at`; sau đó Network đứng im, không có request nào nữa cho tới khi bấm lại.

## Đóng gói

`pnpm --filter extension package` chạy sau `build` và sinh `dist/extension.zip`. Nó không phải một
lệnh `zip -r dist`, và ba khác biệt là lý do nó tồn tại.

**Một, chỉ thứ Chrome cần chạy mới vào gói.** `scripts/pack-rules.ts` giữ danh sách đuôi được phép,
danh sách đuôi cấm và danh sách thư mục cấm. `node_modules/`, `src/`, `tests/`, `scripts/`,
`vendor/`, sourcemap, tài liệu `.md` và mọi file ẩn đều bị loại, và mỗi lần loại đều in ra lý do chứ
không im lặng. Trước khi gói, script còn kiểm ba thứ: manifest không trỏ vào file không có trong
gói, mọi `src`/`href` trong HTML của gói giải ra một entry có thật, và mỗi icon manifest khai là PNG
thật đúng kích thước đã khai.

**Hai, zip xác định được.** Gói hai lần trên cùng một `dist/` ra file giống hệt nhau tới từng byte.
Nguồn bất định duy nhất trong định dạng zip là dấu thời gian, nên nó bị ghim: mọi entry mang DOS
date `0x0021` và DOS time `0x0000`, tức là 1980-01-01 00:00:00, mốc chuẩn của reproducible build.
Cùng với đó là entry sắp theo tên, cờ general purpose bằng 0, trường extra rỗng, external attributes
bằng 0. Entry lưu ở chế độ **store** chứ không nén: nén là chỗ duy nhất còn lại mà kết quả phụ thuộc
phiên bản zlib đi kèm Node, và cả extension chỉ khoảng 50 KB nên không đáng đánh đổi tính xác định
lấy vài chục KB. Chrome Web Store nén lại theo cách của nó khi đóng CRX, nên store mode không làm
người dùng tải nặng hơn.

**Ba, secret bên trong zip bị quét thật.** Đây từng là một lỗ. `scripts/check-no-secrets.ts` bỏ qua
mọi file trông như nhị phân, và một file zip luôn trông như nhị phân, nên trước bước này một secret
nằm trong `dist/extension.zip` sẽ đi qua post-check mà không ai thấy. Bây giờ post-check mở zip ra,
giải từng entry rồi quét từng entry như một chunk riêng, tên chunk in ra dạng
`extension.zip!background.js`. Archive không mở được trong `dist/` là **lỗi** chứ không phải cảnh
báo, vì một vùng không quét được thì không được coi là vùng sạch. `scripts/package.ts` cũng tự quét
lại nội dung zip nó vừa ghi, nên chạy `package` một mình cũng không sinh ra được file zip có pattern
secret.

Diễn tập lỗ này: nhét `aft1_` cộng 43 ký tự vào một file trong `dist/` rồi chạy `package`, hoặc dựng
một zip chỉ chứa entry có token đó rồi chạy `check:no-secrets`. Cả hai đều phải đỏ.

## Chính sách riêng tư là một tạo tác phát hành

`PRIVACY.md` không phải văn bản trang trí. Nó nêu từng tier gửi gì đi đâu, và nó nói thẳng ba thứ mà
một chính sách viết dối sẽ tránh:

- Prefix của tier 1 giấu **trang nào**, không giấu **việc vừa mở một trang nào đó**. Nhịp duyệt web,
  giờ online, cường độ, số trang lạ mở cùng lúc đều còn nguyên trong log của server.
- Prefix ổn định theo host, nên một người đã có sẵn nghi ngờ tính prefix của trang họ nghi rồi dò
  trong log là ra một xác nhận rất mạnh. K-anonymity mạnh trước người không biết đoán gì, yếu hơn
  nhiều trước người đã có danh sách nghi ngờ.
- Install token là một định danh. Nó nối mọi lần quét sâu và mọi report của cùng một bản cài lại với
  nhau, kèm URL đầy đủ từng lần.

Luật: **đổi thứ gì rời khỏi máy thì sửa `PRIVACY.md` trong cùng commit đó.** Thêm một trường vào
`/v1/report`, mở ô ghi chú trong popup, gắn token vào một tier khác, đổi jitter hay TTL cache đều là
thay đổi phải phản ánh vào tài liệu.

## Tài sản cho listing Chrome Web Store

`public/icons/` có icon 16, 48, 128 và cả ba là PNG thật, đúng kích thước, được test khoá lại trong
`tests/package/rules.test.ts`.

Logo là khiên trắng trên nền chàm với một lưỡi câu đỏ bị bẻ gãy nằm gọn bên trong. Bản gốc là
`store/icon-master-1024.png`; ba icon trong `public/icons/` và `store/icon-512.png` đều xuất xuống từ
nó, nên sửa logo là sửa file gốc rồi xuất lại chứ đừng vẽ tay từng cỡ. Bản 16 pixel được tăng tương
phản và độ bão hoà so với bản gốc, vì thu thẳng từ 1024 xuống 16 thì lưỡi câu nhoè thành một vệt hồng.
Cùng logo đó là favicon của console trong `phishing-detect-web`.

`store/screenshots/` có hai ảnh chụp thật của popup, sáng và tối, chụp bằng Chrome thật chạy với
backend production, không dựng, không ghép. Chúng còn thiếu hai thứ trước khi nộp được:

- Chrome Web Store đòi ảnh 1280x800 hoặc 640x400. Hai ảnh này là ảnh gốc theo kích thước thật của
  popup, cần một lượt bố cục để ra đúng khung.
- Chưa có ảnh nào chụp trạng thái **đang cảnh báo**, vì muốn có nó phải ghé một host thật nằm trong
  corpus. Artifact chỉ chứa mã băm cắt ngắn nên không suy ngược ra host được, và bucket lookup của
  các host phổ biến đều rỗng. Ai có một mẫu thật thì chụp được ngay, còn suy luận thì không.

Policy còn thiếu một URL công khai. Chrome Web Store bắt buộc điền URL chính sách riêng tư lúc
submit, và repo này chưa dựng nơi host nào.

## Nạp thử gói zip bằng Chrome thật

Nút "Load unpacked" mở hộp thoại chọn thư mục của hệ điều hành, không tự động hoá được. Nhưng phần
"gói này có nạp được không, manifest có lỗi không" thì đo được, và nên đo bằng Chrome thật:

```sh
# giải zip ra một thư mục tạm, rồi
chrome --headless=new --user-data-dir=<thư mục tạm> --remote-debugging-port=9333 about:blank
```

Rồi qua CDP gọi `Extensions.loadUnpacked` với đường dẫn thư mục vừa giải. Nó trả về extension id nếu
manifest hợp lệ và ném lỗi nếu không. Từ Chrome 137, cờ dòng lệnh `--load-extension` bị tắt mặc định
bởi feature `DisableLoadExtensionCommandLineSwitch`, nên đường CDP đáng tin hơn đường cờ dòng lệnh.

Sau khi nạp được, bật `Network` trên target service worker rồi mở một tab tới một host lạ **dưới
ngưỡng rủi ro**: phải thấy đúng `GET /v1/blocklist` một lần và `GET /v1/lookup?p=xxxxx` với đúng năm
ký tự hex, không `Authorization`, không `Cookie`, không `Referer`.

Cẩn thận hơn trước ở một chỗ: từ khi có cổng tự quét, **điều hướng tới một host vượt ngưỡng sẽ tiêu
một lượt quota production thật**, không cần ai bấm gì. Muốn thử tự động mà không đốt quota thì tắt
công tắc tự quét trong popup trước, hoặc chỉ lái qua những host dưới ngưỡng. Tier 3 thì vẫn **đừng**
tự động bấm: nó đẩy report thật vào hàng đợi moderation của production.

## Bố cục

```
PRIVACY.md                    chính sách riêng tư, sửa cùng commit với mọi thay đổi luồng dữ liệu
store/screenshots/            ảnh chụp popup thật, sáng và tối, nguyên liệu cho listing
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
src/lib/risk.ts               chấm điểm rủi ro từ host, hàm thuần, không import gì, không chạm mạng
src/lib/auto-scan.ts          cổng lọc tự quét, đường duy nhất từ background tới tier 2
src/lib/auto-scan-store.ts    IndexedDB riêng cho công tắc tự quét và sổ ngân sách mỗi ngày
src/background/tier0.ts       alarm, listener tab, sơn badge
src/background/tier1.ts       leo thang khi tier 0 nói unknown, nối vào nguồn ngẫu nhiên
src/background/auto-scan.ts   nối verdict tier 0 và tier 1 vào cổng lọc, sơn badge khi model nói lừa đảo
src/background/index.ts       service worker MV3, chỉ đăng ký listener
src/popup/popup.ts            popup action, chỗ duy nhất gọi runManualScan bằng một cú bấm
src/popup/scan-panel.ts       outcome thành chữ hiện lên, hàm thuần
src/popup/warning-panel.ts    trạng thái cảnh báo thành chữ và nhãn nút tắt, hàm thuần
src/popup/auto-scan-panel.ts  công tắc tự quét và danh sách tín hiệu đã kích hoạt, hàm thuần
src/lib/dismissal-store.ts    IndexedDB riêng cho host đã tắt cảnh báo, một bản ghi mỗi host
scripts/check-vendor-hash.ts  rehash vendor/, cổng của build và test:contract
scripts/vendor-ledger.ts      đọc và kiểm sổ digest
scripts/check-no-secrets.ts   post-check sau build
scripts/secret-patterns.ts    chín pattern secret, có test riêng
scripts/lint-no-blocking.ts   runner của invariant no-blocking, in lý do rồi exit 1
scripts/no-blocking-rules.ts  bốn luật no-blocking, hàm thuần, có test fixture riêng
scripts/package.ts            dist/ thành dist/extension.zip, kiểm manifest, icon, HTML, secret
scripts/pack-rules.ts         luật gói, giải đường dẫn manifest và HTML, đọc kích thước PNG
scripts/eval-risk.ts          đo bộ chấm điểm trên corpus eval-v1, không nằm trong cổng CI nào
scripts/zip.ts                writer zip ghim ngày và reader zip có kiểm CRC, dùng chung hai chỗ
tests/contract/               hợp đồng seam, layout AFBL, version, production thật
tests/kanon/                  k-anonymity tier 1: không credential, so ở client, gộp lô, token không rò
tests/tier2/                  cổng lọc tự quét, hết quota là dừng, vòng đời một lần bấm
tests/risk/                   chấm điểm rủi ro chạy tại máy, hiệu chuẩn ngưỡng trên corpus thật
tests/package/                zip xác định được, ghim ngày, secret trong zip vẫn bị bắt, luật gói
tests/helpers/imports.ts      đi bộ đồ thị import của src/, dùng để khoá ranh giới tier
tests/                        vitest phần còn lại
```
