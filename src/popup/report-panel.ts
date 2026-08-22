import type { ReportClaim } from "../lib/claim.ts";
import type { StoredDispute } from "../lib/dispute-store.ts";
import type { ReportSoftFlag } from "../lib/report.ts";
import type { Tier0Verdict } from "../lib/tier0.ts";
import type { FileReportOutcome } from "../lib/tier3.ts";
import { resolveWarningLevel, type WarningLevel } from "../lib/warning-level.ts";
import { formatInstant } from "./scan-panel.ts";

export const PHISHING_LABEL = "Báo trang này lừa đảo";

export const FALSE_POSITIVE_LABEL = "Báo cảnh báo nhầm";

export const BUSY_LABEL = "Đang gửi...";

export const CLAIM_IS_NOT_A_LABEL =
  "Một report là lời khai gửi cho moderator, không bao giờ tự thành nhãn của trang.";

export const TURNSTILE_NO_EXTENSION_PAGE =
  "Trang của extension MV3 không nạp được script Turnstile của Cloudflare, nên extension không giải thay bạn được. Chờ hết cửa sổ giới hạn rồi bấm lại.";

export const MACHINE_FLAG_UNVERIFIED =
  "Cảnh báo này do model dựng tự động và chưa có người nào kiểm chứng. Đo trên bộ eval-v1, ngưỡng tự duyệt ấy đúng 0.9675, tức là cứ 100 trang bị đánh dấu thì khoảng 3 trang bị đánh dấu oan.";

export const ONE_REPORT_CLEARS_MACHINE_FLAG = `Vì thế trang như thế này gỡ được không cần người: đúng một lượt ${FALSE_POSITIVE_LABEL} của bạn rút cờ mềm ngay lập tức, cho mọi máy đang cài extension, không phải chỉ cho máy bạn và không phải chờ moderator nào cả.`;

export const HUMAN_CONFIRMED_NEEDS_MODERATOR = `Trang đã được một người xác nhận thì khác hẳn: ${FALSE_POSITIVE_LABEL} ở đó chỉ vào hàng chờ moderator và chỉ hạ cảnh báo trên máy bạn, không gỡ cho ai khác.`;

export type { WarningLevel };

export type ReportModel =
  | { readonly kind: "unsupported" }
  | {
      readonly kind: "ready";
      readonly verdict: Tier0Verdict;
      readonly dispute: StoredDispute | null;
    }
  | { readonly kind: "filing"; readonly claim: ReportClaim }
  | {
      readonly kind: "filed";
      readonly outcome: FileReportOutcome;
      readonly dispute: StoredDispute | null;
    };

export interface ReportPanelView {
  readonly headline: string;
  readonly detail: string;
  readonly phishingLabel: string;
  readonly falsePositiveLabel: string;
  readonly phishingEnabled: boolean;
  readonly falsePositiveEnabled: boolean;
}

export function warningLevel(verdict: Tier0Verdict, dispute: StoredDispute | null): WarningLevel {
  return resolveWarningLevel({ verdict, dispute, dismissal: null });
}

function filedAlready(dispute: StoredDispute | null, claim: ReportClaim): boolean {
  return dispute !== null && dispute.claim === claim;
}

function waited(retryAfterSeconds: number | null): string {
  return retryAfterSeconds === null
    ? "Server không nói phải chờ bao lâu."
    : `Server nói chờ ${retryAfterSeconds} giây rồi bấm lại.`;
}

function gateNote(gate: string | null): string {
  return gate === null
    ? "Server không nói cổng Turnstile đã làm gì."
    : `Cổng Turnstile trả lời ${gate}.`;
}

function softFlagNote(softFlag: ReportSoftFlag | null): string {
  if (softFlag === "withdrawn") {
    return "Server nói soft_flag withdrawn: cờ mềm do máy dựng đã bị rút khỏi trang này cho mọi người, ngay lập tức và không cần moderator.";
  }
  if (softFlag === "unchanged") {
    return "Server nói soft_flag unchanged: không có cờ mềm nào bị rút, vì trang này không mang cờ mềm hoặc đã có một người quyết định về nó.";
  }
  return "Server chưa trả trường soft_flag, nên chưa biết có cờ mềm nào bị rút hay không.";
}

function readyView(verdict: Tier0Verdict, dispute: StoredDispute | null): ReportPanelView {
  const level = warningLevel(verdict, dispute);

  const shell = {
    phishingLabel: PHISHING_LABEL,
    falsePositiveLabel: FALSE_POSITIVE_LABEL,
    phishingEnabled: !filedAlready(dispute, "phishing"),
    falsePositiveEnabled: !filedAlready(dispute, "false_positive"),
  };

  if (level === "disputed" && dispute !== null) {
    return {
      ...shell,
      headline: "Cảnh báo đang ở mức mềm",
      detail: `Bạn đã báo nhầm lúc ${formatInstant(new Date(dispute.filedAt).toISOString())}, mã report ${dispute.reportId}. Extension đã hạ cảnh báo ngay trên máy bạn. ${CLAIM_IS_NOT_A_LABEL} Với trang do máy đánh dấu, lượt báo nhầm ấy đã rút cờ mềm cho mọi người; với trang do người xác nhận, trạng thái trên server chỉ đổi khi một moderator xem lại.`,
    };
  }

  if (level === "machine") {
    return {
      ...shell,
      headline: "Máy đánh dấu trang này, chưa có người kiểm chứng",
      detail: `${MACHINE_FLAG_UNVERIFIED} ${ONE_REPORT_CLEARS_MACHINE_FLAG} ${HUMAN_CONFIRMED_NEEDS_MODERATOR} Đúng một cú bấm, không phải điền gì.`,
    };
  }

  if (level === "hard") {
    return {
      ...shell,
      headline: "Danh sách tải sẵn đang cảnh báo trang này là lừa đảo",
      detail: `Một người đã xem trang này và kết luận, nên đây không phải cờ mềm của máy. Nếu bạn tin đây là cảnh báo nhầm thì bấm ${FALSE_POSITIVE_LABEL}. Đúng một cú bấm, không phải điền gì, và cảnh báo hạ xuống mức mềm ngay trên máy bạn, nhưng chỉ trên máy bạn: ${HUMAN_CONFIRMED_NEEDS_MODERATOR}`,
    };
  }

  if (filedAlready(dispute, "phishing") && dispute !== null) {
    return {
      ...shell,
      headline: "Bạn đã báo trang này lừa đảo",
      detail: `Mã report ${dispute.reportId}, gửi lúc ${formatInstant(new Date(dispute.filedAt).toISOString())}. Extension không tự nâng cảnh báo theo lời khai của chính bạn. ${CLAIM_IS_NOT_A_LABEL}`,
    };
  }

  return {
    ...shell,
    headline: "Danh sách tải sẵn chưa cảnh báo trang này",
    detail: `Bạn vẫn báo được nếu thấy nó lừa đảo, và vẫn báo nhầm được nếu badge đang cảnh báo vì một tier khác. ${CLAIM_IS_NOT_A_LABEL}`,
  };
}

function filedView(outcome: FileReportOutcome, dispute: StoredDispute | null): ReportPanelView {
  const shell = {
    phishingLabel: PHISHING_LABEL,
    falsePositiveLabel: FALSE_POSITIVE_LABEL,
    phishingEnabled: !filedAlready(dispute, "phishing"),
    falsePositiveEnabled: !filedAlready(dispute, "false_positive"),
  };

  if (outcome.kind === "queued") {
    const softened = outcome.softened
      ? "Cảnh báo trên máy bạn đã hạ xuống mức mềm ngay bây giờ."
      : "Extension không tự đổi cảnh báo theo report của bạn.";
    return {
      ...shell,
      headline: outcome.claim === "false_positive" ? "Đã ghi nhận báo nhầm" : "Đã gửi report",
      detail: `Mã report ${outcome.reportId}. Server xếp report vào hàng chờ moderator. ${softened} ${softFlagNote(outcome.softFlag)} ${gateNote(outcome.gate)} ${CLAIM_IS_NOT_A_LABEL}`,
    };
  }

  if (outcome.kind === "turnstile_required") {
    return {
      ...shell,
      headline: "Server đòi giải Turnstile",
      detail: `${outcome.message} ${TURNSTILE_NO_EXTENSION_PAGE}`,
      phishingEnabled: false,
      falsePositiveEnabled: false,
    };
  }

  if (outcome.kind === "turnstile_failed") {
    return {
      ...shell,
      headline: "Turnstile không qua",
      detail: `${outcome.message} ${TURNSTILE_NO_EXTENSION_PAGE}`,
      phishingEnabled: false,
      falsePositiveEnabled: false,
    };
  }

  if (outcome.kind === "turnstile_unavailable") {
    return {
      ...shell,
      headline: "Cloudflare không trả lời",
      detail: `${outcome.message} ${waited(outcome.retryAfterSeconds)} Report chưa vào hàng chờ.`,
    };
  }

  if (outcome.kind === "rate_limited") {
    return {
      ...shell,
      headline: "Đã báo quá nhiều lần",
      detail: `${outcome.message} ${waited(outcome.retryAfterSeconds)} Endpoint này không trả thời điểm mở lại, chỉ trả số giây phải chờ, nên ở đây không hiện thời điểm nào cả.`,
      phishingEnabled: false,
      falsePositiveEnabled: false,
    };
  }

  if (outcome.kind === "refused") {
    return {
      ...shell,
      headline: "Server từ chối report",
      detail: `Mã ${outcome.code}. ${outcome.message}`,
    };
  }

  return {
    ...shell,
    headline: "Chưa gửi được report",
    detail: `${outcome.reason}. Report chưa vào hàng chờ nào cả.`,
  };
}

export function reportPanelView(model: ReportModel): ReportPanelView {
  if (model.kind === "unsupported") {
    return {
      headline: "Tab này không báo được",
      detail: "Chỉ trang http hoặc https mới gửi report được. Tab hiện tại không phải một trang như vậy.",
      phishingLabel: PHISHING_LABEL,
      falsePositiveLabel: FALSE_POSITIVE_LABEL,
      phishingEnabled: false,
      falsePositiveEnabled: false,
    };
  }

  if (model.kind === "filing") {
    return {
      headline: "Đang gửi report",
      detail: `Đang gửi một khai báo ${model.claim} lên server. Nó tốn một lượt trong hạn mức report của bản cài này.`,
      phishingLabel: model.claim === "phishing" ? BUSY_LABEL : PHISHING_LABEL,
      falsePositiveLabel: model.claim === "false_positive" ? BUSY_LABEL : FALSE_POSITIVE_LABEL,
      phishingEnabled: false,
      falsePositiveEnabled: false,
    };
  }

  if (model.kind === "ready") {
    return readyView(model.verdict, model.dispute);
  }

  return filedView(model.outcome, model.dispute);
}
