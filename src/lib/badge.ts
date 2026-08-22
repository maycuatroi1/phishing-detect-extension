import type { Tier0Verdict } from "./tier0.ts";
import type { WarningLevel } from "./warning-level.ts";

export const OK_TEXT = "OK";

export const NG_TEXT = "NG";

export type BadgeText = typeof OK_TEXT | typeof NG_TEXT;

export type BadgeState =
  | "phishing"
  | "soft"
  | "legit"
  | "unknown"
  | "pending"
  | "disputed"
  | "dismissed";

export interface BadgeLook {
  readonly state: BadgeState;
  readonly text: BadgeText;
  readonly color: string;
  readonly title: string;
}

export const PHISHING_COLOR = "#c62828";

export const SOFT_COLOR = "#ef6c00";

export const LEGIT_COLOR = "#2e7d32";

export const UNKNOWN_COLOR = "#546e7a";

export const PENDING_COLOR = "#37474f";

export const DISPUTED_COLOR = "#8d6e00";

export const DISMISSED_COLOR = "#5a616e";

export const MACHINE_UNVERIFIED_TEXT = "Trang này bị máy đánh dấu, chưa có người kiểm chứng.";

export const REPORT_HINT =
  "Nếu đây là cảnh báo nhầm, mở popup và bấm Báo cảnh báo nhầm, đúng một cú bấm.";

export const SOFT_REPORT_HINT =
  "Với cảnh báo do máy dựng, đúng một lượt Báo cảnh báo nhầm trong popup gỡ nó cho mọi người ngay, không cần moderator.";

export const DISMISS_HINT =
  "Trang vẫn mở bình thường, extension không chặn và không chuyển hướng. Muốn im hẳn thì mở popup và bấm Tắt cảnh báo cho trang này.";

export const NO_DATA_NOT_SAFE =
  "Chưa có dữ liệu không có nghĩa là an toàn: danh sách mới có vài nghìn host, phần lớn web thì chưa ai chấm, nên một trang lừa đảo vừa dựng cũng rơi đúng vào ô này.";

export const OK_MEANS_NO_FINDING =
  "Chữ OK ở đây đọc như kết quả của một phép kiểm: phép kiểm không tìm thấy vấn đề, chứ không phải trang đã được ai xem.";

export const BADGE_NEVER_BLANK =
  "Badge luôn hiện OK hoặc NG cho mọi trang, nên badge trống nghĩa là extension đang hỏng chứ không phải trang sạch.";

const BADGE_BY_VERDICT: Record<Tier0Verdict, BadgeLook> = {
  phishing: {
    state: "phishing",
    text: NG_TEXT,
    color: PHISHING_COLOR,
    title: `Anti-Fraud: NG màu đỏ. Trang này nằm trong danh sách lừa đảo đã xác nhận, tức là một người đã xem và kết luận. ${REPORT_HINT} ${DISMISS_HINT}`,
  },
  soft: {
    state: "soft",
    text: NG_TEXT,
    color: SOFT_COLOR,
    title: `Anti-Fraud: NG màu hổ phách. ${MACHINE_UNVERIFIED_TEXT} Nó khác hẳn NG màu đỏ, nơi đã có một người xem và kết luận, và nó sai khoảng 3 lần trên 100. ${SOFT_REPORT_HINT} ${DISMISS_HINT}`,
  },
  legit: {
    state: "legit",
    text: OK_TEXT,
    color: LEGIT_COLOR,
    title:
      "Anti-Fraud: OK màu xanh lá. Trang này nằm trong danh sách hợp lệ đã xác nhận, tức là một người đã xem và kết luận.",
  },
  unknown: {
    state: "unknown",
    text: OK_TEXT,
    color: UNKNOWN_COLOR,
    title: `Anti-Fraud: OK màu xám xanh. Chưa có dữ liệu về trang này. ${NO_DATA_NOT_SAFE} ${OK_MEANS_NO_FINDING} ${BADGE_NEVER_BLANK}`,
  },
  no_artifact: {
    state: "pending",
    text: OK_TEXT,
    color: PENDING_COLOR,
    title: `Anti-Fraud: OK màu xám đậm. Chưa tải được danh sách nên chưa tra được trang này, extension sẽ thử lại. ${OK_MEANS_NO_FINDING} ${BADGE_NEVER_BLANK}`,
  },
};

export const DISPUTED_LOOK: BadgeLook = {
  state: "disputed",
  text: NG_TEXT,
  color: DISPUTED_COLOR,
  title:
    "Anti-Fraud: NG màu vàng sẫm. Bạn đã báo trang này bị cảnh báo nhầm, nên extension đã hạ cảnh báo xuống mức mềm trên máy bạn. Cảnh báo do máy dựng thì một lượt báo nhầm gỡ luôn cho mọi người; cảnh báo do người xác nhận thì phải chờ moderator xem lại.",
};

export const DISMISSED_LOOK: BadgeLook = {
  state: "dismissed",
  text: OK_TEXT,
  color: DISMISSED_COLOR,
  title:
    "Anti-Fraud: OK màu xám. Bạn đã tắt cảnh báo cho trang này, nên badge thôi cảnh báo dù kết luận của server không hề đổi. Mở popup rồi bấm Bật lại cảnh báo nếu muốn nó quay lại, cũng đúng một cú bấm.",
};

export function badgeLookFor(verdict: Tier0Verdict): BadgeLook {
  return BADGE_BY_VERDICT[verdict];
}

export function lookForLevel(verdict: Tier0Verdict, level: WarningLevel): BadgeLook {
  if (level === "dismissed") {
    return DISMISSED_LOOK;
  }
  if (level === "disputed") {
    return DISPUTED_LOOK;
  }
  if (level === "hard") {
    return badgeLookFor("phishing");
  }
  if (level === "machine") {
    return badgeLookFor("soft");
  }
  return badgeLookFor(verdict);
}
