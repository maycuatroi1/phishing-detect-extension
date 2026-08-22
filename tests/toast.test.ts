import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { AutoScanOutcome } from "../src/lib/auto-scan.ts";
import type { HostRisk } from "../src/lib/risk.ts";
import {
  CLEAN_IS_NOT_A_CLEARANCE,
  TOAST_ID_PREFIX,
  TOAST_TIMEOUT_MS,
  TOAST_TONES,
  toastFor,
} from "../src/lib/toast.ts";

const MANIFEST = JSON.parse(
  readFileSync(resolve(process.cwd(), "public/manifest.json"), "utf8"),
) as { permissions: string[]; host_permissions: string[] };

const BACKGROUND_TOAST = readFileSync(
  resolve(process.cwd(), "src/background/toast.ts"),
  "utf8",
);

const BACKGROUND_AUTO_SCAN = readFileSync(
  resolve(process.cwd(), "src/background/auto-scan.ts"),
  "utf8",
);

const RISK: HostRisk = { host: "a.example", score: 0, exempt: false, exemptReason: null, signals: [] };

function scanned(isScam: boolean | null, fromCache = false): AutoScanOutcome {
  return {
    kind: "scanned",
    risk: RISK,
    outcome: { kind: "unavailable", reason: "bài kiểm không dùng tới nhánh này" },
    isScam,
    fromCache,
  };
}

describe("quét xong thì nói ra, không bắt người dùng mở popup mới biết", () => {
  it("kết luận lừa đảo thành một thông báo mang đúng host", () => {
    const notice = toastFor("dodgy.example", scanned(true));

    expect(notice).not.toBeNull();
    expect(notice?.tone).toBe("scam");
    expect(notice?.title).toContain("dodgy.example");
    expect(notice?.message).toContain("lừa đảo");
  });

  it("kết luận sạch cũng có thông báo, và nó không được đọc như một giấy chứng nhận", () => {
    const notice = toastFor("clean.example", scanned(false));

    expect(notice?.tone).toBe("clean");
    expect(notice?.message).toContain("Không thấy dấu hiệu");
    expect(notice?.message).toContain(CLEAN_IS_NOT_A_CLEARANCE);
  });

  it("cảnh báo do máy dựng phải nói rõ là chưa ai kiểm chứng", () => {
    const notice = toastFor("dodgy.example", scanned(true));

    expect(notice?.message).toContain("chưa có người kiểm chứng");
    expect(notice?.message).toContain("Báo cảnh báo nhầm");
  });

  it("phân biệt kết quả vừa quét với kết quả lấy từ cache", () => {
    const fresh = toastFor("a.example", scanned(true, false));
    const cached = toastFor("a.example", scanned(true, true));

    expect(fresh?.message).toContain("Vừa quét xong");
    expect(cached?.message).toContain("từ lượt quét trước");
    expect(fresh?.message).not.toBe(cached?.message);
  });

  it("không đọc được kết luận thì nói thẳng là chưa kết luận được", () => {
    const notice = toastFor("mystery.example", scanned(null));

    expect(notice?.tone).toBe("unreadable");
    expect(notice?.title).toContain("Chưa kết luận được");
    expect(TOAST_TONES).toContain(notice?.tone);
  });

  it("lượt bị bỏ qua thì im lặng, vì không có gì mới để nói", () => {
    const skipped: AutoScanOutcome = {
      kind: "skipped",
      reason: "already_scanned_recently",
      risk: RISK,
    };

    expect(toastFor("quiet.example", skipped)).toBeNull();
  });

  it("một host chỉ giữ một thông báo, lần sau ghi đè lên chính nó", () => {
    const first = toastFor("same.example", scanned(true));
    const second = toastFor("same.example", scanned(false));

    expect(first?.id).toBe(second?.id);
    expect(first?.id).toBe(`${TOAST_ID_PREFIX}:same.example`);
  });

  it("thông báo tự tắt, không nằm lại trên màn hình", () => {
    const notice = toastFor("a.example", scanned(true));

    expect(notice?.timeoutMs).toBe(TOAST_TIMEOUT_MS);
    expect(TOAST_TIMEOUT_MS).toBeGreaterThanOrEqual(3_000);
    expect(TOAST_TIMEOUT_MS).toBeLessThanOrEqual(5_000);
    expect(BACKGROUND_TOAST).toContain("requireInteraction: false");
    expect(BACKGROUND_TOAST).toContain("chrome.notifications.clear");
  });
});

describe("thông báo không được đi ngược lại lựa chọn của người dùng", () => {
  it("tắt cảnh báo cho host nào thì host đó không còn bị thông báo cảnh báo", () => {
    expect(BACKGROUND_TOAST).toContain("hostIsSilenced");
    expect(BACKGROUND_TOAST).toContain('notice.tone === "scam" && (await hostIsSilenced(host))');
  });

  it("tự quét gọi đúng chỗ thông báo sau khi đã có kết quả", () => {
    expect(BACKGROUND_AUTO_SCAN).toContain("announceAutoScan(host, outcome)");
  });
});

describe("thông báo chỉ xin đúng một quyền, không xin quyền đọc trang", () => {
  it("manifest xin notifications và không xin content script trên mọi trang", () => {
    expect(MANIFEST.permissions).toContain("notifications");
    expect(MANIFEST.permissions).not.toContain("scripting");
    expect(MANIFEST.host_permissions).toEqual(["https://anti-fraud.omelet.tech/*"]);
    expect(Object.keys(MANIFEST)).not.toContain("content_scripts");
  });
});
