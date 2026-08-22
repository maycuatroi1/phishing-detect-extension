import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_API_BASE_URL } from "../../src/config.ts";
import { clearDispute, readDispute, softensWarning } from "../../src/lib/dispute-store.ts";
import { hostOfUrl } from "../../src/lib/host.ts";
import { REPORT_TURNSTILE_FIELD } from "../../src/lib/report.ts";
import { fileReport } from "../../src/lib/tier3.ts";
import {
  clearStoredInstallToken,
  writeStoredInstallToken,
} from "../../src/lib/token-store.ts";
import { pathOf, type WireRequest } from "../helpers/wire.ts";
import {
  FAKE_INSTALL_TOKEN,
  countInstallRequests,
  installRoute,
  tier2Tap,
} from "../helpers/tier2.ts";
import {
  MEASURED_FALSE_POSITIVE_REPORT_ID,
  MEASURED_RATE_LIMITED_MESSAGE,
  MEASURED_REPORT_ID,
  MEASURED_TURNSTILE_MESSAGE,
  countReportRequests,
  isReportPost,
  reportQueuedResponse,
  reportRateLimitedResponse,
  reportRoute,
  reportSequence,
  reportUnauthorizedResponse,
  turnstileRequiredResponse,
  turnstileUnavailableResponse,
} from "../helpers/report.ts";

const REPORTED_URL = "https://vietcombank-otp.example/dang-nhap?tk=nguyenanhbinh";

const HOST = hostOfUrl(REPORTED_URL) ?? "";

const NOW = 1_800_000_000_000;

function deps(fetchImpl: typeof fetch) {
  return { baseUrl: DEFAULT_API_BASE_URL, fetchImpl, now: () => NOW };
}

function bodyOf(requests: readonly WireRequest[]): Record<string, unknown> {
  const post = requests.find(isReportPost);
  if (post === undefined) {
    throw new Error("không có POST /v1/report nào trong lượt này");
  }
  return JSON.parse(post.body) as Record<string, unknown>;
}

beforeEach(async () => {
  await clearStoredInstallToken();
  await clearDispute(HOST);
});

describe("một cú bấm là một report, và server nhận nó vào hàng chờ", () => {
  it("báo lừa đảo đi ra đúng một POST /v1/report mang đúng hai trường", async () => {
    const tap = tier2Tap([installRoute(), reportRoute(() => reportQueuedResponse())]);

    const outcome = await fileReport(deps(tap.fetchImpl), {
      url: REPORTED_URL,
      claim: "phishing",
    });

    expect(outcome).toEqual({
      kind: "queued",
      reportId: MEASURED_REPORT_ID,
      gate: "not-required",
      claim: "phishing",
      softened: false,
      softFlag: null,
    });
    expect(countReportRequests(tap.requests)).toBe(1);
    expect(countInstallRequests(tap.requests)).toBe(1);
    expect(Object.keys(bodyOf(tap.requests))).toEqual(["url", "claim"]);
  });

  it("tier 3 mang Authorization Bearer, và vẫn không mang cookie hay referrer", async () => {
    const tap = tier2Tap([installRoute(), reportRoute(() => reportQueuedResponse())]);

    await fileReport(deps(tap.fetchImpl), { url: REPORTED_URL, claim: "phishing" });

    const post = tap.requests.find(isReportPost);
    expect(post?.headers.authorization).toBe(`Bearer ${FAKE_INSTALL_TOKEN}`);
    expect(post?.headers["content-type"]).toBe("application/json");
    expect(post?.credentials).toBe("omit");
    expect(post?.referrerPolicy).toBe("no-referrer");
    expect(post?.headers.cookie).toBeUndefined();
  });

  it("401 invalid_token thì mint lại đúng một lần rồi gửi lại đúng một lần", async () => {
    await writeStoredInstallToken({
      token: FAKE_INSTALL_TOKEN,
      rotateAfterDays: 90,
      mintedAt: NOW,
    });

    const tap = tier2Tap([
      installRoute(),
      reportSequence([
        () => reportUnauthorizedResponse("invalid_token"),
        () => reportQueuedResponse(),
      ]),
    ]);

    const outcome = await fileReport(deps(tap.fetchImpl), {
      url: REPORTED_URL,
      claim: "phishing",
    });

    expect(outcome.kind).toBe("queued");
    expect(countReportRequests(tap.requests)).toBe(2);
    expect(countInstallRequests(tap.requests)).toBe(1);
  });

  it("URL không phải http hay https thì không một byte nào đi ra", async () => {
    const tap = tier2Tap([installRoute(), reportRoute(() => reportQueuedResponse())]);

    const outcome = await fileReport(deps(tap.fetchImpl), {
      url: "chrome://extensions",
      claim: "phishing",
    });

    expect(outcome.kind).toBe("unavailable");
    expect(tap.requests).toHaveLength(0);
  });
});

describe("báo nhầm ghi một tranh chấp cục bộ, báo lừa đảo thì không", () => {
  it("false_positive hạ cảnh báo và để lại bản ghi tranh chấp đúng host", async () => {
    const tap = tier2Tap([
      installRoute(),
      reportRoute(() => reportQueuedResponse({ reportId: MEASURED_FALSE_POSITIVE_REPORT_ID })),
    ]);

    const outcome = await fileReport(deps(tap.fetchImpl), {
      url: REPORTED_URL,
      claim: "false_positive",
    });

    expect(outcome).toEqual({
      kind: "queued",
      reportId: MEASURED_FALSE_POSITIVE_REPORT_ID,
      gate: "not-required",
      claim: "false_positive",
      softened: true,
      softFlag: null,
    });

    const dispute = await readDispute(HOST);
    expect(dispute).toEqual({
      host: HOST,
      claim: "false_positive",
      reportId: MEASURED_FALSE_POSITIVE_REPORT_ID,
      filedAt: NOW,
    });
    expect(softensWarning(dispute)).toBe(true);
  });

  it("phishing được ghi lại nhưng không bao giờ hạ hay nâng cảnh báo", async () => {
    const tap = tier2Tap([installRoute(), reportRoute(() => reportQueuedResponse())]);

    const outcome = await fileReport(deps(tap.fetchImpl), {
      url: REPORTED_URL,
      claim: "phishing",
    });

    expect(outcome.kind === "queued" && outcome.softened).toBe(false);

    const dispute = await readDispute(HOST);
    expect(dispute?.claim).toBe("phishing");
    expect(softensWarning(dispute)).toBe(false);
  });

  it("report bị từ chối thì không tranh chấp nào được ghi", async () => {
    const tap = tier2Tap([installRoute(), reportRoute(() => turnstileRequiredResponse())]);

    const outcome = await fileReport(deps(tap.fetchImpl), {
      url: REPORTED_URL,
      claim: "false_positive",
    });

    expect(outcome).toEqual({ kind: "turnstile_required", message: MEASURED_TURNSTILE_MESSAGE });
    expect(await readDispute(HOST)).toBeNull();
  });
});

describe("cổng Turnstile và giới hạn tần suất nổi lên nguyên văn", () => {
  it("403 turnstile_required giữ nguyên câu chữ mà production trả về", async () => {
    const tap = tier2Tap([installRoute(), reportRoute(() => turnstileRequiredResponse())]);

    const outcome = await fileReport(deps(tap.fetchImpl), {
      url: REPORTED_URL,
      claim: "phishing",
    });

    expect(outcome.kind).toBe("turnstile_required");
    expect(outcome.kind === "turnstile_required" && outcome.message).toBe(MEASURED_TURNSTILE_MESSAGE);
  });

  it("turnstile_token đi kèm đúng khi được đưa vào, và vắng mặt khi không", async () => {
    const withToken = tier2Tap([installRoute(), reportRoute(() => reportQueuedResponse())]);
    await fileReport(deps(withToken.fetchImpl), {
      url: REPORTED_URL,
      claim: "phishing",
      turnstileToken: "0.giai-xong-tu-mot-trang-web-that",
    });
    expect(bodyOf(withToken.requests)[REPORT_TURNSTILE_FIELD]).toBe(
      "0.giai-xong-tu-mot-trang-web-that",
    );

    const without = tier2Tap([installRoute(), reportRoute(() => reportQueuedResponse())]);
    await fileReport(deps(without.fetchImpl), { url: REPORTED_URL, claim: "phishing" });
    expect(Object.keys(bodyOf(without.requests))).not.toContain(REPORT_TURNSTILE_FIELD);
  });

  it("429 của report chỉ mang số giây chờ, không có trường thời điểm mở lại nào", async () => {
    const tap = tier2Tap([installRoute(), reportRoute(() => reportRateLimitedResponse(1847))]);

    const outcome = await fileReport(deps(tap.fetchImpl), {
      url: REPORTED_URL,
      claim: "false_positive",
    });

    expect(outcome).toEqual({
      kind: "rate_limited",
      message: MEASURED_RATE_LIMITED_MESSAGE,
      retryAfterSeconds: 1847,
    });
    expect(Object.keys(outcome)).toEqual(["kind", "message", "retryAfterSeconds"]);
    expect(await readDispute(HOST)).toBeNull();
  });

  it("503 nghĩa là Cloudflare không tới được, report chưa vào hàng chờ", async () => {
    const tap = tier2Tap([installRoute(), reportRoute(() => turnstileUnavailableResponse(30))]);

    const outcome = await fileReport(deps(tap.fetchImpl), {
      url: REPORTED_URL,
      claim: "phishing",
    });

    expect(outcome.kind).toBe("turnstile_unavailable");
    expect(outcome.kind === "turnstile_unavailable" && outcome.retryAfterSeconds).toBe(30);
    expect(await readDispute(HOST)).toBeNull();
  });

  it("mọi request tier 3 chỉ chạm hai path, /v1/install và /v1/report", async () => {
    const tap = tier2Tap([installRoute(), reportRoute(() => reportQueuedResponse())]);

    await fileReport(deps(tap.fetchImpl), { url: REPORTED_URL, claim: "false_positive" });

    expect(tap.requests.map(pathOf).sort()).toEqual(["/v1/install", "/v1/report"]);
  });
});
