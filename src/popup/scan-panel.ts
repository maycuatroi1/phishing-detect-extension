import { hasVerdict, type VerdictEnvelope } from "../lib/scan.ts";
import type { ManualScanOutcome } from "../lib/tier2.ts";

export type PanelModel =
  | { readonly kind: "idle"; readonly url: string | null }
  | { readonly kind: "scanning"; readonly url: string }
  | { readonly kind: "result"; readonly url: string; readonly outcome: ManualScanOutcome };

export interface PanelView {
  readonly headline: string;
  readonly detail: string;
  readonly resetAt: string | null;
  readonly scanEnabled: boolean;
  readonly buttonLabel: string;
}

export const SCAN_BUTTON_LABEL = "Quét sâu trang này";

export const SCAN_BUTTON_BUSY_LABEL = "Đang quét...";

export const IDLE_DETAIL =
  "Quét sâu gửi URL đầy đủ của tab này lên server và luôn tốn một lượt trong hạn mức, kể cả khi host đã có kết quả cũ. Đó là khác biệt với lượt tự quét: tự quét nhận lại kết quả cũ nếu có, còn nút này bắt server nhìn lại trang ngay bây giờ.";

export const CACHED_HEADLINE = "Đã có kết quả sẵn";

export function ageInWords(seconds: number): string {
  if (seconds < 60) {
    return `${seconds} giây trước`;
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)} phút trước`;
  }
  if (seconds < 86_400) {
    return `${Math.floor(seconds / 3600)} giờ trước`;
  }
  return `${Math.floor(seconds / 86_400)} ngày trước`;
}

export function formatInstant(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) {
    return iso;
  }
  return `${at.toLocaleString("vi-VN", { hour12: false })} (${iso})`;
}

function confidenceNote(envelope: VerdictEnvelope): string {
  if (envelope.confidence_basis === "uncalibrated_single_vote") {
    return "Đây là một phiếu boolean chưa hiệu chuẩn của một model, không phải xác suất đo được. Đọc như lưu ý mềm, không phải kết luận.";
  }
  if (envelope.confidence_basis === "corpus_label") {
    return "Kết luận này đến từ nhãn trong corpus.";
  }
  if (envelope.confidence_basis === "moderator_decision") {
    return "Kết luận này đến từ quyết định của moderator.";
  }
  return "Lần quét này không kèm cơ sở tin cậy nào.";
}

function verdictView(outcome: Extract<ManualScanOutcome, { kind: "verdict" }>): PanelView {
  const envelope = outcome.envelope;

  if (envelope.status === "failed") {
    return {
      headline: "Quét thất bại",
      detail: `Server dừng lần quét này với mã ${envelope.failure ?? "không rõ"}. Không có kết luận nào cho trang này. Còn ${outcome.quotaRemaining} lượt.`,
      resetAt: null,
      scanEnabled: true,
      buttonLabel: SCAN_BUTTON_LABEL,
    };
  }

  if (!hasVerdict(envelope)) {
    return {
      headline: "Không có kết luận",
      detail: `Lần quét xong nhưng phản hồi của model không parse được (${envelope.parse_failure_reason ?? "không rõ"}), nên không có kết luận. Còn ${outcome.quotaRemaining} lượt.`,
      resetAt: null,
      scanEnabled: true,
      buttonLabel: SCAN_BUTTON_LABEL,
    };
  }

  const headline = envelope.is_scam === true ? "Model nói: lừa đảo" : "Model nói: không thấy dấu hiệu lừa đảo";

  return {
    headline,
    detail: `${confidenceNote(envelope)} Model ${envelope.model}, prompt ${envelope.prompt_version}, xong lúc ${envelope.checked_at === null ? "không rõ" : formatInstant(envelope.checked_at)}. Còn ${outcome.quotaRemaining} lượt.`,
    resetAt: null,
    scanEnabled: true,
    buttonLabel: SCAN_BUTTON_LABEL,
  };
}

function quotaView(outcome: Extract<ManualScanOutcome, { kind: "quota_exceeded" }>): PanelView {
  if (outcome.resetAt !== null) {
    return {
      headline: "Hết lượt quét",
      detail: `Bản cài này đã dùng hết hạn mức quét. Hạn mức mở lại lúc ${formatInstant(outcome.resetAt)}. Extension không tự thử lại; bấm lại sau thời điểm đó.`,
      resetAt: outcome.resetAt,
      scanEnabled: false,
      buttonLabel: SCAN_BUTTON_LABEL,
    };
  }

  const waited =
    outcome.retryAfterSeconds === null
      ? "Server không nói phải chờ bao lâu."
      : `Server chỉ nói chờ ${outcome.retryAfterSeconds} giây.`;

  return {
    headline: "Hết lượt quét",
    detail: `Bản cài này đã dùng hết hạn mức quét. Server không trả thời điểm mở lại, nên ở đây không hiện thời điểm nào cả. ${waited} Extension không tự thử lại.`,
    resetAt: null,
    scanEnabled: false,
    buttonLabel: SCAN_BUTTON_LABEL,
  };
}

export function panelView(model: PanelModel): PanelView {
  if (model.kind === "idle") {
    return {
      headline: model.url === null ? "Tab này không quét được" : "Chưa quét",
      detail:
        model.url === null
          ? "Chỉ trang http hoặc https mới quét được. Tab hiện tại không phải một trang như vậy."
          : IDLE_DETAIL,
      resetAt: null,
      scanEnabled: model.url !== null,
      buttonLabel: SCAN_BUTTON_LABEL,
    };
  }

  if (model.kind === "scanning") {
    return {
      headline: "Đang quét",
      detail: "Đã gửi URL lên server và đang chờ kết luận. Một lượt quét thật mất vài giây.",
      resetAt: null,
      scanEnabled: false,
      buttonLabel: SCAN_BUTTON_BUSY_LABEL,
    };
  }

  const outcome = model.outcome;

  if (outcome.kind === "verdict") {
    return verdictView(outcome);
  }

  if (outcome.kind === "quota_exceeded") {
    return quotaView(outcome);
  }

  if (outcome.kind === "pending") {
    return {
      headline: "Chưa có kết luận",
      detail: `Đã hỏi ${outcome.polls} lần mà lần quét ${outcome.scanId} vẫn chưa xong. Mở lại popup để hỏi tiếp. Còn ${outcome.quotaRemaining} lượt.`,
      resetAt: null,
      scanEnabled: true,
      buttonLabel: SCAN_BUTTON_LABEL,
    };
  }

  if (outcome.kind === "cached") {
    const cached = outcome.cached;
    const verdict = cached.isScam
      ? "Một lượt quét trước đó kết luận đây là trang lừa đảo."
      : "Một lượt quét trước đó không thấy dấu hiệu lừa đảo.";
    return {
      headline: CACHED_HEADLINE,
      detail:
        `${verdict} Kết quả cho host ${cached.host}, quét lúc ${formatInstant(cached.checkedAt)}, ` +
        `tức ${ageInWords(cached.cacheAgeSeconds)}. Lượt này không tốn hạn mức nào, còn ` +
        `${cached.quotaRemaining} lượt. Kết quả tính theo host chứ không theo từng đường dẫn, ` +
        "nên nếu bạn nghi đúng trang này thì bấm nút để bắt server quét lại ngay.",
      resetAt: null,
      scanEnabled: true,
      buttonLabel: SCAN_BUTTON_LABEL,
    };
  }

  if (outcome.kind === "refused") {
    return {
      headline: "Server từ chối",
      detail: `Mã ${outcome.code}. ${outcome.message}`,
      resetAt: null,
      scanEnabled: outcome.code !== "quota_exceeded",
      buttonLabel: SCAN_BUTTON_LABEL,
    };
  }

  return {
    headline: "Chưa hỏi được",
    detail: `${outcome.reason}. Chưa có kết luận nào cho trang này.`,
    resetAt: null,
    scanEnabled: true,
    buttonLabel: SCAN_BUTTON_LABEL,
  };
}
