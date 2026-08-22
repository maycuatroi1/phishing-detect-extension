export const API_ERROR_CODES = [
  "unsupported_media_type",
  "body_too_large",
  "invalid_json",
  "invalid_body",
  "unknown_field",
  "invalid_url",
  "invalid_claim",
  "invalid_comment",
  "invalid_html",
  "missing_token",
  "invalid_token",
  "rate_limited",
  "quota_exceeded",
  "turnstile_required",
  "turnstile_failed",
  "not_found",
  "internal_error",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export const RETRY_AFTER_HEADER = "retry-after";

export interface ApiError {
  readonly code: ApiErrorCode;
  readonly message: string;
  readonly retryAfterSeconds: number | null;
  readonly resetAt: string | null;
}

export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === "string" && (API_ERROR_CODES as readonly string[]).includes(value);
}

export function parseApiError(body: unknown): ApiError | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const error = (body as Record<string, unknown>).error;
  if (typeof error !== "object" || error === null) {
    return null;
  }

  const record = error as Record<string, unknown>;
  if (!isApiErrorCode(record.code)) {
    return null;
  }

  const retryAfter = record.retry_after;
  const resetAt = record.reset_at;

  return {
    code: record.code,
    message: typeof record.message === "string" ? record.message : "",
    retryAfterSeconds:
      typeof retryAfter === "number" && Number.isFinite(retryAfter) ? retryAfter : null,
    resetAt: typeof resetAt === "string" && resetAt.length > 0 ? resetAt : null,
  };
}

export function retryAfterHeaderSeconds(response: Response): number | null {
  const raw = response.headers.get(RETRY_AFTER_HEADER);
  if (raw === null || !/^[0-9]+$/.test(raw.trim())) {
    return null;
  }
  return Number.parseInt(raw.trim(), 10);
}

export function unavailableReason(status: number): string {
  return `HTTP ${status} không mang error envelope nào đọc được`;
}
