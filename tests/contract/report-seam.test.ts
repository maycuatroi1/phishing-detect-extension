import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { readVendorLedger, readVendoredBytes } from "../../scripts/vendor-ledger.ts";
import { API_ERROR_CODES, parseApiError } from "../../src/lib/api-error.ts";
import { REPORT_CLAIMS } from "../../src/lib/claim.ts";
import {
  REPORT_COMMENT_MAX_LENGTH,
  REPORT_HTML_FIELD,
  REPORT_PATH,
  REPORT_REQUEST_FIELDS,
  REPORT_REQUIRED_FIELDS,
  REPORT_SOFT_FLAGS,
  REPORT_SOFT_FLAG_FIELD,
  REPORT_TURNSTILE_FIELD,
  REPORT_URL_MAX_LENGTH,
  TURNSTILE_GATES,
  TURNSTILE_HEADER,
  gateOfResponse,
  parseReportQueued,
  reportRequestBody,
} from "../../src/lib/report.ts";
import { SCAN_URL_MAX_LENGTH } from "../../src/lib/scan.ts";
import {
  MEASURED_REPORT_ID,
  MEASURED_TURNSTILE_MESSAGE,
  MEASURED_TURNSTILE_THRESHOLD,
  reportQueuedResponse,
  reportRateLimitedResponse,
} from "../helpers/report.ts";

const ledger = readVendorLedger();

const document = parseYaml(
  readVendoredBytes(ledger.contracts["public-api"]).toString("utf8"),
) as Record<string, any>;

const reportPost = document.paths[REPORT_PATH]?.post;

const requestSchema = document.components.schemas.ReportRequest;

const SAMPLE_URL = "https://vietcombank-otp.example/dang-nhap";

describe("client tier 3 nói đúng thứ tiếng mà openapi vendor mô tả", () => {
  it("gọi đúng operation createReport và đòi install token", () => {
    expect(reportPost.operationId).toBe("createReport");
    expect(reportPost.tags).toContain("report");
    expect(reportPost.security).toEqual([{ installToken: [] }]);
  });

  it("spec nói thẳng rằng report là lời khai chứ không phải nhãn", () => {
    expect(reportPost.description).toContain("A report is a claim, never a label");
    expect(reportPost.description).toContain("never moves site.status on its own");
    expect(document.tags.find((tag: any) => tag.name === "report").description).toContain(
      "A report is never a label",
    );
  });

  it("thân POST /v1/report chỉ được mang đúng bộ trường mà client biết", () => {
    expect(requestSchema.additionalProperties).toBe(false);
    expect(requestSchema.required).toEqual(REPORT_REQUIRED_FIELDS);
    expect(Object.keys(requestSchema.properties)).toEqual(REPORT_REQUEST_FIELDS);
    expect(requestSchema.properties.url.maxLength).toBe(REPORT_URL_MAX_LENGTH);
    expect(REPORT_URL_MAX_LENGTH).toBe(SCAN_URL_MAX_LENGTH);
    expect(requestSchema.properties.comment.maxLength).toBe(REPORT_COMMENT_MAX_LENGTH);
  });

  it("hai claim mà client gửi được đúng hai claim mà spec nhận", () => {
    expect(requestSchema.properties.claim.enum).toEqual([...REPORT_CLAIMS]);
    expect(REPORT_CLAIMS).toHaveLength(2);
  });

  it("một cú bấm gửi đúng hai trường, không kèm gì thêm", () => {
    for (const claim of REPORT_CLAIMS) {
      const body = JSON.parse(reportRequestBody({ url: SAMPLE_URL, claim }));
      expect(Object.keys(body)).toEqual(REPORT_REQUIRED_FIELDS);
      expect(body.url).toBe(SAMPLE_URL);
      expect(body.claim).toBe(claim);
    }
  });

  it("không thân report nào mang html, vì extension không đọc nội dung trang", () => {
    const full = reportRequestBody({
      url: SAMPLE_URL,
      claim: "phishing",
      comment: "ghi chú của người báo",
      turnstileToken: "0.solved-token",
    });
    expect(full).not.toContain(`"${REPORT_HTML_FIELD}"`);
    expect(Object.keys(JSON.parse(full))).toEqual(["url", "claim", "comment", REPORT_TURNSTILE_FIELD]);
    for (const field of Object.keys(JSON.parse(full))) {
      expect(REPORT_REQUEST_FIELDS, `trường ${field} không có trong spec`).toContain(field);
    }
  });

  it("turnstile_token chỉ đi ra khi có, chứ không gửi null cho vui", () => {
    const bare = reportRequestBody({ url: SAMPLE_URL, claim: "false_positive", turnstileToken: null });
    expect(Object.keys(JSON.parse(bare))).not.toContain(REPORT_TURNSTILE_FIELD);
    expect(requestSchema.properties.turnstile_token.description).toContain(
      "Required only after the report threshold",
    );
  });

  it("202 mang đúng bộ trường mà client đọc, và client parse được", () => {
    const schema = document.components.schemas.ReportQueued;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["report_id", "status", REPORT_SOFT_FLAG_FIELD]);
    expect(schema.properties.status.const).toBe("queued");
    expect(schema.properties[REPORT_SOFT_FLAG_FIELD].enum).toEqual([...REPORT_SOFT_FLAGS]);

    const parsed = parseReportQueued({ report_id: MEASURED_REPORT_ID, status: "queued" }, "not-required");
    expect(parsed?.reportId).toBe(MEASURED_REPORT_ID);
    expect(parsed?.gate).toBe("not-required");
    expect(parseReportQueued({ report_id: MEASURED_REPORT_ID, status: "running" }, null)).toBeNull();
    expect(parseReportQueued({ status: "queued" }, null)).toBeNull();
  });

  it("soft_flag là trường duy nhất một report tự đổi được, và client đọc được cả khi server chưa gửi", () => {
    const description: string = document.components.schemas.ReportQueued.properties[
      REPORT_SOFT_FLAG_FIELD
    ].description;
    expect(description).toContain("machine raised soft flag");
    expect(description).toContain("a moderator decision is never undone automatically");
    expect(description).toContain("A report can only ever lower a warning here");

    const withdrawn = parseReportQueued(
      { report_id: MEASURED_REPORT_ID, status: "queued", soft_flag: "withdrawn" },
      null,
    );
    expect(withdrawn?.softFlag).toBe("withdrawn");

    const unchanged = parseReportQueued(
      { report_id: MEASURED_REPORT_ID, status: "queued", soft_flag: "unchanged" },
      null,
    );
    expect(unchanged?.softFlag).toBe("unchanged");

    const missing = parseReportQueued({ report_id: MEASURED_REPORT_ID, status: "queued" }, null);
    expect(missing).not.toBeNull();
    expect(missing?.softFlag).toBeNull();

    const nonsense = parseReportQueued(
      { report_id: MEASURED_REPORT_ID, status: "queued", soft_flag: "raised" },
      null,
    );
    expect(nonsense?.softFlag).toBeNull();
  });

  it("ba giá trị của header x-turnstile trùng ba hằng số trong client", () => {
    const headers = reportPost.responses["202"].headers;
    expect(Object.keys(headers).map((name) => name.toLowerCase())).toContain(TURNSTILE_HEADER);
    expect(headers["X-Turnstile"].schema.enum).toEqual([...TURNSTILE_GATES]);
    expect(gateOfResponse(reportQueuedResponse({ gate: "verified" }))).toBe("verified");
    expect(gateOfResponse(reportQueuedResponse({ gate: null }))).toBeNull();
  });

  it("403 chỉ có đúng hai mã, và ngưỡng đo trên production khớp câu chữ của spec", () => {
    expect(reportPost.responses["403"].$ref).toBe("#/components/responses/TurnstileForbidden");
    expect(
      document.components.schemas.ForbiddenError.properties.error.allOf[1].properties.code.enum,
    ).toEqual(["turnstile_required", "turnstile_failed"]);
    expect(reportPost.description).toContain("REPORT_TURNSTILE_THRESHOLD");
    expect(MEASURED_TURNSTILE_MESSAGE).toContain(`After ${MEASURED_TURNSTILE_THRESHOLD} reports`);
  });

  it("429 của /v1/report không mang reset_at, khác hẳn 429 của /v1/scan", () => {
    expect(reportPost.responses["429"].$ref).toBe("#/components/responses/ReportRateLimited");
    expect(document.components.responses.ReportRateLimited.description).toContain(
      "retry_after is present and reset_at is not",
    );

    const shape = document.components.schemas.RateLimitedError.properties.error.allOf[1];
    expect(shape.required).toEqual(["code", "message", "retry_after"]);
    expect(shape.required).not.toContain("reset_at");
    expect(shape.properties.code.const).toBe("rate_limited");
    expect(document.components.schemas.ApiError.properties.reset_at.description).toContain(
      "Present only on the 429 from POST /v1/scan",
    );
  });

  it("client đọc 429 của report ra số giây chờ mà không bịa ra thời điểm mở lại", async () => {
    const response = reportRateLimitedResponse(1847);
    const error = parseApiError(await response.json());
    expect(error?.code).toBe("rate_limited");
    expect(error?.retryAfterSeconds).toBe(1847);
    expect(error?.resetAt).toBeNull();
  });

  it("503 là lỗi Cloudflare không tới được, và nó có số giây chờ", () => {
    expect(reportPost.responses["503"].$ref).toBe("#/components/responses/TurnstileUnavailable");
    const shape = document.components.schemas.TurnstileUnavailableError.properties.error.allOf[1];
    expect(shape.required).toContain("retry_after");
    expect(shape.properties.code.const).toBe("turnstile_failed");
    expect(document.components.responses.TurnstileUnavailable.description).toContain(
      "the report was not queued",
    );
  });

  it("mọi mã lỗi 400 của report đều nằm trong bộ mã mà client chịu được", () => {
    const codes: string[] =
      document.components.schemas.ReportBadRequestError.properties.error.allOf[1].properties.code
        .enum;
    expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) {
      expect(API_ERROR_CODES, `mã ${code} lạ với client`).toContain(code);
    }
  });
});
