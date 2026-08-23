import { API_BASE_URL } from "../config.ts";
import {
  AUTO_SCAN_DAILY_CAP,
  runGatedAutoScan,
  type AutoScanOutcome,
  type KnownVerdict,
} from "../lib/auto-scan.ts";
import { hostOfUrl } from "../lib/host.ts";
import {
  DISMISS_HINT,
  MACHINE_UNVERIFIED_TEXT,
  NG_TEXT,
  NO_DATA_NOT_SAFE,
  OK_MEANS_NOTHING_RAN,
  OK_TEXT,
  PENDING_COLOR,
  SOFT_COLOR,
  SOFT_REPORT_HINT,
  type BadgeLook,
} from "../lib/badge.ts";
import { announceAutoScan } from "./toast.ts";
import { paintLook, userAdjustedLook } from "./tier0.ts";
import { evaluateTabTiered } from "./tier1.ts";

export const AUTO_SCAN_WARNING_LOOK: BadgeLook = {
  state: "soft",
  text: NG_TEXT,
  color: SOFT_COLOR,
  title: `Anti-Fraud: NG màu hổ phách. Trang này chưa có trong danh sách nào, nên extension đã tự đẩy lên server quét sâu, và model nói đây là trang lừa đảo. ${MACHINE_UNVERIFIED_TEXT} Mở popup để xem những tín hiệu nào đã kích hoạt. ${SOFT_REPORT_HINT} ${DISMISS_HINT}`,
};

export const UNCHECKED_IS_NOT_CLEAN =
  "Mọi domain lạ đều phải được đẩy qua model, nên lượt nào không đi được là một trang chưa ai " +
  "nhìn tới. Để badge nằm nguyên ở OK màu xám xanh sẽ nói rằng một phép kiểm đã chạy và không " +
  "thấy gì, mà ở đây thì không có phép kiểm nào chạy cả. Màu xám đậm là màu extension đã dùng " +
  "sẵn cho 'chưa tra được', nên dùng lại đúng nó.";

export const BUDGET_SPENT_REASON =
  `Trang này chưa có trong danh sách nào, và extension đã dùng hết ${AUTO_SCAN_DAILY_CAP} lượt tự ` +
  "quét của hôm nay nên chưa đẩy nó lên server được. Mở popup rồi bấm quét tay nếu cần kết luận ngay.";

export const ATTEMPT_FAILED_REASON =
  "Trang này chưa có trong danh sách nào. Extension đã thử đẩy nó lên server quét hôm nay nhưng " +
  "không nhận được kết luận nào, và sẽ thử lại vào ngày mai chứ không thử liên tục để khỏi ăn hết " +
  "ngân sách quét của bạn.";

export const NO_VERDICT_REASON =
  "Trang này chưa có trong danh sách nào. Extension đã đẩy nó lên server quét, nhưng server chưa " +
  "trả về một kết luận đọc được, nên vẫn chưa có phép kiểm nào xong trên trang này.";

export function autoScanUncheckedLook(reason: string): BadgeLook {
  return {
    state: "pending",
    text: OK_TEXT,
    color: PENDING_COLOR,
    title: `Anti-Fraud: OK màu xám đậm. ${reason} ${OK_MEANS_NOTHING_RAN} ${NO_DATA_NOT_SAFE}`,
  };
}

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
    const unchecked =
      outcome.reason === "budget_spent"
        ? BUDGET_SPENT_REASON
        : outcome.reason === "attempt_failed_today"
          ? ATTEMPT_FAILED_REASON
          : null;
    if (unchecked !== null) {
      await paintLook(tabId, await userAdjustedLook(host, autoScanUncheckedLook(unchecked)));
    }
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
  } else if (outcome.isScam === null) {
    await paintLook(tabId, await userAdjustedLook(host, autoScanUncheckedLook(NO_VERDICT_REASON)));
  }

  await announceAutoScan(host, outcome);

  return outcome;
}

export async function evaluateTabWithAutoScan(
  tabId: number,
  url: string | undefined,
): Promise<AutoScanOutcome | null> {
  const verdict = await evaluateTabTiered(tabId, url);
  return considerAutoScan(tabId, url, verdict);
}
