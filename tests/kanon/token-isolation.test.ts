import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_API_BASE_URL } from "../../src/config.ts";
import { createLookupBatcher } from "../../src/lib/lookup-batch.ts";
import { lookupHostTier1 } from "../../src/lib/tier1.ts";
import { runManualScan } from "../../src/lib/tier2.ts";
import { clearStoredInstallToken, readStoredInstallToken } from "../../src/lib/token-store.ts";
import { manualClock } from "../helpers/clock.ts";
import { reachableFrom } from "../helpers/imports.ts";
import { describeRequest, echoEmptyBuckets, tapFetch } from "../helpers/wire.ts";
import {
  FAKE_INSTALL_TOKEN,
  installRoute,
  isScanPost,
  isVerdictGet,
  queuedResponse,
  sleepSpy,
  tier2Tap,
  verdictEnvelope,
  verdictResponse,
} from "../helpers/tier2.ts";

const HOST = "ngan-hang-xac-thuc-otp-2026.kanon.example";

const CREDENTIAL_HEADERS = [
  "authorization",
  "cookie",
  "cookie2",
  "proxy-authorization",
  "x-install-token",
  "x-api-key",
  "x-client-id",
];

const TIER1_MODULES = ["lib/lookup.ts", "lib/lookup-batch.ts", "lib/tier1.ts", "background/tier1.ts"];

const TIER2_MODULES = ["lib/tier2.ts", "lib/scan.ts", "lib/install.ts", "lib/token-store.ts"];

async function spendOneTier2Scan(): Promise<void> {
  const tap = tier2Tap([
    installRoute(),
    (request) => (isScanPost(request) ? queuedResponse({ pollAfterSeconds: 0 }) : null),
    (request) => (isVerdictGet(request) ? verdictResponse(verdictEnvelope()) : null),
  ]);
  const timers = sleepSpy();

  const outcome = await runManualScan(
    {
      baseUrl: DEFAULT_API_BASE_URL,
      fetchImpl: tap.fetchImpl,
      sleep: timers.sleep,
      now: () => 1_800_000_000_000,
    },
    `https://${HOST}/dang-nhap`,
  );

  if (outcome.kind !== "verdict") {
    throw new Error(`tier 2 không đi tới verdict, nhận ${outcome.kind}`);
  }
}

async function driveOneTier1Lookup() {
  const clock = manualClock();
  const tap = tapFetch(echoEmptyBuckets);
  const batcher = createLookupBatcher({
    baseUrl: DEFAULT_API_BASE_URL,
    random: () => 0.5,
    fetchImpl: tap.fetchImpl,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  const pending = lookupHostTier1(HOST, batcher);
  await clock.settle();
  await pending;
  return tap;
}

beforeEach(async () => {
  await clearStoredInstallToken();
});

describe("install token của tier 2 không rò sang đường tier 1", () => {
  it("tier 2 đã lấy và lưu token, mà lượt tier 1 sau đó vẫn đi ra trần trụi", async () => {
    await spendOneTier2Scan();
    expect((await readStoredInstallToken())?.token).toBe(FAKE_INSTALL_TOKEN);

    const tap = await driveOneTier1Lookup();

    expect(tap.requests).toHaveLength(1);
    const request = tap.requests[0];

    expect(request.headerNames).toEqual([]);
    for (const name of CREDENTIAL_HEADERS) {
      expect(request.headers[name], `header ${name} không được có mặt`).toBeUndefined();
    }
    expect(request.credentials).toBe("omit");
    expect(request.referrerPolicy).toBe("no-referrer");
    expect(request.body).toBe("");
  });

  it("không byte nào của request tier 1 chứa token, kể cả năm ký tự đầu của nó", async () => {
    await spendOneTier2Scan();
    const tap = await driveOneTier1Lookup();
    const wire = describeRequest(tap.requests[0]);

    expect(wire).not.toContain(FAKE_INSTALL_TOKEN);
    expect(wire).not.toContain(FAKE_INSTALL_TOKEN.slice(0, 5));
    expect(wire.toLowerCase()).not.toContain("bearer");
    expect(new URL(tap.requests[0].url).pathname).toBe("/v1/lookup");
  });

  it("đồ thị import của tier 1 không chạm tới một module nào của tier 2", () => {
    for (const entry of TIER1_MODULES) {
      const reachable = Array.from(reachableFrom(entry));
      for (const forbidden of TIER2_MODULES) {
        expect(reachable, `${entry} với tới ${forbidden}`).not.toContain(forbidden);
      }
      expect(reachable, `${entry} với tới lib/api-error.ts`).not.toContain("lib/api-error.ts");
    }
  });

  it("kho token là một database riêng, không dùng chung với kho artifact của tier 0", async () => {
    const { INSTALL_DB_NAME } = await import("../../src/lib/token-store.ts");
    const { BLOCKLIST_DB_NAME } = await import("../../src/lib/blocklist-store.ts");
    expect(INSTALL_DB_NAME).not.toBe(BLOCKLIST_DB_NAME);
  });
});
