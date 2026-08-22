import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAfbl } from "../../src/lib/afbl.ts";
import { clearStoredBlocklist, readStoredBlocklist } from "../../src/lib/blocklist-store.ts";
import { syncBlocklist } from "../../src/lib/blocklist-sync.ts";
import { invalidateTier0Cache, lookupHost } from "../../src/lib/tier0.ts";
import {
  LEGIT_HOST,
  PHISH_HOST,
  UNSEEN_HOST,
  blocklistResponse,
  fixtureArtifact,
} from "../helpers/fixture.ts";

const BASE_URL = "https://anti-fraud.omelet.tech";

const GOOD_VERSION = 41;

async function seedGoodArtifact(): Promise<void> {
  const bytes = await fixtureArtifact(GOOD_VERSION);
  const outcome = await syncBlocklist({
    baseUrl: BASE_URL,
    fetchImpl: async () => blocklistResponse(bytes, GOOD_VERSION),
  });
  expect(outcome.kind).toBe("fresh");
  invalidateTier0Cache();
}

function corruptFetch(bytes: Uint8Array, version: number): typeof fetch {
  return (async () => blocklistResponse(bytes, version)) as unknown as typeof fetch;
}

beforeEach(async () => {
  await clearStoredBlocklist();
  invalidateTier0Cache();
});

describe("artifact hỏng thì từ chối và giữ bản cũ", () => {
  it("đường 1: từ chối, bản đã lưu không suy suyển một byte", async () => {
    await seedGoodArtifact();
    const before = await readStoredBlocklist();

    const garbage = new Uint8Array([0x42, 0x41, 0x44, 0x21, 0x01, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const outcome = await syncBlocklist({ baseUrl: BASE_URL, fetchImpl: corruptFetch(garbage, 99) });

    expect(outcome.kind).toBe("refused");
    if (outcome.kind !== "refused") return;
    expect(outcome.refusal.code).toBe("bad_magic");
    expect(outcome.keptVersion).toBe(GOOD_VERSION);

    const after = await readStoredBlocklist();
    expect(after?.version).toBe(GOOD_VERSION);
    expect(Array.from(after!.phish)).toEqual(Array.from(before!.phish));
    expect(Array.from(after!.legit)).toEqual(Array.from(before!.legit));
    expect(after!.fetchedAt).toBe(before!.fetchedAt);
  });

  it("đường 2: không fail open, host lừa đảo vẫn ra phishing sau khi từ chối", async () => {
    await seedGoodArtifact();
    expect((await lookupHost(PHISH_HOST)).verdict).toBe("phishing");

    const truncated = (await fixtureArtifact(99)).subarray(0, 20);
    const outcome = await syncBlocklist({
      baseUrl: BASE_URL,
      fetchImpl: corruptFetch(truncated, 99),
    });
    expect(outcome.kind).toBe("refused");

    invalidateTier0Cache();
    expect((await lookupHost(PHISH_HOST)).verdict).toBe("phishing");
    expect((await lookupHost(PHISH_HOST)).artifactVersion).toBe(GOOD_VERSION);
  });

  it("đường 3: không fail closed, host lạ vẫn ra unknown chứ không bị cảnh báo", async () => {
    await seedGoodArtifact();

    const wrongFormat = encodeAfbl({ version: 99, format: 2, phish: [], legit: [] });
    const outcome = await syncBlocklist({
      baseUrl: BASE_URL,
      fetchImpl: corruptFetch(wrongFormat, 99),
    });
    expect(outcome.kind).toBe("refused");
    if (outcome.kind !== "refused") return;
    expect(outcome.refusal.code).toBe("unsupported_format");

    invalidateTier0Cache();
    expect((await lookupHost(UNSEEN_HOST)).verdict).toBe("unknown");
    expect((await lookupHost(LEGIT_HOST)).verdict).toBe("legit");
  });

  it("chưa có bản nào mà artifact đầu tiên đã hỏng thì vẫn là no_artifact, không phải phishing", async () => {
    const outcome = await syncBlocklist({
      baseUrl: BASE_URL,
      fetchImpl: corruptFetch(new Uint8Array(3), 1),
    });
    expect(outcome.kind).toBe("refused");
    if (outcome.kind !== "refused") return;
    expect(outcome.refusal.code).toBe("too_short");
    expect(outcome.keptVersion).toBeNull();

    invalidateTier0Cache();
    expect((await lookupHost(PHISH_HOST)).verdict).toBe("no_artifact");
  });

  it("mạng hỏng hoặc HTTP lỗi cũng là giữ bản cũ, không phải xoá bản cũ", async () => {
    await seedGoodArtifact();

    const networkDown = await syncBlocklist({
      baseUrl: BASE_URL,
      fetchImpl: (async () => {
        throw new TypeError("Failed to fetch");
      }) as unknown as typeof fetch,
    });
    expect(networkDown.kind).toBe("unavailable");
    if (networkDown.kind === "unavailable") {
      expect(networkDown.keptVersion).toBe(GOOD_VERSION);
    }

    const badRequest = await syncBlocklist({
      baseUrl: BASE_URL,
      fetchImpl: (async () =>
        new Response('{"error":{"code":"unsupported_format","message":"x"}}', {
          status: 400,
        })) as unknown as typeof fetch,
    });
    expect(badRequest.kind).toBe("unavailable");

    invalidateTier0Cache();
    expect((await lookupHost(PHISH_HOST)).verdict).toBe("phishing");
  });

  it("header version nói một đằng byte thứ 6 nói một nẻo thì từ chối", async () => {
    await seedGoodArtifact();
    const bytes = await fixtureArtifact(500);
    const outcome = await syncBlocklist({
      baseUrl: BASE_URL,
      fetchImpl: (async () => blocklistResponse(bytes, 501)) as unknown as typeof fetch,
    });
    expect(outcome.kind).toBe("refused");
    expect((await readStoredBlocklist())?.version).toBe(GOOD_VERSION);
  });

  it("gửi since đúng bằng version đang giữ, tên tham số là since", async () => {
    await seedGoodArtifact();
    const spy = vi.fn(async (input: string | URL | Request) => {
      expect(typeof input).toBe("string");
      return blocklistResponse(await fixtureArtifact(GOOD_VERSION + 1), GOOD_VERSION + 1);
    });
    await syncBlocklist({ baseUrl: BASE_URL, fetchImpl: spy as unknown as typeof fetch });

    const requested = new URL(String(spy.mock.calls[0]?.[0]));
    expect(requested.pathname).toBe("/v1/blocklist");
    expect(requested.searchParams.get("format")).toBe("1");
    expect(requested.searchParams.get("since")).toBe(String(GOOD_VERSION));
    expect(requested.searchParams.has("have")).toBe(false);
  });
});
