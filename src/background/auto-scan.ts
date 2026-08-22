import { API_BASE_URL } from "../config.ts";
import { runGatedAutoScan, type AutoScanOutcome, type KnownVerdict } from "../lib/auto-scan.ts";
import { hostOfUrl } from "../lib/host.ts";
import {
  DISMISS_HINT,
  MACHINE_UNVERIFIED_TEXT,
  SOFT_REPORT_HINT,
  SOFT_WARNING_TEXT,
  badgeLookFor,
  paintLook,
  userAdjustedLook,
  type BadgeLook,
} from "./tier0.ts";
import { evaluateTabTiered } from "./tier1.ts";

export const AUTO_SCAN_WARNING_LOOK: BadgeLook = {
  text: SOFT_WARNING_TEXT,
  color: badgeLookFor("soft").color,
  title: `Anti-Fraud: trang này chưa có trong danh sách nào, nhưng điểm rủi ro của tên miền đủ cao nên extension đã tự quét sâu, và model nói đây là trang lừa đảo. ${MACHINE_UNVERIFIED_TEXT} Mở popup để xem những tín hiệu nào đã kích hoạt. ${SOFT_REPORT_HINT} ${DISMISS_HINT}`,
};

export function knownVerdictOf(verdict: string): KnownVerdict {
  if (verdict === "phishing" || verdict === "legit" || verdict === "soft") {
    return verdict;
  }
  return "unknown";
}

export async function considerAutoScan(
  tabId: number,
  url: string | undefined,
  verdict: string,
): Promise<AutoScanOutcome | null> {
  const host = hostOfUrl(url);
  if (host === null || url === undefined) {
    return null;
  }

  let outcome: AutoScanOutcome;
  try {
    outcome = await runGatedAutoScan(
      { baseUrl: API_BASE_URL },
      { url, host, verdict: knownVerdictOf(verdict) },
    );
  } catch (cause) {
    console.warn("[auto-scan] lượt tự quét ném lỗi:", String(cause));
    return null;
  }

  if (outcome.kind === "skipped") {
    return outcome;
  }

  console.info(
    "[auto-scan] đã tự quét",
    host,
    "điểm",
    outcome.risk.score,
    "tín hiệu",
    outcome.risk.signals.map((signal) => signal.id).join(","),
    "kết luận is_scam",
    String(outcome.isScam),
  );

  if (outcome.isScam === true) {
    await paintLook(tabId, await userAdjustedLook(host, AUTO_SCAN_WARNING_LOOK));
  }

  return outcome;
}

export async function evaluateTabWithAutoScan(
  tabId: number,
  url: string | undefined,
): Promise<AutoScanOutcome | null> {
  const verdict = await evaluateTabTiered(tabId, url);
  return considerAutoScan(tabId, url, verdict);
}
