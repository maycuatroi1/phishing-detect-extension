import {
  NO_DATA_NOT_SAFE,
  OK_MEANS_NO_FINDING,
  OK_TEXT,
  UNKNOWN_COLOR,
  lookForLevel,
  type BadgeLook,
  type BadgeState,
} from "../lib/badge.ts";
import type { Tier0Verdict } from "../lib/tier0.ts";
import type { WarningLevel } from "../lib/warning-level.ts";

export const COLOR_NAME: Record<BadgeState, string> = {
  phishing: "đỏ",
  soft: "hổ phách",
  legit: "xanh lá",
  unknown: "xám xanh",
  pending: "xám đậm",
  disputed: "vàng sẫm",
  dismissed: "xám",
};

export const STATE_NAME: Record<Tier0Verdict, string> = {
  phishing: "lừa đảo, đã có người xác nhận",
  soft: "máy đánh dấu, chưa có người kiểm chứng",
  legit: "hợp lệ, đã có người xác nhận",
  unknown: "chưa có dữ liệu",
  no_artifact: "chưa tra được vì chưa tải được danh sách",
};

export const STATE_MEANING: Record<Tier0Verdict, string> = {
  phishing:
    "Một người đã xem trang này và kết luận nó lừa đảo, nên đây không phải cờ mềm do máy dựng.",
  soft: "Model đánh dấu trang này và chưa có người nào kiểm chứng. Ngưỡng tự duyệt là 0.9675, tức cứ 100 trang bị đánh dấu thì khoảng 3 trang bị đánh dấu oan.",
  legit: "Một người đã xem trang này và kết luận nó hợp lệ.",
  unknown: `Danh sách không có dòng nào về trang này. ${NO_DATA_NOT_SAFE} ${OK_MEANS_NO_FINDING}`,
  no_artifact: `Chưa tải được danh sách nên tier 0 chưa tra được trang này. ${OK_MEANS_NO_FINDING}`,
};

export type StatusModel =
  | { readonly kind: "unsupported" }
  | {
      readonly kind: "ready";
      readonly verdict: Tier0Verdict;
      readonly level: WarningLevel;
    };

export interface StatusPanelView {
  readonly badge: string;
  readonly color: string;
  readonly headline: string;
  readonly detail: string;
}

function headlineFor(look: BadgeLook, verdict: Tier0Verdict): string {
  const badge = `Badge ${look.text} màu ${COLOR_NAME[look.state]}`;
  if (look.state === "dismissed") {
    return `${badge}: bạn đã tắt cảnh báo cho trang này`;
  }
  if (look.state === "disputed") {
    return `${badge}: bạn đã báo nhầm nên cảnh báo hạ xuống mức mềm`;
  }
  return `${badge}: ${STATE_NAME[verdict]}`;
}

function detailFor(look: BadgeLook, verdict: Tier0Verdict): string {
  const origin = `Trạng thái gốc của trang này là ${STATE_NAME[verdict]}. ${STATE_MEANING[verdict]}`;
  if (look.state === "dismissed") {
    return `Badge thôi cảnh báo vì chính bạn đã tắt, kết luận của server không hề đổi. ${origin}`;
  }
  if (look.state === "disputed") {
    return `Lượt báo nhầm của bạn đã hạ cảnh báo xuống mức mềm ngay trên máy này. ${origin}`;
  }
  return origin;
}

export function statusPanelView(model: StatusModel): StatusPanelView {
  if (model.kind === "unsupported") {
    return {
      badge: OK_TEXT,
      color: UNKNOWN_COLOR,
      headline: `Badge ${OK_TEXT} màu ${COLOR_NAME.unknown}: tab này không phải trang http hay https`,
      detail: `Chỉ trang http hoặc https mới được tra, nên extension không có kết luận nào cho tab này. ${OK_MEANS_NO_FINDING}`,
    };
  }

  const look = lookForLevel(model.verdict, model.level);
  return {
    badge: look.text,
    color: look.color,
    headline: headlineFor(look, model.verdict),
    detail: detailFor(look, model.verdict),
  };
}
