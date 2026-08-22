import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DISPUTED_LOOK,
  NG_TEXT,
  badgeLookFor,
  evaluateTab,
  softenIfDisputed,
} from "../../src/background/tier0.ts";
import { tier1BadgeLookFor } from "../../src/background/tier1.ts";
import { DEFAULT_API_BASE_URL } from "../../src/config.ts";
import { decodeAfbl } from "../../src/lib/afbl.ts";
import { clearStoredBlocklist, writeStoredBlocklist } from "../../src/lib/blocklist-store.ts";
import { clearDispute, readDispute } from "../../src/lib/dispute-store.ts";
import { invalidateTier0Cache } from "../../src/lib/tier0.ts";
import { clearStoredInstallToken } from "../../src/lib/token-store.ts";
import { fileReport } from "../../src/lib/tier3.ts";
import { LEGIT_HOST, PHISH_HOST, UNSEEN_HOST, fixtureArtifact } from "../helpers/fixture.ts";
import { installRoute, tier2Tap } from "../helpers/tier2.ts";
import { reportQueuedResponse, reportRoute } from "../helpers/report.ts";

const FIXTURE_VERSION = 5150;

const PHISH_URL = `https://${PHISH_HOST}/dang-nhap`;

const NOW = 1_800_000_000_000;

const setBadgeText = vi.fn(async (_details: { tabId: number; text: string }) => undefined);
const setBadgeBackgroundColor = vi.fn(
  async (_details: { tabId: number; color: string }) => undefined,
);
const setTitle = vi.fn(async (_details: { tabId: number; title: string }) => undefined);

function badgeText(): string {
  return setBadgeText.mock.lastCall?.[0].text ?? "<không gọi>";
}

function badgeColor(): string {
  return setBadgeBackgroundColor.mock.lastCall?.[0].color ?? "<không gọi>";
}

function badgeTitle(): string {
  return setTitle.mock.lastCall?.[0].title ?? "<không gọi>";
}

async function fileFalsePositive(url: string): Promise<void> {
  const tap = tier2Tap([installRoute(), reportRoute(() => reportQueuedResponse())]);
  const outcome = await fileReport(
    { baseUrl: DEFAULT_API_BASE_URL, fetchImpl: tap.fetchImpl, now: () => NOW },
    { url, claim: "false_positive" },
  );
  if (outcome.kind !== "queued") {
    throw new Error(`report báo nhầm không vào hàng chờ, nhận ${outcome.kind}`);
  }
}

async function filePhishing(url: string): Promise<void> {
  const tap = tier2Tap([installRoute(), reportRoute(() => reportQueuedResponse())]);
  const outcome = await fileReport(
    { baseUrl: DEFAULT_API_BASE_URL, fetchImpl: tap.fetchImpl, now: () => NOW },
    { url, claim: "phishing" },
  );
  if (outcome.kind !== "queued") {
    throw new Error(`report lừa đảo không vào hàng chờ, nhận ${outcome.kind}`);
  }
}

beforeEach(async () => {
  setBadgeText.mockClear();
  setBadgeBackgroundColor.mockClear();
  setTitle.mockClear();

  vi.stubGlobal("chrome", {
    action: { setBadgeText, setBadgeBackgroundColor, setTitle },
  });

  await clearStoredBlocklist();
  await clearStoredInstallToken();
  await clearDispute(PHISH_HOST);
  await clearDispute(LEGIT_HOST);
  await clearDispute(UNSEEN_HOST);
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

describe("một cú bấm báo nhầm hạ cảnh báo xuống mức mềm ngay trên máy", () => {
  it("trước khi báo thì badge là cảnh báo cứng và nó chỉ đường tới nút báo nhầm", async () => {
    expect(await evaluateTab(21, PHISH_URL)).toBe("phishing");
    expect(badgeText()).toBe(NG_TEXT);
    expect(badgeColor()).toBe(badgeLookFor("phishing").color);
    expect(badgeTitle()).toContain("Báo cảnh báo nhầm");
  });

  it("sau khi báo nhầm thì cùng một lần điều hướng cho badge mềm", async () => {
    await evaluateTab(21, PHISH_URL);
    expect(badgeText()).toBe(NG_TEXT);

    await fileFalsePositive(PHISH_URL);

    expect(await evaluateTab(21, PHISH_URL)).toBe("phishing");
    expect(badgeText()).toBe(DISPUTED_LOOK.text);
    expect(badgeColor()).toBe(DISPUTED_LOOK.color);
    expect(badgeColor()).not.toBe(badgeLookFor("phishing").color);
    expect(badgeTitle()).toContain("mức mềm");
  });

  it("hạ cảnh báo là chuyện của máy người dùng, artifact và verdict của server không đổi", async () => {
    await fileFalsePositive(PHISH_URL);

    expect(await evaluateTab(21, PHISH_URL)).toBe("phishing");
    expect((await readDispute(PHISH_HOST))?.claim).toBe("false_positive");
  });

  it("xoá bản ghi tranh chấp thì cảnh báo cứng quay lại nguyên vẹn", async () => {
    await fileFalsePositive(PHISH_URL);
    await evaluateTab(21, PHISH_URL);
    expect(badgeText()).toBe(DISPUTED_LOOK.text);
    expect(badgeColor()).toBe(DISPUTED_LOOK.color);

    await clearDispute(PHISH_HOST);
    await evaluateTab(21, PHISH_URL);
    expect(badgeText()).toBe(NG_TEXT);
    expect(badgeColor()).toBe(badgeLookFor("phishing").color);
  });

  it("báo trang này lừa đảo không hạ cảnh báo của chính nó", async () => {
    await filePhishing(PHISH_URL);

    expect(await evaluateTab(21, PHISH_URL)).toBe("phishing");
    expect(badgeText()).toBe(NG_TEXT);
    expect(badgeColor()).toBe(badgeLookFor("phishing").color);
  });

  it("tranh chấp của host này không hạ cảnh báo của host khác", async () => {
    await fileFalsePositive(PHISH_URL);

    const other = await softenIfDisputed(UNSEEN_HOST, badgeLookFor("phishing"));
    expect(other).toEqual(badgeLookFor("phishing"));
  });
});

describe("mức mềm chỉ chạm cảnh báo cứng, không chạm badge nào khác", () => {
  it("badge legit và badge chưa kết luận không đổi dù có tranh chấp", async () => {
    await fileFalsePositive(`https://${LEGIT_HOST}/`);

    expect(await softenIfDisputed(LEGIT_HOST, badgeLookFor("legit"))).toEqual(badgeLookFor("legit"));
    expect(await softenIfDisputed(LEGIT_HOST, badgeLookFor("unknown"))).toEqual(
      badgeLookFor("unknown"),
    );
    expect(await softenIfDisputed(LEGIT_HOST, badgeLookFor("no_artifact"))).toEqual(
      badgeLookFor("no_artifact"),
    );
  });

  it("cảnh báo cứng của tier 1 cũng hạ xuống đúng mức mềm ấy", async () => {
    await fileFalsePositive(PHISH_URL);

    expect(await softenIfDisputed(PHISH_HOST, tier1BadgeLookFor("phishing"))).toEqual(DISPUTED_LOOK);
    expect(await softenIfDisputed(PHISH_HOST, tier1BadgeLookFor("legit"))).toEqual(
      tier1BadgeLookFor("legit"),
    );
    expect(tier1BadgeLookFor("phishing").title).toContain("Báo cảnh báo nhầm");
  });
});
