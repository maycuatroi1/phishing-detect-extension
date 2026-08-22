import type { StoredDismissal } from "../lib/dismissal-store.ts";
import { formatInstant } from "./scan-panel.ts";
import type { WarningLevel } from "./report-panel.ts";

export const DISMISS_LABEL = "Tắt cảnh báo cho trang này";

export const RESTORE_LABEL = "Bật lại cảnh báo";

export const SAVING_LABEL = "Đang lưu...";

export const NEVER_BLOCKS =
  "Extension chỉ cảnh báo. Nó không chặn trang, không chuyển hướng bạn đi đâu, không chèn trang khoá lên trên. Trang bạn đang mở vẫn mở nguyên như thế.";

export const ONE_CLICK_OFF =
  "Tắt cảnh báo là đúng một cú bấm, không hộp thoại xác nhận, không ô nhập lý do, và bấm lại là bật lại được.";

export const STAYS_LOCAL =
  "Việc tắt này chỉ nằm trong máy bạn, không gửi đi đâu và không đổi kết luận của server.";

export type WarningModel =
  | { readonly kind: "unsupported" }
  | {
      readonly kind: "ready";
      readonly level: WarningLevel;
      readonly dismissal: StoredDismissal | null;
    }
  | { readonly kind: "saving"; readonly turningOff: boolean };

export interface WarningPanelView {
  readonly headline: string;
  readonly detail: string;
  readonly buttonLabel: string;
  readonly buttonEnabled: boolean;
  readonly warningVisible: boolean;
}

function readyView(level: WarningLevel, dismissal: StoredDismissal | null): WarningPanelView {
  if (dismissal !== null) {
    return {
      headline: "Cảnh báo đang tắt cho trang này",
      detail: `Bạn tắt lúc ${formatInstant(new Date(dismissal.dismissedAt).toISOString())}. Badge im, không có cảnh báo nào hiện lên nữa. ${STAYS_LOCAL} Bấm ${RESTORE_LABEL} là nó quay lại ngay.`,
      buttonLabel: RESTORE_LABEL,
      buttonEnabled: true,
      warningVisible: false,
    };
  }

  if (level === "hard") {
    return {
      headline: "Đang cảnh báo trang này",
      detail: `${NEVER_BLOCKS} ${ONE_CLICK_OFF}`,
      buttonLabel: DISMISS_LABEL,
      buttonEnabled: true,
      warningVisible: true,
    };
  }

  if (level === "soft") {
    return {
      headline: "Cảnh báo đang ở mức mềm, vẫn tắt hẳn được",
      detail: `Báo nhầm đã hạ cảnh báo xuống mức mềm. Nếu vẫn thấy phiền thì tắt hẳn. ${ONE_CLICK_OFF} ${STAYS_LOCAL}`,
      buttonLabel: DISMISS_LABEL,
      buttonEnabled: true,
      warningVisible: true,
    };
  }

  return {
    headline: "Không có cảnh báo nào đang bật cho trang này",
    detail: `${NEVER_BLOCKS} Bạn vẫn tắt trước được cho trang này nếu không muốn tier nào cảnh báo nó về sau. ${STAYS_LOCAL}`,
    buttonLabel: DISMISS_LABEL,
    buttonEnabled: true,
    warningVisible: false,
  };
}

export function warningPanelView(model: WarningModel): WarningPanelView {
  if (model.kind === "unsupported") {
    return {
      headline: "Tab này không có cảnh báo nào",
      detail: `Chỉ trang http hoặc https mới được tra và mới có cảnh báo để tắt. ${NEVER_BLOCKS}`,
      buttonLabel: DISMISS_LABEL,
      buttonEnabled: false,
      warningVisible: false,
    };
  }

  if (model.kind === "saving") {
    return {
      headline: model.turningOff ? "Đang tắt cảnh báo" : "Đang bật lại cảnh báo",
      detail: `${STAYS_LOCAL} Chỉ mất một lần ghi vào kho cục bộ.`,
      buttonLabel: SAVING_LABEL,
      buttonEnabled: false,
      warningVisible: !model.turningOff,
    };
  }

  return readyView(model.level, model.dismissal);
}
