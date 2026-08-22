import type { ApiErrorCode } from "./api-error.ts";
import { SOFTENING_CLAIM, type ReportClaim } from "./claim.ts";
import { writeDispute, type StoredDispute } from "./dispute-store.ts";
import { hostOfUrl } from "./host.ts";
import { isReportableUrl, submitReport, type ReportInput, type TurnstileGate } from "./report.ts";
import { TOKEN_REFUSAL_CODES, resolveInstallToken } from "./tier2.ts";
import type { StoredInstallToken } from "./token-store.ts";

export interface Tier3Deps {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  readonly readToken?: () => Promise<StoredInstallToken | null>;
  readonly writeToken?: (record: Omit<StoredInstallToken, "key">) => Promise<void>;
  readonly writeDisputeImpl?: (record: StoredDispute) => Promise<void>;
  readonly signal?: AbortSignal;
}

export type FileReportOutcome =
  | {
      readonly kind: "queued";
      readonly reportId: string;
      readonly gate: TurnstileGate | null;
      readonly claim: ReportClaim;
      readonly softened: boolean;
    }
  | { readonly kind: "turnstile_required"; readonly message: string }
  | { readonly kind: "turnstile_failed"; readonly message: string }
  | {
      readonly kind: "turnstile_unavailable";
      readonly message: string;
      readonly retryAfterSeconds: number | null;
    }
  | {
      readonly kind: "rate_limited";
      readonly message: string;
      readonly retryAfterSeconds: number | null;
    }
  | { readonly kind: "refused"; readonly code: ApiErrorCode; readonly message: string }
  | { readonly kind: "unavailable"; readonly reason: string };

async function rememberDispute(
  deps: Tier3Deps,
  input: ReportInput,
  reportId: string,
): Promise<boolean> {
  const host = hostOfUrl(input.url);
  if (host === null) {
    return false;
  }

  const write = deps.writeDisputeImpl ?? writeDispute;
  const now = deps.now ?? Date.now;

  try {
    await write({ host, claim: input.claim, reportId, filedAt: now() });
  } catch {
    return false;
  }

  return input.claim === SOFTENING_CLAIM;
}

export async function fileReport(
  deps: Tier3Deps,
  input: ReportInput,
): Promise<FileReportOutcome> {
  if (!isReportableUrl(input.url)) {
    return {
      kind: "unavailable",
      reason: "URL của tab hiện tại không phải http hoặc https báo được, nên không request nào đi ra",
    };
  }

  let token = await resolveInstallToken(deps);
  if (token.kind === "refused") {
    return { kind: "refused", code: token.error.code, message: token.error.message };
  }
  if (token.kind === "unavailable") {
    return { kind: "unavailable", reason: token.reason };
  }

  const reportDepsFor = (value: string) => ({
    baseUrl: deps.baseUrl,
    token: value,
    fetchImpl: deps.fetchImpl,
    signal: deps.signal,
  });

  let outcome = await submitReport(reportDepsFor(token.token), input);

  if (
    outcome.kind === "refused" &&
    TOKEN_REFUSAL_CODES.includes(outcome.error.code) &&
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
    outcome = await submitReport(reportDepsFor(token.token), input);
  }

  if (outcome.kind === "turnstile_required") {
    return { kind: "turnstile_required", message: outcome.error.message };
  }
  if (outcome.kind === "turnstile_failed") {
    return { kind: "turnstile_failed", message: outcome.error.message };
  }
  if (outcome.kind === "turnstile_unavailable") {
    return {
      kind: "turnstile_unavailable",
      message: outcome.error.message,
      retryAfterSeconds: outcome.error.retryAfterSeconds,
    };
  }
  if (outcome.kind === "rate_limited") {
    return {
      kind: "rate_limited",
      message: outcome.error.message,
      retryAfterSeconds: outcome.error.retryAfterSeconds,
    };
  }
  if (outcome.kind === "refused") {
    return { kind: "refused", code: outcome.error.code, message: outcome.error.message };
  }
  if (outcome.kind === "unavailable") {
    return { kind: "unavailable", reason: outcome.reason };
  }

  const softened = await rememberDispute(deps, input, outcome.queued.reportId);

  return {
    kind: "queued",
    reportId: outcome.queued.reportId,
    gate: outcome.queued.gate,
    claim: input.claim,
    softened,
  };
}
