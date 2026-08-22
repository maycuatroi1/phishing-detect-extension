import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DISMISSED_LOOK,
  DISPUTED_LOOK,
  badgeLookFor,
  evaluateTab,
  userAdjustedLook,
} from "../src/background/tier0.ts";
import { AUTO_SCAN_WARNING_LOOK } from "../src/background/auto-scan.ts";
import { tier1BadgeLookFor } from "../src/background/tier1.ts";
import { lookForLevel, type BadgeLook } from "../src/lib/badge.ts";
import { decodeAfbl } from "../src/lib/afbl.ts";
import { clearStoredBlocklist, writeStoredBlocklist } from "../src/lib/blocklist-store.ts";
import { clearDismissal, writeDismissal } from "../src/lib/dismissal-store.ts";
import { clearDispute } from "../src/lib/dispute-store.ts";
import { invalidateTier0Cache } from "../src/lib/tier0.ts";
import { resolveWarningLevel } from "../src/lib/warning-level.ts";
import { statusPanelView } from "../src/popup/status-panel.ts";
import { LEGIT_HOST, PHISH_HOST, UNSEEN_HOST, fixtureArtifact } from "./helpers/fixture.ts";

const POPUP_HTML = readFileSync(resolve(process.cwd(), "src/popup/index.html"), "utf8");

const POPUP_SOURCE = readFileSync(resolve(process.cwd(), "src/popup/popup.ts"), "utf8");

const FIXTURE_VERSION = 7300;

const NOW = 1_800_000_000_000;

const TIER0_VERDICTS = ["phishing", "soft", "legit", "unknown", "no_artifact"] as const;

const TIER1_VERDICTS = ["phishing", "legit", "unknown", "absent", "unavailable"] as const;

const WARNING_LEVELS_HERE = ["dismissed", "disputed", "hard", "machine", "none"] as const;

const FOUR_STATES = ["legit", "unknown", "soft", "phishing"] as const;

const TEXT_BY_STATE = [
  { verdict: "legit", text: "OK" },
  { verdict: "unknown", text: "OK" },
  { verdict: "soft", text: "NG" },
  { verdict: "phishing", text: "NG" },
] as const;

function everyLook(): BadgeLook[] {
  const looks: BadgeLook[] = [DISPUTED_LOOK, DISMISSED_LOOK, AUTO_SCAN_WARNING_LOOK];
  for (const verdict of TIER0_VERDICTS) {
    looks.push(badgeLookFor(verdict));
  }
  for (const verdict of TIER1_VERDICTS) {
    looks.push(tier1BadgeLookFor(verdict));
  }
  for (const verdict of TIER0_VERDICTS) {
    for (const level of WARNING_LEVELS_HERE) {
      looks.push(lookForLevel(verdict, level));
    }
  }
  return looks;
}

const setBadgeText = vi.fn(async (_details: { tabId: number; text: string }) => undefined);
const setBadgeBackgroundColor = vi.fn(
  async (_details: { tabId: number; color: string }) => undefined,
);
const setTitle = vi.fn(async (_details: { tabId: number; title: string }) => undefined);

beforeEach(async () => {
  setBadgeText.mockClear();
  setBadgeBackgroundColor.mockClear();
  setTitle.mockClear();
  vi.stubGlobal("chrome", { action: { setBadgeText, setBadgeBackgroundColor, setTitle } });

  await clearStoredBlocklist();
  for (const host of [PHISH_HOST, LEGIT_HOST, UNSEEN_HOST]) {
    await clearDismissal(host);
    await clearDispute(host);
  }
  invalidateTier0Cache();

  const decoded = decodeAfbl(await fixtureArtifact(FIXTURE_VERSION));
  if (!decoded.ok) {
    throw new Error("fixture không decode được");
  }
  await writeStoredBlocklist({
    format: decoded.artifact.format,
    version: decoded.artifact.version,
    phish: decoded.artifact.phish,
    legit: decoded.artifact.legit,
    soft: decoded.artifact.soft,
    etag: `"afbl-1-${FIXTURE_VERSION}"`,
    pinnedUrl: `/v1/blocklist/v/${FIXTURE_VERSION}?format=1`,
    fetchedAt: NOW,
  });
  invalidateTier0Cache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chữ trên badge chỉ có đúng hai giá trị", () => {
  it("mọi trạng thái gộp lại cho đúng tập hai chuỗi OK và NG", () => {
    expect(TIER0_VERDICTS).toHaveLength(5);
    expect(TIER1_VERDICTS).toHaveLength(5);
    expect(WARNING_LEVELS_HERE).toHaveLength(5);

    const texts = new Set(everyLook().map((look) => look.text));

    expect([...texts].sort()).toEqual(["NG", "OK"]);
    expect(texts.size).toBe(2);
  });

  it("bảng bốn dòng: legit và unknown ra OK, soft và phishing ra NG", () => {
    expect(TEXT_BY_STATE).toHaveLength(4);

    for (const row of TEXT_BY_STATE) {
      expect(badgeLookFor(row.verdict).text, row.verdict).toBe(row.text);
    }

    expect(badgeLookFor("legit").text).toBe(badgeLookFor("unknown").text);
    expect(badgeLookFor("soft").text).toBe(badgeLookFor("phishing").text);
    expect(badgeLookFor("legit").text).not.toBe(badgeLookFor("phishing").text);
  });
});

describe("không trạng thái nào vẽ ra badge rỗng", () => {
  it("mọi look trong extension đều mang chữ nhìn thấy được và ngắn hơn năm ký tự", () => {
    const looks = everyLook();
    expect(looks.length).toBeGreaterThanOrEqual(18);

    for (const look of looks) {
      expect(look.text, look.title).not.toBe("");
      expect(look.text.trim().length, look.title).toBeGreaterThan(0);
      expect(look.text.length, look.title).toBeLessThanOrEqual(4);
      expect(look.color, look.title).toMatch(/^#[0-9a-f]{6}$/);
      expect(look.title.length, look.text).toBeGreaterThan(20);
    }
  });

  it("đường sơn thật không gửi một lệnh setBadgeText rỗng nào, kể cả cho tab chrome://", async () => {
    await evaluateTab(71, `https://${PHISH_HOST}/dang-nhap`);
    await evaluateTab(72, `https://${LEGIT_HOST}/`);
    await evaluateTab(73, `https://${UNSEEN_HOST}/`);
    await evaluateTab(74, "chrome://extensions");

    const painted = setBadgeText.mock.calls.map((call) => call[0].text);
    expect(painted).toHaveLength(4);
    for (const text of painted) {
      expect(text).not.toBe("");
      expect(["OK", "NG"]).toContain(text);
    }
  });

  it("tắt cảnh báo rồi thì badge vẫn còn chữ, chỉ là chữ thôi cảnh báo", async () => {
    await writeDismissal({ host: PHISH_HOST, dismissedAt: NOW });

    await evaluateTab(75, `https://${PHISH_HOST}/dang-nhap`);

    expect(setBadgeText.mock.lastCall?.[0].text).toBe(DISMISSED_LOOK.text);
    expect(setBadgeText.mock.lastCall?.[0].text).not.toBe("");
  });
});

describe("bốn trạng thái gốc giữ đủ thông tin ở màu và tooltip", () => {
  it("bốn màu đôi một khác nhau, nên unknown không mượn được màu của legit", () => {
    expect(FOUR_STATES).toHaveLength(4);

    for (const left of FOUR_STATES) {
      for (const right of FOUR_STATES) {
        if (left === right) {
          continue;
        }
        expect(badgeLookFor(left).color, `${left} vs ${right}`).not.toBe(badgeLookFor(right).color);
      }
    }

    expect(new Set(FOUR_STATES.map((verdict) => badgeLookFor(verdict).color)).size).toBe(4);
    expect(badgeLookFor("unknown").color).not.toBe(badgeLookFor("legit").color);
    expect(badgeLookFor("soft").color).not.toBe(badgeLookFor("phishing").color);
  });

  it("bốn tooltip cũng đôi một khác nhau, nên chữ giống nhau không làm mất nghĩa", () => {
    const titles = FOUR_STATES.map((verdict) => badgeLookFor(verdict).title);
    expect(new Set(titles).size).toBe(4);
  });

  it("tooltip của unknown nói chưa có dữ liệu và không hề khẳng định an toàn", () => {
    const title = badgeLookFor("unknown").title;

    expect(title.toLowerCase()).toContain("chưa có dữ liệu");
    expect(title).toContain("không có nghĩa là an toàn");
    expect(title.split("an toàn")).toHaveLength(2);
    expect(title).not.toContain("đã xác nhận");
    expect(title).not.toContain("hợp lệ");
    expect(title).not.toBe(badgeLookFor("legit").title);
  });

  it("tooltip của tier 1 cho host lạ cũng mang đúng lời cảnh tỉnh ấy", () => {
    for (const verdict of ["unknown", "absent"] as const) {
      const title = tier1BadgeLookFor(verdict).title;
      expect(title, verdict).toContain("không có nghĩa là an toàn");
      expect(title.split("an toàn"), verdict).toHaveLength(2);
      expect(title, verdict).not.toContain("hợp lệ");
    }

    expect(tier1BadgeLookFor("legit").title).toContain("hợp lệ");
  });

  it("tooltip của legit, soft và phishing vẫn nói đúng nguồn của kết luận", () => {
    expect(badgeLookFor("legit").title).toContain("đã xác nhận");
    expect(badgeLookFor("phishing").title).toContain("đã xác nhận");
    expect(badgeLookFor("soft").title).toContain("máy đánh dấu");
    expect(badgeLookFor("soft").title).toContain("chưa có người kiểm chứng");
    expect(badgeLookFor("soft").title).not.toContain("đã xác nhận");
  });
});

describe("unknown mà người dùng đã tắt cảnh báo thì vẫn là unknown", () => {
  it("tắt cảnh báo không nuốt badge unknown, vì unknown chưa bao giờ là một cảnh báo", async () => {
    const dismissal = { host: UNSEEN_HOST, dismissedAt: NOW };
    await writeDismissal(dismissal);

    expect(resolveWarningLevel({ verdict: "unknown", dispute: null, dismissal })).toBe("none");

    const painted = await userAdjustedLook(UNSEEN_HOST, badgeLookFor("unknown"));
    expect(painted).toEqual(badgeLookFor("unknown"));
    expect(painted).not.toEqual(DISMISSED_LOOK);
    expect(painted.color).not.toBe(DISMISSED_LOOK.color);

    expect(await evaluateTab(76, `https://${UNSEEN_HOST}/`)).toBe("unknown");
    expect(setBadgeText.mock.lastCall?.[0].text).toBe(badgeLookFor("unknown").text);
    expect(setBadgeBackgroundColor.mock.lastCall?.[0].color).toBe(badgeLookFor("unknown").color);
  });
});

describe("popup nói đủ bốn trạng thái gốc, không rút về hai", () => {
  const READY = [
    { verdict: "legit", level: "none" },
    { verdict: "unknown", level: "none" },
    { verdict: "soft", level: "machine" },
    { verdict: "phishing", level: "hard" },
  ] as const;

  it("bốn dòng tiêu đề và bốn dòng giải thích đôi một khác nhau", () => {
    expect(READY).toHaveLength(4);

    const views = READY.map((row) => statusPanelView({ kind: "ready", ...row }));

    expect(new Set(views.map((view) => view.headline)).size).toBe(4);
    expect(new Set(views.map((view) => view.detail)).size).toBe(4);
    expect(new Set(views.map((view) => view.color)).size).toBe(4);
    expect(new Set(views.map((view) => view.badge)).size).toBe(2);
  });

  it("popup của unknown nói thẳng chưa có dữ liệu và không đồng nghĩa an toàn", () => {
    const view = statusPanelView({ kind: "ready", verdict: "unknown", level: "none" });

    expect(view.badge).toBe("OK");
    expect(view.headline.toLowerCase()).toContain("chưa có dữ liệu");
    expect(view.detail).toContain("không có nghĩa là an toàn");
    expect(view.detail.split("an toàn")).toHaveLength(2);
    expect(view.detail).not.toContain("hợp lệ");
  });

  it("popup của legit nói có người xác nhận, khác hẳn popup của unknown", () => {
    const legit = statusPanelView({ kind: "ready", verdict: "legit", level: "none" });
    const unknown = statusPanelView({ kind: "ready", verdict: "unknown", level: "none" });

    expect(legit.badge).toBe(unknown.badge);
    expect(legit.headline).toContain("hợp lệ");
    expect(legit.headline).not.toBe(unknown.headline);
    expect(legit.detail).not.toBe(unknown.detail);
    expect(legit.color).not.toBe(unknown.color);
  });

  it("tắt cảnh báo hay báo nhầm thì popup vẫn kể ra trạng thái gốc của trang", () => {
    const dismissed = statusPanelView({ kind: "ready", verdict: "phishing", level: "dismissed" });
    const disputed = statusPanelView({ kind: "ready", verdict: "soft", level: "disputed" });

    expect(dismissed.badge).toBe("OK");
    expect(dismissed.headline).toContain("tắt cảnh báo");
    expect(dismissed.detail).toContain("lừa đảo");

    expect(disputed.badge).toBe("NG");
    expect(disputed.headline).toContain("mức mềm");
    expect(disputed.detail).toContain("chưa có người kiểm chứng");
  });

  it("dòng trạng thái ấy có chỗ trong popup và được popup vẽ ra thật", () => {
    for (const name of ["status-badge", "status-headline", "status-detail"]) {
      expect(POPUP_HTML, name).toContain(`data-slot="${name}"`);
      expect(POPUP_SOURCE, name).toContain(`"${name}"`);
    }

    expect(POPUP_SOURCE).toContain("statusPanelView");
    expect(POPUP_SOURCE).toContain("applyStatus({ kind: \"ready\"");
    expect(POPUP_SOURCE).toContain("applyStatus({ kind: \"unsupported\" })");
  });

  it("tab không phải http vẫn có một dòng trạng thái, không để trống", () => {
    const view = statusPanelView({ kind: "unsupported" });

    expect(view.badge).not.toBe("");
    expect(["OK", "NG"]).toContain(view.badge);
    expect(view.headline.length).toBeGreaterThan(10);
    expect(view.detail.length).toBeGreaterThan(10);
  });
});
