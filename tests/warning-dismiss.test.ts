import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DISMISSED_LOOK,
  DISPUTED_LOOK,
  NG_TEXT,
  badgeLookFor,
  evaluateTab,
  quietIfDismissed,
  userAdjustedLook,
} from "../src/background/tier0.ts";
import { tier1BadgeLookFor } from "../src/background/tier1.ts";
import { decodeAfbl } from "../src/lib/afbl.ts";
import { clearStoredBlocklist, writeStoredBlocklist } from "../src/lib/blocklist-store.ts";
import { clearDismissal, readDismissal, writeDismissal } from "../src/lib/dismissal-store.ts";
import { clearDispute, writeDispute } from "../src/lib/dispute-store.ts";
import { invalidateTier0Cache } from "../src/lib/tier0.ts";
import {
  DISMISS_LABEL,
  NEVER_BLOCKS,
  RESTORE_LABEL,
  warningPanelView,
} from "../src/popup/warning-panel.ts";
import { LEGIT_HOST, PHISH_HOST, UNSEEN_HOST, fixtureArtifact } from "./helpers/fixture.ts";

const FIXTURE_VERSION = 5150;

const PHISH_URL = `https://${PHISH_HOST}/dang-nhap`;

const NOW = 1_800_000_000_000;

const DISMISSAL = { host: PHISH_HOST, dismissedAt: NOW };

const POPUP_HTML = readFileSync(resolve(process.cwd(), "src/popup/index.html"), "utf8");

const POPUP_SOURCE = readFileSync(resolve(process.cwd(), "src/popup/popup.ts"), "utf8");

const setBadgeText = vi.fn(async (_details: { tabId: number; text: string }) => undefined);
const setBadgeBackgroundColor = vi.fn(
  async (_details: { tabId: number; color: string }) => undefined,
);
const setTitle = vi.fn(async (_details: { tabId: number; title: string }) => undefined);
const tabsUpdate = vi.fn(async (..._args: unknown[]) => undefined);
const tabsCreate = vi.fn(async (..._args: unknown[]) => undefined);

function badgeText(): string {
  return setBadgeText.mock.lastCall?.[0].text ?? "<không gọi>";
}

function badgeTitle(): string {
  return setTitle.mock.lastCall?.[0].title ?? "<không gọi>";
}

beforeEach(async () => {
  setBadgeText.mockClear();
  setBadgeBackgroundColor.mockClear();
  setTitle.mockClear();
  tabsUpdate.mockClear();
  tabsCreate.mockClear();

  vi.stubGlobal("chrome", {
    action: { setBadgeText, setBadgeBackgroundColor, setTitle },
    tabs: { update: tabsUpdate, create: tabsCreate },
  });

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

describe("một cú bấm tắt cảnh báo, một cú bấm nữa bật lại", () => {
  it("chưa tắt thì badge vẫn là cảnh báo cứng và title chỉ đường tới nút tắt", async () => {
    expect(await evaluateTab(41, PHISH_URL)).toBe("phishing");

    expect(badgeText()).toBe(NG_TEXT);
    expect(badgeTitle()).toContain(DISMISS_LABEL);
    expect(badgeTitle()).toContain("không chặn");
  });

  it("ghi đúng một bản ghi tắt rồi tra lại thì badge im hẳn", async () => {
    await writeDismissal(DISMISSAL);

    expect(await evaluateTab(41, PHISH_URL)).toBe("phishing");
    expect(badgeText()).toBe(DISMISSED_LOOK.text);
    expect(badgeText()).not.toBe("");
    expect(badgeText()).not.toBe(NG_TEXT);
    expect(badgeTitle()).toBe(DISMISSED_LOOK.title);
    expect(badgeTitle()).toContain(RESTORE_LABEL);
  });

  it("xoá bản ghi tắt thì cảnh báo cứng quay lại nguyên vẹn", async () => {
    await writeDismissal(DISMISSAL);
    await evaluateTab(41, PHISH_URL);
    expect(badgeText()).toBe(DISMISSED_LOOK.text);

    await clearDismissal(PHISH_HOST);
    await evaluateTab(41, PHISH_URL);

    expect(badgeText()).toBe(NG_TEXT);
    expect(await readDismissal(PHISH_HOST)).toBeNull();
  });

  it("tắt cảnh báo là chuyện của máy người dùng, verdict của artifact không đổi", async () => {
    await writeDismissal(DISMISSAL);

    expect(await evaluateTab(41, PHISH_URL)).toBe("phishing");
  });

  it("tắt ở host này không làm im cảnh báo của host khác", async () => {
    await writeDismissal(DISMISSAL);

    expect(await quietIfDismissed(UNSEEN_HOST, badgeLookFor("phishing"))).toEqual(
      badgeLookFor("phishing"),
    );
  });

  it("tắt cũng nuốt luôn cảnh báo mềm và cảnh báo cứng của tier 1", async () => {
    await writeDismissal(DISMISSAL);

    expect(await quietIfDismissed(PHISH_HOST, DISPUTED_LOOK)).toEqual(DISMISSED_LOOK);
    expect(await quietIfDismissed(PHISH_HOST, tier1BadgeLookFor("phishing"))).toEqual(
      DISMISSED_LOOK,
    );
  });

  it("tắt không chạm badge legit hay badge chưa kết luận", async () => {
    await writeDismissal({ host: LEGIT_HOST, dismissedAt: NOW });

    expect(await quietIfDismissed(LEGIT_HOST, badgeLookFor("legit"))).toEqual(badgeLookFor("legit"));
    expect(await quietIfDismissed(LEGIT_HOST, badgeLookFor("unknown"))).toEqual(
      badgeLookFor("unknown"),
    );
  });

  it("tắt thắng cả báo nhầm: đã hạ mềm rồi vẫn tắt hẳn được", async () => {
    await writeDispute({
      host: PHISH_HOST,
      claim: "false_positive",
      reportId: "rep_tat_canh_bao",
      filedAt: NOW,
    });
    expect(await userAdjustedLook(PHISH_HOST, badgeLookFor("phishing"))).toEqual(DISPUTED_LOOK);

    await writeDismissal(DISMISSAL);
    expect(await userAdjustedLook(PHISH_HOST, badgeLookFor("phishing"))).toEqual(DISMISSED_LOOK);
  });
});

describe("cảnh báo không bao giờ chặn, không bao giờ bẻ hướng tab", () => {
  it("cả đường tra lẫn đường sơn badge không gọi chrome.tabs.update hay chrome.tabs.create", async () => {
    await evaluateTab(41, PHISH_URL);
    await writeDismissal(DISMISSAL);
    await evaluateTab(41, PHISH_URL);
    await evaluateTab(42, `https://${LEGIT_HOST}/`);

    expect(tabsUpdate).not.toHaveBeenCalled();
    expect(tabsCreate).not.toHaveBeenCalled();
  });

  it("popup không bẻ hướng tab nào và không dựng lớp phủ khoá", () => {
    expect(POPUP_SOURCE).not.toContain("chrome.tabs.update");
    expect(POPUP_SOURCE).not.toContain("chrome.tabs.create");
    expect(POPUP_SOURCE).not.toContain("location.href");
    expect(POPUP_SOURCE).not.toContain("location.replace");
    expect(POPUP_HTML).not.toContain("<dialog");
    expect(POPUP_HTML).not.toContain("<iframe");
  });

  it("popup có sẵn nút tắt, và nói thẳng extension không chặn", () => {
    expect(POPUP_HTML).toContain("data-action=\"dismiss-warning\"");
    expect(POPUP_HTML).toContain("data-slot=\"warning-headline\"");
    expect(POPUP_HTML).toContain("data-slot=\"warning-detail\"");
    expect(POPUP_HTML).toContain("không chặn trang");
    expect(POPUP_HTML).not.toContain("<input");
    expect(POPUP_HTML).not.toContain("<textarea");
  });
});

describe("panel cảnh báo nói đúng trạng thái và luôn chỉ một cú bấm", () => {
  it("đang cảnh báo cứng thì nút bật sẵn, nhãn là tắt, lời dặn nói rõ không chặn", () => {
    const view = warningPanelView({ kind: "ready", level: "hard", dismissal: null });

    expect(view.buttonEnabled).toBe(true);
    expect(view.buttonLabel).toBe(DISMISS_LABEL);
    expect(view.warningVisible).toBe(true);
    expect(view.detail).toContain(NEVER_BLOCKS);
    expect(view.detail).toContain("một cú bấm");
    expect(view.detail).toContain("không hộp thoại xác nhận");
  });

  it("đã tắt thì nhãn đổi sang bật lại, vẫn đúng một cú bấm", () => {
    const view = warningPanelView({ kind: "ready", level: "hard", dismissal: DISMISSAL });

    expect(view.buttonEnabled).toBe(true);
    expect(view.buttonLabel).toBe(RESTORE_LABEL);
    expect(view.warningVisible).toBe(false);
    expect(view.headline).toContain("đang tắt");
  });

  it("cảnh báo mềm vẫn tắt hẳn được", () => {
    const view = warningPanelView({ kind: "ready", level: "disputed", dismissal: null });

    expect(view.buttonEnabled).toBe(true);
    expect(view.buttonLabel).toBe(DISMISS_LABEL);
    expect(view.warningVisible).toBe(true);
  });

  it("đang lưu thì không bấm chồng được", () => {
    const view = warningPanelView({ kind: "saving", turningOff: true });

    expect(view.buttonEnabled).toBe(false);
    expect(view.buttonLabel).not.toBe(DISMISS_LABEL);
  });

  it("tab không phải http hay https thì nút tắt đi mà lời hứa không chặn vẫn còn", () => {
    const view = warningPanelView({ kind: "unsupported" });

    expect(view.buttonEnabled).toBe(false);
    expect(view.detail).toContain(NEVER_BLOCKS);
  });
});
