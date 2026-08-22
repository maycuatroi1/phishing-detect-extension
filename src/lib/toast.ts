import type { AutoScanOutcome } from "./auto-scan.ts";
import { MACHINE_UNVERIFIED_TEXT, SOFT_REPORT_HINT } from "./badge.ts";

export const TOAST_TIMEOUT_MS = 5_000;

export const TOAST_ID_PREFIX = "anti-fraud-scan";

export const TOAST_TONES = ["scam", "clean", "unreadable"] as const;

export type ToastTone = (typeof TOAST_TONES)[number];

export const TOAST_RATIONALE =
  "Tự quét chạy khi bạn vừa mở một trang lạ, và kết quả tới sau khi bạn đã đọc trang được vài giây. " +
  "Không nói gì cả thì người dùng không biết đã có một lượt quét chạy; bắt họ mở popup để biết thì " +
  "kết quả tới quá muộn để còn kịp dừng tay.";

export const CLEAN_IS_NOT_A_CLEARANCE =
  "Model không thấy dấu hiệu, chưa phải là có người xác nhận trang này hợp lệ.";

export interface ToastNotice {
  readonly id: string;
  readonly tone: ToastTone;
  readonly title: string;
  readonly message: string;
  readonly timeoutMs: number;
}

function noticeId(host: string): string {
  return `${TOAST_ID_PREFIX}:${host}`;
}

function freshness(fromCache: boolean): string {
  return fromCache ? "Kết quả có sẵn từ lượt quét trước." : "Vừa quét xong.";
}

export function toastFor(host: string, outcome: AutoScanOutcome): ToastNotice | null {
  if (outcome.kind === "skipped") {
    return null;
  }

  if (outcome.isScam === true) {
    return {
      id: noticeId(host),
      tone: "scam",
      title: `Cảnh báo: ${host}`,
      message: `${freshness(outcome.fromCache)} Model nói đây là trang lừa đảo. ${MACHINE_UNVERIFIED_TEXT} ${SOFT_REPORT_HINT}`,
      timeoutMs: TOAST_TIMEOUT_MS,
    };
  }

  if (outcome.isScam === false) {
    return {
      id: noticeId(host),
      tone: "clean",
      title: `Đã quét: ${host}`,
      message: `${freshness(outcome.fromCache)} Không thấy dấu hiệu lừa đảo. ${CLEAN_IS_NOT_A_CLEARANCE}`,
      timeoutMs: TOAST_TIMEOUT_MS,
    };
  }

  return {
    id: noticeId(host),
    tone: "unreadable",
    title: `Chưa kết luận được: ${host}`,
    message:
      "Lượt quét chạy xong nhưng không đọc được kết luận nào. Mở popup và bấm Quét sâu trang này để thử lại.",
    timeoutMs: TOAST_TIMEOUT_MS,
  };
}
