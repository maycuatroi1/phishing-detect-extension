import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { readVendorLedger, readVendoredBytes } from "../../scripts/vendor-ledger.ts";
import { API_ERROR_CODES, parseApiError } from "../../src/lib/api-error.ts";
import {
  INSTALL_PATH,
  INSTALL_TOKEN_BODY_LENGTH,
  INSTALL_TOKEN_LENGTH,
  INSTALL_TOKEN_PREFIX,
  isInstallToken,
  parseInstallResponse,
} from "../../src/lib/install.ts";
import {
  CONFIDENCE_BASES,
  PARSE_FAILURE_REASONS,
  SCAN_CACHED_STATUS,
  SCAN_PATH,
  SCAN_REQUEST_FIELDS,
  SCAN_STATUSES,
  SCAN_URL_FIELD,
  SCAN_URL_MAX_LENGTH,
  VERDICT_ENVELOPE_FIELDS,
  VERDICT_SOURCES,
  parseScanCached,
  parseScanQueued,
  parseVerdictEnvelope,
  scanRequestBody,
  verdictPath,
} from "../../src/lib/scan.ts";
import { MEASURED_QUOTA_MESSAGE } from "../helpers/tier2.ts";

const ledger = readVendorLedger();

const document = parseYaml(
  readVendoredBytes(ledger.contracts["public-api"]).toString("utf8"),
) as Record<string, any>;

const verdictSchema = JSON.parse(
  readVendoredBytes(ledger.contracts["verdict-envelope"]).toString("utf8"),
) as Record<string, any>;

const scanPost = document.paths[SCAN_PATH]?.post;

const verdictGet = document.paths[`${SCAN_PATH}/{scan_id}`]?.get;

const installPost = document.paths[INSTALL_PATH]?.post;

describe("client tier 2 nói đúng thứ tiếng mà openapi vendor mô tả", () => {
  it("gọi đúng hai operation của tier 2", () => {
    expect(scanPost.operationId).toBe("createScan");
    expect(scanPost.tags).toContain("scan");
    expect(verdictGet.operationId).toBe("getScanVerdict");
    expect(verdictPath("abc")).toBe(`${SCAN_PATH}/abc`);
  });

  it("cả hai operation đều đòi install token, khác hẳn tier 1", () => {
    expect(scanPost.security).toEqual([{ installToken: [] }]);
    expect(verdictGet.security).toEqual([{ installToken: [] }]);
    expect(document.paths["/v1/lookup"].get.security).toEqual([]);

    const scheme = document.components.securitySchemes.installToken;
    expect(scheme.type).toBe("http");
    expect(scheme.scheme).toBe("bearer");
  });

  it("thân POST /v1/scan chỉ được mang url và cờ fresh, không gì khác", () => {
    const schema = document.components.schemas.ScanRequest;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual([SCAN_URL_FIELD]);
    expect(Object.keys(schema.properties)).toEqual(SCAN_REQUEST_FIELDS);
    expect(schema.properties.url.maxLength).toBe(SCAN_URL_MAX_LENGTH);
    expect(schema.properties.fresh.type).toBe("boolean");
    expect(schema.properties.fresh.default).toBe(false);
  });

  it("lượt tự quét không đặt fresh, cú bấm tay thì có, và không thân nào mang trường thứ ba", () => {
    expect(Object.keys(JSON.parse(scanRequestBody("https://example.com/")))).toEqual([
      SCAN_URL_FIELD,
    ]);
    expect(Object.keys(JSON.parse(scanRequestBody("https://example.com/", true)))).toEqual(
      SCAN_REQUEST_FIELDS,
    );
    expect(JSON.parse(scanRequestBody("https://example.com/", true)).fresh).toBe(true);
  });

  it("200 là câu trả lời từ kho, và nó cố tình không mang một id nào của lượt quét cũ", () => {
    const schema = document.components.schemas.ScanCached;
    expect(schema.properties.status.const).toBe(SCAN_CACHED_STATUS);
    expect(schema.additionalProperties).toBe(false);

    for (const forbidden of ["scan_id", "site_id", "evidence_id"]) {
      expect(Object.keys(schema.properties), `${forbidden} lọt vào thân 200`).not.toContain(
        forbidden,
      );
    }

    const example = scanPost.responses["200"].content["application/json"].examples.cached.value;
    const parsed = parseScanCached(example);
    expect(parsed).not.toBeNull();
    expect(parsed?.isScam).toBe(example.is_scam);
    expect(parsed?.host).toBe(example.host);
    expect(parsed?.quotaRemaining).toBe(example.quota_remaining);
  });

  it("một thân 200 thiếu trường hay sai kiểu thì client trả null chứ không đoán", () => {
    const example = scanPost.responses["200"].content["application/json"].examples.cached.value;

    expect(parseScanCached({ ...example, status: "queued" })).toBeNull();
    expect(parseScanCached({ ...example, is_scam: "true" })).toBeNull();
    expect(parseScanCached({ ...example, host: "" })).toBeNull();
    expect(parseScanCached({ ...example, quota_remaining: -1 })).toBeNull();
    expect(parseScanCached({ ...example, cache_age_seconds: 1.5 })).toBeNull();
  });

  it("spec nói thẳng vì sao một trường thừa là 400 chứ không phải cảnh báo", () => {
    expect(scanPost.description).toContain(
      "No prompt, no html, no model, no system message, no options",
    );
    expect(scanPost.description).toContain("free LLM proxy for the internet");
    expect(document.components.schemas.ScanBadRequestError.properties.error.allOf[1].properties.code.enum)
      .toContain("unknown_field");
  });

  it("202 mang đúng bốn trường mà client đọc", () => {
    const schema = document.components.schemas.ScanQueued;
    expect(schema.required).toEqual(["scan_id", "status", "poll_after_seconds", "quota_remaining"]);
    expect(schema.properties.status.const).toBe("queued");

    const example = scanPost.responses["202"].content["application/json"].examples.queued.value;
    const parsed = parseScanQueued(example);
    expect(parsed).not.toBeNull();
    expect(parsed?.pollAfterSeconds).toBe(2);
    expect(parsed?.quotaRemaining).toBe(19);
  });

  it("429 của /v1/scan là 429 duy nhất trong API này mang reset_at", () => {
    const response = document.components.responses.ScanQuotaExceeded;
    expect(Object.keys(response.headers)).toContain("Retry-After");

    const shape = document.components.schemas.QuotaExceededError.properties.error.allOf[1];
    expect(shape.required).toEqual(["code", "message", "retry_after", "reset_at"]);
    expect(shape.properties.code.const).toBe("quota_exceeded");

    expect(
      document.components.schemas.RateLimitedError.properties.error.allOf[1].required,
    ).toEqual(["code", "message", "retry_after"]);
    expect(document.components.schemas.ApiError.properties.reset_at.description).toContain(
      "Present only on the 429 from POST /v1/scan",
    );
  });

  it("thân 429 đo trên production trùng ví dụ trong spec vendor, và client parse ra được", () => {
    const example = document.components.responses.ScanQuotaExceeded.content["application/json"]
      .examples.spent.value;

    expect(example.error.message).toBe(MEASURED_QUOTA_MESSAGE);

    const parsed = parseApiError(example);
    expect(parsed?.code).toBe("quota_exceeded");
    expect(parsed?.retryAfterSeconds).toBe(example.error.retry_after);
    expect(parsed?.resetAt).toBe(example.error.reset_at);
    expect(Number.isNaN(new Date(String(parsed?.resetAt)).getTime())).toBe(false);
  });

  it("bộ mã lỗi mà client chịu được đúng bộ trong spec", () => {
    expect(document.components.schemas.ApiError.properties.code.enum).toEqual([...API_ERROR_CODES]);
  });

  it("install token có hình dạng mà client kiểm, và /v1/install không đòi auth", () => {
    expect(installPost.operationId).toBe("createInstallToken");
    expect(installPost.security).toEqual([]);

    const schema = document.components.schemas.InstallResponse;
    expect(schema.required).toEqual(["install_token", "rotate_after_days"]);
    expect(schema.properties.install_token.pattern).toBe(
      `^${INSTALL_TOKEN_PREFIX}[A-Za-z0-9_-]{${INSTALL_TOKEN_BODY_LENGTH}}$`,
    );
    expect(INSTALL_TOKEN_LENGTH).toBe(48);
    expect(isInstallToken(`${INSTALL_TOKEN_PREFIX}${"a".repeat(INSTALL_TOKEN_BODY_LENGTH)}`)).toBe(true);
    expect(isInstallToken(`${INSTALL_TOKEN_PREFIX}${"a".repeat(INSTALL_TOKEN_BODY_LENGTH - 1)}`)).toBe(
      false,
    );
    expect(
      parseInstallResponse({
        install_token: `${INSTALL_TOKEN_PREFIX}${"a".repeat(INSTALL_TOKEN_BODY_LENGTH)}`,
        rotate_after_days: 90,
      }),
    ).not.toBeNull();
  });

  it("/v1/install không nhận trường nào, nên client gửi đúng hai byte {}", () => {
    expect(document.components.schemas.EmptyBody.maxProperties).toBe(0);
    expect(installPost.requestBody.description).toContain("Empty, or the two bytes {}");
  });
});

describe("client đọc verdict envelope theo đúng schema vendor", () => {
  it("danh sách trường bắt buộc trùng nguyên văn, không thiếu không thừa", () => {
    expect(verdictSchema.required).toEqual([...VERDICT_ENVELOPE_FIELDS]);
    expect(verdictSchema.additionalProperties).toBe(false);
    expect(document.components.schemas.VerdictEnvelope.required).toEqual([...VERDICT_ENVELOPE_FIELDS]);
  });

  it("bốn enum trong schema trùng bốn hằng số trong client", () => {
    expect(verdictSchema.properties.status.enum).toEqual([...SCAN_STATUSES]);
    expect(verdictSchema.properties.source.enum).toEqual([...VERDICT_SOURCES]);
    expect(verdictSchema.properties.confidence_basis.enum).toEqual([...CONFIDENCE_BASES, null]);
    expect(verdictSchema.properties.parse_failure_reason.enum).toEqual([...PARSE_FAILURE_REASONS, null]);
  });

  it("cả bốn ví dụ trong spec đều parse được bằng đúng một parser", () => {
    const examples = verdictGet.responses["200"].content["application/json"].examples;
    const names = Object.keys(examples);
    expect(names).toEqual(["stillQueued", "decided", "unparsed", "workerCrashed"]);

    for (const name of names) {
      const parsed = parseVerdictEnvelope(examples[name].value);
      expect(parsed, `ví dụ ${name} không parse được`).not.toBeNull();
    }
  });

  it("thiếu một trường bắt buộc thì parser trả null chứ không đoán", () => {
    const decided = verdictGet.responses["200"].content["application/json"].examples.decided.value;
    for (const field of VERDICT_ENVELOPE_FIELDS) {
      const broken = { ...decided };
      delete broken[field];
      expect(parseVerdictEnvelope(broken), `bỏ ${field} mà vẫn parse được`).toBeNull();
    }
  });

  it("chưa xong thì ba trường verdict đều null, spec nói vậy và client giữ nguyên", () => {
    const queued = verdictGet.responses["200"].content["application/json"].examples.stillQueued.value;
    const parsed = parseVerdictEnvelope(queued);
    expect(parsed?.is_scam).toBeNull();
    expect(parsed?.confidence).toBeNull();
    expect(parsed?.confidence_basis).toBeNull();
    expect(verdictSchema.allOf[0].description).toContain(
      "A verdict exists only when the scan finished and its response parsed",
    );
  });
});
