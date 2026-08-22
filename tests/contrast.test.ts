import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AA_NORMAL_TEXT,
  DARK_INK,
  LIGHT_INK,
  contrastRatio,
  inkOn,
  parseHex,
  ratioOfInkOn,
} from "../src/lib/contrast.ts";
import {
  DISMISSED_COLOR,
  DISPUTED_COLOR,
  LEGIT_COLOR,
  PENDING_COLOR,
  PHISHING_COLOR,
  SOFT_COLOR,
  UNKNOWN_COLOR,
} from "../src/lib/badge.ts";

const POPUP_SOURCE = readFileSync(resolve(process.cwd(), "src/popup/popup.ts"), "utf8");

const BADGE_COLORS: readonly [string, string][] = [
  ["phishing", PHISHING_COLOR],
  ["soft", SOFT_COLOR],
  ["legit", LEGIT_COLOR],
  ["unknown", UNKNOWN_COLOR],
  ["pending", PENDING_COLOR],
  ["disputed", DISPUTED_COLOR],
  ["dismissed", DISMISSED_COLOR],
];

describe("chip trạng thái đọc được trên mọi màu badge", () => {
  it("mọi màu badge đều đạt 4.5:1 với mực được chọn", () => {
    for (const [name, color] of BADGE_COLORS) {
      expect(ratioOfInkOn(color), `${name} ${color}`).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    }
  });

  it("chữ trắng cố định thì có màu trượt ngưỡng, nên phải chọn mực chứ không đặt cứng", () => {
    const white = parseHex(LIGHT_INK);
    expect(white).not.toBeNull();

    const slipping = BADGE_COLORS.filter(([, color]) => {
      const parsed = parseHex(color);
      return parsed !== null && white !== null && contrastRatio(parsed, white) < AA_NORMAL_TEXT;
    });

    expect(slipping.length).toBeGreaterThan(0);
    for (const [, color] of slipping) {
      expect(inkOn(color)).toBe(DARK_INK);
    }
  });

  it("nền tối chọn mực sáng, nền sáng chọn mực tối", () => {
    expect(inkOn("#000000")).toBe(LIGHT_INK);
    expect(inkOn("#ffffff")).toBe(DARK_INK);
    expect(inkOn("#fff")).toBe(DARK_INK);
  });

  it("màu không đọc được thì rơi về mực tối chứ không ném lỗi", () => {
    expect(parseHex("không phải màu")).toBeNull();
    expect(inkOn("không phải màu")).toBe(DARK_INK);
    expect(ratioOfInkOn("không phải màu")).toBe(0);
  });

  it("popup thật sự dùng hàm chọn mực, không đặt màu chữ cứng cho chip", () => {
    expect(POPUP_SOURCE).toContain("inkOn(view.color)");
    expect(POPUP_SOURCE).toContain("badge.style.color");
  });
});
