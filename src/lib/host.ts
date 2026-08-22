import { AFBL_HASH_HEX_LENGTH } from "./afbl.ts";

const HASHABLE_SCHEMES = new Set(["http:", "https:"]);

export function hostOfUrl(url: string | undefined | null): string | null {
  if (typeof url !== "string" || url.length === 0) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (!HASHABLE_SCHEMES.has(parsed.protocol)) {
    return null;
  }

  const host = parsed.hostname.trim().toLowerCase().replace(/\.+$/, "");
  return host.length === 0 ? null : host;
}

export function truncatedEntryOf(hostSha256Hex: string): bigint {
  if (!/^[0-9a-f]{64}$/.test(hostSha256Hex)) {
    throw new Error(
      `SHA256(host) phải là 64 ký tự hex thường, nhận được chuỗi dài ${hostSha256Hex.length}.`,
    );
  }
  return BigInt(`0x${hostSha256Hex.slice(0, AFBL_HASH_HEX_LENGTH)}`);
}

export async function hostSha256Hex(host: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(host.toLowerCase()));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function hostEntryOf(host: string): Promise<bigint> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(host.toLowerCase()));
  return new DataView(digest).getBigUint64(0, false);
}
