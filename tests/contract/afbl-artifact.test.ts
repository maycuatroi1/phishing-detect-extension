import { describe, expect, it } from "vitest";
import {
  AFBL_ENTRY_BYTES,
  AFBL_FORMAT,
  AFBL_FORMAT_OFFSET,
  AFBL_HEADER_BYTES,
  AFBL_LEGIT_COUNT_OFFSET,
  AFBL_PHISH_COUNT_OFFSET,
  AFBL_VERSION_OFFSET,
  afblByteLength,
  afblContains,
  decodeAfbl,
  encodeAfbl,
} from "../../src/lib/afbl.ts";
import { hostEntryOf, hostSha256Hex, hostOfUrl, truncatedEntryOf } from "../../src/lib/host.ts";

const PRODUCTION_EMPTY_ARTIFACT = Uint8Array.from([
  0x41, 0x46, 0x42, 0x4c, 0x01, 0x00, 0x69, 0xa4, 0xf7, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00,
]);

describe("layout AFBL", () => {
  it("header đúng 18 byte và mỗi entry đúng 8 byte", () => {
    expect(AFBL_HEADER_BYTES).toBe(18);
    expect(AFBL_ENTRY_BYTES).toBe(8);
    expect(afblByteLength(0, 0)).toBe(18);
    expect(afblByteLength(3, 2)).toBe(18 + 5 * 8);
  });

  it("từng trường nằm đúng offset mà hợp đồng ghi", () => {
    const bytes = encodeAfbl({ version: 83338345, phish: [1n, 2n], legit: [9n] });
    const view = new DataView(bytes.buffer);

    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe("AFBL");
    expect(view.getUint16(AFBL_FORMAT_OFFSET, true)).toBe(AFBL_FORMAT);
    expect(AFBL_VERSION_OFFSET).toBe(6);
    expect(view.getUint32(AFBL_VERSION_OFFSET, true)).toBe(83338345);
    expect(view.getUint32(AFBL_PHISH_COUNT_OFFSET, true)).toBe(2);
    expect(view.getUint32(AFBL_LEGIT_COUNT_OFFSET, true)).toBe(1);
    expect(bytes.byteLength).toBe(afblByteLength(2, 1));
  });

  it("18 byte thật lấy từ production decode ra artifact rỗng hợp lệ, không phải lỗi", () => {
    const decoded = decodeAfbl(PRODUCTION_EMPTY_ARTIFACT);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.artifact.format).toBe(1);
    expect(decoded.artifact.version).toBe(83338345);
    expect(decoded.artifact.phish.length).toBe(0);
    expect(decoded.artifact.legit.length).toBe(0);
    expect(afblContains(decoded.artifact.phish, 1n)).toBe(false);
  });

  it("encode rồi decode trả lại đúng entry đã bỏ vào", () => {
    const phish = [1n, 0x0123456789abcdefn, 0xffffffffffffffffn].sort((a, b) => (a < b ? -1 : 1));
    const decoded = decodeAfbl(encodeAfbl({ version: 7, phish, legit: [] }));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(Array.from(decoded.artifact.phish)).toEqual(phish);
  });
});

describe("decoder từ chối mọi artifact nó không chắc đọc đúng", () => {
  const good = encodeAfbl({ version: 5, phish: [1n, 2n], legit: [3n] });

  function refusalOf(bytes: Uint8Array): string {
    const decoded = decodeAfbl(bytes);
    expect(decoded.ok).toBe(false);
    return decoded.ok ? "" : decoded.refusal.code;
  }

  it("too_short khi ngắn hơn một header", () => {
    expect(refusalOf(good.subarray(0, 17))).toBe("too_short");
  });

  it("bad_magic khi 4 byte đầu không phải AFBL", () => {
    const bytes = good.slice();
    bytes[0] = 0x42;
    expect(refusalOf(bytes)).toBe("bad_magic");
  });

  it("unsupported_format khi uint16 ở byte 4 là format lạ", () => {
    const bytes = good.slice();
    new DataView(bytes.buffer).setUint16(AFBL_FORMAT_OFFSET, 2, true);
    expect(refusalOf(bytes)).toBe("unsupported_format");
  });

  it("truncated_body khi header khai nhiều entry hơn số byte thật có", () => {
    const bytes = good.slice();
    new DataView(bytes.buffer).setUint32(AFBL_PHISH_COUNT_OFFSET, 9, true);
    expect(refusalOf(bytes)).toBe("truncated_body");
  });

  it("trailing_bytes khi có byte thừa, byte thừa bị từ chối chứ không bị bỏ qua", () => {
    const bytes = new Uint8Array(good.byteLength + 1);
    bytes.set(good, 0);
    expect(refusalOf(bytes)).toBe("trailing_bytes");
  });

  it("unsorted_entries khi mảng không tăng ngặt, vì tìm nhị phân sẽ bỏ sót host", () => {
    const bytes = encodeAfbl({ version: 5, phish: [], legit: [] });
    const grown = new Uint8Array(afblByteLength(2, 0));
    grown.set(bytes, 0);
    const view = new DataView(grown.buffer);
    view.setUint32(AFBL_PHISH_COUNT_OFFSET, 2, true);
    view.setBigUint64(AFBL_HEADER_BYTES, 9n, true);
    view.setBigUint64(AFBL_HEADER_BYTES + 8, 4n, true);
    expect(refusalOf(grown)).toBe("unsorted_entries");
  });

  it("unsorted_entries bắt cả entry trùng nhau", () => {
    const grown = new Uint8Array(afblByteLength(2, 0));
    grown.set(encodeAfbl({ version: 5, phish: [], legit: [] }), 0);
    const view = new DataView(grown.buffer);
    view.setUint32(AFBL_PHISH_COUNT_OFFSET, 2, true);
    view.setBigUint64(AFBL_HEADER_BYTES, 4n, true);
    view.setBigUint64(AFBL_HEADER_BYTES + 8, 4n, true);
    expect(refusalOf(grown)).toBe("unsorted_entries");
  });
});

describe("tìm nhị phân trên mảng uint64 đã sắp xếp", () => {
  const entries = new BigUint64Array(Array.from({ length: 5000 }, (_, index) => BigInt(index) * 7n));

  it("tìm thấy mọi entry có trong mảng", () => {
    for (let index = 0; index < entries.length; index += 137) {
      expect(afblContains(entries, entries[index])).toBe(true);
    }
    expect(afblContains(entries, entries[0])).toBe(true);
    expect(afblContains(entries, entries[entries.length - 1])).toBe(true);
  });

  it("không báo nhầm entry không có", () => {
    expect(afblContains(entries, 1n)).toBe(false);
    expect(afblContains(entries, 5n)).toBe(false);
    expect(afblContains(entries, 0xffffffffffffffffn)).toBe(false);
    expect(afblContains(new BigUint64Array(0), 0n)).toBe(false);
  });
});

describe("host thành entry uint64", () => {
  it("entry là 16 ký tự hex đầu của SHA256(host) đọc big endian", async () => {
    const host = "vietcombank.com.vn";
    const hex = await hostSha256Hex(host);
    expect(hex).toHaveLength(64);
    expect(await hostEntryOf(host)).toBe(truncatedEntryOf(hex));
    expect(await hostEntryOf(host)).toBe(BigInt(`0x${hex.slice(0, 16)}`));
  });

  it("host lấy từ URL được hạ chữ thường và bỏ dấu chấm cuối", () => {
    expect(hostOfUrl("https://VietcomBank.COM.VN./login")).toBe("vietcombank.com.vn");
    expect(hostOfUrl("http://example.test:8080/a?b=c#d")).toBe("example.test");
  });

  it("URL không phải http hay https thì không có host để tra", () => {
    expect(hostOfUrl("chrome://extensions")).toBeNull();
    expect(hostOfUrl("about:blank")).toBeNull();
    expect(hostOfUrl("file:///C:/tmp/x.html")).toBeNull();
    expect(hostOfUrl(undefined)).toBeNull();
    expect(hostOfUrl("khong phai url")).toBeNull();
  });
});
