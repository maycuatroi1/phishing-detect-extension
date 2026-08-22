import {
  parseApiError,
  retryAfterHeaderSeconds,
  unavailableReason,
  type ApiError,
} from "./api-error.ts";
import type { ReportClaim } from "./claim.ts";
import { JSON_MEDIA_TYPE } from "./install.ts";
import { bearerHeaderValue, isScannableUrl } from "./scan.ts";

export const REPORT_PATH = "/v1/report";

export const REPORT_URL_FIELD = "url";

export const REPORT_CLAIM_FIELD = "claim";

export const REPORT_COMMENT_FIELD = "comment";

export const REPORT_HTML_FIELD = "html";

export const REPORT_TURNSTILE_FIELD = "turnstile_token";

export const REPORT_SOFT_FLAG_FIELD = "soft_flag";

export const REPORT_SOFT_FLAGS = ["withdrawn", "unchanged"] as const;

export const REPORT_REQUIRED_FIELDS: readonly string[] = [REPORT_URL_FIELD, REPORT_CLAIM_FIELD];

export const REPORT_REQUEST_FIELDS: readonly string[] = [
  REPORT_URL_FIELD,
  REPORT_CLAIM_FIELD,
  REPORT_COMMENT_FIELD,
  REPORT_HTML_FIELD,
  REPORT_TURNSTILE_FIELD,
];

export const REPORT_URL_MAX_LENGTH = 2048;

export const REPORT_COMMENT_MAX_LENGTH = 2000;

export const TURNSTILE_HEADER = "x-turnstile";

export const TURNSTILE_GATES = ["not-required", "verified", "not-configured"] as const;

export type TurnstileGate = (typeof TURNSTILE_GATES)[number];

export type ReportSoftFlag = (typeof REPORT_SOFT_FLAGS)[number];

export interface ReportInput {
  readonly url: string;
  readonly claim: ReportClaim;
  readonly comment?: string | null;
  readonly turnstileToken?: string | null;
}

export interface ReportQueued {
  readonly reportId: string;
  readonly gate: TurnstileGate | null;
  readonly softFlag: ReportSoftFlag | null;
}

export type SubmitReportOutcome =
  | { readonly kind: "queued"; readonly queued: ReportQueued }
  | { readonly kind: "turnstile_required"; readonly error: ApiError }
  | { readonly kind: "turnstile_failed"; readonly error: ApiError }
  | { readonly kind: "turnstile_unavailable"; readonly error: ApiError }
  | { readonly kind: "rate_limited"; readonly error: ApiError }
  | { readonly kind: "refused"; readonly error: ApiError }
  | { readonly kind: "unavailable"; readonly reason: string };

export interface ReportDeps {
  readonly baseUrl: string;
  readonly token: string;
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
}

export function isReportableUrl(url: string): boolean {
  return url.length <= REPORT_URL_MAX_LENGTH && isScannableUrl(url);
}

export function isReportableComment(comment: string): boolean {
  return comment.length <= REPORT_COMMENT_MAX_LENGTH && !comment.includes("\u0000");
}

export function reportRequestBody(input: ReportInput): string {
  const body: Record<string, string> = {
    [REPORT_URL_FIELD]: input.url,
    [REPORT_CLAIM_FIELD]: input.claim,
  };

  const comment = input.comment;
  if (typeof comment === "string" && comment.length > 0) {
    body[REPORT_COMMENT_FIELD] = comment;
  }

  const turnstileToken = input.turnstileToken;
  if (typeof turnstileToken === "string" && turnstileToken.length > 0) {
    body[REPORT_TURNSTILE_FIELD] = turnstileToken;
  }

  return JSON.stringify(body);
}

export function isTurnstileGate(value: unknown): value is TurnstileGate {
  return typeof value === "string" && (TURNSTILE_GATES as readonly string[]).includes(value);
}

export function gateOfResponse(response: Response): TurnstileGate | null {
  const raw = response.headers.get(TURNSTILE_HEADER);
  return isTurnstileGate(raw) ? raw : null;
}

export function isReportSoftFlag(value: unknown): value is ReportSoftFlag {
  return typeof value === "string" && (REPORT_SOFT_FLAGS as readonly string[]).includes(value);
}

export function parseReportQueued(body: unknown, gate: TurnstileGate | null): ReportQueued | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const record = body as Record<string, unknown>;
  if (typeof record.report_id !== "string" || record.report_id.length === 0) {
    return null;
  }
  if (record.status !== "queued") {
    return null;
  }
  const softFlag = record[REPORT_SOFT_FLAG_FIELD];
  return {
    reportId: record.report_id,
    gate,
    softFlag: isReportSoftFlag(softFlag) ? softFlag : null,
  };
}

function withRetryAfter(error: ApiError, response: Response): ApiError {
  return {
    ...error,
    retryAfterSeconds: error.retryAfterSeconds ?? retryAfterHeaderSeconds(response),
  };
}

export async function submitReport(
  deps: ReportDeps,
  input: ReportInput,
): Promise<SubmitReportOutcome> {
  if (!isReportableUrl(input.url)) {
    return { kind: "unavailable", reason: "URL của tab hiện tại không phải http hoặc https báo được" };
  }
  if (typeof input.comment === "string" && !isReportableComment(input.comment)) {
    return { kind: "unavailable", reason: "ghi chú kèm report vượt giới hạn của server hoặc chứa ký tự NUL" };
  }

  const fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const endpoint = new URL(REPORT_PATH, deps.baseUrl).toString();

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      cache: "no-store",
      credentials: "omit",
      redirect: "follow",
      referrerPolicy: "no-referrer",
      headers: {
        "content-type": JSON_MEDIA_TYPE,
        authorization: bearerHeaderValue(deps.token),
      },
      body: reportRequestBody(input),
      signal: deps.signal,
    });
  } catch (cause) {
    return { kind: "unavailable", reason: `fetch POST /v1/report thất bại: ${String(cause)}` };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    return {
      kind: "unavailable",
      reason: `POST /v1/report trả body không phải JSON: ${String(cause)}`,
    };
  }

  if (!response.ok) {
    const error = parseApiError(body);
    if (error === null) {
      return { kind: "unavailable", reason: unavailableReason(response.status) };
    }
    if (response.status === 403 && error.code === "turnstile_required") {
      return { kind: "turnstile_required", error };
    }
    if (response.status === 403 && error.code === "turnstile_failed") {
      return { kind: "turnstile_failed", error };
    }
    if (response.status === 503) {
      return { kind: "turnstile_unavailable", error: withRetryAfter(error, response) };
    }
    if (response.status === 429) {
      return { kind: "rate_limited", error: withRetryAfter(error, response) };
    }
    return { kind: "refused", error };
  }

  const queued = parseReportQueued(body, gateOfResponse(response));
  if (queued === null) {
    return { kind: "unavailable", reason: "POST /v1/report trả body không đúng hình ReportQueued" };
  }
  return { kind: "queued", queued };
}
