import "fake-indexeddb/auto";
import { beforeAll, describe, expect, it } from "vitest";
import { AFBL_FORMAT, AFBL_HEADER_BYTES, afblByteLength, decodeAfbl } from "../../src/lib/afbl.ts";
import { clearStoredBlocklist, readStoredBlocklist } from "../../src/lib/blocklist-store.ts";
import {
  HEADER_ETAG,
  HEADER_FORMAT,
  HEADER_LEGIT_COUNT,
  HEADER_PHISH_COUNT,
  HEADER_PINNED_URL,
  HEADER_VERSION,
  blocklistRequestUrl,
  syncBlocklist,
} from "../../src/lib/blocklist-sync.ts";
import { DEFAULT_API_BASE_URL } from "../../src/config.ts";
import { invalidateTier0Cache, lookupHost } from "../../src/lib/tier0.ts";
import { UNSEEN_HOST } from "../helpers/fixture.ts";

const BASE_URL = process.env.PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL;

const OFFLINE_IS_OK = process.env.ALLOW_OFFLINE_CONTRACT === "1";

const TIMEOUT_MS = 20_000;

interface Probe {
  readonly status: number;
  readonly bytes: Uint8Array;
  readonly headers: Headers;
}

let probe: Probe | null = null;
let unreachable: string | null = null;

function skipping(): boolean {
  if (probe !== null) {
    return false;
  }
  console.warn(
    `[contract] bỏ qua vế production vì ALLOW_OFFLINE_CONTRACT=1 và không tới được ${BASE_URL}: ${unreachable}`,
  );
  return true;
}

beforeAll(async () => {
  try {
    const response = await fetch(blocklistRequestUrl(BASE_URL, null), {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    probe = {
      status: response.status,
      bytes: new Uint8Array(await response.arrayBuffer()),
      headers: response.headers,
    };
  } catch (cause) {
    unreachable = String(cause);
  }
}, TIMEOUT_MS + 5_000);

describe("đường production thật tại " + BASE_URL, () => {
  it("tới được production và server trả 200", () => {
    if (probe === null && OFFLINE_IS_OK) {
      expect(skipping()).toBe(true);
      return;
    }
    expect(
      unreachable,
      `Không tới được ${BASE_URL}. Đặt ALLOW_OFFLINE_CONTRACT=1 nếu đang chạy offline có chủ ý.`,
    ).toBeNull();
    expect(probe?.status).toBe(200);
  });

  it("parse được header và byte khớp header HTTP từng trường một", () => {
    if (probe === null) return void skipping();
    const decoded = decodeAfbl(probe.bytes);
    expect(decoded.ok, decoded.ok ? "" : decoded.refusal.message).toBe(true);
    if (!decoded.ok) return;

    const artifact = decoded.artifact;
    expect(artifact.format).toBe(AFBL_FORMAT);
    expect(String(artifact.format)).toBe(probe.headers.get(HEADER_FORMAT));
    expect(String(artifact.version)).toBe(probe.headers.get(HEADER_VERSION));
    expect(String(artifact.phish.length)).toBe(probe.headers.get(HEADER_PHISH_COUNT));
    expect(String(artifact.legit.length)).toBe(probe.headers.get(HEADER_LEGIT_COUNT));
    expect(probe.bytes.byteLength).toBe(afblByteLength(artifact.phish.length, artifact.legit.length));
  });

  it("ETag và pinned URL khớp format cùng version vừa đọc được từ byte", () => {
    if (probe === null) return void skipping();
    const decoded = decodeAfbl(probe.bytes);
    if (!decoded.ok) return;
    const { format, version } = decoded.artifact;
    expect(probe.headers.get(HEADER_ETAG)).toBe(`"afbl-${format}-${version}"`);
    expect(probe.headers.get(HEADER_PINNED_URL)).toBe(`/v1/blocklist/v/${version}?format=${format}`);
  });

  it("artifact rỗng vẫn là câu trả lời hợp lệ: lưu được, so version được, không phải lỗi", async () => {
    if (probe === null) return void skipping();
    const decoded = decodeAfbl(probe.bytes);
    if (!decoded.ok) return;

    if (probe.bytes.byteLength === AFBL_HEADER_BYTES) {
      expect(decoded.artifact.phish.length).toBe(0);
      expect(decoded.artifact.legit.length).toBe(0);
    }

    await clearStoredBlocklist();
    invalidateTier0Cache();

    const outcome = await syncBlocklist({ baseUrl: BASE_URL });
    expect(outcome.kind).toBe("fresh");
    if (outcome.kind !== "fresh") return;
    expect(outcome.version).toBe(decoded.artifact.version);

    const stored = await readStoredBlocklist();
    expect(stored?.version).toBe(decoded.artifact.version);
    expect(stored?.format).toBe(AFBL_FORMAT);
    expect(stored?.etag).toBe(`"afbl-${decoded.artifact.format}-${decoded.artifact.version}"`);
    expect(stored?.pinnedUrl).toBe(
      `/v1/blocklist/v/${decoded.artifact.version}?format=${decoded.artifact.format}`,
    );

    invalidateTier0Cache();
    expect((await lookupHost(UNSEEN_HOST)).verdict).toBe("unknown");
  }, TIMEOUT_MS);

  it("since bằng version đang giữ thì production trả 304 và không gửi entry nào", async () => {
    if (probe === null) return void skipping();
    const stored = await readStoredBlocklist();
    expect(stored).not.toBeNull();
    if (stored === null) return;

    const response = await fetch(blocklistRequestUrl(BASE_URL, stored.version), {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    expect(new URL(blocklistRequestUrl(BASE_URL, stored.version)).searchParams.get("since")).toBe(
      String(stored.version),
    );
    expect(response.status).toBe(304);
    expect((await response.arrayBuffer()).byteLength).toBe(0);
    expect(response.headers.get(HEADER_VERSION)).toBe(String(stored.version));

    const outcome = await syncBlocklist({ baseUrl: BASE_URL });
    expect(outcome.kind).toBe("unchanged");
    expect((await readStoredBlocklist())?.version).toBe(stored.version);
  }, TIMEOUT_MS);

  it("format lạ bị từ chối ở server, và câu trả lời đó không làm client mất artifact đang giữ", async () => {
    if (probe === null) return void skipping();
    const before = await readStoredBlocklist();

    const url = new URL("/v1/blocklist", BASE_URL);
    url.searchParams.set("format", "999");
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unsupported_format");

    expect((await readStoredBlocklist())?.version).toBe(before?.version);
  }, TIMEOUT_MS);
});
