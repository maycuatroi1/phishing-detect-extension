import {
  LOOKUP_MAX_PREFIXES_PER_REQUEST,
  fetchLookup,
  isLookupPrefix,
  type LookupEntry,
} from "./lookup.ts";

export const LOOKUP_BATCH_MIN_DELAY_MS = 200;

export const LOOKUP_BATCH_JITTER_MS = 800;

export const LOOKUP_BUCKET_TTL_MS = 300_000;

export type BucketResult =
  | { readonly kind: "bucket"; readonly entries: readonly LookupEntry[] }
  | { readonly kind: "unavailable"; readonly reason: string };

export interface LookupBatcherDeps {
  readonly baseUrl: string;
  readonly random: () => number;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  readonly setTimer?: (run: () => void, delayMs: number) => number;
  readonly clearTimer?: (handle: number) => void;
  readonly minDelayMs?: number;
  readonly jitterMs?: number;
  readonly bucketTtlMs?: number;
  readonly maxPerRequest?: number;
}

export interface LookupBatcher {
  bucketFor(prefix: string): Promise<BucketResult>;
  waitingCount(): number;
}

export function jitterDelayMs(
  random: () => number,
  minDelayMs: number = LOOKUP_BATCH_MIN_DELAY_MS,
  jitterMs: number = LOOKUP_BATCH_JITTER_MS,
): number {
  const raw = random();
  const bounded = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 1) : 0;
  return minDelayMs + Math.floor(bounded * jitterMs);
}

interface Waiter {
  readonly promise: Promise<BucketResult>;
  readonly settle: (result: BucketResult) => void;
}

interface CachedBucket {
  readonly entries: readonly LookupEntry[];
  readonly at: number;
}

export function createLookupBatcher(deps: LookupBatcherDeps): LookupBatcher {
  const now = deps.now ?? Date.now;
  const setTimer =
    deps.setTimer ?? ((run: () => void, delayMs: number) => globalThis.setTimeout(run, delayMs) as unknown as number);
  const clearTimer =
    deps.clearTimer ?? ((handle: number) => globalThis.clearTimeout(handle as unknown as ReturnType<typeof setTimeout>));
  const minDelayMs = deps.minDelayMs ?? LOOKUP_BATCH_MIN_DELAY_MS;
  const jitterMs = deps.jitterMs ?? LOOKUP_BATCH_JITTER_MS;
  const bucketTtlMs = deps.bucketTtlMs ?? LOOKUP_BUCKET_TTL_MS;
  const maxPerRequest = Math.min(
    deps.maxPerRequest ?? LOOKUP_MAX_PREFIXES_PER_REQUEST,
    LOOKUP_MAX_PREFIXES_PER_REQUEST,
  );

  const cache = new Map<string, CachedBucket>();
  const waiters = new Map<string, Waiter>();
  const queued: string[] = [];
  let timer: number | null = null;

  function scheduleFlush(delayMs: number): void {
    if (timer !== null) {
      clearTimer(timer);
    }
    timer = setTimer(() => {
      timer = null;
      void flush();
    }, delayMs);
  }

  function scheduleForQueue(): void {
    if (queued.length === 0) {
      return;
    }
    if (queued.length >= maxPerRequest) {
      scheduleFlush(0);
      return;
    }
    if (timer === null) {
      scheduleFlush(jitterDelayMs(deps.random, minDelayMs, jitterMs));
    }
  }

  async function flush(): Promise<void> {
    const chunk = queued.splice(0, maxPerRequest);
    if (chunk.length === 0) {
      return;
    }

    const outcome = await fetchLookup({
      baseUrl: deps.baseUrl,
      prefixes: chunk,
      fetchImpl: deps.fetchImpl,
    });

    const stamp = now();
    for (const prefix of chunk) {
      const waiter = waiters.get(prefix);
      waiters.delete(prefix);
      if (waiter === undefined) {
        continue;
      }

      if (outcome.kind === "refused") {
        waiter.settle({ kind: "unavailable", reason: `server từ chối lô: ${outcome.code}` });
        continue;
      }
      if (outcome.kind === "unavailable") {
        waiter.settle({ kind: "unavailable", reason: outcome.reason });
        continue;
      }

      const entries = outcome.buckets.get(prefix);
      if (entries === undefined) {
        waiter.settle({ kind: "unavailable", reason: "server bỏ sót bucket của prefix vừa hỏi" });
        continue;
      }

      cache.set(prefix, { entries, at: stamp });
      waiter.settle({ kind: "bucket", entries });
    }

    scheduleForQueue();
  }

  function bucketFor(prefix: string): Promise<BucketResult> {
    if (!isLookupPrefix(prefix)) {
      return Promise.resolve({
        kind: "unavailable",
        reason: `chỉ prefix 5 ký tự hex thường được xếp hàng, nhận chuỗi dài ${prefix.length}`,
      });
    }

    const cached = cache.get(prefix);
    if (cached !== undefined) {
      if (now() - cached.at < bucketTtlMs) {
        return Promise.resolve({ kind: "bucket", entries: cached.entries });
      }
      cache.delete(prefix);
    }

    const waiting = waiters.get(prefix);
    if (waiting !== undefined) {
      return waiting.promise;
    }

    let settle: (result: BucketResult) => void = () => undefined;
    const promise = new Promise<BucketResult>((resolve) => {
      settle = resolve;
    });
    waiters.set(prefix, { promise, settle });
    queued.push(prefix);
    scheduleForQueue();
    return promise;
  }

  return {
    bucketFor,
    waitingCount: () => waiters.size,
  };
}
