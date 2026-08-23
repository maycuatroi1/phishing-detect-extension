import { INSTALL_PATH } from "../../src/lib/install.ts";
import { SCAN_PATH, type VerdictEnvelope } from "../../src/lib/scan.ts";
import { echoEmptyBuckets, pathOf, tapFetch, type WireRequest, type WireTap } from "./wire.ts";
import { LOOKUP_PATH } from "../../src/lib/lookup.ts";

export const FAKE_INSTALL_TOKEN = "aft1_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG";

export const FAKE_ROTATED_TOKEN = "aft1_0123456789abcdefghijklmnopqrstuvwxyzABCDEFH";

export const FAKE_SCAN_ID = "4f6d1c2e-9a3b-4c5d-8e7f-0a1b2c3d4e5f";

export const FAKE_SITE_ID = "6b1e0d2a-3c4f-4a5b-9c8d-7e6f5a4b3c2d";

export const MEASURED_QUOTA_MESSAGE =
  "One install token may request 20 scans per 86400 seconds. The quota frees up as the oldest scan in the window ages out; reset_at is the instant that happens.";

export const MEASURED_RESET_AT = "2026-08-23T16:11:10.783Z";

export const MEASURED_RETRY_AFTER = 86395;

const JSON_HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

export function installResponse(token = FAKE_INSTALL_TOKEN, rotateAfterDays = 90): Response {
  return new Response(JSON.stringify({ install_token: token, rotate_after_days: rotateAfterDays }), {
    status: 201,
    headers: JSON_HEADERS,
  });
}

export function queuedResponse(
  overrides: { scanId?: string; pollAfterSeconds?: number; quotaRemaining?: number } = {},
): Response {
  return new Response(
    JSON.stringify({
      scan_id: overrides.scanId ?? FAKE_SCAN_ID,
      status: "queued",
      poll_after_seconds: overrides.pollAfterSeconds ?? 2,
      quota_remaining: overrides.quotaRemaining ?? 19,
    }),
    { status: 202, headers: JSON_HEADERS },
  );
}

export function verdictEnvelope(overrides: Partial<VerdictEnvelope> = {}): VerdictEnvelope {
  return {
    scan_id: FAKE_SCAN_ID,
    status: "done",
    is_scam: true,
    confidence: 0.5,
    confidence_basis: "uncalibrated_single_vote",
    source: "llm",
    site_id: FAKE_SITE_ID,
    evidence_id: "91a2b3c4-d5e6-4f70-8192-a3b4c5d6e7f8",
    model: "gpt-5-mini",
    prompt_version: "detection_prompt.v2+sha256:16dff025e971",
    requested_at: "2026-08-22T16:11:10.783Z",
    checked_at: "2026-08-22T16:11:14.224Z",
    parse_ok: true,
    parse_failure_reason: null,
    failure: null,
    reason: null,
    ...overrides,
  };
}

export function queuedEnvelope(): VerdictEnvelope {
  return verdictEnvelope({
    status: "queued",
    is_scam: null,
    confidence: null,
    confidence_basis: null,
    evidence_id: null,
    checked_at: null,
    parse_ok: null,
  });
}

export function verdictResponse(envelope: VerdictEnvelope): Response {
  return new Response(JSON.stringify(envelope), { status: 200, headers: JSON_HEADERS });
}

export function quotaExceededResponse(
  overrides: { resetAt?: string | null; retryAfter?: number | null } = {},
): Response {
  const resetAt = overrides.resetAt === undefined ? MEASURED_RESET_AT : overrides.resetAt;
  const retryAfter = overrides.retryAfter === undefined ? MEASURED_RETRY_AFTER : overrides.retryAfter;

  const error: Record<string, unknown> = { code: "quota_exceeded", message: MEASURED_QUOTA_MESSAGE };
  if (retryAfter !== null) {
    error.retry_after = retryAfter;
  }
  if (resetAt !== null) {
    error.reset_at = resetAt;
  }

  const headers: Record<string, string> = { ...JSON_HEADERS };
  if (retryAfter !== null) {
    headers["retry-after"] = String(retryAfter);
  }

  return new Response(JSON.stringify({ error }), { status: 429, headers });
}

export function unauthorizedResponse(code: "missing_token" | "invalid_token"): Response {
  return new Response(
    JSON.stringify({
      error: {
        code,
        message: "/v1/scan needs an install token sent as 'Authorization: Bearer <token>'.",
      },
    }),
    { status: 401, headers: JSON_HEADERS },
  );
}

export interface SleepSpy {
  readonly sleep: (ms: number) => Promise<void>;
  readonly delays: number[];
}

export function sleepSpy(): SleepSpy {
  const delays: number[] = [];
  return {
    delays,
    sleep: (ms: number) => {
      delays.push(ms);
      return Promise.resolve();
    },
  };
}

export type Tier2Route = (request: WireRequest) => Response | Promise<Response> | null;

export function tier2Tap(routes: readonly Tier2Route[]): WireTap {
  return tapFetch((request) => {
    for (const route of routes) {
      const answer = route(request);
      if (answer !== null) {
        return answer;
      }
    }
    throw new Error(`không có route nào cho ${request.method} ${pathOf(request)}`);
  });
}

export function lookupRoute(request: WireRequest): Response | null {
  return pathOf(request) === LOOKUP_PATH ? echoEmptyBuckets(request) : null;
}

export function installRoute(token = FAKE_INSTALL_TOKEN): Tier2Route {
  return (request) =>
    pathOf(request) === INSTALL_PATH && request.method === "POST" ? installResponse(token) : null;
}

export function isScanPost(request: WireRequest): boolean {
  return pathOf(request) === SCAN_PATH && request.method === "POST";
}

export function isVerdictGet(request: WireRequest): boolean {
  return pathOf(request).startsWith(`${SCAN_PATH}/`) && request.method === "GET";
}

export function countScanRequests(requests: readonly WireRequest[]): number {
  return requests.filter((request) => pathOf(request).startsWith(SCAN_PATH)).length;
}

export function countInstallRequests(requests: readonly WireRequest[]): number {
  return requests.filter((request) => pathOf(request) === INSTALL_PATH).length;
}
