import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { statusPanelView } from "../src/popup/status-panel.ts";
import { warningPanelView } from "../src/popup/warning-panel.ts";

const POPUP_HTML = readFileSync(resolve(process.cwd(), "src/popup/index.html"), "utf8");

const BODY = POPUP_HTML.slice(POPUP_HTML.indexOf("<body>"));

const LONG_SLOTS = [
  "status-detail",
  "scan-detail",
  "warning-detail",
  "auto-scan-detail",
  "report-detail",
  "auto-scan-reasons",
];

function enclosingDetails(slot: string): string | null {
  const at = BODY.indexOf(`data-slot="${slot}"`);
  if (at < 0) {
    return null;
  }
  const opened = BODY.lastIndexOf("<details", at);
  if (opened < 0) {
    return null;
  }
  const closed = BODY.indexOf("</details>", at);
  return closed < 0 ? null : BODY.slice(opened, closed);
}

describe("popup mở ra là đọc được ngay, chữ dài nằm sau một cú bấm", () => {
  it("mọi đoạn giải thích dài đều nằm trong một details đang đóng", () => {
    for (const slot of LONG_SLOTS) {
      const block = enclosingDetails(slot);
      expect(block, slot).not.toBeNull();
      expect(block, slot).not.toContain("<details open");
    }
  });

  it("đoạn văn nằm ngoài details đều ngắn, không có bức tường chữ nào", () => {
    const outside = BODY.replace(/<details[\s\S]*?<\/details>/g, "");
    const paragraphs = [...outside.matchAll(/<p(?=[\s>])[^>]*>([\s\S]*?)<\/p>/g)].map((match) =>
      match[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim(),
    );

    expect(paragraphs.length).toBeGreaterThan(0);
    for (const paragraph of paragraphs) {
      expect(paragraph.length, paragraph).toBeLessThanOrEqual(90);
    }
  });

  it("lời hứa không chặn vẫn hiện sẵn, không bị gấp vào details", () => {
    const outside = BODY.replace(/<details[\s\S]*?<\/details>/g, "");

    expect(outside).toContain("không chặn trang");
    expect(outside).toContain("không chuyển hướng");
  });

  it("mỗi details có một summary nói rõ bên trong là gì", () => {
    const summaries = BODY.match(/<summary>/g) ?? [];
    const details = BODY.match(/<details[\s>]/g) ?? [];

    expect(summaries.length).toBe(details.length);
    expect(details.length).toBeGreaterThanOrEqual(6);
  });

  it("chữ trung thực không bị cắt đi, chỉ bị gấp lại", () => {
    const unknown = statusPanelView({ kind: "ready", verdict: "unknown", level: "none" });
    const machine = warningPanelView({ kind: "ready", level: "machine", dismissal: null });

    expect(unknown.detail).toContain("không có nghĩa là an toàn");
    expect(machine.detail).toContain("không chặn");
    expect(machine.detail).toContain("Màu đỏ mới là mức đã có người xem và kết luận");
  });

  it("dòng kết luận ngắn hơn hẳn đoạn giải thích, nên nó mới là thứ đọc trước", () => {
    const unknown = statusPanelView({ kind: "ready", verdict: "unknown", level: "none" });

    expect(unknown.headline.length).toBeLessThan(unknown.detail.length / 2);
  });
});

describe("popup giữ đủ chỗ cho mọi thứ popup.ts vẽ ra", () => {
  it("host của tab hiện tại có chỗ riêng, không lẫn vào đoạn văn", () => {
    expect(BODY).toContain('data-slot="host"');
  });

  it("nút mang nhãn trong một span riêng nên đổi nhãn không xoá mất icon", () => {
    const buttons = BODY.match(/<button[\s\S]*?<\/button>/g) ?? [];

    expect(buttons.length).toBeGreaterThanOrEqual(5);
    for (const button of buttons) {
      expect(button).toContain("data-label");
    }
  });

  it("icon là svg chứ không phải emoji", () => {
    expect(BODY).toContain("<svg");
    expect(BODY).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it("mọi svg trang trí đều bị ẩn khỏi trình đọc màn hình", () => {
    const svgs = BODY.match(/<svg[^>]*>/g) ?? [];

    expect(svgs.length).toBeGreaterThan(0);
    for (const svg of svgs) {
      expect(svg).toContain('aria-hidden="true"');
    }
  });

  it("có bộ token màu cho cả nền sáng và nền tối", () => {
    expect(POPUP_HTML).toContain("prefers-color-scheme: dark");
    expect(POPUP_HTML).toContain("prefers-reduced-motion: reduce");
    expect(POPUP_HTML).toContain(":focus-visible");
  });
});
