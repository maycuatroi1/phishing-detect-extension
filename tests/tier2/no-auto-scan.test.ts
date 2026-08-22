import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_API_BASE_URL } from "../../src/config.ts";
import { decodeAfbl } from "../../src/lib/afbl.ts";
import { clearStoredBlocklist, writeStoredBlocklist } from "../../src/lib/blocklist-store.ts";
import { clearStoredInstallToken } from "../../src/lib/token-store.ts";
import { invalidateTier0Cache, lookupHost } from "../../src/lib/tier0.ts";
import { createLookupBatcher } from "../../src/lib/lookup-batch.ts";
import { useLookupBatcher } from "../../src/background/tier1.ts";
import { evaluateTabWithAutoScan } from "../../src/background/auto-scan.ts";
import { runManualScan } from "../../src/lib/tier2.ts";
import {
  AUTO_SCAN_DAILY_CAP,
  PRODUCTION_SCAN_QUOTA_PER_DAY,
  budgetLeftOf,
  resetAutoScanGate,
  runGatedAutoScan,
} from "../../src/lib/auto-scan.ts";
import {
  clearAutoScanStore,
  dayKeyOf,
  readAutoScanDay,
  writeAutoScanEnabled,
} from "../../src/lib/auto-scan-store.ts";
import { RISK_THRESHOLD, isHighRisk, scoreHost } from "../../src/lib/risk.ts";
import { HARD_WARNING_TEXT, SOFT_WARNING_TEXT } from "../../src/background/tier0.ts";
import { entriesFor } from "../helpers/fixture.ts";
import { encodeAfbl } from "../../src/lib/afbl.ts";
import { manualClock } from "../helpers/clock.ts";
import { pathOf, type WireTap } from "../helpers/wire.ts";
import { directImportsOf, reachableFrom, readSource, sourceFiles } from "../helpers/imports.ts";
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

const TIER2_MODULES = ["lib/tier2.ts", "lib/scan.ts", "lib/install.ts", "lib/token-store.ts"];

const HOST_HIGH_RISK = "mamibet88.cc";

const HOST_LOW_RISK = "benhvien199.vn";

const HOST_LEGIT_IN_ARTIFACT = "xoso-mien-bac.vn";

const HOST_PHISH_IN_ARTIFACT = "vietcombank-xacthuc-otp.top";

const TWELVE_HIGH_RISK_HOSTS = [
  "nhacai-mot.top",
  "nhacai-hai.top",
  "nhacai-ba.top",
  "nhacai-bon.top",
  "nhacai-nam.top",
  "nhacai-sau.top",
  "nhacai-bay.top",
  "nhacai-tam.top",
  "nhacai-chin.top",
  "nhacai-muoi.top",
  "nhacai-muoimot.top",
  "nhacai-muoihai.top",
];

const setBadgeText = vi.fn(async (_details: { tabId: number; text: string }) => undefined);
const setBadgeBackgroundColor = vi.fn(async () => undefined);
const setTitle = vi.fn(async () => undefined);

let clock = manualClock();
let tap: WireTap = tier2Tap([lookupRoute]);

function urlOf(host: string): string {
  return `https://${host}/dang-nhap?tk=nguyenanhbinh`;
}

async function browse(hosts: readonly string[]): Promise<void> {
  const pending = hosts.map((host, index) => evaluateTabWithAutoScan(300 + index, urlOf(host)));
  await clock.settle();
  await Promise.all(pending);
}

beforeEach(async () => {
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
    phish: await entriesFor([HOST_PHISH_IN_ARTIFACT]),
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
  resetAutoScanGate();
  vi.unstubAllGlobals();
});

describe("tự quét chỉ chạy sau khi qua cổng lọc", () => {
  it("host lạ điểm rủi ro cao thì tự quét và tự cảnh báo, không cần một cú bấm nào", async () => {
    expect(scoreHost(HOST_HIGH_RISK).score).toBe(8);
    expect(isHighRisk(scoreHost(HOST_HIGH_RISK))).toBe(true);

    await browse([HOST_HIGH_RISK]);

    expect(tap.requests.filter(isScanPost)).toHaveLength(1);
    expect(countInstallRequests(tap.requests)).toBe(1);
    expect(setBadgeText.mock.calls.some((call) => call[0].text === SOFT_WARNING_TEXT)).toBe(true);
    expect(
      setBadgeText.mock.calls.some((call) => call[0].text === HARD_WARNING_TEXT),
      "một verdict của model không được sơn badge đỏ, đó là badge của mức đã có người xác nhận",
    ).toBe(false);

    const day = await readAutoScanDay(dayKeyOf(Date.now()));
    expect(day.entries.map((entry) => entry.host)).toEqual([HOST_HIGH_RISK]);
    expect(day.entries[0].isScam).toBe(true);
  });

  it("host dưới ngưỡng rủi ro thì tuyệt đối không tự quét", async () => {
    expect(RISK_THRESHOLD).toBe(4);
    expect(scoreHost(HOST_LOW_RISK).score).toBe(3);
    expect(isHighRisk(scoreHost(HOST_LOW_RISK))).toBe(false);

    await browse([HOST_LOW_RISK]);

    expect(countScanRequests(tap.requests)).toBe(0);
    expect(countInstallRequests(tap.requests)).toBe(0);
    expect(tap.requests.every((request) => pathOf(request) === "/v1/lookup")).toBe(true);
  });

  it("host có verdict legit trong artifact thì không tự quét, kể cả khi điểm rủi ro vượt ngưỡng", async () => {
    expect(scoreHost(HOST_LEGIT_IN_ARTIFACT).score).toBe(5);
    expect(isHighRisk(scoreHost(HOST_LEGIT_IN_ARTIFACT))).toBe(true);
    expect((await lookupHost(HOST_LEGIT_IN_ARTIFACT)).verdict).toBe("legit");

    await browse([HOST_LEGIT_IN_ARTIFACT]);

    expect(countScanRequests(tap.requests)).toBe(0);
    expect(countInstallRequests(tap.requests)).toBe(0);
    expect(await readAutoScanDay(dayKeyOf(Date.now()))).toEqual({
      day: dayKeyOf(Date.now()),
      entries: [],
    });
  });

  it("host đã là phishing trong artifact thì không tiêu thêm một lượt tự quét nào", async () => {
    expect(isHighRisk(scoreHost(HOST_PHISH_IN_ARTIFACT))).toBe(true);
    expect((await lookupHost(HOST_PHISH_IN_ARTIFACT)).verdict).toBe("phishing");

    await browse([HOST_PHISH_IN_ARTIFACT]);

    expect(countScanRequests(tap.requests)).toBe(0);
  });

  it("trần tự quét mỗi ngày là 6 lượt và mười hai trang lạ điểm cao chỉ tiêu đúng 6", async () => {
    expect(AUTO_SCAN_DAILY_CAP).toBe(6);
    expect(PRODUCTION_SCAN_QUOTA_PER_DAY).toBe(20);
    expect(PRODUCTION_SCAN_QUOTA_PER_DAY - AUTO_SCAN_DAILY_CAP).toBe(14);
    expect(TWELVE_HIGH_RISK_HOSTS).toHaveLength(12);
    for (const host of TWELVE_HIGH_RISK_HOSTS) {
      expect(isHighRisk(scoreHost(host)), `${host} phải vượt ngưỡng thì bài này mới có nghĩa`).toBe(true);
    }

    await browse(TWELVE_HIGH_RISK_HOSTS);

    expect(tap.requests.filter(isScanPost)).toHaveLength(6);

    const day = await readAutoScanDay(dayKeyOf(Date.now()));
    expect(day.entries).toHaveLength(6);
    expect(budgetLeftOf(day)).toBe(0);
  });

  it("người dùng tắt tự quét thì mười hai trang lạ điểm cao không chạy lượt nào", async () => {
    await writeAutoScanEnabled(false, 1_800_000_000_000);

    await browse(TWELVE_HIGH_RISK_HOSTS);

    expect(countScanRequests(tap.requests)).toBe(0);
    expect(countInstallRequests(tap.requests)).toBe(0);
    expect((await readAutoScanDay(dayKeyOf(Date.now()))).entries).toEqual([]);
  });

  it("một host đã tự quét rồi thì năm lần ghé lại trong cùng ngày vẫn chỉ có một lượt quét", async () => {
    await browse([HOST_HIGH_RISK]);
    await browse([HOST_HIGH_RISK]);
    await browse([HOST_HIGH_RISK]);
    await browse([HOST_HIGH_RISK]);
    await browse([HOST_HIGH_RISK]);

    expect(tap.requests.filter(isScanPost)).toHaveLength(1);

    const day = await readAutoScanDay(dayKeyOf(Date.now()));
    expect(day.entries).toHaveLength(1);
    expect(budgetLeftOf(day)).toBe(5);
  });

  it("ngân sách mở lại theo ngày chứ không phải theo phiên", async () => {
    const firstDay = 1_800_000_000_000;
    const nextDay = firstDay + 86_400_000;

    for (const host of TWELVE_HIGH_RISK_HOSTS) {
      await runGatedAutoScan(
        { baseUrl: DEFAULT_API_BASE_URL, fetchImpl: tap.fetchImpl, sleep: sleepSpy().sleep, now: () => firstDay },
        { url: urlOf(host), host, verdict: "unknown" },
      );
    }
    expect(tap.requests.filter(isScanPost)).toHaveLength(6);

    await runGatedAutoScan(
      { baseUrl: DEFAULT_API_BASE_URL, fetchImpl: tap.fetchImpl, sleep: sleepSpy().sleep, now: () => nextDay },
      { url: urlOf(HOST_HIGH_RISK), host: HOST_HIGH_RISK, verdict: "unknown" },
    );

    expect(tap.requests.filter(isScanPost)).toHaveLength(7);
    expect((await readAutoScanDay(dayKeyOf(nextDay))).entries).toHaveLength(1);
    expect((await readAutoScanDay(dayKeyOf(firstDay))).entries).toEqual([]);
  });

  it("giữ chỗ trong sổ ngân sách trước khi gửi request, chứ không phải sau khi có kết quả", async () => {
    let entriesWhenScanLeft = -1;

    const recordThenQueue = async (): Promise<Response> => {
      entriesWhenScanLeft = (await readAutoScanDay(dayKeyOf(Date.now()))).entries.length;
      return queuedResponse({ pollAfterSeconds: 0 });
    };

    tap = tier2Tap([
      lookupRoute,
      installRoute(),
      (request) => (isScanPost(request) ? recordThenQueue() : null),
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

    await browse([HOST_HIGH_RISK]);

    expect(tap.requests.filter(isScanPost)).toHaveLength(1);
    expect(entriesWhenScanLeft).toBe(1);
  });

  it("bấm nút vẫn quét được ngay cả khi ngân sách tự quét đã cạn", async () => {
    await browse(TWELVE_HIGH_RISK_HOSTS);
    const beforeClick = tap.requests.length;

    const timers = sleepSpy();
    const outcome = await runManualScan(
      {
        baseUrl: DEFAULT_API_BASE_URL,
        fetchImpl: tap.fetchImpl,
        sleep: timers.sleep,
        now: () => 1_800_000_000_000,
      },
      urlOf(HOST_HIGH_RISK),
    );

    expect(outcome.kind).toBe("verdict");
    expect(tap.requests.slice(beforeClick).filter(isScanPost)).toHaveLength(1);
  });
});

describe("cấu trúc không cho phép một đường tắt nào tới tier 2", () => {
  it("không file nào trong background import thẳng một module tier 2", () => {
    const background = sourceFiles().filter((file) => file.startsWith("background/"));
    expect(background.length).toBeGreaterThanOrEqual(4);

    for (const file of background) {
      for (const forbidden of TIER2_MODULES) {
        expect(directImportsOf(file), `${file} import thẳng ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("đúng hai chỗ trong src gọi được runManualScan: cổng lọc và cú bấm trong popup", () => {
    const callers = sourceFiles().filter(
      (file) => file !== "lib/tier2.ts" && readSource(file).includes("runManualScan"),
    );
    expect(callers.sort()).toEqual(["lib/auto-scan.ts", "popup/popup.ts"]);
  });

  it("service worker chỉ với tới tier 2 qua cổng lọc, và cổng lọc luôn kéo theo bộ chấm điểm", () => {
    const reachable = reachableFrom("background/index.ts");
    expect(reachable.has("lib/auto-scan.ts")).toBe(true);
    expect(reachable.has("lib/tier2.ts")).toBe(true);

    const gate = reachableFrom("lib/auto-scan.ts");
    for (const required of ["lib/risk.ts", "lib/auto-scan-store.ts", "lib/tier2.ts", "lib/scan.ts"]) {
      expect(Array.from(gate), `cổng lọc phải với tới ${required}`).toContain(required);
    }

    const text = readSource("lib/auto-scan.ts");
    expect(text).toContain("decideAutoScan(context)");
    expect(text).toContain("reserveAutoScanSlot(day");
  });

  it("không file nào của tier 2 hay của cổng lọc tự khởi động được", () => {
    for (const relative of [...TIER2_MODULES, "lib/auto-scan.ts", "lib/auto-scan-store.ts", "lib/risk.ts"]) {
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

  it("popup vẫn là chỗ duy nhất gọi runManualScan bằng một cú bấm", () => {
    const fromPopup = reachableFrom("popup/popup.ts");
    expect(fromPopup.has("lib/tier2.ts")).toBe(true);
    expect(readSource("popup/popup.ts")).toContain("addEventListener(\"click\"");
  });
});
