import {
  AFBL_FALLBACK_FORMAT,
  AFBL_PREFERRED_FORMAT,
  afblCarriesSoft,
  decodeAfbl,
  type AfblArtifact,
  type AfblRefusal,
} from "./afbl.ts";
import {
  readStoredBlocklist,
  writeStoredBlocklist,
  type StoredBlocklist,
} from "./blocklist-store.ts";

export const BLOCKLIST_PATH = "/v1/blocklist";

export const BLOCKLIST_FORMAT_PARAM = "format";

export const BLOCKLIST_SINCE_PARAM = "since";

export const BLOCKLIST_REQUEST_FORMATS: readonly number[] = [
  AFBL_PREFERRED_FORMAT,
  AFBL_FALLBACK_FORMAT,
];

export const BLOCKLIST_REFRESH_PERIOD_MINUTES = 1440;

export const HEADER_ETAG = "etag";

export const HEADER_FORMAT = "x-blocklist-format";

export const HEADER_VERSION = "x-blocklist-version";

export const HEADER_PHISH_COUNT = "x-blocklist-phish-count";

export const HEADER_LEGIT_COUNT = "x-blocklist-legit-count";

export const HEADER_SOFT_COUNT = "x-blocklist-soft-count";

export const HEADER_PINNED_URL = "x-blocklist-pinned-url";

export type BlocklistSyncOutcome =
  | {
      readonly kind: "fresh";
      readonly format: number;
      readonly version: number;
      readonly phishCount: number;
      readonly legitCount: number;
      readonly softCount: number;
    }
  | { readonly kind: "unchanged"; readonly version: number }
  | { readonly kind: "refused"; readonly refusal: AfblRefusal; readonly keptVersion: number | null }
  | { readonly kind: "rejected_older"; readonly incomingVersion: number; readonly keptVersion: number }
  | { readonly kind: "unavailable"; readonly reason: string; readonly keptVersion: number | null };

export function acceptsIncomingVersion(
  storedVersion: number | null,
  incomingVersion: number,
): boolean {
  if (storedVersion === null) {
    return true;
  }
  return incomingVersion >= storedVersion;
}

export function acceptsIncomingArtifact(
  stored: StoredBlocklist | null,
  artifact: AfblArtifact,
): boolean {
  if (stored === null || stored.format !== artifact.format) {
    return true;
  }
  return acceptsIncomingVersion(stored.version, artifact.version);
}

export function blocklistAgeMs(record: StoredBlocklist, now: number): number {
  return Math.max(0, now - record.fetchedAt);
}

export function sinceForFormat(stored: StoredBlocklist | null, format: number): number | null {
  return stored !== null && stored.format === format ? stored.version : null;
}

export function blocklistRequestUrl(
  baseUrl: string,
  since: number | null,
  format: number = AFBL_PREFERRED_FORMAT,
): string {
  const url = new URL(BLOCKLIST_PATH, baseUrl);
  url.searchParams.set(BLOCKLIST_FORMAT_PARAM, String(format));
  if (since !== null) {
    url.searchParams.set(BLOCKLIST_SINCE_PARAM, String(since));
  }
  return url.toString();
}

function headerNumber(response: Response, name: string): number | null {
  const raw = response.headers.get(name);
  if (raw === null || !/^[0-9]+$/.test(raw)) {
    return null;
  }
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

export interface SyncDeps {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
}

interface FetchAttempt {
  readonly kind: "response";
  readonly response: Response;
  readonly format: number;
}

type FetchResult =
  | FetchAttempt
  | { readonly kind: "failed"; readonly reason: string };

async function fetchNegotiated(
  fetchImpl: typeof fetch,
  baseUrl: string,
  stored: StoredBlocklist | null,
): Promise<FetchResult> {
  let refusedFormats = "";

  for (let index = 0; index < BLOCKLIST_REQUEST_FORMATS.length; index += 1) {
    const format = BLOCKLIST_REQUEST_FORMATS[index];
    const last = index === BLOCKLIST_REQUEST_FORMATS.length - 1;

    let response: Response;
    try {
      response = await fetchImpl(
        blocklistRequestUrl(baseUrl, sinceForFormat(stored, format), format),
        {
          method: "GET",
          cache: "no-store",
          credentials: "omit",
          redirect: "follow",
        },
      );
    } catch (cause) {
      return { kind: "failed", reason: `fetch thất bại: ${String(cause)}` };
    }

    if (response.status === 400 && !last) {
      refusedFormats = `${refusedFormats}${refusedFormats === "" ? "" : ", "}format ${format}`;
      continue;
    }

    return { kind: "response", response, format };
  }

  return {
    kind: "failed",
    reason: `server từ chối mọi format client biết đọc (${refusedFormats})`,
  };
}

export async function syncBlocklist(deps: SyncDeps): Promise<BlocklistSyncOutcome> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const now = deps.now ?? Date.now;

  let stored: StoredBlocklist | null = null;
  try {
    stored = await readStoredBlocklist();
  } catch (cause) {
    return { kind: "unavailable", reason: `không đọc được IndexedDB: ${String(cause)}`, keptVersion: null };
  }

  const keptVersion = stored === null ? null : stored.version;

  const attempt = await fetchNegotiated(fetchImpl, deps.baseUrl, stored);
  if (attempt.kind === "failed") {
    return { kind: "unavailable", reason: attempt.reason, keptVersion };
  }

  const response = attempt.response;

  if (response.status === 304) {
    if (stored !== null) {
      await writeStoredBlocklist({
        format: stored.format,
        version: stored.version,
        phish: stored.phish,
        legit: stored.legit,
        soft: stored.soft,
        etag: response.headers.get(HEADER_ETAG) ?? stored.etag,
        pinnedUrl: response.headers.get(HEADER_PINNED_URL) ?? stored.pinnedUrl,
        fetchedAt: now(),
      });
      return { kind: "unchanged", version: stored.version };
    }
    return {
      kind: "unavailable",
      reason: "server trả 304 nhưng client chưa có artifact nào để giữ",
      keptVersion,
    };
  }

  if (!response.ok) {
    return {
      kind: "unavailable",
      reason: `HTTP ${response.status}`,
      keptVersion,
    };
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (cause) {
    return { kind: "unavailable", reason: `không đọc được body: ${String(cause)}`, keptVersion };
  }

  const decoded = decodeAfbl(bytes);
  if (!decoded.ok) {
    return { kind: "refused", refusal: decoded.refusal, keptVersion };
  }

  const artifact = decoded.artifact;

  const headerVersion = headerNumber(response, HEADER_VERSION);
  if (headerVersion !== null && headerVersion !== artifact.version) {
    return {
      kind: "refused",
      refusal: {
        code: "unsupported_format",
        message: `Header ${HEADER_VERSION} nói ${headerVersion} nhưng byte thứ 6 nói ${artifact.version}. Hai nguồn không khớp thì giữ bản đang có.`,
      },
      keptVersion,
    };
  }

  const headerFormat = headerNumber(response, HEADER_FORMAT);
  if (headerFormat !== null && headerFormat !== artifact.format) {
    return {
      kind: "refused",
      refusal: {
        code: "unsupported_format",
        message: `Header ${HEADER_FORMAT} nói ${headerFormat} nhưng byte thứ 4 nói ${artifact.format}. Hai nguồn không khớp thì giữ bản đang có.`,
      },
      keptVersion,
    };
  }

  const headerSoftCount = headerNumber(response, HEADER_SOFT_COUNT);
  if (
    headerSoftCount !== null &&
    afblCarriesSoft(artifact.format) &&
    headerSoftCount !== artifact.soft.length
  ) {
    return {
      kind: "refused",
      refusal: {
        code: "truncated_body",
        message: `Header ${HEADER_SOFT_COUNT} nói ${headerSoftCount} entry mềm nhưng byte thứ 18 nói ${artifact.soft.length}. Hai nguồn không khớp thì giữ bản đang có.`,
      },
      keptVersion,
    };
  }

  if (stored !== null && !acceptsIncomingArtifact(stored, artifact)) {
    return {
      kind: "rejected_older",
      incomingVersion: artifact.version,
      keptVersion: stored.version,
    };
  }

  await writeStoredBlocklist({
    format: artifact.format,
    version: artifact.version,
    phish: artifact.phish,
    legit: artifact.legit,
    soft: artifact.soft,
    etag: response.headers.get(HEADER_ETAG),
    pinnedUrl: response.headers.get(HEADER_PINNED_URL),
    fetchedAt: now(),
  });

  return {
    kind: "fresh",
    format: artifact.format,
    version: artifact.version,
    phishCount: artifact.phish.length,
    legitCount: artifact.legit.length,
    softCount: artifact.soft.length,
  };
}
