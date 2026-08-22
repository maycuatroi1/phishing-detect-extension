import { AUTO_SCAN_DAILY_CAP, AUTO_SCAN_MEMORY_DAYS } from "../lib/auto-scan.ts";
import type { AutoScanEntry } from "../lib/auto-scan-store.ts";
import type { HostRisk } from "../lib/risk.ts";
import { formatInstant } from "./scan-panel.ts";

export const AUTO_SCAN_OFF_LABEL = "Tắt tự quét trang lạ";

export const AUTO_SCAN_ON_LABEL = "Bật lại tự quét trang lạ";

export const AUTO_SCAN_SAVING_LABEL = "Đang lưu...";

export const AUTO_SCAN_COST_NOTE = `Mỗi lượt tự quét gửi URL đầy đủ của tab lên server. Nếu host đó đã có kết quả trong kho thì server trả lại kết quả cũ và không tiêu lượt nào; chỉ host thật sự mới mới tốn một lượt. Trần là ${AUTO_SCAN_DAILY_CAP} host một ngày, và một host đã quét thì ${AUTO_SCAN_MEMORY_DAYS} ngày sau mới hỏi lại.`;

export const AUTO_SCAN_LOCAL_NOTE =
  "Điểm rủi ro tính hoàn toàn trong máy bạn, chỉ từ tên miền, và không có byte nào của phép tính đó rời khỏi máy. Nó không còn quyết định có quét hay không, chỉ nói cho bạn biết tên miền này trông thế nào.";

export const AUTO_SCAN_NO_GATE_NOTE =
  "Host lạ nào cũng được đẩy lên quét, kể cả host không có một tín hiệu rủi ro nào trong tên miền. Điểm 0 nghĩa là tên miền trông bình thường, không nghĩa là trang an toàn.";

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
    detail: `Tự quét lúc ${when} vì host này chưa có trong dữ liệu. Tên miền đạt ${entry.score} điểm rủi ro, con số đó chỉ để bạn đọc chứ không quyết định có quét hay không. ${verdict} Hôm nay còn ${budgetLeft} lượt tự quét.`,
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
      detail: `Không lượt tự quét nào chạy khi công tắc này tắt, kể cả với host chưa có trong dữ liệu. Tên miền này đang ${model.risk.score} điểm rủi ro. Nút Quét sâu vẫn bấm tay được.`,
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

  return {
    headline: "Host này sẽ được tự quét",
    detail: `Host chưa có trong dữ liệu nên extension đẩy lên quét. Tên miền đạt ${model.risk.score} điểm rủi ro. ${AUTO_SCAN_NO_GATE_NOTE} Hôm nay còn ${model.budgetLeft} lượt. ${AUTO_SCAN_LOCAL_NOTE}`,
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
