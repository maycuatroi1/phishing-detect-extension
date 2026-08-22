import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FORBIDDEN_PERMISSIONS,
  NO_BLOCKING_RATIONALE,
  WHY_BY_RULE,
  findBlockingViolations,
  type BlockingRule,
  type BlockingViolation,
  type LintTargets,
} from "../scripts/no-blocking-rules.ts";

const REPO_ROOT = process.cwd();

const CLEAN_MANIFEST = {
  manifest_version: 3,
  name: "Anti-Fraud",
  version: "0.0.1",
  permissions: ["alarms", "tabs"],
  host_permissions: ["https://anti-fraud.omelet.tech/*"],
};

const CLEAN_SOURCE = 'chrome.action.setBadgeText({ tabId: 1, text: "!" });\n';

const MUST_STAY_FORBIDDEN: readonly string[] = [
  "webRequestBlocking",
  "declarativeNetRequest",
  "declarativeNetRequestWithHostAccess",
  "declarativeNetRequestFeedback",
];

const roots: string[] = [];

interface Fixture {
  readonly manifest: Record<string, unknown>;
  readonly sources?: Record<string, string>;
}

function plant(fixture: Fixture): LintTargets {
  const root = mkdtempSync(join(tmpdir(), "no-blocking-"));
  roots.push(root);

  mkdirSync(join(root, "public"), { recursive: true });
  writeFileSync(join(root, "public/manifest.json"), JSON.stringify(fixture.manifest, null, 2));

  const sources = fixture.sources ?? { "background/index.ts": CLEAN_SOURCE };
  for (const [name, text] of Object.entries(sources)) {
    const full = join(root, "src", name);
    mkdirSync(resolve(full, ".."), { recursive: true });
    writeFileSync(full, text);
  }

  return {
    root,
    manifestPath: join(root, "public/manifest.json"),
    sourceDir: join(root, "src"),
  };
}

function rules(violations: readonly BlockingViolation[]): BlockingRule[] {
  return violations.map((violation) => violation.rule);
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop() as string, { recursive: true, force: true });
  }
});

describe("repo thật đứng sạch trước cả ba mệnh đề", () => {
  it("manifest và src hiện tại không sinh vi phạm nào", () => {
    expect(
      findBlockingViolations({
        root: REPO_ROOT,
        manifestPath: resolve(REPO_ROOT, "public/manifest.json"),
        sourceDir: resolve(REPO_ROOT, "src"),
      }),
    ).toEqual([]);
  });

  it("fixture sạch cũng không sinh vi phạm nào", () => {
    expect(findBlockingViolations(plant({ manifest: CLEAN_MANIFEST }))).toEqual([]);
  });
});

describe("mệnh đề 1: manifest không xin quyền chặn được", () => {
  it("webRequestBlocking bị bắt", () => {
    const violations = findBlockingViolations(
      plant({ manifest: { ...CLEAN_MANIFEST, permissions: ["alarms", "webRequestBlocking"] } }),
    );

    expect(rules(violations)).toEqual(["manifest-permission"]);
    expect(violations[0].what).toContain("webRequestBlocking");
  });

  it("mọi quyền chặn được đều bị bắt, kể cả khi xin ở optional_permissions", () => {
    for (const permission of MUST_STAY_FORBIDDEN) {
      expect(FORBIDDEN_PERMISSIONS, `${permission} rơi khỏi danh sách cấm`).toContain(permission);

      const inline = findBlockingViolations(
        plant({ manifest: { ...CLEAN_MANIFEST, permissions: ["alarms", permission] } }),
      );
      expect(rules(inline), `${permission} trong permissions`).toEqual(["manifest-permission"]);

      const optional = findBlockingViolations(
        plant({ manifest: { ...CLEAN_MANIFEST, optional_permissions: [permission] } }),
      );
      expect(rules(optional), `${permission} trong optional_permissions`).toEqual([
        "manifest-permission",
      ]);
    }
  });

  it("quyền extension đang thật sự dùng không bị bắt nhầm", () => {
    const violations = findBlockingViolations(
      plant({ manifest: { ...CLEAN_MANIFEST, permissions: ["alarms", "tabs", "webRequest"] } }),
    );

    expect(violations).toEqual([]);
  });
});

describe("mệnh đề 2: không có block rule declarativeNetRequest", () => {
  it("thêm một block rule vào manifest thì lint đỏ", () => {
    const violations = findBlockingViolations(
      plant({
        manifest: {
          ...CLEAN_MANIFEST,
          declarative_net_request: {
            rule_resources: [{ id: "chan", enabled: true, path: "rules.json" }],
          },
        },
      }),
    );

    expect(rules(violations)).toEqual(["manifest-block-rules"]);
    expect(violations[0].where).toBe("public/manifest.json");
  });

  it("rule nạp lúc chạy cũng đỏ, dù manifest sạch", () => {
    const violations = findBlockingViolations(
      plant({
        manifest: CLEAN_MANIFEST,
        sources: {
          "background/index.ts": [
            "void chrome.declarativeNetRequest.updateDynamicRules({",
            '  addRules: [{ id: 1, priority: 1, action: { type: "block" }, condition: {} }],',
            "});",
          ].join("\n"),
        },
      }),
    );

    expect(rules(violations)).toEqual(["runtime-block-rules"]);
  });
});

describe("mệnh đề 3: không handler webNavigation nào gọi chrome.tabs.update", () => {
  it("một file vừa nghe điều hướng vừa bẻ hướng thì đỏ", () => {
    const violations = findBlockingViolations(
      plant({
        manifest: CLEAN_MANIFEST,
        sources: {
          "background/index.ts": [
            "chrome.webNavigation.onBeforeNavigate.addListener((details) => {",
            '  void chrome.tabs.update(details.tabId, { url: "about:blank" });',
            "});",
          ].join("\n"),
        },
      }),
    );

    expect(rules(violations)).toEqual(["navigation-redirect"]);
    expect(violations[0].what).toContain("chrome.tabs.update");
    expect(violations[0].what).toContain("chrome.webNavigation");
  });

  it("tách listener và cú bẻ hướng ra hai file vẫn đỏ", () => {
    const violations = findBlockingViolations(
      plant({
        manifest: CLEAN_MANIFEST,
        sources: {
          "background/listen.ts": [
            'import { sendAway } from "./redirect.ts";',
            "chrome.webNavigation.onCommitted.addListener((details) => sendAway(details.tabId));",
          ].join("\n"),
          "background/redirect.ts": [
            "export function sendAway(tabId: number): void {",
            '  void chrome.tabs.update(tabId, { url: "about:blank" });',
            "}",
          ].join("\n"),
        },
      }),
    );

    expect(rules(violations)).toEqual(["navigation-redirect"]);
    expect(violations[0].where).toBe("src/background/redirect.ts");
    expect(violations[0].what).toContain("src/background/listen.ts");
  });

  it("chrome.tabs.update một mình, không có listener điều hướng nào, thì không đỏ", () => {
    const violations = findBlockingViolations(
      plant({
        manifest: CLEAN_MANIFEST,
        sources: {
          "popup/popup.ts": 'void chrome.tabs.update({ url: "https://example.test/" });\n',
        },
      }),
    );

    expect(violations).toEqual([]);
  });
});

describe("thông báo lỗi trỏ tới lý do false positive, không chỉ nói vi phạm", () => {
  it("mỗi rule có một câu lý do riêng, và câu ấy nói về hậu quả của một lần chấm nhầm", () => {
    for (const [rule, why] of Object.entries(WHY_BY_RULE)) {
      expect(why.length, rule).toBeGreaterThan(80);
      expect(
        /false positive|chấm nhầm|nhầm/.test(why),
        `${rule} không nhắc tới chuyện chấm nhầm`,
      ).toBe(true);
    }
  });

  it("vi phạm mang theo lý do của đúng rule đã bắt nó", () => {
    const violations = findBlockingViolations(
      plant({ manifest: { ...CLEAN_MANIFEST, permissions: ["webRequestBlocking"] } }),
    );

    expect(violations[0].why).toBe(WHY_BY_RULE["manifest-permission"]);
  });

  it("phần lý do chung nói cái giá của một lần chặn sai và chỉ đường đọc tiếp", () => {
    const text = NO_BLOCKING_RATIONALE.join(" ");

    expect(text.toLowerCase()).toContain("false positive");
    expect(text).toContain("hỏng cả buổi làm việc");
    expect(text).toContain("invariants.md#no-blocking");
    expect(text).toContain("AGENTS.md");
  });
});
