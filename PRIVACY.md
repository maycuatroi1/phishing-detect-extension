# Chính sách riêng tư của extension Anti-Fraud

Cập nhật lần cuối: 23/08/2026. Áp dụng cho extension `Anti-Fraud - phát hiện lừa đảo`, phiên bản
`0.0.1`.

Tài liệu này mô tả đúng những gì extension gửi ra khỏi máy bạn, không phải những gì nó có thể gửi
trong tương lai. Mọi con số trong đây đọc thẳng từ mã nguồn của bản đang phát hành và đo được lại
bằng tab Network của Chrome.

Extension nói chuyện với đúng một máy chủ: `https://anti-fraud.omelet.tech`. Không có bên thứ ba
nào khác, không có mạng quảng cáo, không có công cụ đo lường, không có SDK phân tích.

## Tóm tắt trong một đoạn

Duyệt web bình thường không gửi tên trang bạn đang xem đi đâu cả. Tier 0 tra hoàn toàn trong máy.
Tier 1 gửi 20 bit đầu của mã băm tên miền, tức là một mẩu 5 ký tự dùng chung cho hơn một triệu tên
miền khác nhau, nên máy chủ không đọc ra được bạn đang ở đâu. Nhưng chính việc có một request tier 1
đã nói với máy chủ rằng máy bạn vừa mở một trang lạ vào đúng lúc đó, và điều đó đủ để dựng lại nhịp
duyệt web của bạn. Phần "Điều tier 1 không giấu được" ở dưới nói kỹ chuyện này. Tier 2 và tier 3 gửi
URL đầy đủ, và chúng mang một install token nối các lần gửi của cùng một máy lại với nhau. Tier 3
chỉ chạy khi bạn bấm. Tier 2 chạy khi bạn bấm, và từ bản này nó còn tự chạy trong một trường hợp hẹp:
tên miền chưa có kết luận nào và điểm rủi ro tính tại máy vượt ngưỡng. Phần "Tier 2 tự chạy khi nào"
ở dưới nói đủ điều kiện, trần mỗi ngày và cách tắt hẳn.

## Tier 0: danh sách tải sẵn, tra trong máy

**Gửi đi:** `GET /v1/blocklist?format=2`, và nếu máy chủ chưa phục vụ format 2 thì hỏi lại
`GET /v1/blocklist?format=1`. Tham số `since=<version>` được thêm khi máy đã có sẵn một bản đúng
format đang hỏi. Request này không mang cookie, không mang header xác thực, không mang bất kỳ định
danh nào của extension.

**Chạy lúc nào:** khi cài extension, khi Chrome khởi động, và sau đó mỗi 1440 phút, tức là một ngày
một lần, qua `chrome.alarms`.

**Không gửi đi:** tên miền, URL, hay bất cứ thứ gì về trang bạn đang xem.

Khi bạn mở một trang, extension băm tên miền bằng SHA-256, lấy 64 bit đầu, rồi tìm nhị phân trong
mảng đã tải sẵn nằm trong máy. Không một byte nào rời khỏi máy trong bước này.

Danh sách có **ba mảng**, và ba mảng đó không đáng tin như nhau:

- **Mảng phish:** một moderator đã xem trang và kết luận. Badge đỏ, chữ `!`.
- **Mảng hợp lệ:** cũng do người quyết định. Badge xanh, chữ `OK`.
- **Mảng mềm:** model tự đánh dấu, chưa người nào kiểm chứng. Badge hổ phách, chữ `~`, và tooltip
  nói thẳng "trang này bị máy đánh dấu, chưa có người kiểm chứng".

Con số bạn nên biết: ngưỡng tự duyệt của mảng mềm đo trên bộ eval của dự án đạt 0.9675, tức khoảng
**3 trang trên 100 bị đánh dấu oan**. Đó là lý do trang ở mức mềm gỡ được không cần người: đúng một
lượt "Báo cảnh báo nhầm" của một người dùng rút cờ mềm khỏi trang đó cho mọi máy, ngay lập tức.
Trang đã được một người xác nhận thì không thế: report chỉ vào hàng chờ moderator.

Cả ba mảng đều tra trong máy bạn. Việc trang bạn mở nằm ở mảng nào không rời khỏi máy.

Hai điều máy chủ vẫn biết từ tier 0: địa chỉ IP của bạn vào lúc tải danh sách, và tham số `since`
cho biết máy bạn đang giữ bản nào, tức là lần gần nhất bạn đồng bộ. Một ngày một request là rất ít,
nhưng nó không phải là không.

## Tier 1: hỏi bằng 20 bit của mã băm

Tier 1 chỉ chạy khi tier 0 nói `unknown`, nghĩa là tên miền không có trong danh sách tải sẵn, hoặc
khi máy chưa tải được danh sách nào.

**Gửi đi:** `GET /v1/lookup?p=xxxxx`, trong đó mỗi `p` đúng 5 ký tự hex thường. Năm ký tự đó là 20
bit đầu của `SHA256(tên_miền)`. Một request mang tối đa 16 giá trị `p`.

**Không gửi đi:** tên miền, URL, đường dẫn, tham số query, tiêu đề trang, nội dung trang. Không có
header `Authorization`, không có `Cookie`, không có `Referer`, không có install token. Điều này được
khoá bằng test `tests/kanon/token-isolation.test.ts` và `tests/kanon/no-credentials.test.ts` chứ
không phải bằng lời hứa.

Hai mươi bit chia không gian tên miền thành 1.048.576 nhóm. Máy chủ trả về cả nhóm, và việc so mã
băm đầy đủ để biết trang nào là trang nào xảy ra hoàn toàn trong máy bạn. Máy chủ không bao giờ biết
bạn hỏi về mục nào trong nhóm nó vừa trả.

Extension gộp các prefix lại và bắn đi trễ 200 tới 1000 mili giây, và giữ kết quả mỗi nhóm trong bộ
nhớ 5 phút.

### Điều tier 1 không giấu được: nhịp duyệt web của bạn

Đây là phần mà một chính sách riêng tư dễ lấp liếm nhất, nên nó được viết ra đây đầy đủ.

K-anonymity giấu **bạn đang ở trang nào**. Nó không giấu **việc bạn vừa đi tới một trang nào đó**.
Mỗi request tier 1 là một dòng trong log của máy chủ, và dòng đó mang địa chỉ IP của bạn cùng thời
điểm chính xác. Từ chuỗi các dòng đó, máy chủ, hoặc bất kỳ ai đọc được log của nó, suy ra được:

- Bạn online giờ nào và nghỉ giờ nào. Múi giờ của bạn. Bạn ngủ lúc mấy giờ, cuối tuần bạn có làm
  việc không, hôm nay bạn nghỉ phép hay không.
- Bạn duyệt web dày hay thưa, và những lúc nào trong ngày thì dày nhất.
- Bạn vừa mở bao nhiêu trang lạ cùng lúc, vì số tham số `p` trong một request nói đúng điều đó.
- Máy bạn đang bật hay tắt, vì im lặng cũng là một tín hiệu.

Đó là một hồ sơ hành vi, dù trong đó không có lấy một tên miền.

Ba điều nữa cần nói rõ, vì chúng làm k-anonymity yếu hơn con số 1.048.576 gợi ý:

1. **Prefix ổn định.** Cùng một tên miền luôn ra cùng một prefix, mãi mãi. Nếu ai đó đã nghi bạn vào
   một trang cụ thể, họ tự tính prefix của trang đó rồi tìm trong log của bạn. Trùng prefix không
   phải bằng chứng chắc chắn, nhưng đó là một xác nhận rất mạnh. K-anonymity bảo vệ tốt trước người
   không biết đoán gì; nó bảo vệ kém hơn nhiều trước người đã có sẵn danh sách nghi ngờ.
2. **Tập prefix lặp lại là một dấu vân tay.** Bộ các nhóm mà một địa chỉ IP hỏi đi hỏi lại theo thời
   gian tự nó khá riêng biệt. Nó không nói tên trang, nhưng nó gắn các phiên duyệt web của cùng một
   người lại với nhau, kể cả khi IP đổi.
3. **Jitter và cache chỉ làm mờ, không xoá.** Trễ 200 tới 1000 mili giây làm nhoè thời điểm mở trang
   trong khoảng dưới một giây, không hơn. Cache 5 phút chỉ bỏ bớt các lần ghé lại rất gần nhau.
   Không cái nào che được hình dạng chung của một ngày duyệt web.

Bản này **không có công tắc tắt tier 1**. Cách duy nhất để không phát ra request tier 1 nào là gỡ
extension, hoặc chỉ ghé những trang đã nằm sẵn trong danh sách tier 0. Đó là một hở thật của bản
hiện tại, không phải một chi tiết bị bỏ quên.

## Tier 2: quét sâu, khi bạn bấm hoặc khi trang lạ đủ đáng ngờ

Tier 2 chạy trong đúng hai trường hợp: bạn mở popup và bấm nút "Quét sâu trang này", hoặc cổng lọc
tự quét mô tả ở mục kế cho phép. Không có trường hợp thứ ba, và điều đó được khoá bằng test
`tests/tier2/no-auto-scan.test.ts`.

Trong cả hai trường hợp, ba thứ rời khỏi máy:

1. `POST /v1/install` với body rỗng `{}`, chỉ ở lần đầu tiên, để xin một install token. Xem mục
   install token bên dưới.
2. `POST /v1/scan` với header `Authorization: Bearer <install token>` và body JSON có **đúng một
   trường**: `url`. Đó là **URL đầy đủ của tab đang mở**, gồm cả đường dẫn và toàn bộ chuỗi query,
   tối đa 2048 ký tự.
3. `GET /v1/scan/{scan_id}` với cùng install token, lặp tối đa 12 lần cách nhau vài giây, để lấy kết
   quả.

**URL đầy đủ nghĩa là đầy đủ.** Nếu trang bạn đang mở có mã đơn hàng, mã phiên, email, hay token đặt
lại mật khẩu nằm trong query string, thì những thứ đó đi lên máy chủ cùng với URL. Extension chỉ từ
chối một dạng: URL có tên đăng nhập và mật khẩu nhúng thẳng trong phần authority. Ngoài ra nó không
lọc gì cả. Đừng bấm quét sâu trên một trang có dữ liệu nhạy cảm trong địa chỉ.

Máy chủ tự mở URL đó bằng trình duyệt của nó rồi đưa nội dung cho một mô hình ngôn ngữ chấm. Kết quả
trả về gồm kết luận, độ tin cậy, tên mô hình và phiên bản prompt. Extension **không đọc nội dung
trang trong máy bạn** và không gửi nội dung trang đi: nó không có content script và không xin quyền
đọc trang. Thứ mô hình đọc là bản mà máy chủ tự tải, không phải bản bạn đang nhìn.

Mỗi install token có một hạn mức quét. Hết hạn mức thì extension dừng hẳn, không thử lại và không
gửi request nào nữa cho tới khi bạn bấm lại sau mốc mở lại.

### Tier 2 tự chạy khi nào

Trước bản này, tier 2 chỉ chạy khi bạn bấm. Đổi lại, một trang lừa đảo mà máy chủ chưa từng biết thì
im lặng tuyệt đối cho tới khi bạn tự nghi ngờ và tự bấm, mà lúc đó thường là muộn. Bản này mở một
đường tự quét hẹp, và hẹp ở đây có nghĩa cụ thể.

Extension chỉ tự gửi URL đầy đủ lên máy chủ khi **tất cả** những điều sau cùng đúng:

1. Công tắc "Tự quét trang lạ" trong popup đang bật. Nó bật sẵn, và tắt là đúng một cú bấm.
2. Trang là http hoặc https, và tên miền không phải địa chỉ nội bộ, tên máy trong mạng riêng, hay
   đuôi do cơ quan đăng ký cấp có kiểm tra pháp nhân như `.gov.vn`, `.edu.vn`, `.gov`, `.edu`.
3. Tên miền chưa có kết luận nào: không nằm trong bất kỳ mảng nào của danh sách tier 0, kể cả mảng
   mềm, và tier 1 cũng không trả về `phishing` hay `legit`. Một tên miền đã được đánh dấu hợp lệ thì
   **không bao giờ** bị tự quét, kể cả khi điểm rủi ro của nó rất cao. Một tên miền đã mang cờ mềm
   cũng không bị quét lại, vì cờ đó vốn đã là kết luận của chính model ấy.
4. Điểm rủi ro của tên miền, tính hoàn toàn trong máy bạn, đạt từ ngưỡng trở lên.
5. Hôm nay chưa tự quét tên miền đó, và số lượt tự quét trong ngày chưa chạm trần 6 lượt. Trần đó
   thấp hơn hẳn hạn mức 20 lượt mỗi ngày của một install token, để phần còn lại vẫn dành cho những
   lần bạn tự bấm.

**Điểm rủi ro tính hoàn toàn trong máy bạn và không một byte nào của phép tính đó rời khỏi máy.** Nó
chỉ đọc **tên miền**, không đọc URL đầy đủ, không đọc nội dung trang, không gọi mạng, không đọc kho
dữ liệu nào. Nó là một hàm thuần trong `src/lib/risk.ts` không import một module nào khác, và
`tests/risk/local-scoring.test.ts` khoá điều đó bằng cách cho mọi lối ra mạng nổ tung rồi bắt nó vẫn
chấm điểm được.

Những thứ làm tăng điểm đều đọc ra được từ chính tên miền: từ khoá cờ bạc, từ khoá làm bằng giả, từ
khoá dụ nhập OTP hoặc mật khẩu, tên thương hiệu ngân hàng hoặc sàn thương mại điện tử gắn vào một
tên miền không phải của họ, punycode `xn--`, IP công cộng trần, nền tảng host miễn phí, đuôi tên
miền rẻ, chuỗi số dài, nhiều dấu gạch ngang, subdomain sâu bất thường.

Popup liệt kê **đúng những tín hiệu đã kích hoạt cho trang bạn đang mở**, kèm điểm của từng tín
hiệu. Một cảnh báo mà không nói được vì sao là một cảnh báo không dùng được, nên phần đó không phải
tuỳ chọn.

Khi một lượt tự quét chạy, thứ rời khỏi máy đúng bằng thứ một cú bấm gửi đi: URL đầy đủ của tab, kèm
install token. Cảnh báo tự động cũng chỉ là badge và chữ trong popup; extension vẫn không chặn và
không chuyển hướng.

Cảnh báo sinh ra từ một lượt tự quét là **badge hổ phách**, không phải badge đỏ, vì nó cũng chỉ là
kết luận của model và chưa người nào kiểm chứng. Màu đỏ dành riêng cho mức đã có người xem và kết
luận.

**Tắt hẳn:** mở popup, bấm "Tắt tự quét trang lạ". Sau đó không lượt tự quét nào chạy nữa, kể cả với
trang điểm rủi ro cao nhất, và nút bấm tay vẫn dùng được. Trạng thái công tắc nằm trong IndexedDB
tại máy bạn, không gửi đi đâu.

## Tier 3: report, chỉ khi bạn bấm

Tier 3 cũng chỉ chạy sau một cú bấm của bạn: "Báo trang này lừa đảo" hoặc "Báo cảnh báo nhầm".

**Gửi đi:** `POST /v1/report` với header `Authorization: Bearer <install token>` và body JSON gồm:

- `url`: URL đầy đủ của tab đang mở, cùng cảnh báo về query string như ở tier 2.
- `claim`: đúng một trong hai giá trị `phishing` hoặc `false_positive`.

Hợp đồng API còn có ba trường tuỳ chọn `comment`, `html` và `turnstile_token`. Bản extension hiện
tại **không gửi trường nào trong ba trường đó**: popup không có ô nhập ghi chú, và extension không
bao giờ gửi HTML của trang. Nếu về sau popup mở ô ghi chú, thì chữ bạn tự gõ vào ô đó sẽ đi lên máy
chủ, và tài liệu này sẽ được sửa trước khi việc đó xảy ra.

Extension không nạp script Turnstile từ Cloudflare hay từ bất cứ máy chủ nào khác. Điều này được
khoá bằng test `tests/tier3/no-remote-turnstile.test.ts`. Không có script bên thứ ba nào chạy trong
extension này.

Một report là **lời khai của bạn gửi cho moderator**, không bao giờ tự động trở thành nhãn của
trang. Report gắn với install token của bạn, nên nó không nặc danh trước máy chủ.

Có đúng một việc mà một report tự làm được, và nó chỉ đi theo chiều HẠ cảnh báo: một khai báo
`false_positive` trên trang đang mang cờ mềm của máy sẽ rút cờ đó ngay, không moderator nào phải
duyệt, và trang biến khỏi mảng mềm của bản danh sách tiếp theo mà mọi máy tải về. Trên trang đã có
quyết định của người thì cùng khai báo ấy không rút gì cả, nó vào hàng chờ. Máy chủ nói rõ vế nào đã
xảy ra trong trường `soft_flag` của câu trả lời 202, và popup hiện lại nguyên văn vế đó. Không có
chiều ngược lại: không lời khai nào của người dùng NÂNG được mức cảnh báo của một trang.

## Install token: định danh, và nó nối các lần bấm lại với nhau

Install token là một chuỗi dạng `aft1_` cộng 43 ký tự, do máy chủ cấp qua `POST /v1/install` ở lần
đầu bạn dùng tier 2 hoặc tier 3. Nó được lưu trong IndexedDB tại máy bạn và tự làm mới sau số ngày
máy chủ chỉ định.

Đây là sự thật cần nói thẳng: **install token là một định danh**. Nó gắn vào mọi request tier 2 và
tier 3, nên máy chủ nối được tất cả các lần quét sâu và tất cả các report phát ra từ cùng một máy
cài đặt, kèm URL đầy đủ của từng lần. Cộng với địa chỉ IP trong log, đó là một hồ sơ giả danh có
thật, không phải một chuỗi ngẫu nhiên vô hại.

Ba giới hạn có chủ ý quanh nó:

- Token **không bao giờ** đi kèm tier 0 hay tier 1. Duyệt web thường không mang định danh nào.
- Token do máy chủ cấp cho một lượt cài đặt, không gắn với tài khoản, email, tên, hay số điện thoại.
  Extension không có đăng nhập và không hỏi bạn thông tin cá nhân nào.
- Xoá dữ liệu của extension là xoá token. Lần bấm tiếp theo xin một token mới, và máy chủ không có
  cách nào nối token mới với token cũ ngoài những gì suy ra được từ IP và thời điểm.

## Những gì nằm lại trong máy và không bao giờ rời máy

Extension dùng năm database IndexedDB, tất cả đều nằm trong hồ sơ Chrome của bạn trên máy này.
IndexedDB của extension **không** đồng bộ qua tài khoản Google, khác với `chrome.storage.sync`.

- `anti-fraud-blocklist`: danh sách đã tải, số phiên bản, etag, thời điểm tải.
- `anti-fraud-install`: install token và thời điểm cấp.
- `anti-fraud-disputes`: với mỗi trang bạn đã báo, lưu **tên miền dạng chữ thường rõ ràng**, loại
  báo cáo, mã report và thời điểm. Đây là lịch sử các trang bạn từng report, và nó nằm nguyên trong
  máy.
- `anti-fraud-dismissals`: với mỗi trang bạn đã tắt cảnh báo, lưu **tên miền dạng chữ thường rõ
  ràng** và thời điểm tắt. Đây là lịch sử các trang bạn từng tắt cảnh báo, cũng nằm nguyên trong máy.
- `anti-fraud-auto-scan`: trạng thái công tắc tự quét, và sổ ngân sách của ngày hôm nay gồm **tên
  miền dạng chữ thường rõ ràng** của những trang đã tự quét trong ngày, điểm rủi ro và kết luận. Sổ
  của những ngày trước bị xoá ngay khi có lượt tự quét đầu tiên của ngày mới, nên nó không tích lại
  thành lịch sử duyệt web. Sổ này nằm nguyên trong máy và không gửi đi đâu.

Việc bạn tắt cảnh báo cho một trang là một quyết định cục bộ. Nó không được gửi đi đâu và không đổi
kết luận của máy chủ về trang đó.

Trong bộ nhớ, chỉ tồn tại tới khi service worker ngủ: bản giải mã của danh sách tier 0 và các nhóm
tier 1 đã hỏi trong 5 phút gần nhất.

Gỡ extension xoá cả năm database.

## Những gì extension không bao giờ làm

- Không đọc nội dung trang. Không có content script, không xin quyền đọc trang, không chạm vào DOM
  của trang bạn đang xem.
- Không đọc mật khẩu, số thẻ, hay bất cứ thứ gì bạn gõ vào trang.
- Không gửi cookie. Mọi request đều đặt `credentials: "omit"`.
- Không dùng công cụ đo lường, không quảng cáo, không profile để bán, không chia sẻ dữ liệu với bên
  thứ ba, không bán dữ liệu.
- Không chặn trang, không chuyển hướng, không chèn trang khoá. Extension chỉ đổi badge và chữ trong
  popup. Điều này được khoá bằng `pnpm lint:no-blocking`.
- Không gửi URL đầy đủ của mọi trang bạn mở. Việc đó chỉ xảy ra sau một cú bấm của bạn, hoặc trong
  trường hợp hẹp của cổng tự quét ở mục "Tier 2 tự chạy khi nào": tối đa 6 tên miền một ngày, mỗi
  tên miền một lần, chỉ với tên miền chưa có kết luận và vượt ngưỡng rủi ro, và tắt được bằng một
  cú bấm.

## Thứ không giấu được: IP, User-Agent và ngôn ngữ trình duyệt

Mọi request HTTPS đều để lộ địa chỉ IP của bạn cho máy chủ nhận nó. Không có thiết kế nào trong
extension thay đổi được điều đó.

Chrome cũng tự gắn thêm hai header vào mọi request mà extension không tắt được, và chúng tôi đã đo
lại trên bản đang phát hành:

- `user-agent`: phiên bản Chrome, hệ điều hành và kiến trúc máy của bạn.
- `accept-language`: ngôn ngữ trình duyệt của bạn, ví dụ `vi-VN` hoặc `en-US`.

IP cộng hai header đó là một dấu vân tay thô của máy bạn. Nó không nhận diện được cá nhân một mình,
nhưng nó có thật và nó nằm trong log máy chủ.

Tài liệu này nói về những gì extension gửi đi. Nó không thay cho cam kết của máy chủ về việc giữ log
bao lâu và ai đọc được log; phần đó thuộc về dịch vụ chạy tại `anti-fraud.omelet.tech` và phải được
công bố riêng.

## Quyền extension xin, và vì sao

- `alarms`: để hẹn giờ tải lại danh sách tier 0 một ngày một lần. Service worker MV3 bị Chrome cho
  ngủ sau vài chục giây rảnh, nên không có API nào khác đánh thức nó theo lịch được.
- `tabs`: để đọc **URL của tab**. Không có quyền này thì Chrome trả về `undefined` và extension
  không có gì để băm. Quyền này cho phép đọc địa chỉ tab, **không** cho phép đọc nội dung trang.
- `host_permissions: https://anti-fraud.omelet.tech/*`: để gọi được đúng một máy chủ. Đây là một
  origin duy nhất, không phải `<all_urls>`.

Extension **không** xin quyền đọc mọi trang, **không** cài content script, và **không** xin quyền
`storage`.

## Cách xoá dữ liệu của bạn

Tại máy: `chrome://extensions`, chọn extension, "Remove". Việc này xoá cả năm database kể trên, kể
cả install token.

Tại máy chủ: extension không có nút xoá dữ liệu phía máy chủ. Muốn xoá những gì đã gửi trong tier 2
và tier 3, bạn phải liên hệ người vận hành dịch vụ. Đây là một hở của bản hiện tại và nó được ghi ra
thay vì bỏ qua.

## Trẻ em

Extension không nhắm tới trẻ em dưới 13 tuổi và không cố ý thu thập dữ liệu từ trẻ em. Nó không có
tài khoản, không hỏi tuổi, và không hỏi thông tin cá nhân nào.

## Thay đổi chính sách này

Bất kỳ thay đổi nào về việc extension gửi gì đi đâu đều phải sửa tài liệu này trong cùng một commit
với thay đổi mã. Ngày ở đầu tài liệu là ngày sửa gần nhất.

## Liên hệ

Mở issue tại repo mã nguồn của extension. Repo là công khai và toàn bộ mã trong file zip phát hành
đọc được trực tiếp từ đó.
