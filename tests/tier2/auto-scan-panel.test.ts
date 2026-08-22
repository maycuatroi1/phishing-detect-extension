import { describe, expect, it } from "vitest";
import {
  AUTO_SCAN_OFF_LABEL,
  AUTO_SCAN_ON_LABEL,
  autoScanPanelView,
} from "../../src/popup/auto-scan-panel.ts";
import { AUTO_SCAN_DAILY_CAP } from "../../src/lib/auto-scan.ts";
import { scoreHost } from "../../src/lib/risk.ts";

const HIGH = scoreHost("mamibet88.cc");

const LOW = scoreHost("tuoitre.vn");

const GATED = scoreHost("hanoi.gov.vn");

describe("popup nói được vì sao nó tự quét trang này", () => {
  it("liệt kê đúng từng tín hiệu đã kích hoạt, kèm điểm của tín hiệu đó", () => {
    const view = autoScanPanelView({
      kind: "ready",
      enabled: true,
      risk: HIGH,
      entry: { host: HIGH.host, scannedAt: 1_800_000_000_000, score: HIGH.score, isScam: true },
      budgetLeft: 5,
    });

    expect(view.headline).toContain("đã tự quét");
    expect(view.reasons).toHaveLength(HIGH.signals.length);
    expect(view.reasons.some((line) => line.includes("cờ bạc"))).toBe(true);
    expect(view.reasons.some((line) => line.includes("đuôi rẻ"))).toBe(true);
    expect(view.reasons.every((line) => /\(\+\d+\)$/.test(line))).toBe(true);
    expect(view.detail).toContain("lừa đảo");
    expect(view.detail).toContain("còn 5 lượt");
  });

  it("trang điểm thấp cũng được nói thẳng là sẽ quét, và điểm 0 không được đọc thành an toàn", () => {
    const view = autoScanPanelView({ kind: "ready", enabled: true, risk: LOW, entry: null, budgetLeft: 6 });

    expect(view.headline).toContain("sẽ được tự quét");
    expect(view.detail).toContain("không nghĩa là trang an toàn");
    expect(view.detail).toContain("còn 6 lượt");
    expect(view.reasons).toEqual([]);
    expect(view.buttonLabel).toBe(AUTO_SCAN_OFF_LABEL);
  });

  it("không một dòng chữ nào trong panel còn nói tới ngưỡng rủi ro", () => {
    const views = [
      autoScanPanelView({ kind: "unsupported" }),
      autoScanPanelView({ kind: "saving", turningOff: true }),
      autoScanPanelView({ kind: "ready", enabled: true, risk: LOW, entry: null, budgetLeft: 6 }),
      autoScanPanelView({ kind: "ready", enabled: false, risk: LOW, entry: null, budgetLeft: 6 }),
      autoScanPanelView({ kind: "ready", enabled: true, risk: HIGH, entry: null, budgetLeft: 6 }),
      autoScanPanelView({ kind: "ready", enabled: true, risk: GATED, entry: null, budgetLeft: 6 }),
    ];

    for (const view of views) {
      expect(`${view.headline} ${view.detail}`, view.headline).not.toContain("ngưỡng");
    }
  });

  it("nói ra rằng một host đã có kết quả thì không tốn lượt nào", () => {
    const view = autoScanPanelView({ kind: "unsupported" });

    expect(view.detail).toContain("không tiêu lượt nào");
    expect(view.detail).toContain(String(AUTO_SCAN_DAILY_CAP));
  });

  it("trang được miễn thì nêu lý do miễn chứ không để trống", () => {
    const view = autoScanPanelView({ kind: "ready", enabled: true, risk: GATED, entry: null, budgetLeft: 6 });

    expect(view.reasons).toHaveLength(1);
    expect(view.reasons[0]).toContain("pháp nhân");
  });

  it("khi người dùng đã tắt thì nút mời bật lại và vẫn nói trang này đáng ngờ ở đâu", () => {
    const view = autoScanPanelView({ kind: "ready", enabled: false, risk: HIGH, entry: null, budgetLeft: 6 });

    expect(view.buttonLabel).toBe(AUTO_SCAN_ON_LABEL);
    expect(view.headline).toContain("đang tắt");
    expect(view.reasons).toHaveLength(HIGH.signals.length);
  });

  it("tab không phải http hay https thì nút tắt hẳn, không có tín hiệu nào để kể", () => {
    const view = autoScanPanelView({ kind: "unsupported" });

    expect(view.buttonEnabled).toBe(false);
    expect(view.reasons).toEqual([]);
  });
});
