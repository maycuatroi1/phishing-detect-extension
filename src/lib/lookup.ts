export const LOOKUP_PATH = "/v1/lookup";

export const LOOKUP_PREFIX_PARAM = "p";

export const LOOKUP_PREFIX_BITS = 20;

export const LOOKUP_PREFIX_HEX_LENGTH = 5;

export const LOOKUP_MAX_PREFIXES_PER_REQUEST = 16;

export const LOOKUP_FULL_HASH_HEX_LENGTH = 64;

const PREFIX_PATTERN = /^[0-9a-f]{5}$/;

const FULL_HASH_PATTERN = /^[0-9a-f]{64}$/;

export type LookupCorpusVerdict = "phishing" | "legit" | "unknown";

export type LookupErrorCode =
  | "missing_prefix"
  | "too_many_prefixes"
  | "invalid_prefix"
  | "internal_error";

export interface LookupEntry {
  readonly h: string;
  readonly v: LookupCorpusVerdict;
  readonly c: number;
}

export type LookupOutcome =
  | { readonly kind: "buckets"; readonly buckets: Map<string, readonly LookupEntry[]> }
  | { readonly kind: "refused"; readonly code: LookupErrorCode; readonly message: string }
  | { readonly kind: "unavailable"; readonly reason: string };

export interface LookupDeps {
  readonly baseUrl: string;
  readonly prefixes: readonly string[];
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
}

export function isLookupPrefix(value: string): boolean {
  return PREFIX_PATTERN.test(value);
}

export function prefixOfHashHex(hashHex: string): string {
  if (!FULL_HASH_PATTERN.test(hashHex)) {
    throw new Error(
      `SHA256(host) phải là ${LOOKUP_FULL_HASH_HEX_LENGTH} ký tự hex thường, nhận được chuỗi dài ${hashHex.length}.`,
    );
  }
  return hashHex.slice(0, LOOKUP_PREFIX_HEX_LENGTH);
}

export function lookupRequestUrl(baseUrl: string, prefixes: readonly string[]): string {
  if (prefixes.length === 0) {
    throw new Error("Một request lookup phải mang ít nhất một prefix.");
  }
  if (prefixes.length > LOOKUP_MAX_PREFIXES_PER_REQUEST) {
    throw new Error(
      `Server nhận tối đa ${LOOKUP_MAX_PREFIXES_PER_REQUEST} prefix một request, lô này có ${prefixes.length}.`,
    );
  }

  const url = new URL(LOOKUP_PATH, baseUrl);
  for (const prefix of prefixes) {
    if (!isLookupPrefix(prefix)) {
      throw new Error(
        `Chỉ ${LOOKUP_PREFIX_HEX_LENGTH} ký tự hex thường được rời khỏi máy. Giá trị dài ${prefix.length} không phải prefix.`,
      );
    }
    url.searchParams.append(LOOKUP_PREFIX_PARAM, prefix);
  }
  return url.toString();
}

function isEntry(value: unknown): value is LookupEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.h === "string" &&
    FULL_HASH_PATTERN.test(candidate.h) &&
    (candidate.v === "phishing" || candidate.v === "legit" || candidate.v === "unknown") &&
    typeof candidate.c === "number"
  );
}

export function parseLookupBuckets(body: unknown): Map<string, readonly LookupEntry[]> | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const buckets = (body as Record<string, unknown>).buckets;
  if (typeof buckets !== "object" || buckets === null) {
    return null;
  }

  const parsed = new Map<string, readonly LookupEntry[]>();
  for (const [key, value] of Object.entries(buckets as Record<string, unknown>)) {
    const normalised = key.toLowerCase();
    if (!isLookupPrefix(normalised) || !Array.isArray(value)) {
      return null;
    }
    const entries: LookupEntry[] = [];
    for (const item of value) {
      if (!isEntry(item)) {
        return null;
      }
      entries.push({ h: item.h.toLowerCase(), v: item.v, c: item.c });
    }
    parsed.set(normalised, entries);
  }
  return parsed;
}

function parseRefusal(body: unknown): { code: LookupErrorCode; message: string } | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const error = (body as Record<string, unknown>).error;
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const code = (error as Record<string, unknown>).code;
  const message = (error as Record<string, unknown>).message;
  if (
    code !== "missing_prefix" &&
    code !== "too_many_prefixes" &&
    code !== "invalid_prefix" &&
    code !== "internal_error"
  ) {
    return null;
  }
  return { code, message: typeof message === "string" ? message : "" };
}

export async function fetchLookup(deps: LookupDeps): Promise<LookupOutcome> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);

  let url: string;
  try {
    url = lookupRequestUrl(deps.baseUrl, deps.prefixes);
  } catch (cause) {
    return { kind: "unavailable", reason: `lô prefix không hợp lệ: ${String(cause)}` };
  }

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      redirect: "follow",
      referrerPolicy: "no-referrer",
      signal: deps.signal,
    });
  } catch (cause) {
    return { kind: "unavailable", reason: `fetch thất bại: ${String(cause)}` };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    return { kind: "unavailable", reason: `body không phải JSON: ${String(cause)}` };
  }

  if (!response.ok) {
    const refusal = parseRefusal(body);
    if (refusal === null) {
      return { kind: "unavailable", reason: `HTTP ${response.status}` };
    }
    return { kind: "refused", code: refusal.code, message: refusal.message };
  }

  const buckets = parseLookupBuckets(body);
  if (buckets === null) {
    return { kind: "unavailable", reason: "body 200 không đúng hình LookupResponse" };
  }
  return { kind: "buckets", buckets };
}

export function matchFullHash(
  entries: readonly LookupEntry[],
  hashHex: string,
): LookupEntry | null {
  if (!FULL_HASH_PATTERN.test(hashHex)) {
    throw new Error(
      `So khớp cần đủ ${LOOKUP_FULL_HASH_HEX_LENGTH} ký tự hex, nhận được chuỗi dài ${hashHex.length}.`,
    );
  }
  for (const entry of entries) {
    if (entry.h === hashHex) {
      return entry;
    }
  }
  return null;
}
