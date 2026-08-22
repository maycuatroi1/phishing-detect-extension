import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_API_BASE_URL } from "../../src/config.ts";
import { SCAN_PATH, isScannableUrl, scanRequestBody, verdictPath } from "../../src/lib/scan.ts";
import { runManualScan } from "../../src/lib/tier2.ts";
import {
  clearStoredInstallToken,
  readStoredInstallToken,
  writeStoredInstallToken,
} from "../../src/lib/token-store.ts";
import { panelView } from "../../src/popup/scan-panel.ts";
import { pathOf, type WireRequest } from "../helpers/wire.ts";
import {
  FAKE_INSTALL_TOKEN,
  FAKE_ROTATED_TOKEN,
  FAKE_SCAN_ID,
  countInstallRequests,
  installRoute,
  isScanPost,
  isVerdictGet,
  queuedEnvelope,
  queuedResponse,
  sleepSpy,
  tier2Tap,
  unauthorizedResponse,
  verdictEnvelope,
  verdictResponse,
} from "../helpers/tier2.ts";

const TARGET = "https://vietcombank-otp.example/dang-nhap?tk=nguyenanhbinh";

const NOW = 1_800_000_000_000;

beforeEach(async () => {
  await clearStoredInstallToken();
});

function pollingTap(pollsBeforeDone: number) {
  let polls = 0;
  return tier2Tap([
    installRoute(),
    (request) => (isScanPost(request) ? queuedResponse({ pollAfterSeconds: 2 }) : null),
    (request) => {
      if (!isVerdictGet(request)) {
        return null;
      }
      polls += 1;
      return verdictResponse(polls > pollsBeforeDone ? verdictEnvelope() : queuedEnvelope());
    },
  ]);
}

describe("một lần bấm quét đi hết vòng đời của nó", () => {
  it("mint token lần đầu, POST đúng một trường url, rồi poll tới khi có kết luận", async () => {
    const tap = pollingTap(2);
    const timers = sleepSpy();

    const outcome = await runManualScan(
      { baseUrl: DEFAULT_API_BASE_URL, fetchImpl: tap.fetchImpl, sleep: timers.sleep, now: () => NOW },
      TARGET,
    );

    expect(outcome.kind).toBe("verdict");
    if (outcome.kind !== "verdict") {
      throw new Error("outcome sai nhánh");
    }
    expect(outcome.envelope.status).toBe("done");
    expect(outcome.polls).toBe(3);
    expect(outcome.quotaRemaining).toBe(19);

    expect(countInstallRequests(tap.requests)).toBe(1);
    expect(tap.requests.filter(isScanPost)).toHaveLength(1);
    expect(tap.requests.filter(isVerdictGet)).toHaveLength(3);
    expect(timers.delays).toEqual([2000, 2000, 2000]);
  });

  it("thân request mang đúng một trường url, không prompt, không html, không model", async () => {
    const tap = pollingTap(0);
    const timers = sleepSpy();

    await runManualScan(
      { baseUrl: DEFAULT_API_BASE_URL, fetchImpl: tap.fetchImpl, sleep: timers.sleep, now: () => NOW },
      TARGET,
    );

    const post = tap.requests.find(isScanPost) as WireRequest;
    expect(Object.keys(JSON.parse(post.body))).toEqual(["url"]);
    expect(JSON.parse(post.body).url).toBe(TARGET);
    expect(post.body).toBe(scanRequestBody(TARGET));
    expect(pathOf(post)).toBe(SCAN_PATH);
  });

  it("cả POST lẫn GET đều mang Bearer token, và POST không mang cookie", async () => {
    const tap = pollingTap(0);
    const timers = sleepSpy();

    await runManualScan(
      { baseUrl: DEFAULT_API_BASE_URL, fetchImpl: tap.fetchImpl, sleep: timers.sleep, now: () => NOW },
      TARGET,
    );

    const post = tap.requests.find(isScanPost) as WireRequest;
    const get = tap.requests.find(isVerdictGet) as WireRequest;

    expect(post.headers.authorization).toBe(`Bearer ${FAKE_INSTALL_TOKEN}`);
    expect(get.headers.authorization).toBe(`Bearer ${FAKE_INSTALL_TOKEN}`);
    expect(post.headers.cookie).toBeUndefined();
    expect(post.credentials).toBe("omit");
    expect(get.credentials).toBe("omit");
    expect(pathOf(get)).toBe(verdictPath(FAKE_SCAN_ID));
  });

  it("token được lưu lại, lần quét thứ hai không xin token mới", async () => {
    const tap = pollingTap(0);
    const timers = sleepSpy();
    const deps = {
      baseUrl: DEFAULT_API_BASE_URL,
      fetchImpl: tap.fetchImpl,
      sleep: timers.sleep,
      now: () => NOW,
    };

    await runManualScan(deps, TARGET);
    const stored = await readStoredInstallToken();
    expect(stored?.token).toBe(FAKE_INSTALL_TOKEN);

    await runManualScan(deps, TARGET);
    expect(countInstallRequests(tap.requests)).toBe(1);
  });

  it("token quá hạn xoay vòng thì mint lại đúng một lần", async () => {
    await writeStoredInstallToken({
      token: FAKE_INSTALL_TOKEN,
      rotateAfterDays: 90,
      mintedAt: NOW - 91 * 86_400_000,
    });

    const tap = tier2Tap([
      installRoute(FAKE_ROTATED_TOKEN),
      (request) => (isScanPost(request) ? queuedResponse({ pollAfterSeconds: 0 }) : null),
      (request) => (isVerdictGet(request) ? verdictResponse(verdictEnvelope()) : null),
    ]);
    const timers = sleepSpy();

    await runManualScan(
      { baseUrl: DEFAULT_API_BASE_URL, fetchImpl: tap.fetchImpl, sleep: timers.sleep, now: () => NOW },
      TARGET,
    );

    expect(countInstallRequests(tap.requests)).toBe(1);
    const post = tap.requests.find(isScanPost) as WireRequest;
    expect(post.headers.authorization).toBe(`Bearer ${FAKE_ROTATED_TOKEN}`);
    expect((await readStoredInstallToken())?.token).toBe(FAKE_ROTATED_TOKEN);
  });

  it("401 invalid_token chỉ được sửa bằng đúng một lần mint lại, không lặp vô hạn", async () => {
    await writeStoredInstallToken({
      token: FAKE_INSTALL_TOKEN,
      rotateAfterDays: 90,
      mintedAt: NOW,
    });

    const tap = tier2Tap([
      installRoute(FAKE_ROTATED_TOKEN),
      (request) => (isScanPost(request) ? unauthorizedResponse("invalid_token") : null),
    ]);
    const timers = sleepSpy();

    const outcome = await runManualScan(
      { baseUrl: DEFAULT_API_BASE_URL, fetchImpl: tap.fetchImpl, sleep: timers.sleep, now: () => NOW },
      TARGET,
    );

    expect(outcome.kind).toBe("refused");
    expect(countInstallRequests(tap.requests)).toBe(1);
    expect(tap.requests.filter(isScanPost)).toHaveLength(2);
  });

  it("scan không xong sau trần poll thì trả pending chứ không poll mãi", async () => {
    const tap = tier2Tap([
      installRoute(),
      (request) => (isScanPost(request) ? queuedResponse({ pollAfterSeconds: 0 }) : null),
      (request) => (isVerdictGet(request) ? verdictResponse(queuedEnvelope()) : null),
    ]);
    const timers = sleepSpy();

    const outcome = await runManualScan(
      {
        baseUrl: DEFAULT_API_BASE_URL,
        fetchImpl: tap.fetchImpl,
        sleep: timers.sleep,
        now: () => NOW,
        maxPollAttempts: 4,
      },
      TARGET,
    );

    expect(outcome.kind).toBe("pending");
    expect(tap.requests.filter(isVerdictGet)).toHaveLength(4);
  });

  it("URL không quét được thì không phát ra request nào tới /v1/scan", async () => {
    const tap = tier2Tap([installRoute()]);
    const timers = sleepSpy();

    const outcome = await runManualScan(
      { baseUrl: DEFAULT_API_BASE_URL, fetchImpl: tap.fetchImpl, sleep: timers.sleep, now: () => NOW },
      "chrome://extensions",
    );

    expect(outcome.kind).toBe("unavailable");
    expect(tap.requests.filter(isScanPost)).toHaveLength(0);
    expect(isScannableUrl("chrome://extensions")).toBe(false);
    expect(isScannableUrl("https://user:pass@example.com/")).toBe(false);
    expect(isScannableUrl(TARGET)).toBe(true);
  });

  it("verdict done kèm cơ sở chưa hiệu chuẩn phải hiện đúng như vậy, không nâng lên thành kết luận cứng", async () => {
    const tap = pollingTap(0);
    const timers = sleepSpy();

    const outcome = await runManualScan(
      { baseUrl: DEFAULT_API_BASE_URL, fetchImpl: tap.fetchImpl, sleep: timers.sleep, now: () => NOW },
      TARGET,
    );

    const view = panelView({ kind: "result", url: TARGET, outcome });
    expect(view.headline).toBe("Model nói: lừa đảo");
    expect(view.detail).toContain("chưa hiệu chuẩn");
    expect(view.detail).toContain("gpt-5-mini");
    expect(view.scanEnabled).toBe(true);
  });
});
