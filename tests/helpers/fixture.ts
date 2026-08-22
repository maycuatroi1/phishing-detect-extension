import {
  AFBL_FORMAT,
  AFBL_SOFT_FORMAT,
  decodeAfbl,
  encodeAfbl,
  type AfblArtifact,
} from "../../src/lib/afbl.ts";
import { writeStoredBlocklist } from "../../src/lib/blocklist-store.ts";
import { hostEntryOf } from "../../src/lib/host.ts";

export const PHISH_HOST = "vietcombank-otp.example";

export const LEGIT_HOST = "vietcombank.com.vn";

export const SOFT_HOST = "vietcombank-otp-2026.example";

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

export async function softFixtureArtifact(
  version: number,
  softHosts: readonly string[] = [SOFT_HOST],
  phishHosts: readonly string[] = [PHISH_HOST],
  legitHosts: readonly string[] = [LEGIT_HOST],
): Promise<Uint8Array> {
  return encodeAfbl({
    version,
    format: AFBL_SOFT_FORMAT,
    phish: await entriesFor(phishHosts),
    legit: await entriesFor(legitHosts),
    soft: await entriesFor(softHosts),
  });
}

export function decodedFixture(bytes: Uint8Array): AfblArtifact {
  const decoded = decodeAfbl(bytes);
  if (!decoded.ok) {
    throw new Error(`fixture không decode được: ${decoded.refusal.code}`);
  }
  return decoded.artifact;
}

export async function storeFixture(bytes: Uint8Array, fetchedAt = 1_800_000_000_000): Promise<AfblArtifact> {
  const artifact = decodedFixture(bytes);
  await writeStoredBlocklist({
    format: artifact.format,
    version: artifact.version,
    phish: artifact.phish,
    legit: artifact.legit,
    soft: artifact.soft,
    etag: `"afbl-${artifact.format}-${artifact.version}"`,
    pinnedUrl: `/v1/blocklist/v/${artifact.version}?format=${artifact.format}`,
    fetchedAt,
  });
  return artifact;
}

export function blocklistResponse(
  bytes: Uint8Array,
  version: number,
  format = AFBL_FORMAT,
  softCount: number | null = null,
): Response {
  const headers: Record<string, string> = {
    "content-type": "application/octet-stream",
    etag: `"afbl-${format}-${version}"`,
    "x-blocklist-format": String(format),
    "x-blocklist-version": String(version),
    "x-blocklist-pinned-url": `/v1/blocklist/v/${version}?format=${format}`,
  };
  if (softCount !== null) {
    headers["x-blocklist-soft-count"] = String(softCount);
  }

  return new Response(bytes.slice().buffer as ArrayBuffer, { status: 200, headers });
}

export function unsupportedFormatResponse(format: number): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: "unsupported_format",
        message: `GET /v1/blocklist serves artifact format 1 only, and format=${format} is not it.`,
      },
    }),
    { status: 400, headers: { "content-type": "application/json" } },
  );
}

export function notModifiedResponse(version: number, format = AFBL_FORMAT): Response {
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
