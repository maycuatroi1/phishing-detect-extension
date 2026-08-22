import type { ApiError, ApiErrorCode } from "./api-error.ts";
import { mintInstallToken } from "./install.ts";
import {
  fetchVerdict,
  startScan,
  isTerminal,
  type ScanDeps,
  type VerdictEnvelope,
} from "./scan.ts";
import {
  readStoredInstallToken,
  writeStoredInstallToken,
  isTokenPastRotation,
  type StoredInstallToken,
} from "./token-store.ts";

export const SCAN_POLL_MAX_ATTEMPTS = 12;

export const SCAN_POLL_FALLBACK_SECONDS = 2;

export const SCAN_POLL_MAX_SECONDS = 10;

export const TOKEN_REFUSAL_CODES: readonly ApiErrorCode[] = ["missing_token", "invalid_token"];

export type TokenOutcome =
  | { readonly kind: "token"; readonly token: string; readonly minted: boolean }
  | { readonly kind: "refused"; readonly error: ApiError }
  | { readonly kind: "unavailable"; readonly reason: string };

export type ManualScanOutcome =
  | {
      readonly kind: "verdict";
      readonly envelope: VerdictEnvelope;
      readonly quotaRemaining: number;
      readonly polls: number;
    }
  | {
      readonly kind: "quota_exceeded";
      readonly message: string;
      readonly resetAt: string | null;
      readonly retryAfterSeconds: number | null;
    }
  | { readonly kind: "refused"; readonly code: ApiErrorCode; readonly message: string }
  | { readonly kind: "unavailable"; readonly reason: string }
  | {
      readonly kind: "pending";
      readonly scanId: string;
      readonly polls: number;
      readonly quotaRemaining: number;
    };

export interface Tier2Deps {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  readonly readToken?: () => Promise<StoredInstallToken | null>;
  readonly writeToken?: (record: Omit<StoredInstallToken, "key">) => Promise<void>;
  readonly maxPollAttempts?: number;
  readonly signal?: AbortSignal;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

export function pollDelayMs(pollAfterSeconds: number): number {
  const seconds = Number.isFinite(pollAfterSeconds) ? pollAfterSeconds : SCAN_POLL_FALLBACK_SECONDS;
  const bounded = Math.min(Math.max(seconds, 0), SCAN_POLL_MAX_SECONDS);
  return Math.round(bounded * 1000);
}

export async function resolveInstallToken(
  deps: Tier2Deps,
  forceMint = false,
): Promise<TokenOutcome> {
  const now = deps.now ?? Date.now;
  const read = deps.readToken ?? readStoredInstallToken;
  const write = deps.writeToken ?? writeStoredInstallToken;

  if (!forceMint) {
    let stored: StoredInstallToken | null = null;
    try {
      stored = await read();
    } catch (cause) {
      return { kind: "unavailable", reason: `không đọc được kho install token: ${String(cause)}` };
    }
    if (stored !== null && !isTokenPastRotation(stored, now())) {
      return { kind: "token", token: stored.token, minted: false };
    }
  }

  const outcome = await mintInstallToken({
    baseUrl: deps.baseUrl,
    fetchImpl: deps.fetchImpl,
    signal: deps.signal,
  });

  if (outcome.kind === "refused") {
    return { kind: "refused", error: outcome.error };
  }
  if (outcome.kind === "unavailable") {
    return { kind: "unavailable", reason: outcome.reason };
  }

  try {
    await write({
      token: outcome.minted.token,
      rotateAfterDays: outcome.minted.rotateAfterDays,
      mintedAt: now(),
    });
  } catch (cause) {
    return { kind: "unavailable", reason: `không lưu được install token: ${String(cause)}` };
  }

  return { kind: "token", token: outcome.minted.token, minted: true };
}

async function pollUntilTerminal(
  scanDeps: ScanDeps,
  scanId: string,
  firstDelayMs: number,
  maxAttempts: number,
  sleep: (ms: number) => Promise<void>,
): Promise<
  | { readonly kind: "terminal"; readonly envelope: VerdictEnvelope; readonly polls: number }
  | { readonly kind: "refused"; readonly error: ApiError }
  | { readonly kind: "unavailable"; readonly reason: string }
  | { readonly kind: "pending"; readonly polls: number }
> {
  let delayMs = firstDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await sleep(delayMs);

    const outcome = await fetchVerdict(scanDeps, scanId);
    if (outcome.kind === "refused") {
      return { kind: "refused", error: outcome.error };
    }
    if (outcome.kind === "unavailable") {
      return { kind: "unavailable", reason: outcome.reason };
    }
    if (isTerminal(outcome.envelope)) {
      return { kind: "terminal", envelope: outcome.envelope, polls: attempt };
    }
    delayMs = pollDelayMs(SCAN_POLL_FALLBACK_SECONDS);
  }

  return { kind: "pending", polls: maxAttempts };
}

export async function runManualScan(deps: Tier2Deps, url: string): Promise<ManualScanOutcome> {
  const sleep = deps.sleep ?? defaultSleep;
  const maxAttempts = deps.maxPollAttempts ?? SCAN_POLL_MAX_ATTEMPTS;

  let token = await resolveInstallToken(deps);
  if (token.kind === "refused") {
    return { kind: "refused", code: token.error.code, message: token.error.message };
  }
  if (token.kind === "unavailable") {
    return { kind: "unavailable", reason: token.reason };
  }

  const scanDepsFor = (value: string): ScanDeps => ({
    baseUrl: deps.baseUrl,
    token: value,
    fetchImpl: deps.fetchImpl,
    signal: deps.signal,
  });

  let queued = await startScan(scanDepsFor(token.token), url);

  if (
    queued.kind === "refused" &&
    TOKEN_REFUSAL_CODES.includes(queued.error.code) &&
    !token.minted
  ) {
    const fresh = await resolveInstallToken(deps, true);
    if (fresh.kind === "refused") {
      return { kind: "refused", code: fresh.error.code, message: fresh.error.message };
    }
    if (fresh.kind === "unavailable") {
      return { kind: "unavailable", reason: fresh.reason };
    }
    token = fresh;
    queued = await startScan(scanDepsFor(token.token), url);
  }

  if (queued.kind === "quota_exceeded") {
    return {
      kind: "quota_exceeded",
      message: queued.error.message,
      resetAt: queued.error.resetAt,
      retryAfterSeconds: queued.error.retryAfterSeconds,
    };
  }
  if (queued.kind === "refused") {
    return { kind: "refused", code: queued.error.code, message: queued.error.message };
  }
  if (queued.kind === "unavailable") {
    return { kind: "unavailable", reason: queued.reason };
  }

  const polled = await pollUntilTerminal(
    scanDepsFor(token.token),
    queued.queued.scanId,
    pollDelayMs(queued.queued.pollAfterSeconds),
    maxAttempts,
    sleep,
  );

  if (polled.kind === "refused") {
    return { kind: "refused", code: polled.error.code, message: polled.error.message };
  }
  if (polled.kind === "unavailable") {
    return { kind: "unavailable", reason: polled.reason };
  }
  if (polled.kind === "pending") {
    return {
      kind: "pending",
      scanId: queued.queued.scanId,
      polls: polled.polls,
      quotaRemaining: queued.queued.quotaRemaining,
    };
  }

  return {
    kind: "verdict",
    envelope: polled.envelope,
    quotaRemaining: queued.queued.quotaRemaining,
    polls: polled.polls,
  };
}
