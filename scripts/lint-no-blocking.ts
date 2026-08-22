import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const REPO_ROOT = process.cwd();
const MANIFEST_PATH = resolve(REPO_ROOT, "public/manifest.json");
const SOURCE_DIR = resolve(REPO_ROOT, "src");

const FORBIDDEN_PERMISSIONS = new Set([
  "webRequestBlocking",
  "declarativeNetRequestWithHostAccess",
]);

const REDIRECTING_CALL = "chrome.tabs.update";
const NAVIGATION_API = "chrome.webNavigation";

interface ManifestShape {
  permissions?: unknown;
  optional_permissions?: unknown;
  declarative_net_request?: { rule_resources?: unknown };
}

function listSourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      found.push(...listSourceFiles(full));
    } else if (/\.(ts|tsx|js|mjs)$/.test(name)) {
      found.push(full);
    }
  }
  return found;
}

function permissionList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function main(): void {
  const violations: string[] = [];

  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as ManifestShape;
  const declared = [
    ...permissionList(manifest.permissions),
    ...permissionList(manifest.optional_permissions),
  ];
  for (const permission of declared) {
    if (FORBIDDEN_PERMISSIONS.has(permission)) {
      violations.push(
        `public/manifest.json xin quyền ${permission}, quyền này cho phép chặn request trước khi nó chạy.`,
      );
    }
  }
  if (manifest.declarative_net_request !== undefined) {
    violations.push(
      "public/manifest.json khai báo declarative_net_request, tức là có bộ rule chặn tĩnh trong bundle.",
    );
  }

  for (const file of listSourceFiles(SOURCE_DIR)) {
    const text = readFileSync(file, "utf8");
    if (text.includes(NAVIGATION_API) && text.includes(REDIRECTING_CALL)) {
      violations.push(
        `${relative(REPO_ROOT, file).split("\\").join("/")} vừa nghe ${NAVIGATION_API} vừa gọi ${REDIRECTING_CALL}, đó là chặn điều hướng.`,
      );
    }
  }

  if (violations.length === 0) {
    console.log("lint-no-blocking: OK, extension chỉ cảnh báo chứ không chặn.");
    return;
  }

  console.error("lint-no-blocking: THẤT BẠI.");
  for (const violation of violations) {
    console.error(`  ${violation}`);
  }
  console.error("");
  console.error(
    "Một false positive mà chặn được điều hướng là chặn ngân hàng thật của người dùng. Extension này cảnh báo, không chặn. Xem invariants.md#no-blocking ở harness root.",
  );
  process.exit(1);
}

main();
