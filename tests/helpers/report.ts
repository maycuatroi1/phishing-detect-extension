import { REPORT_PATH, TURNSTILE_HEADER, type TurnstileGate } from "../../src/lib/report.ts";
import { pathOf, type WireRequest } from "./wire.ts";
import type { Tier2Route } from "./tier2.ts";

export const MEASURED_REPORT_ID = "fff8ddc8-fff7-4f04-958a-b9aa8913e38f";

export const MEASURED_FALSE_POSITIVE_REPORT_ID = "d27cc0f6-3c94-450c-877b-ba1dfd30e57e";

export const MEASURED_TURNSTILE_THRESHOLD = 3;

export const MEASURED_TURNSTILE_MESSAGE =
  "After 3 reports inside 3600 seconds an install token must solve a Cloudflare Turnstile challenge and send the result as turnstile_token.";

export const MEASURED_TURNSTILE_FAILED_MESSAGE =
  "The Turnstile token presented did not verify with Cloudflare. Solve a fresh challenge and send the new token.";

export const MEASURED_RATE_LIMITED_MESSAGE =
  "One install token may file 20 reports per 3600 seconds. Wait retry_after seconds and file again.";

const JSON_HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

export function isReportPost(request: WireRequest): boolean {
  return pathOf(request) === REPORT_PATH && request.method === "POST";
}

export function countReportRequests(requests: readonly WireRequest[]): number {
  return requests.filter((request) => pathOf(request) === REPORT_PATH).length;
}

export function reportQueuedResponse(
  overrides: { reportId?: string; gate?: TurnstileGate | null } = {},
): Response {
  const gate = overrides.gate === undefined ? "not-required" : overrides.gate;
  const headers: Record<string, string> = { ...JSON_HEADERS };
  if (gate !== null) {
    headers[TURNSTILE_HEADER] = gate;
  }

  return new Response(
    JSON.stringify({ report_id: overrides.reportId ?? MEASURED_REPORT_ID, status: "queued" }),
    { status: 202, headers },
  );
}

export function turnstileRequiredResponse(): Response {
  return new Response(
    JSON.stringify({
      error: { code: "turnstile_required", message: MEASURED_TURNSTILE_MESSAGE },
    }),
    { status: 403, headers: JSON_HEADERS },
  );
}

export function turnstileFailedResponse(): Response {
  return new Response(
    JSON.stringify({
      error: { code: "turnstile_failed", message: MEASURED_TURNSTILE_FAILED_MESSAGE },
    }),
    { status: 403, headers: JSON_HEADERS },
  );
}

export function turnstileUnavailableResponse(retryAfter = 30): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: "turnstile_failed",
        message: "Cloudflare could not be reached to check the challenge.",
        retry_after: retryAfter,
      },
    }),
    { status: 503, headers: { ...JSON_HEADERS, "retry-after": String(retryAfter) } },
  );
}

export function reportRateLimitedResponse(retryAfter = 1847): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: "rate_limited",
        message: MEASURED_RATE_LIMITED_MESSAGE,
        retry_after: retryAfter,
      },
    }),
    { status: 429, headers: { ...JSON_HEADERS, "retry-after": String(retryAfter) } },
  );
}

export function reportUnauthorizedResponse(code: "missing_token" | "invalid_token"): Response {
  return new Response(
    JSON.stringify({
      error: {
        code,
        message: "/v1/report needs an install token sent as 'Authorization: Bearer <token>'.",
      },
    }),
    { status: 401, headers: JSON_HEADERS },
  );
}

export function reportRoute(answer: (request: WireRequest) => Response): Tier2Route {
  return (request) => (isReportPost(request) ? answer(request) : null);
}

export function reportSequence(makers: readonly (() => Response)[]): Tier2Route {
  let index = 0;
  return (request) => {
    if (!isReportPost(request)) {
      return null;
    }
    const maker = makers[Math.min(index, makers.length - 1)];
    index += 1;
    return maker();
  };
}
