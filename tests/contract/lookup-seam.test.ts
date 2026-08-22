import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { readVendorLedger, readVendoredBytes } from "../../scripts/vendor-ledger.ts";
import {
  LOOKUP_FULL_HASH_HEX_LENGTH,
  LOOKUP_MAX_PREFIXES_PER_REQUEST,
  LOOKUP_PATH,
  LOOKUP_PREFIX_BITS,
  LOOKUP_PREFIX_HEX_LENGTH,
  LOOKUP_PREFIX_PARAM,
} from "../../src/lib/lookup.ts";

const ledger = readVendorLedger();

const document = parseYaml(
  readVendoredBytes(ledger.contracts["public-api"]).toString("utf8"),
) as Record<string, any>;

const operation = document.paths[LOOKUP_PATH]?.get;

const prefixParameter = document.components.parameters.LookupPrefix;

describe("client tier 1 nói đúng thứ tiếng mà openapi vendor mô tả", () => {
  it("gọi đúng path GET /v1/lookup", () => {
    expect(operation).toBeDefined();
    expect(operation.operationId).toBe("lookupPrefixes");
    expect(operation.tags).toContain("lookup");
  });

  it("endpoint này không có yêu cầu bảo mật nào, ở cả mức tài liệu lẫn mức operation", () => {
    expect(document.security).toEqual([]);
    expect(operation.security).toEqual([]);
  });

  it("tên query param là p, lặp lại một lần cho mỗi host", () => {
    const names = operation.parameters.map((parameter: any) =>
      String(parameter.$ref).replace("#/components/parameters/", ""),
    );
    expect(names).toEqual(["LookupPrefix"]);
    expect(prefixParameter.name).toBe(LOOKUP_PREFIX_PARAM);
    expect(prefixParameter.in).toBe("query");
    expect(prefixParameter.required).toBe(true);
    expect(prefixParameter.style).toBe("form");
    expect(prefixParameter.explode).toBe(true);
  });

  it("trần 16 prefix một request là con số trong spec chứ không phải con số tự đặt", () => {
    expect(prefixParameter.schema.type).toBe("array");
    expect(prefixParameter.schema.minItems).toBe(1);
    expect(prefixParameter.schema.maxItems).toBe(LOOKUP_MAX_PREFIXES_PER_REQUEST);
  });

  it("mỗi prefix đúng 5 ký tự hex, tức 20 bit, khớp hằng số trong client", () => {
    expect(prefixParameter.schema.items.pattern).toBe(`^[0-9a-fA-F]{${LOOKUP_PREFIX_HEX_LENGTH}}$`);
    expect(LOOKUP_PREFIX_BITS).toBe(LOOKUP_PREFIX_HEX_LENGTH * 4);
    expect(prefixParameter.description).toContain("first five hex characters of SHA256(host)");
  });

  it("spec nói thẳng server trả cả bucket và không biết host nào trong bucket là của client", () => {
    const description: string = operation.description;
    expect(description).toContain("takes the first five hex characters");
    expect(description).toContain("answers with the whole bucket");
    expect(description).toContain("never learns which host inside the bucket the client cared about");
    expect(description).toContain("Up to 16 buckets may be asked for in one request");
  });

  it("spec cấm ghi prefix cùng địa chỉ client trên một dòng log", () => {
    expect(operation.description).toContain(
      "no request to this endpoint ever writes a prefix and a client address on the same log line",
    );
    expect(document.tags.find((tag: any) => tag.name === "lookup").description).toContain(
      "no client identifier logged",
    );
  });

  it("header 200 khẳng định lại đúng tính chất đó", () => {
    const headers = operation.responses["200"].headers;
    expect(Object.keys(headers).map((name) => name.toLowerCase())).toContain("x-lookup-anonymity");
    expect(headers["X-Lookup-Anonymity"].schema.const).toBe(
      "k-anonymity; no authentication; client identifiers not logged",
    );
  });

  it("entry mang hash đầy đủ 64 ký tự, đó là thứ client so ở máy mình", () => {
    const entry = document.components.schemas.LookupEntry;
    expect(entry.required).toEqual(["h", "v", "c"]);
    expect(entry.properties.h.pattern).toBe(`^[0-9a-f]{${LOOKUP_FULL_HASH_HEX_LENGTH}}$`);
    expect(entry.properties.h.description).toContain("The client matches this against its own");
    expect(entry.properties.v.enum).toEqual(["phishing", "legit", "unknown"]);
    expect(entry.properties.c.minimum).toBe(0);
    expect(entry.properties.c.maximum).toBe(1);
  });

  it("bucket rỗng không phải là unknown, spec tách hai câu trả lời đó ra", () => {
    expect(operation.responses["200"].description).toContain(
      "A bucket with no corpus entries comes back as an empty array, which is not the same answer as unknown",
    );
    expect(document.components.schemas.LookupEntry.properties.v.description).toContain(
      "not the same as the host being absent",
    );
  });

  it("bốn mã lỗi của lookup đúng bộ mà client phải chịu được", () => {
    expect(document.components.schemas.LookupError.properties.code.enum).toEqual([
      "missing_prefix",
      "too_many_prefixes",
      "invalid_prefix",
      "internal_error",
    ]);
  });

  it("LookupResponse chỉ có buckets, và khoá bucket là chính chuỗi client gửi", () => {
    const schema = document.components.schemas.LookupResponse;
    expect(schema.required).toEqual(["buckets"]);
    expect(schema.properties.buckets.propertyNames.pattern).toBe(
      `^[0-9a-fA-F]{${LOOKUP_PREFIX_HEX_LENGTH}}$`,
    );
    expect(schema.properties.buckets.description).toContain("Keyed by the exact p string the client sent");
  });
});
