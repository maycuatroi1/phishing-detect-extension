import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PACKABLE_EXTENSIONS,
  REJECTED_EXTENSIONS,
  REJECTED_SEGMENTS,
  decidePackEntry,
  htmlAssetPaths,
  manifestAssetPaths,
  missingAmong,
  normaliseAssetPath,
  partitionPackEntries,
  pngShape,
  wrongSizedIcons,
  type PackRefusal,
} from "../../scripts/pack-rules.ts";

const REPO_ROOT = process.cwd();

const MANIFEST_PATH = resolve(REPO_ROOT, "public/manifest.json");

const MANIFEST = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Record<string, unknown>;

const DECISIONS: readonly (readonly [string, PackRefusal | null])[] = [
  ["manifest.json", null],
  ["background.js", null],
  ["popup.js", null],
  ["popup/index.html", null],
  ["chunks/tier0-DYA7yBuG.js", null],
  ["icons/icon16.png", null],
  ["icons/icon48.png", null],
  ["icons/icon128.png", null],
  ["assets/style-abc123.css", null],
  ["assets/logo-abc123.svg", null],
  ["assets/inter-abc123.woff2", null],
  ["_locales/vi/messages.json", null],
  ["extension.zip", "zip-artifact"],
  [".env", "dotfile"],
  [".env.local", "dotfile"],
  [".git/config", "dotfile"],
  ["node_modules/vite/index.js", "rejected-segment"],
  ["src/lib/tier0.ts", "rejected-segment"],
  ["src/popup/popup.js", "rejected-segment"],
  ["tests/kanon/escalation.test.ts", "rejected-segment"],
  ["scripts/package.ts", "rejected-segment"],
  ["vendor/openapi/public.yaml", "rejected-segment"],
  ["coverage/index.html", "rejected-segment"],
  ["background.js.map", "rejected-extension"],
  ["README.md", "rejected-extension"],
  ["PRIVACY.md", "rejected-extension"],
  ["public.yaml", "rejected-extension"],
  ["tsconfig.tsbuildinfo", "rejected-extension"],
  ["LICENSE", "unlisted-extension"],
  ["notes.txt", "unlisted-extension"],
  ["extension.crx", "unlisted-extension"],
];

describe("chỉ thứ Chrome cần chạy mới vào gói", () => {
  it("mỗi tên file được xử đúng như bảng đã chốt", () => {
    const actual = DECISIONS.map(([name]) => {
      const decision = decidePackEntry(name);
      return [name, decision.refusal] as const;
    });
    expect(actual).toEqual(DECISIONS.map(([name, refusal]) => [name, refusal] as const));
  });

  it("mã nguồn, test, node_modules và sourcemap không bao giờ lọt vào danh sách gói", () => {
    const listing: readonly string[] = [
      ".env",
      "background.js",
      "background.js.map",
      "chunks/tier0-DYA7yBuG.js",
      "extension.zip",
      "icons/icon128.png",
      "icons/icon16.png",
      "icons/icon48.png",
      "manifest.json",
      "node_modules/vite/index.js",
      "popup.js",
      "popup/index.html",
      "scripts/package.ts",
      "src/lib/tier0.ts",
      "tests/kanon/escalation.test.ts",
    ];

    expect(partitionPackEntries(listing).packed).toEqual([
      "background.js",
      "chunks/tier0-DYA7yBuG.js",
      "icons/icon128.png",
      "icons/icon16.png",
      "icons/icon48.png",
      "manifest.json",
      "popup.js",
      "popup/index.html",
    ]);
  });

  it("danh sách đuôi cho phép vẫn đúng bộ đã chốt, không ai nới thêm", () => {
    expect([...PACKABLE_EXTENSIONS]).toEqual([".css", ".html", ".js", ".json", ".png", ".svg", ".woff2"]);
  });

  it("danh sách đuôi cấm vẫn đúng bộ đã chốt", () => {
    expect([...REJECTED_EXTENSIONS]).toEqual([
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
    ]);
  });

  it("danh sách thư mục cấm vẫn đúng bộ đã chốt", () => {
    expect([...REJECTED_SEGMENTS]).toEqual([
      ".git",
      "coverage",
      "node_modules",
      "plans",
      "scripts",
      "src",
      "test",
      "tests",
      "vendor",
    ]);
  });
});

describe("manifest không được trỏ vào hư không", () => {
  it("gom đúng mọi đường dẫn manifest tham chiếu", () => {
    expect(
      manifestAssetPaths({
        icons: { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" },
        background: { service_worker: "background.js", type: "module" },
        action: { default_popup: "popup/index.html", default_icon: { "16": "icons/icon16.png" } },
        content_scripts: [{ js: ["cs.js"], css: ["cs.css"] }],
      }),
    ).toEqual([
      "background.js",
      "cs.css",
      "cs.js",
      "icons/icon128.png",
      "icons/icon16.png",
      "icons/icon48.png",
      "popup/index.html",
    ]);
  });

  it("bắt được đường dẫn manifest khai mà gói không có", () => {
    const wanted = manifestAssetPaths(MANIFEST);
    expect(missingAmong(["manifest.json", ...wanted], wanted)).toEqual([]);
    expect(missingAmong(["manifest.json"], wanted)).toEqual(wanted);
  });

  it("manifest thật vẫn khai đúng ba icon đã chốt", () => {
    expect(MANIFEST.icons).toEqual({
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png",
    });
  });
});

describe("đường dẫn tương đối trong HTML phải giải đúng", () => {
  it("giải được các dạng đường dẫn thật gặp trong bundle", () => {
    expect(normaliseAssetPath("popup/index.html", "/popup.js")).toBe("popup.js");
    expect(normaliseAssetPath("popup/index.html", "./popup.js")).toBe("popup/popup.js");
    expect(normaliseAssetPath("popup/index.html", "../assets/a.css")).toBe("assets/a.css");
    expect(normaliseAssetPath("manifest.json", "icons/icon16.png")).toBe("icons/icon16.png");
    expect(normaliseAssetPath("popup/index.html", "/popup.js?v=2")).toBe("popup.js");
  });

  it("bỏ qua thứ không phải file trong gói", () => {
    expect(normaliseAssetPath("popup/index.html", "https://example.com/a.js")).toBeNull();
    expect(normaliseAssetPath("popup/index.html", "data:image/png;base64,AAAA")).toBeNull();
    expect(normaliseAssetPath("popup/index.html", "//cdn.example.com/a.js")).toBeNull();
    expect(normaliseAssetPath("popup/index.html", "#main")).toBeNull();
  });

  it("đọc ra đúng file mà một trang popup tham chiếu", () => {
    const html =
      '<!doctype html><link rel="stylesheet" href="/assets/a.css">' +
      '<script type="module" crossorigin src="/popup.js"></script>' +
      '<a href="https://example.com">ngoài</a><img src="./icons/icon16.png">';
    expect(htmlAssetPaths("popup/index.html", html)).toEqual([
      "assets/a.css",
      "popup.js",
      "popup/icons/icon16.png",
    ]);
  });
});

describe("icon phải là ảnh thật, đúng kích thước manifest khai", () => {
  const REAL_ICONS: readonly (readonly [string, number])[] = [
    ["icons/icon16.png", 16],
    ["icons/icon48.png", 48],
    ["icons/icon128.png", 128],
  ];

  it("ba file icon trong public/ tồn tại và là PNG đúng cỡ", () => {
    for (const [name, size] of REAL_ICONS) {
      const full = resolve(REPO_ROOT, "public", name);
      expect(existsSync(full), `${name} phải tồn tại trong public/`).toBe(true);
      expect(pngShape(readFileSync(full))).toEqual({ width: size, height: size });
    }
  });

  it("không nhận file không phải PNG", () => {
    expect(pngShape(Buffer.from("<svg></svg>", "utf8"))).toBeNull();
    expect(pngShape(Buffer.alloc(4))).toBeNull();
  });

  it("bắt được icon thiếu, icon hỏng và icon sai cỡ", () => {
    const good = readFileSync(resolve(REPO_ROOT, "public/icons/icon48.png"));
    const wrong = wrongSizedIcons(
      { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" },
      (name) =>
        name === "icons/icon16.png"
          ? Buffer.from("không phải png", "utf8")
          : name === "icons/icon48.png"
            ? good
            : null,
    );
    expect(wrong).toEqual([
      "icons/icon16.png: không phải PNG hợp lệ",
      "icons/icon128.png: không có trong gói",
    ]);
  });

  it("bắt được ảnh đúng PNG nhưng sai cỡ so với manifest", () => {
    const icon48 = readFileSync(resolve(REPO_ROOT, "public/icons/icon48.png"));
    expect(wrongSizedIcons({ "128": "icons/icon128.png" }, () => icon48)).toEqual([
      "icons/icon128.png: manifest khai 128 nhưng ảnh là 48x48",
    ]);
  });
});
