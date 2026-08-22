import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NG_TEXT, OK_TEXT, badgeLookFor, evaluateTab } from "../src/background/tier0.ts";
import { clearStoredBlocklist, writeStoredBlocklist } from "../src/lib/blocklist-store.ts";
import { decodeAfbl } from "../src/lib/afbl.ts";
import { invalidateTier0Cache } from "../src/lib/tier0.ts";
import { LEGIT_HOST, PHISH_HOST, UNSEEN_HOST, fixtureArtifact } from "./helpers/fixture.ts";

const FIXTURE_VERSION = 4242;

const setBadgeText = vi.fn(async (_details: { tabId: number; text: string }) => undefined);
const setBadgeBackgroundColor = vi.fn(
  async (_details: { tabId: number; color: string }) => undefined,
);
const setTitle = vi.fn(async (_details: { tabId: number; title: string }) => undefined);

const networkCalls: string[] = [];

function forbidNetwork(label: string) {
  return (...args: unknown[]) => {
    networkCalls.push(`${label}(${String(args[0])})`);
    throw new Error(`đường tra tier 0 vừa gọi ${label}, nó phải chạy hoàn toàn trong máy`);
  };
}

beforeEach(async () => {
  networkCalls.length = 0;
  setBadgeText.mockClear();
  setBadgeBackgroundColor.mockClear();
  setTitle.mockClear();

  vi.stubGlobal("chrome", {
    action: { setBadgeText, setBadgeBackgroundColor, setTitle },
  });

  await clearStoredBlocklist();
  invalidateTier0Cache();

  const decoded = decodeAfbl(await fixtureArtifact(FIXTURE_VERSION));
  if (!decoded.ok) throw new Error("fixture không decode được");
  await writeStoredBlocklist({
    format: decoded.artifact.format,
    version: decoded.artifact.version,
    phish: decoded.artifact.phish,
    legit: decoded.artifact.legit,
    soft: decoded.artifact.soft,
    etag: `"afbl-1-${FIXTURE_VERSION}"`,
    pinnedUrl: `/v1/blocklist/v/${FIXTURE_VERSION}?format=1`,
    fetchedAt: 1_800_000_000_000,
  });
  invalidateTier0Cache();

  vi.stubGlobal("fetch", forbidNetwork("fetch"));
  vi.stubGlobal("XMLHttpRequest", forbidNetwork("XMLHttpRequest"));
  vi.stubGlobal("WebSocket", forbidNetwork("WebSocket"));
  vi.stubGlobal("EventSource", forbidNetwork("EventSource"));
  vi.stubGlobal("sendBeacon", forbidNetwork("sendBeacon"));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function badgeText(): string {
  return setBadgeText.mock.lastCall?.[0].text ?? "<không gọi>";
}

function badgeColor(): string {
  return setBadgeBackgroundColor.mock.lastCall?.[0].color ?? "<không gọi>";
}

describe("badge đổi theo artifact fixture, và đường tra không chạm mạng", () => {
  it("host có trong danh sách phish làm badge đổi thành cảnh báo", async () => {
    const verdict = await evaluateTab(11, `https://${PHISH_HOST}/dang-nhap`);

    expect(verdict).toBe("phishing");
    expect(badgeText()).toBe(badgeLookFor("phishing").text);
    expect(badgeText()).not.toBe("");
    expect(badgeColor()).toBe(badgeLookFor("phishing").color);
    expect(setBadgeText).toHaveBeenCalledWith({ tabId: 11, text: NG_TEXT });
    expect(badgeText()).toBe("NG");
    expect(setTitle.mock.lastCall?.[0].title).toContain("lừa đảo");
  });

  it("không request mạng nào phát ra khi tra", async () => {
    await evaluateTab(11, `https://${PHISH_HOST}/dang-nhap`);
    await evaluateTab(12, `https://${LEGIT_HOST}/`);
    await evaluateTab(13, `https://${UNSEEN_HOST}/`);

    expect(networkCalls).toEqual([]);
  });

  it("host legit và host lạ cùng ra OK nhưng khác màu và khác tooltip", async () => {
    expect(await evaluateTab(12, `https://${LEGIT_HOST}/`)).toBe("legit");
    expect(badgeText()).toBe("OK");
    expect(badgeText()).toBe(OK_TEXT);
    expect(badgeColor()).toBe(badgeLookFor("legit").color);

    expect(await evaluateTab(13, `https://${UNSEEN_HOST}/`)).toBe("unknown");
    expect(badgeText()).toBe("OK");
    expect(badgeColor()).toBe(badgeLookFor("unknown").color);
    expect(badgeColor()).not.toBe(badgeLookFor("legit").color);
    expect(setTitle.mock.lastCall?.[0].title.toLowerCase()).toContain("chưa có dữ liệu");
  });

  it("subdomain của host phish không bị gán nhầm, entry là băm của đúng host", async () => {
    expect(await evaluateTab(14, `https://www.${PHISH_HOST}/`)).toBe("unknown");
  });

  it("URL không phải http hay https thì không tra, badge về mức chưa có dữ liệu chứ không trống", async () => {
    expect(await evaluateTab(15, "chrome://extensions")).toBe("unknown");
    expect(badgeText()).toBe("OK");
    expect(badgeText()).not.toBe("");
    expect(badgeColor()).toBe(badgeLookFor("unknown").color);
    expect(networkCalls).toEqual([]);
  });

  it("mỗi tab có badge riêng, không sơn đè lên tab khác", async () => {
    await evaluateTab(11, `https://${PHISH_HOST}/`);
    await evaluateTab(12, `https://${UNSEEN_HOST}/`);

    expect(setBadgeText.mock.calls.map((call) => call[0])).toEqual([
      { tabId: 11, text: "NG" },
      { tabId: 12, text: "OK" },
    ]);
  });
});
