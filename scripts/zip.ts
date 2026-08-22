import { inflateRawSync } from "node:zlib";

export const ZIP_LOCAL_SIGNATURE = 0x04034b50;

export const ZIP_CENTRAL_SIGNATURE = 0x02014b50;

export const ZIP_EOCD_SIGNATURE = 0x06054b50;

export const ZIP_EOCD_LENGTH = 22;

export const ZIP_METHOD_STORE = 0;

export const ZIP_METHOD_DEFLATE = 8;

export const ZIP_VERSION_NEEDED = 20;

export const ZIP_VERSION_MADE_BY = 20;

export const ZIP_PINNED_DOS_DATE = 0x0021;

export const ZIP_PINNED_DOS_TIME = 0x0000;

export const ZIP_PINNED_EXTERNAL_ATTRIBUTES = 0;

export const ZIP_PINNED_FLAGS = 0;

export const ZIP_MAX_NAME_LENGTH = 255;

export interface ZipEntry {
  readonly name: string;
  readonly data: Buffer;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(data: Buffer): number {
  let value = 0xffffffff;
  for (const byte of data) {
    value = (CRC_TABLE[(value ^ byte) & 0xff] as number) ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

export function isSafeZipName(name: string): boolean {
  if (name.length === 0 || name.length > ZIP_MAX_NAME_LENGTH) {
    return false;
  }
  if (name.startsWith("/") || name.endsWith("/")) {
    return false;
  }
  if (name.includes("\\") || name.includes("//")) {
    return false;
  }
  if (/[^\x21-\x7e]/.test(name)) {
    return false;
  }
  return !name.split("/").some((part) => part === "" || part === "." || part === "..");
}

function sortedUniqueEntries(entries: readonly ZipEntry[]): ZipEntry[] {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!isSafeZipName(entry.name)) {
      throw new Error(`Tên entry không đóng gói được: ${JSON.stringify(entry.name)}.`);
    }
    if (seen.has(entry.name)) {
      throw new Error(`Entry ${entry.name} bị lặp trong cùng một zip.`);
    }
    seen.add(entry.name);
  }
  return [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export function buildZip(entries: readonly ZipEntry[]): Buffer {
  const ordered = sortedUniqueEntries(entries);

  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of ordered) {
    const name = Buffer.from(entry.name, "ascii");
    const checksum = crc32(entry.data);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(ZIP_LOCAL_SIGNATURE, 0);
    local.writeUInt16LE(ZIP_VERSION_NEEDED, 4);
    local.writeUInt16LE(ZIP_PINNED_FLAGS, 6);
    local.writeUInt16LE(ZIP_METHOD_STORE, 8);
    local.writeUInt16LE(ZIP_PINNED_DOS_TIME, 10);
    local.writeUInt16LE(ZIP_PINNED_DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(ZIP_CENTRAL_SIGNATURE, 0);
    central.writeUInt16LE(ZIP_VERSION_MADE_BY, 4);
    central.writeUInt16LE(ZIP_VERSION_NEEDED, 6);
    central.writeUInt16LE(ZIP_PINNED_FLAGS, 8);
    central.writeUInt16LE(ZIP_METHOD_STORE, 10);
    central.writeUInt16LE(ZIP_PINNED_DOS_TIME, 12);
    central.writeUInt16LE(ZIP_PINNED_DOS_DATE, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(ZIP_PINNED_EXTERNAL_ATTRIBUTES, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);

    locals.push(local, entry.data);
    centrals.push(central);
    offset += local.length + entry.data.length;
  }

  const directory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(ZIP_EOCD_LENGTH);
  eocd.writeUInt32LE(ZIP_EOCD_SIGNATURE, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(ordered.length, 8);
  eocd.writeUInt16LE(ordered.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, directory, eocd]);
}

function eocdOffset(buffer: Buffer): number {
  const floor = Math.max(0, buffer.length - ZIP_EOCD_LENGTH - 0xffff);
  for (let at = buffer.length - ZIP_EOCD_LENGTH; at >= floor; at -= 1) {
    if (buffer.readUInt32LE(at) === ZIP_EOCD_SIGNATURE) {
      return at;
    }
  }
  throw new Error("Không tìm thấy end of central directory, đây không phải zip đọc được.");
}

export function readZip(buffer: Buffer): ZipEntry[] {
  if (buffer.length < ZIP_EOCD_LENGTH) {
    throw new Error(`Zip chỉ dài ${buffer.length} byte, ngắn hơn cả end of central directory.`);
  }

  const eocd = eocdOffset(buffer);
  const total = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);

  const entries: ZipEntry[] = [];
  for (let index = 0; index < total; index += 1) {
    if (buffer.readUInt32LE(cursor) !== ZIP_CENTRAL_SIGNATURE) {
      throw new Error(`Central directory hỏng ở entry thứ ${index}.`);
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const checksum = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);

    if (buffer.readUInt32LE(localOffset) !== ZIP_LOCAL_SIGNATURE) {
      throw new Error(`Local header của ${name} hỏng.`);
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataAt = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataAt, dataAt + compressedSize);

    let data: Buffer;
    if (method === ZIP_METHOD_STORE) {
      data = Buffer.from(raw);
    } else if (method === ZIP_METHOD_DEFLATE) {
      data = inflateRawSync(raw);
    } else {
      throw new Error(`Entry ${name} dùng method ${method}, script này chỉ đọc store và deflate.`);
    }

    if (data.length !== uncompressedSize) {
      throw new Error(`Entry ${name} giải ra ${data.length} byte, central directory ghi ${uncompressedSize}.`);
    }
    if (crc32(data) !== checksum) {
      throw new Error(`Entry ${name} sai CRC32, nội dung zip không toàn vẹn.`);
    }

    entries.push({ name, data });
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}
