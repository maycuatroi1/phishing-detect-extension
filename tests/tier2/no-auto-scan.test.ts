import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_API_BASE_URL } from "../../src/config.ts";
import { decodeAfbl } from "../../src/lib/afbl.ts";
import { clearStoredBlocklist, writeStoredBlocklist } from "../../src/lib/blocklist-store.ts";
import { clearStoredInstallToken } from "../../src/lib/token-store.ts";
import { invalidateTier0Cache } from "../../src/lib/tier0.ts";
import { createLookupBatcher } from "../../src/lib/lookup-batch.ts";
import { evaluateTabTiered, useLookupBatcher } from "../../src/background/tier1.ts";
import { runManualScan } from "../../src/lib/tier2.ts";
import { fixtureArtifact } from "../helpers/fixture.ts";
import { manualClock } from "../helpers/clock.ts";
import { pathOf, type WireTap } from "../helpers/wire.ts";
import { reachableFrom, readSource } from "../helpers/imports.ts";
import {
  countInstallRequests,
  countScanRequests,
  installRoute,
  isScanPost,
  isVerdictGet,
  lookupRoute,
  queuedResponse,
  sleepSpy,
  tier2Tap,
  verdictEnvelope,
  verdictResponse,
} from "../helpers/tier2.ts";

const FIXTURE_VERSION = 5150;

const STRANGE_HOSTS = Array.from({ length: 20 }, (_, index) => `trang-la-so-${index + 1}.example`);

const setBadgeText = vi.fn(async () => undefined);
const setBadgeBackgroundColor = vi.fn(async () => undefined);
const setTitle = vi.fn(async () => undefined);

let clock = manualClock();
let tap: WireTap = tier2Tap([lookupRoute]);

beforeEach(async () => {
  vi.stubGlobal("chrome", { action: { setBadgeText, setBadgeBackgroundColor, setTitle } });

  await clearStoredBlocklist();
  await clearStoredInstallToken();
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
    etag: `"afbl-1-${FIXTURE_VERSION}"`,
    pinnedUrl: `/v1/blocklist/v/${FIXTURE_VERSION}?format=1`,
    fetchedAt: 1_800_000_000_000,
  });
  invalidateTier0Cache();

  clock = manualClock();
  tap = tier2Tap([
    lookupRoute,
    installRoute(),
    (request) => (isScanPost(request) ? queuedResponse({ pollAfterSeconds: 0 }) : null),
    (request) => (isVerdictGet(request) ? verdictResponse(verdictEnvelope()) : null),
  ]);

  vi.stubGlobal("fetch", tap.fetchImpl);

  useLookupBatcher(
    createLookupBatcher({
      baseUrl: DEFAULT_API_BASE_URL,
      random: () => 0.5,
      fetchImpl: tap.fetchImpl,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    }),
  );
});

afterEach(() => {
  useLookupBatcher(null);
  vi.unstubAllGlobals();
});

async function browseTwentyStrangePages(): Promise<void> {
  const pending = STRANGE_HOSTS.map((host, index) =>
    evaluateTabTiered(300 + index, `https://${host}/dang-nhap?tk=nguyenanhbinh`),
  );
  await clock.settle();
  await Promise.all(pending);
}

describe("điều hướng không bao giờ tự gọi tier 2", () => {
  it("đi qua 20 trang lạ mà không có một request /v1/scan nào", async () => {
    await browseTwentyStrangePages();

    expect(countScanRequests(tap.requests)).toBe(0);
    expect(countInstallRequests(tap.requests)).toBe(0);
    expect(tap.requests.every((request) => pathOf(request) === "/v1/lookup")).toBe(true);
  });

  it("bấm nút mới phát ra đúng một POST /v1/scan, và chỉ sau khi đã duyệt xong 20 trang", async () => {
    await browseTwentyStrangePages();
    const beforeClick = tap.requests.length;

    const timers = sleepSpy();
    const outcome = await runManualScan(
      {
        baseUrl: DEFAULT_API_BASE_URL,
        fetchImpl: tap.fetchImpl,
        sleep: timers.sleep,
        now: () => 1_800_000_000_000,
      },
      `https://${STRANGE_HOSTS[0]}/dang-nhap?tk=nguyenanhbinh`,
    );

    expect(outcome.kind).toBe("verdict");

    const afterClick = tap.requests.slice(beforeClick);
    expect(afterClick.filter(isScanPost)).toHaveLength(1);
    expect(countInstallRequests(afterClick)).toBe(1);
    expect(afterClick.filter(isVerdictGet)).toHaveLength(1);
  });

  it("service worker không với tới được một dòng code nào của tier 2", () => {
    const reachable = reachableFrom("background/index.ts");

    expect(reachable.has("background/tier0.ts")).toBe(true);
    expect(reachable.has("background/tier1.ts")).toBe(true);
    for (const module of ["lib/tier2.ts", "lib/scan.ts", "lib/install.ts", "lib/token-store.ts"]) {
      expect(Array.from(reachable), `${module} không được nằm trong đồ thị import của background`)
        .not.toContain(module);
    }
  });

  it("chỉ popup nối vào tier 2, và popup là thứ duy nhất gọi runManualScan", () => {
    const fromPopup = reachableFrom("popup/popup.ts");
    expect(fromPopup.has("lib/tier2.ts")).toBe(true);

    expect(readSource("popup/popup.ts")).toContain("addEventListener(\"click\"");
  });

  it("không file nào của tier 2 nghe sự kiện điều hướng hay đặt hẹn giờ nền", () => {
    for (const relative of ["lib/tier2.ts", "lib/scan.ts", "lib/install.ts", "lib/token-store.ts"]) {
      const text = readSource(relative);
      for (const banned of [
        "chrome.tabs",
        "chrome.alarms",
        "chrome.webNavigation",
        "chrome.runtime",
        "onUpdated",
        "onActivated",
        "addListener",
        "setInterval",
      ]) {
        expect(text, `${relative} nhắc tới ${banned}`).not.toContain(banned);
      }
    }
  });
});
