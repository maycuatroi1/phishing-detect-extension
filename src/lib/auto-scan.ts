import {
  dayKeyOf,
  pruneAutoScanDaysBefore,
  readAutoScanDay,
  readAutoScanEnabled,
  reserveAutoScanSlot,
  settleAutoScanSlot,
  type AutoScanDay,
} from "./auto-scan-store.ts";
import { isHighRisk, scoreHost, type HostRisk } from "./risk.ts";
import { isScannableUrl } from "./scan.ts";
import { runManualScan, type ManualScanOutcome, type Tier2Deps } from "./tier2.ts";

export const PRODUCTION_SCAN_QUOTA_PER_DAY = 20;

export const AUTO_SCAN_DAILY_CAP = 6;

export const AUTO_SCAN_SKIP_REASONS = [
  "disabled",
  "not_scannable",
  "host_exempt",
  "verdict_known",
  "below_threshold",
  "already_scanned_today",
  "budget_spent",
] as const;

export type AutoScanSkipReason = (typeof AUTO_SCAN_SKIP_REASONS)[number];

export type KnownVerdict = "phishing" | "legit" | "unknown";

export interface AutoScanContext {
  readonly url: string;
  readonly host: string;
  readonly verdict: KnownVerdict;
  readonly enabled: boolean;
  readonly risk: HostRisk;
  readonly day: AutoScanDay;
}

export type AutoScanDecision =
  | { readonly kind: "scan"; readonly risk: HostRisk; readonly budgetLeft: number }
  | { readonly kind: "skip"; readonly reason: AutoScanSkipReason; readonly risk: HostRisk };

export type AutoScanOutcome =
  | { readonly kind: "skipped"; readonly reason: AutoScanSkipReason; readonly risk: HostRisk }
  | {
      readonly kind: "scanned";
      readonly risk: HostRisk;
      readonly outcome: ManualScanOutcome;
      readonly isScam: boolean | null;
    };

export interface AutoScanDeps extends Tier2Deps {
  readonly now?: () => number;
}

export interface AutoScanInput {
  readonly url: string;
  readonly host: string;
  readonly verdict: KnownVerdict;
}

export function budgetLeftOf(day: AutoScanDay): number {
  return Math.max(AUTO_SCAN_DAILY_CAP - day.entries.length, 0);
}

export function alreadyScannedToday(day: AutoScanDay, host: string): boolean {
  return day.entries.some((entry) => entry.host === host);
}

export function decideAutoScan(context: AutoScanContext): AutoScanDecision {
  const risk = context.risk;

  if (!context.enabled) {
    return { kind: "skip", reason: "disabled", risk };
  }
  if (!isScannableUrl(context.url)) {
    return { kind: "skip", reason: "not_scannable", risk };
  }
  if (risk.exempt) {
    return { kind: "skip", reason: "host_exempt", risk };
  }
  if (context.verdict === "legit" || context.verdict === "phishing") {
    return { kind: "skip", reason: "verdict_known", risk };
  }
  if (!isHighRisk(risk)) {
    return { kind: "skip", reason: "below_threshold", risk };
  }
  if (alreadyScannedToday(context.day, context.host)) {
    return { kind: "skip", reason: "already_scanned_today", risk };
  }
  const budgetLeft = budgetLeftOf(context.day);
  if (budgetLeft <= 0) {
    return { kind: "skip", reason: "budget_spent", risk };
  }

  return { kind: "scan", risk, budgetLeft };
}

export function verdictIsScam(outcome: ManualScanOutcome): boolean | null {
  if (outcome.kind !== "verdict") {
    return null;
  }
  const envelope = outcome.envelope;
  if (envelope.status !== "done" || envelope.parse_ok !== true) {
    return null;
  }
  return envelope.is_scam;
}

let gate: Promise<unknown> = Promise.resolve();

export function resetAutoScanGate(): void {
  gate = Promise.resolve();
}

async function gatedRun(
  deps: AutoScanDeps,
  input: AutoScanInput,
): Promise<AutoScanOutcome> {
  const now = deps.now ?? Date.now;
  const risk = scoreHost(input.host);
  const day = dayKeyOf(now());

  const context: AutoScanContext = {
    url: input.url,
    host: risk.host,
    verdict: input.verdict,
    enabled: await readAutoScanEnabled(),
    risk,
    day: await readAutoScanDay(day),
  };

  const decision = decideAutoScan(context);
  if (decision.kind === "skip") {
    return { kind: "skipped", reason: decision.reason, risk };
  }

  await reserveAutoScanSlot(day, {
    host: context.host,
    scannedAt: now(),
    score: risk.score,
    isScam: null,
  });
  await pruneAutoScanDaysBefore(day);

  const outcome = await runManualScan(deps, input.url);
  const isScam = verdictIsScam(outcome);
  await settleAutoScanSlot(day, context.host, isScam);

  return { kind: "scanned", risk, outcome, isScam };
}

export function runGatedAutoScan(
  deps: AutoScanDeps,
  input: AutoScanInput,
): Promise<AutoScanOutcome> {
  const next = gate.then(
    () => gatedRun(deps, input),
    () => gatedRun(deps, input),
  );
  gate = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}
