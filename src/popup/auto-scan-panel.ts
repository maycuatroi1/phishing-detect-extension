import { AUTO_SCAN_DAILY_CAP } from "../lib/auto-scan.ts";
import type { AutoScanEntry } from "../lib/auto-scan-store.ts";
import { RISK_THRESHOLD, isHighRisk, type HostRisk } from "../lib/risk.ts";
import { formatInstant } from "./scan-panel.ts";

export const AUTO_SCAN_OFF_LABEL = "Tắt tự quét trang lạ";

export const AUTO_SCAN_ON_LABEL = "Bật lại tự quét trang lạ";

export const AUTO_SCAN_SAVING_LABEL = "Đang lưu...";

export const AUTO_SCAN_COST_NOTE = `Mỗi lượt tự quét gửi URL đầy đủ của tab lên server và tiêu một lượt trong hạn mức, nên extension chỉ tự quét tối đa ${AUTO_SCAN_DAILY_CAP} trang một ngày và không bao giờ quét lại cùng một trang trong ngày đó.`;

export const AUTO_SCAN_LOCAL_NOTE =
  "Điểm rủi ro tính hoàn toàn trong máy bạn, chỉ từ tên miền, và không có byte nào của phép tính đó rời khỏi máy.";

export type AutoScanModel =
  | { readonly kind: "unsupported" }
  | {
      readonly kind: "ready";
      readonly enabled: boolean;
      readonly risk: HostRisk;
      readonly entry: AutoScanEntry | null;
      readonly budgetLeft: number;
    }
  | { readonly kind: "saving"; readonly turningOff: boolean };

export interface AutoScanPanelView {
  readonly headline: string;
  readonly detail: string;
  readonly reasons: readonly string[];
  readonly buttonLabel: string;
  readonly buttonEnabled: boolean;
}

export function reasonsOf(risk: HostRisk): readonly string[] {
  if (risk.exempt) {
    return risk.exemptReason === null ? [] : [risk.exemptReason];
  }
  return risk.signals.map((signal) => `${signal.note} (+${signal.weight})`);
}

function scannedView(risk: HostRisk, entry: AutoScanEntry, budgetLeft: number): AutoScanPanelView {
  const when = formatInstant(new Date(entry.scannedAt).toISOString());
  const verdict =
    entry.isScam === true
      ? "Model nói đây là trang lừa đảo."
      : entry.isScam === false
        ? "Model không thấy dấu hiệu lừa đảo, nhưng đó là một phiếu chưa hiệu chuẩn chứ không phải giấy chứng nhận sạch."
        : "Lượt quét đó chưa cho kết luận nào.";

  return {
    headline: "Extension đã tự quét trang này",
    detail: `Tự quét lúc ${when} vì tên miền đạt ${entry.score} điểm rủi ro, từ ngưỡng ${RISK_THRESHOLD} trở lên là quét. ${verdict} Hôm nay còn ${budgetLeft} lượt tự quét.`,
    reasons: reasonsOf(risk),
    buttonLabel: AUTO_SCAN_OFF_LABEL,
    buttonEnabled: true,
  };
}

function readyView(model: Extract<AutoScanModel, { kind: "ready" }>): AutoScanPanelView {
  if (model.entry !== null) {
    return scannedView(model.risk, model.entry, model.budgetLeft);
  }

  if (!model.enabled) {
    return {
      headline: "Tự quét trang lạ đang tắt",
      detail: `Không lượt tự quét nào chạy khi công tắc này tắt, kể cả với trang điểm rủi ro cao. Tên miền này đang ${model.risk.score} điểm, ngưỡng là ${RISK_THRESHOLD}. Nút Quét sâu vẫn bấm tay được.`,
      reasons: reasonsOf(model.risk),
      buttonLabel: AUTO_SCAN_ON_LABEL,
      buttonEnabled: true,
    };
  }

  if (model.risk.exempt) {
    return {
      headline: "Trang này không nằm trong diện tự quét",
      detail: `Extension không bao giờ tiêu một lượt tự quét cho host kiểu này. ${AUTO_SCAN_LOCAL_NOTE}`,
      reasons: reasonsOf(model.risk),
      buttonLabel: AUTO_SCAN_OFF_LABEL,
      buttonEnabled: true,
    };
  }

  if (isHighRisk(model.risk)) {
    return {
      headline: "Tên miền này đủ điểm để tự quét",
      detail: `Tên miền đạt ${model.risk.score} điểm rủi ro, ngưỡng là ${RISK_THRESHOLD}. Hôm nay còn ${model.budgetLeft} lượt tự quét. ${AUTO_SCAN_LOCAL_NOTE}`,
      reasons: reasonsOf(model.risk),
      buttonLabel: AUTO_SCAN_OFF_LABEL,
      buttonEnabled: true,
    };
  }

  return {
    headline: "Tên miền này dưới ngưỡng tự quét",
    detail: `Tên miền chỉ đạt ${model.risk.score} điểm rủi ro, dưới ngưỡng ${RISK_THRESHOLD}, nên extension không tự quét nó. ${AUTO_SCAN_COST_NOTE}`,
    reasons: reasonsOf(model.risk),
    buttonLabel: AUTO_SCAN_OFF_LABEL,
    buttonEnabled: true,
  };
}

export function autoScanPanelView(model: AutoScanModel): AutoScanPanelView {
  if (model.kind === "unsupported") {
    return {
      headline: "Tab này không nằm trong diện tự quét",
      detail: `Chỉ trang http hoặc https mới được chấm điểm và mới có thể bị tự quét. ${AUTO_SCAN_COST_NOTE}`,
      reasons: [],
      buttonLabel: AUTO_SCAN_OFF_LABEL,
      buttonEnabled: false,
    };
  }

  if (model.kind === "saving") {
    return {
      headline: model.turningOff ? "Đang tắt tự quét" : "Đang bật lại tự quét",
      detail: "Công tắc này chỉ nằm trong máy bạn, không gửi đi đâu.",
      reasons: [],
      buttonLabel: AUTO_SCAN_SAVING_LABEL,
      buttonEnabled: false,
    };
  }

  return readyView(model);
}
