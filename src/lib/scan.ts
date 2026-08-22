import {
  parseApiError,
  retryAfterHeaderSeconds,
  unavailableReason,
  type ApiError,
} from "./api-error.ts";
import { JSON_MEDIA_TYPE } from "./install.ts";

export const SCAN_PATH = "/v1/scan";

export const SCAN_URL_FIELD = "url";

export const SCAN_REQUEST_FIELDS: readonly string[] = [SCAN_URL_FIELD];

export const SCAN_URL_MAX_LENGTH = 2048;

export const AUTHORIZATION_HEADER = "authorization";

export const BEARER_SCHEME = "Bearer";

export const SCAN_STATUSES = ["queued", "running", "done", "failed"] as const;

export type ScanStatus = (typeof SCAN_STATUSES)[number];

export const TERMINAL_SCAN_STATUSES: readonly ScanStatus[] = ["done", "failed"];

export const VERDICT_SOURCES = ["local", "lookup", "llm", "human"] as const;

export type VerdictSource = (typeof VERDICT_SOURCES)[number];

export const CONFIDENCE_BASES = [
  "uncalibrated_single_vote",
  "corpus_label",
  "moderator_decision",
] as const;

export type ConfidenceBasis = (typeof CONFIDENCE_BASES)[number];

export const PARSE_FAILURE_REASONS = [
  "no_json",
  "truncated",
  "refused_missing_html",
  "api_error",
] as const;

export type ParseFailureReason = (typeof PARSE_FAILURE_REASONS)[number];

export const VERDICT_ENVELOPE_FIELDS: readonly string[] = [
  "scan_id",
  "status",
  "is_scam",
  "confidence",
  "confidence_basis",
  "source",
  "site_id",
  "evidence_id",
  "model",
  "prompt_version",
  "requested_at",
  "checked_at",
  "parse_ok",
  "parse_failure_reason",
  "failure",
];

export interface VerdictEnvelope {
  readonly scan_id: string;
  readonly status: ScanStatus;
  readonly is_scam: boolean | null;
  readonly confidence: number | null;
  readonly confidence_basis: ConfidenceBasis | null;
  readonly source: VerdictSource;
  readonly site_id: string;
  readonly evidence_id: string | null;
  readonly model: string;
  readonly prompt_version: string;
  readonly requested_at: string;
  readonly checked_at: string | null;
  readonly parse_ok: boolean | null;
  readonly parse_failure_reason: ParseFailureReason | null;
  readonly failure: string | null;
}

export interface ScanQueued {
  readonly scanId: string;
  readonly pollAfterSeconds: number;
  readonly quotaRemaining: number;
}

export type StartScanOutcome =
  | { readonly kind: "queued"; readonly queued: ScanQueued }
  | { readonly kind: "quota_exceeded"; readonly error: ApiError }
  | { readonly kind: "refused"; readonly error: ApiError }
  | { readonly kind: "unavailable"; readonly reason: string };

export type VerdictOutcome =
  | { readonly kind: "verdict"; readonly envelope: VerdictEnvelope }
  | { readonly kind: "refused"; readonly error: ApiError }
  | { readonly kind: "unavailable"; readonly reason: string };

export interface ScanDeps {
  readonly baseUrl: string;
  readonly token: string;
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
}

export function scanRequestBody(url: string): string {
  return JSON.stringify({ [SCAN_URL_FIELD]: url });
}

export function verdictPath(scanId: string): string {
  return `${SCAN_PATH}/${encodeURIComponent(scanId)}`;
}

export function bearerHeaderValue(token: string): string {
  return `${BEARER_SCHEME} ${token}`;
}

export function isScannableUrl(url: string): boolean {
  if (url.length === 0 || url.length > SCAN_URL_MAX_LENGTH) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }
  if (parsed.hostname.length === 0) {
    return false;
  }
  return parsed.username.length === 0 && parsed.password.length === 0;
}

export function parseScanQueued(body: unknown): ScanQueued | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const record = body as Record<string, unknown>;
  if (typeof record.scan_id !== "string" || record.scan_id.length === 0) {
    return null;
  }
  if (record.status !== "queued") {
    return null;
  }
  const poll = record.poll_after_seconds;
  const quota = record.quota_remaining;
  if (typeof poll !== "number" || !Number.isInteger(poll) || poll < 0) {
    return null;
  }
  if (typeof quota !== "number" || !Number.isInteger(quota) || quota < 0) {
    return null;
  }
  return { scanId: record.scan_id, pollAfterSeconds: poll, quotaRemaining: quota };
}

function isNullableMember<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T | null {
  return value === null || (typeof value === "string" && (allowed as readonly string[]).includes(value));
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableBoolean(value: unknown): value is boolean | null {
  return value === null || typeof value === "boolean";
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

export function parseVerdictEnvelope(body: unknown): VerdictEnvelope | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const record = body as Record<string, unknown>;

  for (const field of VERDICT_ENVELOPE_FIELDS) {
    if (!(field in record)) {
      return null;
    }
  }

  if (typeof record.scan_id !== "string" || record.scan_id.length === 0) {
    return null;
  }
  if (typeof record.status !== "string" || !(SCAN_STATUSES as readonly string[]).includes(record.status)) {
    return null;
  }
  if (typeof record.source !== "string" || !(VERDICT_SOURCES as readonly string[]).includes(record.source)) {
    return null;
  }
  if (typeof record.site_id !== "string" || typeof record.model !== "string") {
    return null;
  }
  if (typeof record.prompt_version !== "string" || typeof record.requested_at !== "string") {
    return null;
  }
  if (!isNullableBoolean(record.is_scam) || !isNullableNumber(record.confidence)) {
    return null;
  }
  if (!isNullableMember(record.confidence_basis, CONFIDENCE_BASES)) {
    return null;
  }
  if (!isNullableString(record.evidence_id) || !isNullableString(record.checked_at)) {
    return null;
  }
  if (!isNullableBoolean(record.parse_ok) || !isNullableString(record.failure)) {
    return null;
  }
  if (!isNullableMember(record.parse_failure_reason, PARSE_FAILURE_REASONS)) {
    return null;
  }

  return {
    scan_id: record.scan_id,
    status: record.status as ScanStatus,
    is_scam: record.is_scam,
    confidence: record.confidence,
    confidence_basis: record.confidence_basis,
    source: record.source as VerdictSource,
    site_id: record.site_id,
    evidence_id: record.evidence_id,
    model: record.model,
    prompt_version: record.prompt_version,
    requested_at: record.requested_at,
    checked_at: record.checked_at,
    parse_ok: record.parse_ok,
    parse_failure_reason: record.parse_failure_reason,
    failure: record.failure,
  };
}

export function hasVerdict(envelope: VerdictEnvelope): boolean {
  return envelope.status === "done" && envelope.parse_ok === true && envelope.is_scam !== null;
}

export function isTerminal(envelope: VerdictEnvelope): boolean {
  return TERMINAL_SCAN_STATUSES.includes(envelope.status);
}

export async function startScan(deps: ScanDeps, url: string): Promise<StartScanOutcome> {
  if (!isScannableUrl(url)) {
    return { kind: "unavailable", reason: "URL của tab hiện tại không phải http/https quét được" };
  }

  const fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const endpoint = new URL(SCAN_PATH, deps.baseUrl).toString();

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
      body: scanRequestBody(url),
      signal: deps.signal,
    });
  } catch (cause) {
    return { kind: "unavailable", reason: `fetch POST /v1/scan thất bại: ${String(cause)}` };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    return { kind: "unavailable", reason: `POST /v1/scan trả body không phải JSON: ${String(cause)}` };
  }

  if (!response.ok) {
    const error = parseApiError(body);
    if (error === null) {
      return { kind: "unavailable", reason: unavailableReason(response.status) };
    }
    if (response.status === 429 || error.code === "quota_exceeded") {
      const headerSeconds = retryAfterHeaderSeconds(response);
      return {
        kind: "quota_exceeded",
        error: {
          ...error,
          retryAfterSeconds: error.retryAfterSeconds ?? headerSeconds,
        },
      };
    }
    return { kind: "refused", error };
  }

  const queued = parseScanQueued(body);
  if (queued === null) {
    return { kind: "unavailable", reason: "POST /v1/scan trả body không đúng hình ScanQueued" };
  }
  return { kind: "queued", queued };
}

export async function fetchVerdict(deps: ScanDeps, scanId: string): Promise<VerdictOutcome> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const endpoint = new URL(verdictPath(scanId), deps.baseUrl).toString();

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      redirect: "follow",
      referrerPolicy: "no-referrer",
      headers: { authorization: bearerHeaderValue(deps.token) },
      signal: deps.signal,
    });
  } catch (cause) {
    return { kind: "unavailable", reason: `fetch GET /v1/scan/{id} thất bại: ${String(cause)}` };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    return {
      kind: "unavailable",
      reason: `GET /v1/scan/{id} trả body không phải JSON: ${String(cause)}`,
    };
  }

  if (!response.ok) {
    const error = parseApiError(body);
    if (error === null) {
      return { kind: "unavailable", reason: unavailableReason(response.status) };
    }
    return { kind: "refused", error };
  }

  const envelope = parseVerdictEnvelope(body);
  if (envelope === null) {
    return { kind: "unavailable", reason: "GET /v1/scan/{id} trả body không đúng hình VerdictEnvelope" };
  }
  return { kind: "verdict", envelope };
}
