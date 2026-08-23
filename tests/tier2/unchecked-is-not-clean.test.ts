import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_API_BASE_URL } from "../../src/config.ts";
import { decodeAfbl, encodeAfbl } from "../../src/lib/afbl.ts";
import { clearStoredBlocklist, writeStoredBlocklist } from "../../src/lib/blocklist-store.ts";
import { clearStoredInstallToken } from "../../src/lib/token-store.ts";
import { invalidateTier0Cache } from "../../src/lib/tier0.ts";
import { createLookupBatcher } from "../../src/lib/lookup-batch.ts";
import { useLookupBatcher } from "../../src/background/tier1.ts";
import {
  ATTEMPT_FAILED_REASON,
  BUDGET_SPENT_REASON,
  NO_VERDICT_REASON,
  UNCHECKED_IS_NOT_CLEAN,
  autoScanUncheckedLook,
  evaluateTabWithAutoScan,
} from "../../src/background/auto-scan.ts";
import {
  AUTO_SCAN_DAILY_CAP,
  AUTO_SCAN_MEMORY_DAYS,
  AUTO_SCAN_SKIP_REASONS,
  MEMORY_MEANS_AN_ANSWER,
  alreadyScannedRecently,
  attemptFailedToday,
  resetAutoScanGate,
  type AutoScanSkipReason,
} from "../../src/lib/auto-scan.ts";
import {
  clearAutoScanStore,
  dayKeyOf,
  reserveAutoScanSlot,
} from "../../src/lib/auto-scan-store.ts";
import {
  OK_MEANS_NOTHING_RAN,
  OK_MEANS_NO_FINDING,
  OK_TEXT,
  PENDING_COLOR,
  UNKNOWN_COLOR,
} from "../../src/lib/badge.ts";
import { entriesFor } from "../helpers/fixture.ts";
import { manualClock } from "../helpers/clock.ts";
import { type WireTap } from "../helpers/wire.ts";
import {
  installRoute,
  isScanPost,
  isVerdictGet,
  lookupRoute,
  queuedResponse,
  tier2Tap,
  verdictEnvelope,
  verdictResponse,
} from "../helpers/tier2.ts";

const FIXTURE_VERSION = 5151;

const HOST_UNKNOWN = "trang-la-chua-ai-cham.com";

const HOST_LEGIT_IN_ARTIFACT = "xoso-mien-bac.vn";

const setBadgeText = vi.fn(async (_details: { tabId: number; text: string }) => undefined);
const setBadgeBackgroundColor = vi.fn(
  async (_details: { tabId: number; color: string }) => undefined,
);
const setTitle = vi.fn(async (_details: { tabId: number; title: string }) => undefined);

let clock = manualClock();
let tap: WireTap = tier2Tap([lookupRoute]);

function urlOf(host: string): string {
  return `https://${host}/dang-nhap`;
}

async function browse(host: string): Promise<void> {
  const pending = evaluateTabWithAutoScan(700, urlOf(host));
  await clock.settle();
  await pending;
}

function paintedColors(): string[] {
  return setBadgeBackgroundColor.mock.calls.map((call) => call[0].color);
}

function paintedTitles(): string[] {
  return setTitle.mock.calls.map((call) => call[0].title);
}

async function spendBudget(): Promise<void> {
  const day = dayKeyOf(Date.now());
  for (let index = 0; index < AUTO_SCAN_DAILY_CAP; index += 1) {
    await reserveAutoScanSlot(day, {
      host: `da-quet-${index}.test`,
      scannedAt: Date.now(),
      score: 0,
      isScam: false,
    });
  }
}

async function setup(verdictBody: ReturnType<typeof verdictEnvelope>): Promise<void> {
  setBadgeText.mockClear();
  setBadgeBackgroundColor.mockClear();
  setTitle.mockClear();
  vi.stubGlobal("chrome", { action: { setBadgeText, setBadgeBackgroundColor, setTitle } });

  await clearStoredBlocklist();
  await clearStoredInstallToken();
  await clearAutoScanStore();
  resetAutoScanGate();
  invalidateTier0Cache();

  const bytes = encodeAfbl({
    version: FIXTURE_VERSION,
    phish: await entriesFor([]),
    legit: await entriesFor([HOST_LEGIT_IN_ARTIFACT]),
  });
  const decoded = decodeAfbl(bytes);
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
    fetchedAt: 1_800_000_000_000,
  });
  invalidateTier0Cache();

  clock = manualClock();
  tap = tier2Tap([
    lookupRoute,
    installRoute(),
    (request) => (isScanPost(request) ? queuedResponse({ pollAfterSeconds: 0 }) : null),
    (request) => (isVerdictGet(request) ? verdictResponse(verdictBody) : null),
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
}

beforeEach(async () => {
  await setup(verdictEnvelope({ is_scam: false }));
});

afterEach(() => {
  useLookupBatcher(null);
  resetAutoScanGate();
  vi.unstubAllGlobals();
});

describe("một trang chưa quét được không được sơn như một trang đã quét sạch", () => {
  it("nói rõ vì sao hai màu xám phải khác nhau", () => {
    expect(UNCHECKED_IS_NOT_CLEAN).toContain("không có phép kiểm nào chạy");
    expect(OK_MEANS_NOTHING_RAN).not.toBe(OK_MEANS_NO_FINDING);
    expect(PENDING_COLOR).not.toBe(UNKNOWN_COLOR);
  });

  it("badge chưa quét được vẫn là OK nhưng mang màu và lời giải thích riêng", () => {
    const look = autoScanUncheckedLook(BUDGET_SPENT_REASON);
    expect(look.text).toBe(OK_TEXT);
    expect(look.state).toBe("pending");
    expect(look.color).toBe(PENDING_COLOR);
    expect(look.color).not.toBe(UNKNOWN_COLOR);
    expect(look.title).toContain(BUDGET_SPENT_REASON);
    expect(look.title).toContain(OK_MEANS_NOTHING_RAN);
    expect(look.title).not.toContain(OK_MEANS_NO_FINDING);
  });

  it("hết ngân sách ngày thì domain lạ được sơn chưa quét được, không phải xám xanh", async () => {
    await spendBudget();

    await browse(HOST_UNKNOWN);

    expect(tap.requests.filter(isScanPost)).toHaveLength(0);
    expect(paintedColors()).toContain(PENDING_COLOR);
    expect(paintedTitles().some((title) => title.includes(BUDGET_SPENT_REASON))).toBe(true);
    expect(paintedColors().at(-1)).toBe(PENDING_COLOR);
  });

  it("nhắc đúng con số ngân sách trong lời giải thích, để người đọc biết chờ tới bao giờ", () => {
    expect(BUDGET_SPENT_REASON).toContain(String(AUTO_SCAN_DAILY_CAP));
  });

  it("quét xong mà server không trả kết luận đọc được thì cũng sơn chưa quét được", async () => {
    await setup(verdictEnvelope({ parse_ok: false, is_scam: null, parse_failure_reason: "no_json" }));

    await browse(HOST_UNKNOWN);

    expect(tap.requests.filter(isScanPost)).toHaveLength(1);
    expect(paintedColors()).toContain(PENDING_COLOR);
    expect(paintedTitles().some((title) => title.includes(NO_VERDICT_REASON))).toBe(true);
  });

  it("quét xong và model nói không phải lừa đảo thì không sơn chưa quét được", async () => {
    await browse(HOST_UNKNOWN);

    expect(tap.requests.filter(isScanPost)).toHaveLength(1);
    expect(paintedTitles().some((title) => title.includes(BUDGET_SPENT_REASON))).toBe(false);
    expect(paintedTitles().some((title) => title.includes(NO_VERDICT_REASON))).toBe(false);
  });

  it("host đã có kết luận trong danh sách thì không đi qua đường chưa quét được", async () => {
    await browse(HOST_LEGIT_IN_ARTIFACT);

    expect(tap.requests.filter(isScanPost)).toHaveLength(0);
    expect(paintedColors()).not.toContain(PENDING_COLOR);
  });

  it("một lượt quét hỏng không chiếm chỗ trong sổ nhớ bảy ngày", () => {
    expect(MEMORY_MEANS_AN_ANSWER).toContain("một tuần");

    const answered = {
      day: "2026-08-20",
      entries: [{ host: HOST_UNKNOWN, scannedAt: 1, score: 0, isScam: false }],
    };
    const failed = {
      day: "2026-08-20",
      entries: [{ host: HOST_UNKNOWN, scannedAt: 1, score: 0, isScam: null }],
    };

    expect(alreadyScannedRecently([answered], HOST_UNKNOWN)).toBe(true);
    expect(alreadyScannedRecently([failed], HOST_UNKNOWN)).toBe(false);
    expect(AUTO_SCAN_MEMORY_DAYS).toBe(7);
  });

  it("nhưng lượt hỏng vẫn chặn hết ngày hôm nay, để server hỏng không ăn sạch ngân sách", () => {
    const today = {
      day: "2026-08-23",
      entries: [{ host: HOST_UNKNOWN, scannedAt: 1, score: 0, isScam: null }],
    };

    expect(attemptFailedToday(today, HOST_UNKNOWN)).toBe(true);
    expect(attemptFailedToday(today, "host-khac.test")).toBe(false);
    expect(
      attemptFailedToday(
        { day: "2026-08-23", entries: [{ host: HOST_UNKNOWN, scannedAt: 1, score: 0, isScam: true }] },
        HOST_UNKNOWN,
      ),
    ).toBe(false);
  });

  it("lượt hỏng hôm nay được sơn chưa quét được ở những lần vào lại trang trong ngày", async () => {
    await setup(verdictEnvelope({ parse_ok: false, is_scam: null, parse_failure_reason: "no_json" }));

    await browse(HOST_UNKNOWN);
    setBadgeBackgroundColor.mockClear();
    setTitle.mockClear();
    await browse(HOST_UNKNOWN);

    expect(tap.requests.filter(isScanPost)).toHaveLength(1);
    expect(paintedColors()).toContain(PENDING_COLOR);
    expect(paintedTitles().some((title) => title.includes(ATTEMPT_FAILED_REASON))).toBe(true);
  });

  it("mỗi lý do bỏ qua phải được xếp vào sơn lại hay im lặng, không lý do nào rơi ra ngoài", () => {
    const repaints: AutoScanSkipReason[] = ["budget_spent", "attempt_failed_today"];
    const quiet: AutoScanSkipReason[] = [
      "disabled",
      "not_scannable",
      "host_exempt",
      "verdict_known",
      "already_scanned_recently",
    ];

    expect([...repaints, ...quiet].sort()).toEqual([...AUTO_SCAN_SKIP_REASONS].sort());
    expect(repaints.filter((reason) => quiet.includes(reason))).toEqual([]);

    const source = readFileSync(
      new URL("../../src/background/auto-scan.ts", import.meta.url),
      "utf8",
    );
    for (const reason of repaints) {
      expect(source).toContain(`outcome.reason === "${reason}"`);
    }
    for (const reason of quiet) {
      expect(source).not.toContain(`outcome.reason === "${reason}"`);
    }
  });
});
