export const LIGHT_INK = "#ffffff";

export const DARK_INK = "#111827";

export const AA_NORMAL_TEXT = 4.5;

export const CONTRAST_RATIONALE =
  "Màu badge do lib/badge.ts quyết định vì nó phải hợp với badge của Chrome, và Chrome tự lo phần " +
  "chữ trên badge của nó. Chip trong popup thì là chữ của chúng ta trên nền ấy, nên chữ trắng cố " +
  "định sẽ trượt ngưỡng ngay khi màu nền sáng lên. Chọn mực theo độ sáng thật của nền là cách duy " +
  "nhất đúng cho mọi màu, kể cả màu thêm về sau.";

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export function parseHex(value: string): Rgb | null {
  const raw = value.trim().replace(/^#/, "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((char) => char + char)
          .join("")
      : raw;

  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    return null;
  }

  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

function channel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(color: Rgb): number {
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

export function contrastRatio(left: Rgb, right: Rgb): number {
  const a = relativeLuminance(left) + 0.05;
  const b = relativeLuminance(right) + 0.05;
  return a > b ? a / b : b / a;
}

export function inkOn(background: string): string {
  const color = parseHex(background);
  if (color === null) {
    return DARK_INK;
  }

  const light = parseHex(LIGHT_INK);
  const dark = parseHex(DARK_INK);
  if (light === null || dark === null) {
    return DARK_INK;
  }

  return contrastRatio(color, light) >= contrastRatio(color, dark) ? LIGHT_INK : DARK_INK;
}

export function ratioOfInkOn(background: string): number {
  const color = parseHex(background);
  const ink = parseHex(inkOn(background));
  if (color === null || ink === null) {
    return 0;
  }
  return contrastRatio(color, ink);
}
