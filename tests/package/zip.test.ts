import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { scanSecretPatterns } from "../../scripts/secret-patterns.ts";
import {
  buildZip,
  crc32,
  isSafeZipName,
  readZip,
  ZIP_CENTRAL_SIGNATURE,
  ZIP_EOCD_SIGNATURE,
  ZIP_LOCAL_SIGNATURE,
  type ZipEntry,
} from "../../scripts/zip.ts";

const PINNED_DOS_TIME = 0x0000;

const PINNED_DOS_DATE = 0x0021;

const STORE_METHOD = 0;

const SAMPLE: readonly ZipEntry[] = [
  { name: "manifest.json", data: Buffer.from('{"manifest_version":3}', "utf8") },
  { name: "popup/index.html", data: Buffer.from("<!doctype html><p>xin chào</p>", "utf8") },
  { name: "icons/icon16.png", data: Buffer.from("89504e470d0a1a0a0000", "hex") },
  { name: "background.js", data: Buffer.from("console.info('anti-fraud');\n".repeat(40), "utf8") },
];

function localHeaderAt(archive: Buffer, at: number): Record<string, number> {
  return {
    signature: archive.readUInt32LE(at),
    flags: archive.readUInt16LE(at + 6),
    method: archive.readUInt16LE(at + 8),
    time: archive.readUInt16LE(at + 10),
    date: archive.readUInt16LE(at + 12),
    extraLength: archive.readUInt16LE(at + 28),
  };
}

describe("zip dựng ra phải xác định được", () => {
  it("gói hai lần cùng một input ra hai file giống hệt nhau về byte", () => {
    expect(buildZip(SAMPLE).equals(buildZip(SAMPLE))).toBe(true);
  });

  it("đảo thứ tự entry lúc đưa vào không đổi được một byte nào của file ra", () => {
    const shuffled = [SAMPLE[2], SAMPLE[0], SAMPLE[3], SAMPLE[1]] as ZipEntry[];
    expect(buildZip(shuffled).equals(buildZip(SAMPLE))).toBe(true);
  });

  it("entry nằm trong file theo đúng thứ tự tên đã sắp", () => {
    expect(readZip(buildZip(SAMPLE)).map((entry) => entry.name)).toEqual([
      "background.js",
      "icons/icon16.png",
      "manifest.json",
      "popup/index.html",
    ]);
  });

  it("mọi local header đều ghim ngày 1980-01-01 00:00:00 chứ không lấy đồng hồ máy", () => {
    const archive = buildZip(SAMPLE);
    let at = 0;
    let seen = 0;
    while (archive.readUInt32LE(at) === ZIP_LOCAL_SIGNATURE) {
      const header = localHeaderAt(archive, at);
      expect(header.time).toBe(PINNED_DOS_TIME);
      expect(header.date).toBe(PINNED_DOS_DATE);
      expect(header.method).toBe(STORE_METHOD);
      expect(header.flags).toBe(0);
      expect(header.extraLength).toBe(0);
      seen += 1;
      at += 30 + archive.readUInt16LE(at + 26) + archive.readUInt32LE(at + 18);
    }
    expect(seen).toBe(4);
    expect(archive.readUInt32LE(at)).toBe(ZIP_CENTRAL_SIGNATURE);
  });

  it("mọi central header cũng ghim đúng ngày đó", () => {
    const archive = buildZip(SAMPLE);
    const eocdAt = archive.length - 22;
    expect(archive.readUInt32LE(eocdAt)).toBe(ZIP_EOCD_SIGNATURE);
    let at = archive.readUInt32LE(eocdAt + 16);
    for (let index = 0; index < 4; index += 1) {
      expect(archive.readUInt32LE(at)).toBe(ZIP_CENTRAL_SIGNATURE);
      expect(archive.readUInt16LE(at + 12)).toBe(PINNED_DOS_TIME);
      expect(archive.readUInt16LE(at + 14)).toBe(PINNED_DOS_DATE);
      at += 46 + archive.readUInt16LE(at + 28) + archive.readUInt16LE(at + 30) + archive.readUInt16LE(at + 32);
    }
  });

  it("đọc lại trả đúng nội dung từng entry", () => {
    const readBack = new Map(readZip(buildZip(SAMPLE)).map((entry) => [entry.name, entry.data]));
    for (const entry of SAMPLE) {
      expect(readBack.get(entry.name)?.equals(entry.data)).toBe(true);
    }
  });
});

describe("đọc zip là đọc thật chứ không tin lời central directory", () => {
  it("sửa một byte nội dung thì CRC không khớp và đọc lại nổ", () => {
    const archive = buildZip(SAMPLE);
    const at = archive.indexOf(Buffer.from("xin chào", "utf8"));
    expect(at).toBeGreaterThan(0);
    archive[at] = archive[at] === 0x78 ? 0x79 : 0x78;
    expect(() => readZip(archive)).toThrow(/CRC32/);
  });

  it("đọc được entry nén bằng deflate do công cụ khác tạo ra", () => {
    const payload = Buffer.from("nội dung nén bằng deflate\n".repeat(30), "utf8");
    const compressed = deflateRawSync(payload, { level: 9 });
    const name = Buffer.from("nen.txt", "ascii");

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(ZIP_LOCAL_SIGNATURE, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(payload), 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(payload.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(ZIP_CENTRAL_SIGNATURE, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(payload), 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(payload.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0, 42);
    name.copy(central, 46);

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(ZIP_EOCD_SIGNATURE, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(central.length, 12);
    eocd.writeUInt32LE(local.length + compressed.length, 16);

    const archive = Buffer.concat([local, compressed, central, eocd]);
    const entries = readZip(archive);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe("nen.txt");
    expect(entries[0]?.data.equals(payload)).toBe(true);
  });

  it("buffer không phải zip thì nổ chứ không trả mảng rỗng", () => {
    expect(() => readZip(Buffer.from("đây không phải zip", "utf8"))).toThrow();
  });
});

describe("secret nằm bên trong zip vẫn phải bị bắt", () => {
  it("token install giấu trong một entry bị quét ra sau khi giải nén", () => {
    const token = `aft1_${"A".repeat(43)}`;
    const archive = buildZip([
      { name: "manifest.json", data: Buffer.from('{"manifest_version":3}', "utf8") },
      { name: "background.js", data: Buffer.from(`const t = "${token}";\n`, "utf8") },
    ]);

    expect(archive.includes(token)).toBe(true);

    const hits = readZip(archive).flatMap((entry) =>
      scanSecretPatterns(entry.data.toString("utf8")).map((match) => `${entry.name}:${match.patternId}`),
    );
    expect(hits).toEqual(["background.js:install-token"]);
  });
});

describe("tên entry không an toàn thì không gói", () => {
  const REJECTED: readonly string[] = [
    "",
    "/manifest.json",
    "popup/",
    "..",
    "../manifest.json",
    "popup/../../manifest.json",
    "popup/./index.html",
    "popup//index.html",
    "popup\\index.html",
    "biểu tượng.png",
    "icon 16.png",
  ];

  const ACCEPTED: readonly string[] = [
    "manifest.json",
    "popup/index.html",
    "chunks/tier0-DYA7yBuG.js",
    "icons/icon128.png",
    "_locales/vi/messages.json",
  ];

  it("từ chối đúng những tên nguy hiểm hoặc không ASCII", () => {
    expect(REJECTED.filter(isSafeZipName)).toEqual([]);
  });

  it("nhận đúng những tên bình thường của một extension", () => {
    expect(ACCEPTED.filter((name) => !isSafeZipName(name))).toEqual([]);
  });

  it("buildZip nổ khi gặp tên nguy hiểm chứ không lặng lẽ bỏ qua", () => {
    expect(() => buildZip([{ name: "../evil.js", data: Buffer.alloc(1) }])).toThrow(/không đóng gói được/);
  });

  it("buildZip nổ khi hai entry trùng tên", () => {
    expect(() =>
      buildZip([
        { name: "a.js", data: Buffer.from("một") },
        { name: "a.js", data: Buffer.from("hai") },
      ]),
    ).toThrow(/lặp/);
  });
});
