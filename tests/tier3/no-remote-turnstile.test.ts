import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SECRET_PATTERNS, scanSecretPatterns } from "../../scripts/secret-patterns.ts";
import { TURNSTILE_GATES } from "../../src/lib/report.ts";

const REPO_ROOT = process.cwd();

const SOURCE_ROOT = resolve(REPO_ROOT, "src");

const MANIFEST = JSON.parse(
  readFileSync(resolve(REPO_ROOT, "public/manifest.json"), "utf8"),
) as Record<string, unknown>;

const TURNSTILE_SCRIPT_HOST = "challenges.cloudflare.com";

const TURNSTILE_SCRIPT_PATH = "turnstile/v0/api.js";

const SAMPLE_SITE_KEY = "0x4AAAAAABkMYinukE8nzYS";

function listSourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      found.push(...listSourceFiles(full));
    } else {
      found.push(full);
    }
  }
  return found;
}

const SOURCE_FILES = listSourceFiles(SOURCE_ROOT);

describe("tier 3 không mở thêm một quyền nào trong manifest", () => {
  it("bộ quyền vẫn đúng hai dòng mà tier 0 đã xin", () => {
    expect(MANIFEST.permissions).toEqual(["alarms", "tabs"]);
    expect(MANIFEST.host_permissions).toEqual(["https://anti-fraud.omelet.tech/*"]);
  });

  it("không quyền tuỳ chọn, không content script, không origin nào nói chuyện được với extension", () => {
    for (const key of [
      "optional_permissions",
      "optional_host_permissions",
      "content_scripts",
      "externally_connectable",
      "web_accessible_resources",
    ]) {
      expect(MANIFEST[key], `manifest mọc thêm khoá ${key}`).toBeUndefined();
    }
  });
});

describe("không một dòng remote code nào lọt vào trang của extension", () => {
  it("manifest không nới content_security_policy, nên MV3 giữ script-src 'self'", () => {
    expect(MANIFEST.content_security_policy).toBeUndefined();
  });

  it("không file nguồn nào nạp script Turnstile của Cloudflare", () => {
    for (const file of SOURCE_FILES) {
      const text = readFileSync(file, "utf8");
      const name = relative(REPO_ROOT, file).split("\\").join("/");
      expect(text, `${name} nạp ${TURNSTILE_SCRIPT_HOST}`).not.toContain(TURNSTILE_SCRIPT_HOST);
      expect(text, `${name} nạp ${TURNSTILE_SCRIPT_PATH}`).not.toContain(TURNSTILE_SCRIPT_PATH);
    }
  });

  it("site key Turnstile không thể nằm trong bundle, chính post-check của repo này chặn nó", () => {
    const pattern = SECRET_PATTERNS.find((entry) => entry.id === "turnstile-secret-key");
    expect(pattern).toBeDefined();

    const matches = scanSecretPatterns(`const key = "${SAMPLE_SITE_KEY}";`);
    expect(matches.map((match) => match.patternId)).toContain("turnstile-secret-key");

    for (const file of SOURCE_FILES) {
      const text = readFileSync(file, "utf8");
      expect(scanSecretPatterns(text), relative(REPO_ROOT, file)).toEqual([]);
    }
  });

  it("client vẫn đọc được cả ba trạng thái cổng, kể cả server không cấu hình Turnstile", () => {
    expect([...TURNSTILE_GATES]).toEqual(["not-required", "verified", "not-configured"]);
  });
});
