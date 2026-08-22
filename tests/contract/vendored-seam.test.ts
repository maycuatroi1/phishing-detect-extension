import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  checkVendoredContracts,
  readVendorLedger,
  readVendoredBytes,
} from "../../scripts/vendor-ledger.ts";
import {
  AFBL_FORMAT,
  AFBL_FORMATS,
  AFBL_HEADER_BYTES,
  AFBL_MAGIC,
  AFBL_SOFT_FORMAT,
  AFBL_SOFT_HEADER_BYTES,
  afblEtag,
  afblPinnedPath,
} from "../../src/lib/afbl.ts";
import {
  BLOCKLIST_FORMAT_PARAM,
  BLOCKLIST_PATH,
  BLOCKLIST_REQUEST_FORMATS,
  BLOCKLIST_SINCE_PARAM,
  HEADER_ETAG,
  HEADER_FORMAT,
  HEADER_PINNED_URL,
  HEADER_SOFT_COUNT,
  HEADER_VERSION,
} from "../../src/lib/blocklist-sync.ts";

const ledger = readVendorLedger();

function spec(): Record<string, any> {
  const yaml = readVendoredBytes(ledger.contracts["public-api"]).toString("utf8");
  return parseYaml(yaml) as Record<string, any>;
}

describe("hai file seam vendor còn nguyên byte", () => {
  it("khớp băm, độ dài và line ending mà ledger khai", () => {
    expect(checkVendoredContracts(ledger)).toEqual([]);
  });

  it("ledger pin đúng hai seam mà extension tiêu thụ", () => {
    expect(Object.keys(ledger.contracts).sort()).toEqual(["public-api", "verdict-envelope"]);
    expect(ledger.owner_repo).toBe("phishing-detect-web");
  });

  it("verdict.schema.json parse được và là một JSON Schema", () => {
    const schema = JSON.parse(readVendoredBytes(ledger.contracts["verdict-envelope"]).toString("utf8"));
    expect(typeof schema).toBe("object");
    expect(schema).toHaveProperty("$schema");
  });

  it("không file vendor nào chứa byte CR, vì `vendor/** -text` phải chặn được Windows", () => {
    for (const contract of Object.values(ledger.contracts)) {
      expect(readVendoredBytes(contract).includes(0x0d), `${contract.path} có CR`).toBe(false);
    }
  });
});

describe("client tier 0 nói đúng thứ tiếng mà openapi vendor mô tả", () => {
  const document = spec();

  it("gọi đúng path GET /v1/blocklist", () => {
    expect(document.paths[BLOCKLIST_PATH]).toBeDefined();
    expect(document.paths[BLOCKLIST_PATH].get.operationId).toBe("getBlocklist");
  });

  it("tên query param là since chứ không phải have", () => {
    const names = document.paths[BLOCKLIST_PATH].get.parameters.map((parameter: any) =>
      String(parameter.$ref).replace("#/components/parameters/", ""),
    );
    expect(names).toContain("BlocklistFormat");
    expect(names).toContain("BlocklistSince");

    expect(document.components.parameters.BlocklistSince.name).toBe(BLOCKLIST_SINCE_PARAM);
    expect(document.components.parameters.BlocklistFormat.name).toBe(BLOCKLIST_FORMAT_PARAM);
    expect(document.components.parameters.BlocklistSince.in).toBe("query");
  });

  it("format mặc định là format cũ nhất, và client biết đọc đúng bộ format mà spec liệt kê", () => {
    expect(document.components.parameters.BlocklistFormat.schema.default).toBe(AFBL_FORMAT);
    expect(document.components.parameters.BlocklistFormat.schema.enum).toEqual([1, 2]);
    expect([...AFBL_FORMATS]).toEqual([1, 2]);
    expect([...BLOCKLIST_REQUEST_FORMATS]).toEqual([2, 1]);
  });

  it("spec mô tả mảng mềm là mảng THỨ BA của một header 22 byte, không phải cờ trên mảng phish", () => {
    const description: string = document.components.parameters.BlocklistFormat.description;
    expect(description).toContain("appends a uint32");
    expect(description).toContain("making it 22 bytes");
    expect(description).toContain("a third array after legit");
    expect(description).toContain("never folded into the phish array of either format");
    expect(AFBL_SOFT_HEADER_BYTES).toBe(22);
    expect(AFBL_SOFT_FORMAT).toBe(2);
  });

  it("spec nói thẳng entry mềm là kết luận của máy, gỡ được bằng đúng một report", () => {
    const soft: string = document.components.headers.BlocklistSoftCount.description;
    expect(soft).toContain("Present on format 2 and above and absent on format 1");
    expect(soft).toContain("no moderator behind it");
    expect(soft).toContain("warn in amber");

    const path: string = document.paths[BLOCKLIST_PATH].get.description;
    expect(path).toContain("A single user report withdraws a soft entry with no human in the");
    expect(path).toContain("Soft hosts never appear in the phish array of any format");
  });

  it("header đếm entry mềm mà client đọc trùng tên header trong spec", () => {
    const headers = document.paths[BLOCKLIST_PATH].get.responses["200"].headers;
    const declared = Object.keys(headers).map((name) => name.toLowerCase());
    expect(declared).toContain(HEADER_SOFT_COUNT);
  });

  it("mô tả layout AFBL đúng như decoder giả định", () => {
    const description: string = document.paths[BLOCKLIST_PATH].get.description;
    expect(description).toContain(`"${AFBL_MAGIC}"`);
    expect(description).toContain("uint16 format");
    expect(description).toContain("uint32 version");
    expect(description).toContain("little endian uint64");
    expect(description).toContain("first 16 hex characters of SHA256(host)");
    expect(description).toContain("strictly ascending");
  });

  it("nói thẳng rằng client không parse được thì giữ bản cũ chứ không fail open", () => {
    const description: string = document.paths[BLOCKLIST_PATH].get.description;
    expect(description).toContain("must keep the artifact it already has rather than fail open");
  });

  it("tên header mà client đọc trùng với tên header trong spec", () => {
    const headers = document.paths[BLOCKLIST_PATH].get.responses["200"].headers;
    const declared = Object.keys(headers).map((name) => name.toLowerCase());
    expect(declared).toContain(HEADER_ETAG);
    expect(declared).toContain(HEADER_FORMAT);
    expect(declared).toContain(HEADER_VERSION);
    expect(declared).toContain(HEADER_PINNED_URL);
  });

  it("ETag và pinned URL mà client dựng khớp pattern trong spec", () => {
    const etagPattern = new RegExp(document.components.headers.BlocklistEtag.schema.pattern);
    const pinnedPattern = new RegExp(document.components.headers.BlocklistPinnedUrl.schema.pattern);
    expect(afblEtag(AFBL_FORMAT, 83338345)).toMatch(etagPattern);
    expect(afblPinnedPath(AFBL_FORMAT, 83338345)).toMatch(pinnedPattern);
  });

  it("304 là câu trả lời khi since bằng version hiện tại", () => {
    expect(document.paths[BLOCKLIST_PATH].get.responses["304"]).toBeDefined();
    expect(document.components.parameters.BlocklistSince.description).toContain("means 304");
  });

  it("mã lỗi 400 của blocklist đúng bộ mà client phải chịu được", () => {
    expect(document.components.schemas.BlocklistError.properties.code.enum).toEqual([
      "unsupported_format",
      "invalid_since",
      "invalid_version",
      "version_not_current",
    ]);
  });

  it("header 18 byte của decoder khớp tổng các trường mà spec liệt kê", () => {
    expect(AFBL_HEADER_BYTES).toBe(4 + 2 + 4 + 4 + 4);
    expect(AFBL_SOFT_HEADER_BYTES).toBe(4 + 2 + 4 + 4 + 4 + 4);
  });
});
