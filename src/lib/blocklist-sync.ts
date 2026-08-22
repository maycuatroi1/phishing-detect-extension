import { AFBL_FORMAT, decodeAfbl, type AfblRefusal } from "./afbl.ts";
import {
  readStoredBlocklist,
  writeStoredBlocklist,
  type StoredBlocklist,
} from "./blocklist-store.ts";

export const BLOCKLIST_PATH = "/v1/blocklist";

export const BLOCKLIST_FORMAT_PARAM = "format";

export const BLOCKLIST_SINCE_PARAM = "since";

export const BLOCKLIST_REFRESH_PERIOD_MINUTES = 1440;

export const HEADER_ETAG = "etag";

export const HEADER_FORMAT = "x-blocklist-format";

export const HEADER_VERSION = "x-blocklist-version";

export const HEADER_PHISH_COUNT = "x-blocklist-phish-count";

export const HEADER_LEGIT_COUNT = "x-blocklist-legit-count";

export const HEADER_PINNED_URL = "x-blocklist-pinned-url";

export type BlocklistSyncOutcome =
  | { readonly kind: "fresh"; readonly version: number; readonly phishCount: number; readonly legitCount: number }
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

export function blocklistAgeMs(record: StoredBlocklist, now: number): number {
  return Math.max(0, now - record.fetchedAt);
}

export function blocklistRequestUrl(baseUrl: string, since: number | null): string {
  const url = new URL(BLOCKLIST_PATH, baseUrl);
  url.searchParams.set(BLOCKLIST_FORMAT_PARAM, String(AFBL_FORMAT));
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

  let response: Response;
  try {
    response = await fetchImpl(blocklistRequestUrl(deps.baseUrl, keptVersion), {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      redirect: "follow",
    });
  } catch (cause) {
    return { kind: "unavailable", reason: `fetch thất bại: ${String(cause)}`, keptVersion };
  }

  if (response.status === 304) {
    if (stored !== null) {
      await writeStoredBlocklist({
        format: stored.format,
        version: stored.version,
        phish: stored.phish,
        legit: stored.legit,
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

  if (keptVersion !== null && !acceptsIncomingVersion(keptVersion, artifact.version)) {
    return {
      kind: "rejected_older",
      incomingVersion: artifact.version,
      keptVersion,
    };
  }

  await writeStoredBlocklist({
    format: artifact.format,
    version: artifact.version,
    phish: artifact.phish,
    legit: artifact.legit,
    etag: response.headers.get(HEADER_ETAG),
    pinnedUrl: response.headers.get(HEADER_PINNED_URL),
    fetchedAt: now(),
  });

  return {
    kind: "fresh",
    version: artifact.version,
    phishCount: artifact.phish.length,
    legitCount: artifact.legit.length,
  };
}
