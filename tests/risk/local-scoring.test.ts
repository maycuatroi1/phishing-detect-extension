import { afterEach, describe, expect, it, vi } from "vitest";
import { RISK_THRESHOLD, isHighRisk, scoreHost } from "../../src/lib/risk.ts";
import { reachableFrom, readSource } from "../helpers/imports.ts";

const WHITELIST_NEAR_MISSES = [
  "benhvien199.vn",
  "bvbs150798.com",
  "vnptdanang.vn",
  "19-8hospital.vn",
  "benhvien198.net",
  "bkhost.vn",
  "blockchain.vn",
  "bqlctgtqng.vn",
  "congnghiep247.com",
  "coolmate.me",
  "dulichdalat.pro",
  "hailocvn.com",
  "halongtourism.info",
  "tradeline.vn",
  "truongthinh.info",
  "vesinhnha247.com",
  "vudigital.co",
  "5ky.vn",
  "api.web2m.com",
  "benhvienquan11.vn",
  "benhvientamthanphutho.com.vn",
  "cat-event.com.vn",
  "daithanh-group.vn",
  "dalat-info.vn",
  "giaoducthudo.giaoducthoidai.vn",
  "hub-js.com",
  "net1s.com",
  "nhatrang-travel.com",
  "quatest3.com.vn",
  "sonha-sg.com.vn",
];

const WHITELIST_GATED = [
  "1022.cantho.gov.vn",
  "hanoi.gov.vn",
  "aichallenge.hochiminhcity.gov.vn",
  "angiang.toaan.gov.vn",
  "angiang.edu.vn",
  "hust.edu.vn",
  "dilinh.lamdong.dcs.vn",
];

const BLACKLIST_CAUGHT = [
  "0000.live",
  "7777.mu",
  "92clube.com",
  "amazon186.pro",
  "bangdaihochinhquy.com",
  "binancenet.info",
  "btgetvn.com",
  "coinex-vip9.com",
  "eventslazadavn.com",
  "hcmc-tiktok-vn.com",
  "kk95888.com",
  "lambangcap3-dongnai.com",
  "lambangcap3thpt-binhduong.com",
  "lambangcap3thpt-kiengiang.com",
  "lambangcap3thpt-tayninh.com",
  "lambangdaihocchinhquy.wordpress.com",
  "lambanggia.org",
  "lazada69.com",
  "lodesieuvip.com",
  "muabanacc365.com",
  "profitfx.co",
  "robux365.com",
  "soicau3canghomnay.com",
  "taisunwin.it.com",
  "tiktokshop-consignment.com",
  "usdtcw.com",
  "vn100a.com",
  "vn168a.com",
  "vnmall.net",
  "win5524.com",
];

const EVERYDAY_HOSTS = [
  "google.com",
  "docs.google.com",
  "accounts.google.com",
  "youtube.com",
  "facebook.com",
  "github.com",
  "stackoverflow.com",
  "wikipedia.org",
  "amazon.com",
  "netflix.com",
  "chatgpt.com",
  "claude.ai",
  "openai.com",
  "linkedin.com",
  "cloudflare.com",
  "huggingface.co",
  "login.microsoftonline.com",
  "id.apple.com",
  "paypal.com",
  "coinbase.com",
  "binance.com",
  "tradingview.com",
  "investing.com",
  "marketwatch.com",
  "finance.yahoo.com",
  "vnexpress.net",
  "tuoitre.vn",
  "thanhnien.vn",
  "vietnamnet.vn",
  "24h.com.vn",
  "shopee.vn",
  "tiki.vn",
  "lazada.vn",
  "vietcombank.com.vn",
  "techcombank.com.vn",
  "zalo.me",
];

const NETWORK_GLOBALS = ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "indexedDB", "chrome"];

const BANNED_SOURCE_TOKENS = [
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "sendBeacon",
  "navigator",
  "chrome.",
  "indexedDB",
  "crypto.",
  "Math.random",
  "Date.now",
  "new Date",
  "import(",
  "require(",
];

function cutEveryWire(): void {
  for (const name of NETWORK_GLOBALS) {
    vi.stubGlobal(name, () => {
      throw new Error(`chấm điểm rủi ro đã chạm vào ${name}, mà nó phải chạy hoàn toàn trong máy`);
    });
  }
  vi.stubGlobal("navigator", {
    sendBeacon: () => {
      throw new Error("chấm điểm rủi ro đã gọi navigator.sendBeacon");
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chấm điểm rủi ro chạy hoàn toàn trong máy", () => {
  it("chấm được cả trăm host trong khi mọi lối ra mạng đều nổ tung", () => {
    cutEveryWire();

    const hosts = [...WHITELIST_NEAR_MISSES, ...WHITELIST_GATED, ...BLACKLIST_CAUGHT, ...EVERYDAY_HOSTS];
    expect(hosts.length).toBeGreaterThan(100);

    const scored = hosts.map((host) => scoreHost(host));
    expect(scored).toHaveLength(hosts.length);
    expect(scored.every((risk) => Number.isInteger(risk.score))).toBe(true);
  });

  it("bộ chấm điểm không import một module nào khác, nên nó không có đường nào ra mạng", () => {
    expect(Array.from(reachableFrom("lib/risk.ts"))).toEqual(["lib/risk.ts"]);
  });

  it("nguồn của bộ chấm điểm không nhắc tới bất kỳ API mạng, kho hay đồng hồ nào", () => {
    const text = readSource("lib/risk.ts");
    for (const banned of BANNED_SOURCE_TOKENS) {
      expect(text, `lib/risk.ts nhắc tới ${banned}`).not.toContain(banned);
    }
  });

  it("cùng một host luôn ra cùng một điểm, không phụ thuộc đồng hồ hay số ngẫu nhiên", () => {
    for (const host of BLACKLIST_CAUGHT) {
      expect(scoreHost(host)).toEqual(scoreHost(host));
    }
  });
});

describe("hiệu chuẩn ngưỡng đo trên corpus eval-v1", () => {
  it("host Bình đã gặp thật vượt ngưỡng, và vượt vì những lý do nói ra được", () => {
    const risk = scoreHost("mamibet88.cc");
    expect(isHighRisk(risk)).toBe(true);
    expect(risk.score).toBe(8);
    expect(risk.signals.map((signal) => signal.id).sort()).toEqual([
      "cheap-tld",
      "digits",
      "gambling-word",
      "lucky-tail",
    ]);
    expect(risk.signals.every((signal) => signal.note.length > 20)).toBe(true);
  });

  it("ba mươi host hợp lệ sát ngưỡng nhất trong eval-v1 vẫn không host nào vượt", () => {
    expect(WHITELIST_NEAR_MISSES).toHaveLength(30);
    for (const host of WHITELIST_NEAR_MISSES) {
      const risk = scoreHost(host);
      expect(isHighRisk(risk), `${host} đạt ${risk.score} điểm, không được vượt ${RISK_THRESHOLD}`).toBe(false);
    }
  });

  it("host .gov.vn, .edu.vn và .dcs.vn được miễn quét chứ không chỉ dưới ngưỡng", () => {
    for (const host of WHITELIST_GATED) {
      const risk = scoreHost(host);
      expect(risk.exempt, `${host} phải được miễn`).toBe(true);
      expect(risk.exemptReason).not.toBeNull();
      expect(isHighRisk(risk)).toBe(false);
    }
  });

  it("ba mươi host lừa đảo lấy đều tay từ eval-v1 đều vượt ngưỡng", () => {
    expect(BLACKLIST_CAUGHT).toHaveLength(30);
    for (const host of BLACKLIST_CAUGHT) {
      const risk = scoreHost(host);
      expect(isHighRisk(risk), `${host} chỉ đạt ${risk.score} điểm`).toBe(true);
    }
  });

  it("ba mươi sáu trang người ta mở hằng ngày không trang nào bị tự quét", () => {
    for (const host of EVERYDAY_HOSTS) {
      const risk = scoreHost(host);
      expect(isHighRisk(risk), `${host} đạt ${risk.score} điểm: ${risk.signals.map((s) => s.id).join(",")}`).toBe(false);
    }
  });

  it("địa chỉ nội bộ và tên máy trong mạng riêng không bao giờ bị gửi đi quét", () => {
    for (const host of ["192.168.1.1", "10.0.0.5", "127.0.0.1", "172.16.3.4", "localhost", "nas.local", "router"]) {
      expect(scoreHost(host).exempt, `${host} phải được miễn`).toBe(true);
    }
  });

  it("IP công cộng trần thì ngược lại, đủ điểm để quét", () => {
    const risk = scoreHost("203.0.113.9");
    expect(risk.exempt).toBe(false);
    expect(isHighRisk(risk)).toBe(true);
  });
});
