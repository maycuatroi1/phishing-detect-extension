export const REPORT_CLAIMS = ["phishing", "false_positive"] as const;

export type ReportClaim = (typeof REPORT_CLAIMS)[number];

export const SOFTENING_CLAIM: ReportClaim = "false_positive";

export function isReportClaim(value: unknown): value is ReportClaim {
  return typeof value === "string" && (REPORT_CLAIMS as readonly string[]).includes(value);
}
