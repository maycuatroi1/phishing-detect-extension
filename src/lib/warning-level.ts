import type { StoredDismissal } from "./dismissal-store.ts";
import { softensWarning, type StoredDispute } from "./dispute-store.ts";
import type { Tier0Verdict } from "./tier0.ts";

export const WARNING_LEVELS = ["dismissed", "disputed", "hard", "machine", "none"] as const;

export type WarningLevel = (typeof WARNING_LEVELS)[number];

export type ServerWarningLevel = Extract<WarningLevel, "hard" | "machine" | "none">;

export interface WarningInputs {
  readonly verdict: Tier0Verdict;
  readonly dispute: StoredDispute | null;
  readonly dismissal: StoredDismissal | null;
}

export function serverWarningLevel(verdict: Tier0Verdict): ServerWarningLevel {
  if (verdict === "phishing") {
    return "hard";
  }
  if (verdict === "soft") {
    return "machine";
  }
  return "none";
}

export function resolveWarningLevel(inputs: WarningInputs): WarningLevel {
  const fromServer = serverWarningLevel(inputs.verdict);
  if (fromServer === "none") {
    return "none";
  }
  if (inputs.dismissal !== null) {
    return "dismissed";
  }
  if (softensWarning(inputs.dispute)) {
    return "disputed";
  }
  return fromServer;
}
