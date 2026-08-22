export const PACKAGE_ZIP_NAME = "extension.zip";

export const MANIFEST_ENTRY_NAME = "manifest.json";

export const PACKABLE_EXTENSIONS: readonly string[] = [
  ".css",
  ".html",
  ".js",
  ".json",
  ".png",
  ".svg",
  ".woff2",
];

export const REJECTED_EXTENSIONS: readonly string[] = [
  ".cjs",
  ".log",
  ".map",
  ".md",
  ".mts",
  ".ts",
  ".tsbuildinfo",
  ".tsx",
  ".yaml",
  ".yml",
  ".zip",
];

export const REJECTED_SEGMENTS: readonly string[] = [
  ".git",
  "coverage",
  "node_modules",
  "plans",
  "scripts",
  "src",
  "test",
  "tests",
  "vendor",
];

export const PNG_SIGNATURE = "89504e470d0a1a0a";

export type PackRefusal =
  | "zip-artifact"
  | "dotfile"
  | "rejected-segment"
  | "rejected-extension"
  | "unlisted-extension";

export interface PackDecision {
  readonly name: string;
  readonly packed: boolean;
  readonly refusal: PackRefusal | null;
}

export const WHY_REFUSED: Record<PackRefusal, string> = {
  "zip-artifact": "file zip của lần đóng gói trước, không bao giờ gói lại vào chính nó",
  dotfile: "file hoặc thư mục ẩn, Chrome không cần và nó hay mang cấu hình cục bộ",
  "rejected-segment": "nằm trong thư mục mã nguồn, test hoặc phụ thuộc, không phải thứ Chrome chạy",
  "rejected-extension": "đuôi này là mã nguồn, sourcemap hoặc tài liệu, không phải thứ Chrome chạy",
  "unlisted-extension": "đuôi không nằm trong danh sách thứ Chrome cần chạy",
};

export function extensionOf(name: string): string {
  const base = name.slice(name.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot).toLowerCase();
}

export function decidePackEntry(name: string): PackDecision {
  const parts = name.split("/");
  const extension = extensionOf(name);

  if (name === PACKAGE_ZIP_NAME) {
    return { name, packed: false, refusal: "zip-artifact" };
  }
  if (parts.some((part) => part.startsWith("."))) {
    return { name, packed: false, refusal: "dotfile" };
  }
  if (parts.slice(0, -1).some((part) => REJECTED_SEGMENTS.includes(part.toLowerCase()))) {
    return { name, packed: false, refusal: "rejected-segment" };
  }
  if (REJECTED_EXTENSIONS.includes(extension)) {
    return { name, packed: false, refusal: "rejected-extension" };
  }
  if (!PACKABLE_EXTENSIONS.includes(extension)) {
    return { name, packed: false, refusal: "unlisted-extension" };
  }
  return { name, packed: true, refusal: null };
}

export interface PackRefusalEntry {
  readonly name: string;
  readonly refusal: PackRefusal;
}

export interface PackPartition {
  readonly packed: readonly string[];
  readonly refused: readonly PackRefusalEntry[];
}

export function partitionPackEntries(names: readonly string[]): PackPartition {
  const packed: string[] = [];
  const refused: PackRefusalEntry[] = [];
  for (const name of [...names].sort()) {
    const decision = decidePackEntry(name);
    if (decision.packed || decision.refusal === null) {
      packed.push(decision.name);
    } else {
      refused.push({ name: decision.name, refusal: decision.refusal });
    }
  }
  return { packed, refused };
}

function stringsOf(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value as Record<string, unknown>).filter(
      (item): item is string => typeof item === "string",
    );
  }
  return [];
}

function fieldOf(record: unknown, key: string): unknown {
  if (typeof record !== "object" || record === null) {
    return undefined;
  }
  return (record as Record<string, unknown>)[key];
}

export function normaliseAssetPath(from: string, target: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//") || target.startsWith("#")) {
    return null;
  }

  const base = target.startsWith("/") ? [] : from.split("/").slice(0, -1);
  const stack = [...base];
  for (const part of target.replace(/[?#].*$/, "").split("/")) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === "..") {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  const joined = stack.join("/");
  return joined.length === 0 ? null : joined;
}

export function manifestAssetPaths(manifest: unknown): string[] {
  const action = fieldOf(manifest, "action");
  const background = fieldOf(manifest, "background");
  const optionsUi = fieldOf(manifest, "options_ui");

  const found = [
    ...stringsOf(fieldOf(manifest, "icons")),
    ...stringsOf(fieldOf(action, "default_icon")),
    ...stringsOf(fieldOf(action, "default_popup")),
    ...stringsOf(fieldOf(background, "service_worker")),
    ...stringsOf(fieldOf(manifest, "options_page")),
    ...stringsOf(fieldOf(optionsUi, "page")),
  ];

  const scripts = fieldOf(manifest, "content_scripts");
  if (Array.isArray(scripts)) {
    for (const script of scripts) {
      found.push(...stringsOf(fieldOf(script, "js")), ...stringsOf(fieldOf(script, "css")));
    }
  }

  const normalised = found
    .map((target) => normaliseAssetPath(MANIFEST_ENTRY_NAME, target))
    .filter((target): target is string => target !== null);
  return [...new Set(normalised)].sort();
}

const HTML_REFERENCE = /(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export function htmlAssetPaths(name: string, html: string): string[] {
  const references = new RegExp(HTML_REFERENCE.source, HTML_REFERENCE.flags);
  const found: string[] = [];
  let hit: RegExpExecArray | null = references.exec(html);
  while (hit !== null) {
    const target = normaliseAssetPath(name, hit[1] ?? hit[2] ?? "");
    if (target !== null) {
      found.push(target);
    }
    hit = references.exec(html);
  }
  return [...new Set(found)].sort();
}

export function missingAmong(names: readonly string[], wanted: readonly string[]): string[] {
  const present = new Set(names);
  return wanted.filter((target) => !present.has(target));
}

export interface PngShape {
  readonly width: number;
  readonly height: number;
}

export function pngShape(data: Buffer): PngShape | null {
  if (data.length < 24 || data.subarray(0, 8).toString("hex") !== PNG_SIGNATURE) {
    return null;
  }
  if (data.toString("ascii", 12, 16) !== "IHDR") {
    return null;
  }
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

export function wrongSizedIcons(
  icons: Readonly<Record<string, string>>,
  read: (name: string) => Buffer | null,
): string[] {
  const wrong: string[] = [];
  for (const [declared, path] of Object.entries(icons)) {
    const data = read(path);
    if (data === null) {
      wrong.push(`${path}: không có trong gói`);
      continue;
    }
    const shape = pngShape(data);
    if (shape === null) {
      wrong.push(`${path}: không phải PNG hợp lệ`);
      continue;
    }
    const wanted = Number(declared);
    if (shape.width !== wanted || shape.height !== wanted) {
      wrong.push(`${path}: manifest khai ${declared} nhưng ảnh là ${shape.width}x${shape.height}`);
    }
  }
  return wrong;
}
