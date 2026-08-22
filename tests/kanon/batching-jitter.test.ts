import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_API_BASE_URL } from "../../src/config.ts";
import { hostSha256Hex } from "../../src/lib/host.ts";
import { LOOKUP_MAX_PREFIXES_PER_REQUEST, prefixOfHashHex } from "../../src/lib/lookup.ts";
import {
  LOOKUP_BATCH_JITTER_MS,
  LOOKUP_BATCH_MIN_DELAY_MS,
  createLookupBatcher,
  jitterDelayMs,
} from "../../src/lib/lookup-batch.ts";
import { lookupHostTier1 } from "../../src/lib/tier1.ts";
import { manualClock } from "../helpers/clock.ts";
import { echoEmptyBuckets, tapFetch } from "../helpers/wire.ts";

function hostsNamed(count: number, label = "la"): string[] {
  return Array.from({ length: count }, (_, index) => `${label}-${index}.kanon.example`);
}

function harness(random: () => number = () => 0.5) {
  const clock = manualClock();
  const tap = tapFetch(echoEmptyBuckets);
  const batcher = createLookupBatcher({
    baseUrl: DEFAULT_API_BASE_URL,
    random,
    fetchImpl: tap.fetchImpl,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  return { clock, tap, batcher };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("gộp thật sự gộp: nhiều host lạ đi chung một request", () => {
  it("năm host lạ trong cùng một cửa sổ đi chung đúng một request", async () => {
    const { clock, tap, batcher } = harness();
    const hosts = hostsNamed(5);

    const pending = hosts.map((host) => lookupHostTier1(host, batcher));
    await clock.settle();
    const results = await Promise.all(pending);

    expect(tap.requests).toHaveLength(1);
    expect(tap.requests[0].prefixes).toHaveLength(5);
    expect(results.every((result) => result.verdict === "absent")).toBe(true);

    const expected = await Promise.all(hosts.map(async (host) => prefixOfHashHex(await hostSha256Hex(host))));
    expect(tap.requests[0].prefixes.slice().sort()).toEqual(expected.slice().sort());
  });

  it("hai mươi host lạ không thành hai mươi request, lô đầu đúng 16 prefix", async () => {
    const { clock, tap, batcher } = harness();
    const hosts = hostsNamed(20, "nhieu");

    const pending = hosts.map((host) => lookupHostTier1(host, batcher));
    await clock.settle();
    await Promise.all(pending);

    expect(tap.requests.length).toBeLessThan(hosts.length);
    expect(tap.requests).toHaveLength(2);
    expect(tap.requests[0].prefixes).toHaveLength(LOOKUP_MAX_PREFIXES_PER_REQUEST);
    expect(tap.requests[1].prefixes).toHaveLength(4);

    for (const request of tap.requests) {
      expect(request.prefixes.length).toBeLessThanOrEqual(LOOKUP_MAX_PREFIXES_PER_REQUEST);
    }
  });

  it("không lô nào vượt 16 prefix dù có 40 host cùng lúc", async () => {
    const { clock, tap, batcher } = harness();
    const hosts = hostsNamed(40, "rat-nhieu");

    const pending = hosts.map((host) => lookupHostTier1(host, batcher));
    await clock.settle();
    await Promise.all(pending);

    const sent = tap.requests.flatMap((request) => request.prefixes);
    expect(new Set(sent).size).toBe(sent.length);
    expect(tap.requests.every((request) => request.prefixes.length <= 16)).toBe(true);
    expect(tap.requests.length).toBe(Math.ceil(new Set(sent).size / 16));
  });

  it("hai host khác nhau trùng prefix chỉ tốn một p, và một host hỏi lại không tốn request nào", async () => {
    const { clock, tap, batcher } = harness();
    const host = "trung-lap.kanon.example";

    const first = lookupHostTier1(host, batcher);
    const second = lookupHostTier1(host, batcher);
    await clock.settle();
    await Promise.all([first, second]);

    expect(tap.requests).toHaveLength(1);
    expect(tap.requests[0].prefixes).toHaveLength(1);

    await lookupHostTier1(host, batcher);
    await clock.settle();
    expect(tap.requests).toHaveLength(1);
  });
});

describe("jitter tiêm được từ ngoài chứ không gọi thẳng Math.random", () => {
  it("jitterDelayMs nằm trong khoảng và di chuyển theo nguồn ngẫu nhiên", () => {
    expect(jitterDelayMs(() => 0)).toBe(LOOKUP_BATCH_MIN_DELAY_MS);
    expect(jitterDelayMs(() => 1)).toBe(LOOKUP_BATCH_MIN_DELAY_MS + LOOKUP_BATCH_JITTER_MS);
    expect(jitterDelayMs(() => 0.5)).toBe(
      LOOKUP_BATCH_MIN_DELAY_MS + Math.floor(0.5 * LOOKUP_BATCH_JITTER_MS),
    );
    expect(jitterDelayMs(() => 0.25)).not.toBe(jitterDelayMs(() => 0.75));
  });

  it("nguồn ngẫu nhiên hỏng không đẩy delay ra ngoài khoảng", () => {
    expect(jitterDelayMs(() => Number.NaN)).toBe(LOOKUP_BATCH_MIN_DELAY_MS);
    expect(jitterDelayMs(() => -5)).toBe(LOOKUP_BATCH_MIN_DELAY_MS);
    expect(jitterDelayMs(() => 9)).toBe(LOOKUP_BATCH_MIN_DELAY_MS + LOOKUP_BATCH_JITTER_MS);
  });

  it("batcher lên lịch bằng đúng số mà nguồn tiêm vào sinh ra", async () => {
    const draws = [0, 1, 0.5];
    let index = 0;
    const { clock, batcher } = harness(() => {
      const value = draws[Math.min(index, draws.length - 1)];
      index += 1;
      return value;
    });

    void lookupHostTier1("mot.kanon.example", batcher);
    await clock.settle();
    void lookupHostTier1("hai.kanon.example", batcher);
    await clock.settle();

    expect(clock.scheduledDelays().slice(0, 2)).toEqual([
      LOOKUP_BATCH_MIN_DELAY_MS,
      LOOKUP_BATCH_MIN_DELAY_MS + LOOKUP_BATCH_JITTER_MS,
    ]);
  });

  it("Math.random nổ tung mà đường tier 1 vẫn chạy, vì nó không hề gọi Math.random", async () => {
    vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("đường tier 1 vừa gọi Math.random thay vì nguồn được tiêm vào");
    });

    const { clock, tap, batcher } = harness(() => 0.5);
    const pending = lookupHostTier1("khong-dung-math-random.kanon.example", batcher);
    await clock.settle();

    expect((await pending).verdict).toBe("absent");
    expect(tap.requests).toHaveLength(1);
  });

  it("không file thư viện tier 1 nào chứa Math.random", () => {
    for (const relative of ["src/lib/lookup.ts", "src/lib/lookup-batch.ts", "src/lib/tier1.ts"]) {
      const text = readFileSync(resolve(process.cwd(), relative), "utf8");
      expect(text, `${relative} gọi thẳng Math.random`).not.toContain("Math.random");
    }
  });
});
