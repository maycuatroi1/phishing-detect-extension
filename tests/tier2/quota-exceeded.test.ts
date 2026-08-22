import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_API_BASE_URL } from "../../src/config.ts";
import { clearStoredInstallToken } from "../../src/lib/token-store.ts";
import { runManualScan, type ManualScanOutcome } from "../../src/lib/tier2.ts";
import { panelView } from "../../src/popup/scan-panel.ts";
import { pathOf, type WireTap } from "../helpers/wire.ts";
import {
  MEASURED_RESET_AT,
  MEASURED_RETRY_AFTER,
  countScanRequests,
  installRoute,
  isScanPost,
  quotaExceededResponse,
  sleepSpy,
  tier2Tap,
} from "../helpers/tier2.ts";

const TARGET = "https://vietcombank-otp.example/dang-nhap";

async function settle(): Promise<void> {
  for (let round = 0; round < 8; round += 1) {
    await new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, 0);
    });
  }
}

async function drive(
  response: () => Response,
): Promise<{ outcome: ManualScanOutcome; tap: WireTap; delays: number[] }> {
  const tap = tier2Tap([installRoute(), (request) => (isScanPost(request) ? response() : null)]);
  const timers = sleepSpy();

  const outcome = await runManualScan(
    {
      baseUrl: DEFAULT_API_BASE_URL,
      fetchImpl: tap.fetchImpl,
      sleep: timers.sleep,
      now: () => 1_800_000_000_000,
    },
    TARGET,
  );

  await settle();
  return { outcome, tap, delays: timers.delays };
}

beforeEach(async () => {
  await clearStoredInstallToken();
});

describe("hết quota thì hiện thời điểm reset và dừng hẳn", () => {
  it("đọc reset_at từ thân 429, đúng hình mà production trả", async () => {
    const { outcome } = await drive(() => quotaExceededResponse());

    expect(outcome.kind).toBe("quota_exceeded");
    if (outcome.kind !== "quota_exceeded") {
      throw new Error("outcome sai nhánh");
    }
    expect(outcome.resetAt).toBe(MEASURED_RESET_AT);
    expect(outcome.retryAfterSeconds).toBe(MEASURED_RETRY_AFTER);
  });

  it("UI hiện thời điểm reset nguyên văn của server, không tự dựng thời điểm nào", async () => {
    const { outcome } = await drive(() => quotaExceededResponse());
    const view = panelView({ kind: "result", url: TARGET, outcome });

    expect(view.headline).toBe("Hết lượt quét");
    expect(view.resetAt).toBe(MEASURED_RESET_AT);
    expect(view.detail).toContain(MEASURED_RESET_AT);
    expect(view.detail).toContain("Extension không tự thử lại");
    expect(view.scanEnabled).toBe(false);
  });

  it("sau 429 số request phát thêm đúng bằng 0", async () => {
    const { tap, delays } = await drive(() => quotaExceededResponse());

    const scanRequests = tap.requests.filter(isScanPost);
    expect(scanRequests).toHaveLength(1);

    const indexOf429 = tap.requests.findIndex(isScanPost);
    expect(tap.requests.slice(indexOf429 + 1)).toEqual([]);
    expect(countScanRequests(tap.requests)).toBe(1);
    expect(delays, "một backoff nào đó đã được hẹn giờ sau 429").toEqual([]);
  });

  it("gọi lại tay lần nữa cũng chỉ đúng một request nữa, không nhân lên", async () => {
    const tap = tier2Tap([
      installRoute(),
      (request) => (isScanPost(request) ? quotaExceededResponse() : null),
    ]);
    const timers = sleepSpy();
    const deps = {
      baseUrl: DEFAULT_API_BASE_URL,
      fetchImpl: tap.fetchImpl,
      sleep: timers.sleep,
      now: () => 1_800_000_000_000,
    };

    await runManualScan(deps, TARGET);
    await runManualScan(deps, TARGET);
    await settle();

    expect(countScanRequests(tap.requests)).toBe(2);
    expect(tap.requests.filter((request) => pathOf(request) === "/v1/install")).toHaveLength(1);
    expect(timers.delays).toEqual([]);
  });

  it("429 không kèm reset_at thì UI nói thẳng là server không cho biết, không bịa thời điểm", async () => {
    const { outcome, delays } = await drive(() => quotaExceededResponse({ resetAt: null }));

    expect(outcome.kind).toBe("quota_exceeded");
    if (outcome.kind !== "quota_exceeded") {
      throw new Error("outcome sai nhánh");
    }
    expect(outcome.resetAt).toBeNull();

    const view = panelView({ kind: "result", url: TARGET, outcome });
    expect(view.resetAt).toBeNull();
    expect(view.detail).toContain("Server không trả thời điểm mở lại");
    expect(view.detail).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(view.scanEnabled).toBe(false);
    expect(delays).toEqual([]);
  });

  it("429 không có retry_after trong thân vẫn đọc được từ header Retry-After", async () => {
    const { outcome } = await drive(
      () =>
        new Response(
          JSON.stringify({
            error: { code: "quota_exceeded", message: "hết lượt", reset_at: MEASURED_RESET_AT },
          }),
          {
            status: 429,
            headers: { "content-type": "application/json", "retry-after": String(MEASURED_RETRY_AFTER) },
          },
        ),
    );

    if (outcome.kind !== "quota_exceeded") {
      throw new Error("outcome sai nhánh");
    }
    expect(outcome.retryAfterSeconds).toBe(MEASURED_RETRY_AFTER);
    expect(outcome.resetAt).toBe(MEASURED_RESET_AT);
  });
});
