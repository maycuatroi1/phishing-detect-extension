import { encodeAfbl } from "../../src/lib/afbl.ts";
import { hostEntryOf } from "../../src/lib/host.ts";

export const PHISH_HOST = "vietcombank-otp.example";

export const LEGIT_HOST = "vietcombank.com.vn";

export const UNSEEN_HOST = "khong-co-trong-danh-sach.example";

function ascending(values: bigint[]): bigint[] {
  return Array.from(new Set(values)).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

export async function entriesFor(hosts: readonly string[]): Promise<bigint[]> {
  return ascending(await Promise.all(hosts.map((host) => hostEntryOf(host))));
}

export async function fixtureArtifact(
  version: number,
  phishHosts: readonly string[] = [PHISH_HOST],
  legitHosts: readonly string[] = [LEGIT_HOST],
): Promise<Uint8Array> {
  return encodeAfbl({
    version,
    phish: await entriesFor(phishHosts),
    legit: await entriesFor(legitHosts),
  });
}

export function blocklistResponse(
  bytes: Uint8Array,
  version: number,
  format = 1,
): Response {
  return new Response(bytes.slice().buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "content-type": "application/octet-stream",
      etag: `"afbl-${format}-${version}"`,
      "x-blocklist-format": String(format),
      "x-blocklist-version": String(version),
      "x-blocklist-pinned-url": `/v1/blocklist/v/${version}?format=${format}`,
    },
  });
}

export function notModifiedResponse(version: number, format = 1): Response {
  return new Response(null, {
    status: 304,
    headers: {
      etag: `"afbl-${format}-${version}"`,
      "x-blocklist-format": String(format),
      "x-blocklist-version": String(version),
      "x-blocklist-pinned-url": `/v1/blocklist/v/${version}?format=${format}`,
    },
  });
}
