import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_API_BASE_URL } from "../../src/config.ts";
import { decodeAfbl } from "../../src/lib/afbl.ts";
import { clearStoredBlocklist, writeStoredBlocklist } from "../../src/lib/blocklist-store.ts";
import { hostSha256Hex } from "../../src/lib/host.ts";
import { prefixOfHashHex } from "../../src/lib/lookup.ts";
import { createLookupBatcher } from "../../src/lib/lookup-batch.ts";
import { invalidateTier0Cache } from "../../src/lib/tier0.ts";
import { evaluateTabTiered, tier0AsksTier1, useLookupBatcher } from "../../src/background/tier1.ts";
import { LEGIT_HOST, PHISH_HOST, UNSEEN_HOST, fixtureArtifact } from "../helpers/fixture.ts";
import { manualClock } from "../helpers/clock.ts";
import { echoEmptyBuckets, tapFetch } from "../helpers/wire.ts";

const FIXTURE_VERSION = 5150;

const setBadgeText = vi.fn(async () => undefined);
const setBadgeBackgroundColor = vi.fn(async () => undefined);
const setTitle = vi.fn(async () => undefined);

let clock = manualClock();
let tap = tapFetch(echoEmptyBuckets);

beforeEach(async () => {
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

  clock = manualClock();
  tap = tapFetch(echoEmptyBuckets);
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

describe("tier 1 chỉ mở ra cho host không có trong artifact cục bộ", () => {
  it("host nằm trong danh sách phish không phát ra request nào", async () => {
    const verdict = await evaluateTabTiered(21, `https://${PHISH_HOST}/dang-nhap`);
    await clock.settle();

    expect(verdict).toBe("phishing");
    expect(tap.requests).toEqual([]);
  });

  it("host nằm trong danh sách legit cũng không phát ra request nào", async () => {
    const verdict = await evaluateTabTiered(22, `https://${LEGIT_HOST}/`);
    await clock.settle();

    expect(verdict).toBe("legit");
    expect(tap.requests).toEqual([]);
  });

  it("URL không phải http hay https thì dừng ở tier 0, không có gì để băm", async () => {
    const verdict = await evaluateTabTiered(23, "chrome://extensions");
    await clock.settle();

    expect(verdict).toBe("unknown");
    expect(tap.requests).toEqual([]);
  });

  it("host lạ mới đi tiếp, và nó chỉ gửi đúng một prefix 5 ký tự hex", async () => {
    const pending = evaluateTabTiered(24, `https://${UNSEEN_HOST}/tai-khoan`);
    await clock.settle();
    const verdict = await pending;

    expect(verdict).toBe("absent");
    expect(tap.requests).toHaveLength(1);

    const expected = prefixOfHashHex(await hostSha256Hex(UNSEEN_HOST));
    expect(tap.requests[0].prefixes).toEqual([expected]);
    expect(tap.requests[0].headerNames).toEqual([]);
    expect(tap.requests[0].credentials).toBe("omit");
  });

  it("chỉ hai verdict của tier 0 mở đường cho tier 1", () => {
    expect(tier0AsksTier1("unknown")).toBe(true);
    expect(tier0AsksTier1("no_artifact")).toBe(true);
    expect(tier0AsksTier1("phishing")).toBe(false);
    expect(tier0AsksTier1("legit")).toBe(false);
  });

  it("chưa có artifact nào thì host nào cũng phải hỏi tier 1", async () => {
    await clearStoredBlocklist();
    invalidateTier0Cache();

    const pending = evaluateTabTiered(25, `https://${PHISH_HOST}/`);
    await clock.settle();
    await pending;

    expect(tap.requests).toHaveLength(1);
    expect(tap.requests[0].prefixes).toHaveLength(1);
  });
});
