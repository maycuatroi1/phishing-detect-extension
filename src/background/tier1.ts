import { API_BASE_URL } from "../config.ts";
import { hostOfUrl } from "../lib/host.ts";
import { createLookupBatcher, type LookupBatcher } from "../lib/lookup-batch.ts";
import { lookupHostTier1, type Tier1Verdict } from "../lib/tier1.ts";
import {
  DISMISS_HINT,
  LEGIT_COLOR,
  NG_TEXT,
  NO_DATA_NOT_SAFE,
  OK_MEANS_NO_FINDING,
  OK_TEXT,
  PENDING_COLOR,
  PHISHING_COLOR,
  REPORT_HINT,
  UNKNOWN_COLOR,
  type BadgeLook,
} from "../lib/badge.ts";
import { evaluateTab, paintLook, userAdjustedLook } from "./tier0.ts";
import type { Tier0Verdict } from "../lib/tier0.ts";

const BADGE_BY_TIER1_VERDICT: Record<Tier1Verdict, BadgeLook> = {
  phishing: {
    state: "phishing",
    text: NG_TEXT,
    color: PHISHING_COLOR,
    title: `Anti-Fraud: NG màu đỏ. Corpus đánh dấu trang này là lừa đảo. ${REPORT_HINT} ${DISMISS_HINT}`,
  },
  legit: {
    state: "legit",
    text: OK_TEXT,
    color: LEGIT_COLOR,
    title: "Anti-Fraud: OK màu xanh lá. Corpus đánh dấu trang này là hợp lệ.",
  },
  unknown: {
    state: "unknown",
    text: OK_TEXT,
    color: UNKNOWN_COLOR,
    title: `Anti-Fraud: OK màu xám xanh. Corpus có trang này nhưng chưa kết luận. ${NO_DATA_NOT_SAFE} ${OK_MEANS_NO_FINDING}`,
  },
  absent: {
    state: "unknown",
    text: OK_TEXT,
    color: UNKNOWN_COLOR,
    title: `Anti-Fraud: OK màu xám xanh. Corpus không có trang này. ${NO_DATA_NOT_SAFE} ${OK_MEANS_NO_FINDING}`,
  },
  unavailable: {
    state: "pending",
    text: OK_TEXT,
    color: PENDING_COLOR,
    title: `Anti-Fraud: OK màu xám đậm. Chưa hỏi được server nên chưa kết luận cho trang này. ${OK_MEANS_NO_FINDING}`,
  },
};

export function tier1BadgeLookFor(verdict: Tier1Verdict): BadgeLook {
  return BADGE_BY_TIER1_VERDICT[verdict];
}

export function tier0AsksTier1(verdict: Tier0Verdict): boolean {
  return verdict === "unknown" || verdict === "no_artifact";
}

let shared: LookupBatcher | null = null;

export function tier1Batcher(): LookupBatcher {
  if (shared === null) {
    shared = createLookupBatcher({
      baseUrl: API_BASE_URL,
      random: () => Math.random(),
    });
  }
  return shared;
}

export function useLookupBatcher(batcher: LookupBatcher | null): void {
  shared = batcher;
}

export async function escalateTab(tabId: number, host: string): Promise<Tier1Verdict> {
  const result = await lookupHostTier1(host, tier1Batcher());
  await paintLook(tabId, await userAdjustedLook(host, tier1BadgeLookFor(result.verdict)));
  return result.verdict;
}

export async function evaluateTabTiered(
  tabId: number,
  url: string | undefined,
): Promise<Tier0Verdict | Tier1Verdict> {
  const local = await evaluateTab(tabId, url);
  if (!tier0AsksTier1(local)) {
    return local;
  }

  const host = hostOfUrl(url);
  if (host === null) {
    return local;
  }

  return escalateTab(tabId, host);
}
