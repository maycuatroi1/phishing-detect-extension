import { API_BASE_URL } from "../config.ts";
import { hostOfUrl } from "../lib/host.ts";
import { createLookupBatcher, type LookupBatcher } from "../lib/lookup-batch.ts";
import { lookupHostTier1, type Tier1Verdict } from "../lib/tier1.ts";
import {
  HARD_WARNING_TEXT,
  REPORT_HINT,
  evaluateTab,
  paintLook,
  softenIfDisputed,
  type BadgeLook,
} from "./tier0.ts";
import type { Tier0Verdict } from "../lib/tier0.ts";

const BADGE_BY_TIER1_VERDICT: Record<Tier1Verdict, BadgeLook> = {
  phishing: {
    text: HARD_WARNING_TEXT,
    color: "#c62828",
    title: `Anti-Fraud: corpus đánh dấu trang này là lừa đảo. ${REPORT_HINT}`,
  },
  legit: {
    text: "OK",
    color: "#2e7d32",
    title: "Anti-Fraud: corpus đánh dấu trang này là hợp lệ",
  },
  unknown: {
    text: "",
    color: "#5a616e",
    title: "Anti-Fraud: corpus có trang này nhưng chưa kết luận",
  },
  absent: {
    text: "",
    color: "#5a616e",
    title: "Anti-Fraud: corpus không có trang này",
  },
  unavailable: {
    text: "",
    color: "#5a616e",
    title: "Anti-Fraud: chưa hỏi được, chưa kết luận cho trang này",
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
  await paintLook(tabId, await softenIfDisputed(host, tier1BadgeLookFor(result.verdict)));
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
