import { describe, expect, it } from "vitest";
import { DEFAULT_API_BASE_URL } from "../../src/config.ts";
import { hostSha256Hex } from "../../src/lib/host.ts";
import { matchFullHash, prefixOfHashHex, type LookupEntry } from "../../src/lib/lookup.ts";
import { createLookupBatcher } from "../../src/lib/lookup-batch.ts";
import { lookupHostTier1 } from "../../src/lib/tier1.ts";
import { manualClock } from "../helpers/clock.ts";
import { bucketsResponse, tapFetch, type WireRequest } from "../helpers/wire.ts";

const HOST = "vietcombank-otp-xacthuc.kanon.example";

const DECOY_DIGITS = ["1", "2", "3", "4", "5", "6", "7"];

function decoysFor(prefix: string, verdict: LookupEntry["v"] = "phishing"): LookupEntry[] {
  return DECOY_DIGITS.map((digit) => ({ h: `${prefix}${digit.repeat(59)}`, v: verdict, c: 1 }));
}

async function askServer(
  bucketFor: (prefix: string) => readonly LookupEntry[],
): Promise<{ requests: WireRequest[]; result: Awaited<ReturnType<typeof lookupHostTier1>> }> {
  const clock = manualClock();
  const tap = tapFetch((request) => {
    const buckets: Record<string, readonly LookupEntry[]> = {};
    for (const prefix of request.prefixes) {
      buckets[prefix] = bucketFor(prefix);
    }
    return bucketsResponse(buckets);
  });

  const batcher = createLookupBatcher({
    baseUrl: DEFAULT_API_BASE_URL,
    random: () => 0.25,
    fetchImpl: tap.fetchImpl,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  const pending = lookupHostTier1(HOST, batcher);
  await clock.settle();
  return { requests: tap.requests, result: await pending };
}

describe("so khớp hash đầy đủ xảy ra trong extension, không phải trên server", () => {
  it("bucket có 8 hash đầy đủ, đúng một cái là của host, extension chọn đúng cái đó", async () => {
    const hashHex = await hostSha256Hex(HOST);
    const prefix = prefixOfHashHex(hashHex);

    const { requests, result } = await askServer((asked) => {
      const bucket = decoysFor(asked);
      bucket.splice(4, 0, { h: hashHex, v: "phishing", c: 1 });
      return bucket;
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].prefixes).toEqual([prefix]);

    expect(result.verdict).toBe("phishing");
    expect(result.confirmed).toBe(true);
    expect(result.prefix).toBe(prefix);
    expect(result.bucketSize).toBe(8);
  });

  it("server trả bucket trùng prefix nhưng không có hash của host thì kết luận là absent", async () => {
    const hashHex = await hostSha256Hex(HOST);
    const prefix = prefixOfHashHex(hashHex);

    const { requests, result } = await askServer((asked) => decoysFor(asked));

    expect(requests).toHaveLength(1);
    expect(requests[0].prefixes).toEqual([prefix]);

    expect(result.verdict).toBe("absent");
    expect(result.confirmed).toBe(false);
    expect(result.bucketSize).toBe(7);
  });

  it("lệch đúng một ký tự hex cuối cũng là không khớp, so là 256 bit chứ không phải 20 bit", async () => {
    const hashHex = await hostSha256Hex(HOST);
    const lastNibble = hashHex.slice(63);
    const flipped = `${hashHex.slice(0, 63)}${lastNibble === "0" ? "1" : "0"}`;

    const { result } = await askServer(() => [{ h: flipped, v: "phishing", c: 1 }]);

    expect(flipped.slice(0, 5)).toBe(hashHex.slice(0, 5));
    expect(result.verdict).toBe("absent");
    expect(result.bucketSize).toBe(1);
  });

  it("bucket rỗng là câu trả lời hợp lệ và cũng là absent, không phải unavailable", async () => {
    const { result } = await askServer(() => []);
    expect(result.verdict).toBe("absent");
    expect(result.bucketSize).toBe(0);
  });

  it("verdict unknown của corpus khác hẳn absent, hai câu trả lời không được gộp", async () => {
    const hashHex = await hostSha256Hex(HOST);
    const { result } = await askServer(() => [{ h: hashHex, v: "unknown", c: 0 }]);

    expect(result.verdict).toBe("unknown");
    expect(result.confirmed).toBe(false);
  });

  it("matchFullHash một mình đã là toàn bộ quyết định, và nó là hàm thuần trong extension", async () => {
    const hashHex = await hostSha256Hex(HOST);
    const prefix = prefixOfHashHex(hashHex);
    const bucket = decoysFor(prefix, "legit");

    expect(matchFullHash(bucket, hashHex)).toBeNull();

    const withHost = [...bucket, { h: hashHex, v: "legit" as const, c: 1 }];
    expect(matchFullHash(withHost, hashHex)?.h).toBe(hashHex);
    expect(matchFullHash(withHost, hashHex)?.v).toBe("legit");
  });

  it("matchFullHash từ chối chuỗi ngắn hơn 64 ký tự chứ không âm thầm so theo prefix", async () => {
    const hashHex = await hostSha256Hex(HOST);
    expect(() => matchFullHash([{ h: hashHex, v: "phishing", c: 1 }], hashHex.slice(0, 5))).toThrow();
  });
});
