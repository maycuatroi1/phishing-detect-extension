import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const FORBIDDEN_PERMISSIONS: readonly string[] = [
  "webRequestBlocking",
  "declarativeNetRequest",
  "declarativeNetRequestWithHostAccess",
  "declarativeNetRequestFeedback",
];

export const MANIFEST_BLOCK_RULE_KEY = "declarative_net_request";

export const RUNTIME_BLOCK_RULE_API = "chrome.declarativeNetRequest";

export const NAVIGATION_API = "chrome.webNavigation";

export const REDIRECTING_CALL = "chrome.tabs.update";

export type BlockingRule =
  | "manifest-permission"
  | "manifest-block-rules"
  | "runtime-block-rules"
  | "navigation-redirect";

export interface BlockingViolation {
  readonly rule: BlockingRule;
  readonly where: string;
  readonly what: string;
  readonly why: string;
}

export interface LintTargets {
  readonly root: string;
  readonly manifestPath: string;
  readonly sourceDir: string;
}

export const WHY_BY_RULE: Record<BlockingRule, string> = {
  "manifest-permission":
    "Quyền này tồn tại để huỷ hoặc bẻ hướng request trước khi nó chạy. Corpus cộng đồng chắc chắn có false positive, và một false positive cầm quyền đó sẽ cắt đúng trang ngân hàng thật của người dùng.",
  "manifest-block-rules":
    "Rule declarativeNetRequest chặn theo bảng, không hỏi ai và không có nút bỏ qua. Một host bị chấm nhầm là người dùng không mở nổi nó trong suốt phiên đang làm dở.",
  "runtime-block-rules":
    "Rule nạp lúc chạy chặn y hệt rule tĩnh, chỉ khó soát hơn vì nó không nằm trong manifest. Một false positive vẫn cắt đứt trang thật của người dùng.",
  "navigation-redirect":
    "Nghe điều hướng rồi gọi chrome.tabs.update là chặn: người dùng gõ địa chỉ, extension kéo họ đi chỗ khác. Chấm nhầm một lần là hỏng cả buổi làm việc chứ không còn là phiền toái.",
};

export const NO_BLOCKING_RATIONALE: readonly string[] = [
  "Extension này cảnh báo, không chặn. Cảnh báo sai làm người ta bực một lúc; chặn sai làm hỏng cả buổi làm việc, rồi người ta gỡ extension và không tin cả dự án nữa.",
  "False positive trên corpus cộng đồng là chuyện chắc chắn xảy ra, không phải rủi ro giả định. Mọi thiết kế ở đây giả định điều đó và giữ cho một lần chấm nhầm chỉ tốn của người dùng một cú bấm.",
  "Nếu bạn đang muốn cảnh báo mạnh hơn thì làm mạnh hơn ở đúng chỗ cảnh báo: badge rõ hơn, chữ trong popup dứt khoát hơn. Đừng đổi cảnh báo thành chặn.",
  "Xem principles/invariants.md#no-blocking ở harness root và mục \"Extension chỉ cảnh báo, không chặn\" trong AGENTS.md.",
];

interface ManifestShape {
  permissions?: unknown;
  optional_permissions?: unknown;
  [MANIFEST_BLOCK_RULE_KEY]?: unknown;
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

function posixRelative(root: string, full: string): string {
  return relative(root, full).split("\\").join("/");
}

function permissionList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function manifestViolations(targets: LintTargets): BlockingViolation[] {
  const found: BlockingViolation[] = [];
  const where = posixRelative(targets.root, targets.manifestPath);
  const manifest = JSON.parse(readFileSync(targets.manifestPath, "utf8")) as ManifestShape;

  const declared = [
    ...permissionList(manifest.permissions),
    ...permissionList(manifest.optional_permissions),
  ];
  for (const permission of declared) {
    if (FORBIDDEN_PERMISSIONS.includes(permission)) {
      found.push({
        rule: "manifest-permission",
        where,
        what: `manifest xin quyền ${permission}`,
        why: WHY_BY_RULE["manifest-permission"],
      });
    }
  }

  if (manifest[MANIFEST_BLOCK_RULE_KEY] !== undefined) {
    found.push({
      rule: "manifest-block-rules",
      where,
      what: `manifest khai báo ${MANIFEST_BLOCK_RULE_KEY}, tức là có bộ rule chặn đi kèm bundle`,
      why: WHY_BY_RULE["manifest-block-rules"],
    });
  }

  return found;
}

function sourceViolations(targets: LintTargets): BlockingViolation[] {
  const found: BlockingViolation[] = [];
  const navigationFiles: string[] = [];
  const redirectFiles: string[] = [];

  for (const full of listSourceFiles(targets.sourceDir)) {
    const where = posixRelative(targets.root, full);
    const text = readFileSync(full, "utf8");

    if (text.includes(RUNTIME_BLOCK_RULE_API)) {
      found.push({
        rule: "runtime-block-rules",
        where,
        what: `file này gọi ${RUNTIME_BLOCK_RULE_API}, tức là nạp rule chặn lúc chạy`,
        why: WHY_BY_RULE["runtime-block-rules"],
      });
    }
    if (text.includes(NAVIGATION_API)) {
      navigationFiles.push(where);
    }
    if (text.includes(REDIRECTING_CALL)) {
      redirectFiles.push(where);
    }
  }

  if (navigationFiles.length > 0 && redirectFiles.length > 0) {
    for (const where of redirectFiles) {
      found.push({
        rule: "navigation-redirect",
        where,
        what: `file này gọi ${REDIRECTING_CALL} trong khi ${navigationFiles.join(", ")} nghe ${NAVIGATION_API}`,
        why: WHY_BY_RULE["navigation-redirect"],
      });
    }
  }

  return found;
}

export function findBlockingViolations(targets: LintTargets): BlockingViolation[] {
  return [...manifestViolations(targets), ...sourceViolations(targets)];
}
