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
  AUTO_SCAN_MEMORY_DAYS,
  PRODUCTION_SCAN_QUOTA_PER_DAY,
  budgetLeftOf,
  decideAutoScan,
  resetAutoScanGate,
  runGatedAutoScan,
} from "../../src/lib/auto-scan.ts";
import {
  clearAutoScanStore,
  dayKeyOf,
  dayKeysBack,
  readAutoScanDay,
  writeAutoScanEnabled,
} from "../../src/lib/auto-scan-store.ts";
import { RISK_THRESHOLD, isHighRisk, scoreHost } from "../../src/lib/risk.ts";
import { NG_TEXT, badgeLookFor } from "../../src/background/tier0.ts";
import { entriesFor } from "../helpers/fixture.ts";
import { encodeAfbl } from "../../src/lib/afbl.ts";
import { manualClock } from "../helpers/clock.ts";
import { type WireTap } from "../helpers/wire.ts";
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

const HOST_NO_SIGNAL = "www.omelet.tech";

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
const setBadgeBackgroundColor = vi.fn(
  async (_details: { tabId: number; color: string }) => undefined,
);
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
    expect(setBadgeText.mock.calls.some((call) => call[0].text === NG_TEXT)).toBe(true);
    expect(
      setBadgeBackgroundColor.mock.calls.some(
        (call) => call[0].color === badgeLookFor("soft").color,
      ),
    ).toBe(true);
    expect(
      setBadgeBackgroundColor.mock.calls.some(
        (call) => call[0].color === badgeLookFor("phishing").color,
      ),
      "một verdict của model không được sơn badge đỏ, đó là badge của mức đã có người xác nhận",
    ).toBe(false);

    const day = await readAutoScanDay(dayKeyOf(Date.now()));
    expect(day.entries.map((entry) => entry.host)).toEqual([HOST_HIGH_RISK]);
    expect(day.entries[0].isScam).toBe(true);
  });

  it("host lạ không một tín hiệu rủi ro nào vẫn được tự quét, vì chưa có dữ liệu không phải là an toàn", async () => {
    expect(scoreHost(HOST_NO_SIGNAL).score).toBe(0);
    expect(isHighRisk(scoreHost(HOST_NO_SIGNAL))).toBe(false);
    expect(scoreHost(HOST_NO_SIGNAL).exempt).toBe(false);

    await browse([HOST_NO_SIGNAL]);

    expect(tap.requests.filter(isScanPost)).toHaveLength(1);
    expect(countInstallRequests(tap.requests)).toBe(1);
  });

  it("host dưới ngưỡng rủi ro cũng được quét, điểm rủi ro không còn là cổng chặn", async () => {
    expect(RISK_THRESHOLD).toBe(4);
    expect(scoreHost(HOST_LOW_RISK).score).toBe(3);
    expect(isHighRisk(scoreHost(HOST_LOW_RISK))).toBe(false);

    await browse([HOST_LOW_RISK]);

    expect(tap.requests.filter(isScanPost)).toHaveLength(1);
  });

  it("không lý do bỏ qua nào còn nhắc tới ngưỡng rủi ro", () => {
    const day = { day: "2026-08-23", entries: [] as const };
    const decision = decideAutoScan({
      url: `https://${HOST_NO_SIGNAL}/`,
      host: HOST_NO_SIGNAL,
      verdict: "unknown",
      enabled: true,
      risk: scoreHost(HOST_NO_SIGNAL),
      day,
      memory: [day],
    });

    expect(decision.kind).toBe("scan");
    expect(readSource("lib/auto-scan.ts")).not.toContain("below_threshold");
    expect(readSource("lib/auto-scan.ts")).not.toContain("isHighRisk");
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

  it("mười hai trang lạ trong một phiên duyệt nay tiêu đúng mười hai lượt, không còn bị cổng lọc chặn", async () => {
    expect(TWELVE_HIGH_RISK_HOSTS).toHaveLength(12);

    await browse(TWELVE_HIGH_RISK_HOSTS);

    expect(tap.requests.filter(isScanPost)).toHaveLength(12);

    const day = await readAutoScanDay(dayKeyOf(Date.now()));
    expect(day.entries).toHaveLength(12);
    expect(budgetLeftOf(day)).toBe(AUTO_SCAN_DAILY_CAP - 12);
  });

  it("trần vẫn còn đó và vẫn chừa chỗ cho lượt bấm tay trong hạn mức server", () => {
    expect(AUTO_SCAN_DAILY_CAP).toBe(300);
    expect(PRODUCTION_SCAN_QUOTA_PER_DAY).toBe(500);
    expect(PRODUCTION_SCAN_QUOTA_PER_DAY - AUTO_SCAN_DAILY_CAP).toBe(200);

    const full = {
      day: "2026-08-23",
      entries: Array.from({ length: AUTO_SCAN_DAILY_CAP }, (_unused, index) => ({
        host: `da-quet-${index}.test`,
        scannedAt: 1_800_000_000_000,
        score: 0,
        isScam: false,
      })),
    };

    expect(budgetLeftOf(full)).toBe(0);
    expect(
      decideAutoScan({
        url: `https://${HOST_NO_SIGNAL}/`,
        host: HOST_NO_SIGNAL,
        verdict: "unknown",
        enabled: true,
        risk: scoreHost(HOST_NO_SIGNAL),
        day: full,
        memory: [full],
      }),
    ).toEqual({ kind: "skip", reason: "budget_spent", risk: scoreHost(HOST_NO_SIGNAL) });
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
    expect(budgetLeftOf(day)).toBe(AUTO_SCAN_DAILY_CAP - 1);
  });

  it("ngân sách mở lại theo ngày, nhưng trí nhớ về host đã quét thì sống qua mốc nửa đêm", async () => {
    const firstDay = 1_800_000_000_000;
    const nextDay = firstDay + 86_400_000;
    const depsAt = (at: number) => ({
      baseUrl: DEFAULT_API_BASE_URL,
      fetchImpl: tap.fetchImpl,
      sleep: sleepSpy().sleep,
      now: () => at,
    });

    await runGatedAutoScan(depsAt(firstDay), {
      url: urlOf(HOST_HIGH_RISK),
      host: HOST_HIGH_RISK,
      verdict: "unknown",
    });
    expect(tap.requests.filter(isScanPost)).toHaveLength(1);

    const again = await runGatedAutoScan(depsAt(nextDay), {
      url: urlOf(HOST_HIGH_RISK),
      host: HOST_HIGH_RISK,
      verdict: "unknown",
    });

    expect(again).toEqual({
      kind: "skipped",
      reason: "already_scanned_recently",
      risk: scoreHost(HOST_HIGH_RISK),
    });
    expect(tap.requests.filter(isScanPost)).toHaveLength(1);

    const other = await runGatedAutoScan(depsAt(nextDay), {
      url: urlOf(TWELVE_HIGH_RISK_HOSTS[0]),
      host: TWELVE_HIGH_RISK_HOSTS[0],
      verdict: "unknown",
    });

    expect(other.kind).toBe("scanned");
    expect(tap.requests.filter(isScanPost)).toHaveLength(2);
    expect(budgetLeftOf(await readAutoScanDay(dayKeyOf(nextDay)))).toBe(AUTO_SCAN_DAILY_CAP - 1);
  });

  it("trí nhớ trải đúng bảy ngày, và ngày thứ tám thì host được quét lại", async () => {
    expect(AUTO_SCAN_MEMORY_DAYS).toBe(7);
    expect(dayKeysBack("2026-08-23", AUTO_SCAN_MEMORY_DAYS)).toEqual([
      "2026-08-23",
      "2026-08-22",
      "2026-08-21",
      "2026-08-20",
      "2026-08-19",
      "2026-08-18",
      "2026-08-17",
    ]);

    const firstDay = 1_800_000_000_000;
    const eighthDay = firstDay + 8 * 86_400_000;
    const depsAt = (at: number) => ({
      baseUrl: DEFAULT_API_BASE_URL,
      fetchImpl: tap.fetchImpl,
      sleep: sleepSpy().sleep,
      now: () => at,
    });

    await runGatedAutoScan(depsAt(firstDay), {
      url: urlOf(HOST_HIGH_RISK),
      host: HOST_HIGH_RISK,
      verdict: "unknown",
    });
    const later = await runGatedAutoScan(depsAt(eighthDay), {
      url: urlOf(HOST_HIGH_RISK),
      host: HOST_HIGH_RISK,
      verdict: "unknown",
    });

    expect(later.kind).toBe("scanned");
    expect(tap.requests.filter(isScanPost)).toHaveLength(2);
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
