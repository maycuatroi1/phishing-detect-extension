import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { StoredDispute } from "../../src/lib/dispute-store.ts";
import {
  FALSE_POSITIVE_LABEL,
  PHISHING_LABEL,
  reportPanelView,
  warningLevel,
} from "../../src/popup/report-panel.ts";
import { MEASURED_FALSE_POSITIVE_REPORT_ID, MEASURED_REPORT_ID } from "../helpers/report.ts";

const NOW = 1_800_000_000_000;

const FALSE_POSITIVE_DISPUTE: StoredDispute = {
  host: "vietcombank-otp.example",
  claim: "false_positive",
  reportId: MEASURED_FALSE_POSITIVE_REPORT_ID,
  filedAt: NOW,
};

const PHISHING_DISPUTE: StoredDispute = {
  host: "vietcombank-otp.example",
  claim: "phishing",
  reportId: MEASURED_REPORT_ID,
  filedAt: NOW,
};

const POPUP_HTML = readFileSync(resolve(process.cwd(), "src/popup/index.html"), "utf8");

describe("đường báo nhầm luôn nằm sẵn ngay cạnh cảnh báo", () => {
  it("popup có sẵn hai nút, mỗi nút một cú bấm, không ô nhập nào", () => {
    expect(POPUP_HTML).toContain("data-action=\"report-false-positive\"");
    expect(POPUP_HTML).toContain("data-action=\"report-phishing\"");
    expect(POPUP_HTML).toContain("data-slot=\"report-headline\"");
    expect(POPUP_HTML).toContain("data-slot=\"report-detail\"");
    expect(POPUP_HTML).not.toContain("<input");
    expect(POPUP_HTML).not.toContain("<textarea");
  });

  it("khi trang đang bị cảnh báo cứng, nút báo nhầm bật sẵn và được gọi tên trong lời dặn", () => {
    const view = reportPanelView({ kind: "ready", verdict: "phishing", dispute: null });

    expect(warningLevel("phishing", null)).toBe("hard");
    expect(view.falsePositiveEnabled).toBe(true);
    expect(view.falsePositiveLabel).toBe(FALSE_POSITIVE_LABEL);
    expect(view.detail).toContain(FALSE_POSITIVE_LABEL);
    expect(view.detail).toContain("một cú bấm");
  });

  it("trang chưa bị cảnh báo vẫn báo nhầm được, vì tier khác cũng cảnh báo được", () => {
    const view = reportPanelView({ kind: "ready", verdict: "unknown", dispute: null });

    expect(warningLevel("unknown", null)).toBe("none");
    expect(view.falsePositiveEnabled).toBe(true);
    expect(view.phishingEnabled).toBe(true);
    expect(view.phishingLabel).toBe(PHISHING_LABEL);
  });

  it("đã báo nhầm rồi thì mức cảnh báo là mềm và nút ấy tắt đi", () => {
    const view = reportPanelView({
      kind: "ready",
      verdict: "phishing",
      dispute: FALSE_POSITIVE_DISPUTE,
    });

    expect(warningLevel("phishing", FALSE_POSITIVE_DISPUTE)).toBe("soft");
    expect(view.headline).toContain("mức mềm");
    expect(view.detail).toContain(MEASURED_FALSE_POSITIVE_REPORT_ID);
    expect(view.falsePositiveEnabled).toBe(false);
    expect(view.phishingEnabled).toBe(true);
  });

  it("một lời khai lừa đảo không tự nâng cảnh báo, và view nói thẳng điều đó", () => {
    expect(warningLevel("unknown", PHISHING_DISPUTE)).toBe("none");

    const view = reportPanelView({ kind: "ready", verdict: "unknown", dispute: PHISHING_DISPUTE });
    expect(view.detail).toContain("không bao giờ tự thành nhãn");
    expect(view.phishingEnabled).toBe(false);
    expect(view.falsePositiveEnabled).toBe(true);
  });

  it("tab không phải http hay https thì cả hai nút tắt", () => {
    const view = reportPanelView({ kind: "unsupported" });
    expect(view.phishingEnabled).toBe(false);
    expect(view.falsePositiveEnabled).toBe(false);
  });

  it("đang gửi thì không bấm chồng được, và nút đang chạy đổi nhãn", () => {
    const view = reportPanelView({ kind: "filing", claim: "false_positive" });
    expect(view.phishingEnabled).toBe(false);
    expect(view.falsePositiveEnabled).toBe(false);
    expect(view.falsePositiveLabel).not.toBe(FALSE_POSITIVE_LABEL);
    expect(view.phishingLabel).toBe(PHISHING_LABEL);
  });
});

describe("view nói đúng chuyện gì vừa xảy ra sau khi gửi", () => {
  it("báo nhầm vào hàng chờ thì view nói rõ cảnh báo đã hạ ngay trên máy", () => {
    const view = reportPanelView({
      kind: "filed",
      outcome: {
        kind: "queued",
        reportId: MEASURED_FALSE_POSITIVE_REPORT_ID,
        gate: "not-required",
        claim: "false_positive",
        softened: true,
      },
      dispute: FALSE_POSITIVE_DISPUTE,
    });

    expect(view.headline).toContain("báo nhầm");
    expect(view.detail).toContain(MEASURED_FALSE_POSITIVE_REPORT_ID);
    expect(view.detail).toContain("mức mềm");
    expect(view.detail).toContain("hàng chờ moderator");
    expect(view.detail).toContain("not-required");
    expect(view.falsePositiveEnabled).toBe(false);
  });

  it("server đòi Turnstile thì view nói thẳng extension không giải thay được", () => {
    const view = reportPanelView({
      kind: "filed",
      outcome: { kind: "turnstile_required", message: "After 3 reports inside 3600 seconds..." },
      dispute: null,
    });

    expect(view.headline).toContain("Turnstile");
    expect(view.detail).toContain("không nạp được script Turnstile");
    expect(view.phishingEnabled).toBe(false);
    expect(view.falsePositiveEnabled).toBe(false);
  });

  it("429 thì view nói số giây chờ và nói rõ không có thời điểm mở lại", () => {
    const view = reportPanelView({
      kind: "filed",
      outcome: { kind: "rate_limited", message: "Too many reports.", retryAfterSeconds: 1847 },
      dispute: null,
    });

    expect(view.detail).toContain("1847 giây");
    expect(view.detail).toContain("không trả thời điểm mở lại");
    expect(view.falsePositiveEnabled).toBe(false);
  });
});
