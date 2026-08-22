export const AFBL_MAGIC = "AFBL";

export const AFBL_MAGIC_BYTES: readonly number[] = [0x41, 0x46, 0x42, 0x4c];

export const AFBL_FORMAT = 1;

export const AFBL_SOFT_FORMAT = 2;

export const AFBL_FORMATS: readonly number[] = [AFBL_FORMAT, AFBL_SOFT_FORMAT];

export const AFBL_PREFERRED_FORMAT = AFBL_SOFT_FORMAT;

export const AFBL_FALLBACK_FORMAT = AFBL_FORMAT;

export const AFBL_HEADER_BYTES = 18;

export const AFBL_SOFT_HEADER_BYTES = 22;

export const AFBL_ENTRY_BYTES = 8;

export const AFBL_FORMAT_OFFSET = 4;

export const AFBL_VERSION_OFFSET = 6;

export const AFBL_PHISH_COUNT_OFFSET = 10;

export const AFBL_LEGIT_COUNT_OFFSET = 14;

export const AFBL_SOFT_COUNT_OFFSET = 18;

export const AFBL_MAX_UINT32 = 0xffffffff;

export const AFBL_HASH_HEX_LENGTH = 16;

export interface AfblArtifact {
  readonly format: number;
  readonly version: number;
  readonly phish: BigUint64Array;
  readonly legit: BigUint64Array;
  readonly soft: BigUint64Array;
}

export type AfblRefusalCode =
  | "too_short"
  | "bad_magic"
  | "unsupported_format"
  | "truncated_body"
  | "trailing_bytes"
  | "unsorted_entries";

export interface AfblRefusal {
  readonly code: AfblRefusalCode;
  readonly message: string;
}

export type AfblDecodeResult =
  | { readonly ok: true; readonly artifact: AfblArtifact }
  | { readonly ok: false; readonly refusal: AfblRefusal };

export function isAfblFormat(format: number): boolean {
  return AFBL_FORMATS.includes(format);
}

export function afblCarriesSoft(format: number): boolean {
  return format >= AFBL_SOFT_FORMAT;
}

export function afblHeaderBytes(format: number): number {
  return afblCarriesSoft(format) ? AFBL_SOFT_HEADER_BYTES : AFBL_HEADER_BYTES;
}

export function afblByteLength(
  phishCount: number,
  legitCount: number,
  softCount = 0,
  format: number = AFBL_FORMAT,
): number {
  return afblHeaderBytes(format) + (phishCount + legitCount + softCount) * AFBL_ENTRY_BYTES;
}

function refuse(code: AfblRefusalCode, message: string): AfblDecodeResult {
  return { ok: false, refusal: { code, message } };
}

function readSortedEntries(
  view: DataView,
  start: number,
  count: number,
): { entries: BigUint64Array; ascending: boolean } {
  const entries = new BigUint64Array(count);
  let ascending = true;
  let previous = 0n;

  for (let index = 0; index < count; index += 1) {
    const entry = view.getBigUint64(start + index * AFBL_ENTRY_BYTES, true);
    if (index > 0 && entry <= previous) {
      ascending = false;
    }
    previous = entry;
    entries[index] = entry;
  }

  return { entries, ascending };
}

export function decodeAfbl(bytes: Uint8Array): AfblDecodeResult {
  if (bytes.byteLength < AFBL_HEADER_BYTES) {
    return refuse(
      "too_short",
      `Artifact AFBL tối thiểu là ${AFBL_HEADER_BYTES} byte header, nhận được ${bytes.byteLength}. Giữ bản đang có.`,
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  for (let index = 0; index < AFBL_MAGIC_BYTES.length; index += 1) {
    if (view.getUint8(index) !== AFBL_MAGIC_BYTES[index]) {
      return refuse(
        "bad_magic",
        `${AFBL_MAGIC_BYTES.length} byte đầu không phải "${AFBL_MAGIC}". Đây không phải artifact blocklist. Giữ bản đang có.`,
      );
    }
  }

  const format = view.getUint16(AFBL_FORMAT_OFFSET, true);
  if (!isAfblFormat(format)) {
    return refuse(
      "unsupported_format",
      `Format ${format} không nằm trong bộ format ${AFBL_FORMATS.join(" và ")} mà decoder này đọc được. Giữ bản đang có thay vì đoán layout.`,
    );
  }

  const headerBytes = afblHeaderBytes(format);
  if (bytes.byteLength < headerBytes) {
    return refuse(
      "too_short",
      `Artifact AFBL format ${format} tối thiểu là ${headerBytes} byte header, nhận được ${bytes.byteLength}. Giữ bản đang có.`,
    );
  }

  const version = view.getUint32(AFBL_VERSION_OFFSET, true);
  const phishCount = view.getUint32(AFBL_PHISH_COUNT_OFFSET, true);
  const legitCount = view.getUint32(AFBL_LEGIT_COUNT_OFFSET, true);
  const softCount = afblCarriesSoft(format) ? view.getUint32(AFBL_SOFT_COUNT_OFFSET, true) : 0;

  const expected = afblByteLength(phishCount, legitCount, softCount, format);
  if (bytes.byteLength < expected) {
    return refuse(
      "truncated_body",
      `Header khai ${phishCount} entry phish, ${legitCount} entry legit và ${softCount} entry mềm, cần ${expected} byte, nhưng artifact chỉ có ${bytes.byteLength} byte. Giữ bản đang có.`,
    );
  }
  if (bytes.byteLength > expected) {
    return refuse(
      "trailing_bytes",
      `Header khai ${expected} byte nhưng artifact có ${bytes.byteLength} byte. Byte thừa bị từ chối chứ không bị bỏ qua. Giữ bản đang có.`,
    );
  }

  const phish = readSortedEntries(view, headerBytes, phishCount);
  if (!phish.ascending) {
    return refuse(
      "unsorted_entries",
      "Mảng phish không tăng ngặt, tìm nhị phân trên đó sẽ bỏ sót host. Giữ bản đang có.",
    );
  }

  const legitStart = headerBytes + phishCount * AFBL_ENTRY_BYTES;
  const legit = readSortedEntries(view, legitStart, legitCount);
  if (!legit.ascending) {
    return refuse(
      "unsorted_entries",
      "Mảng legit không tăng ngặt, tìm nhị phân trên đó sẽ bỏ sót host. Giữ bản đang có.",
    );
  }

  const softStart = legitStart + legitCount * AFBL_ENTRY_BYTES;
  const soft = readSortedEntries(view, softStart, softCount);
  if (!soft.ascending) {
    return refuse(
      "unsorted_entries",
      "Mảng mềm không tăng ngặt, tìm nhị phân trên đó sẽ bỏ sót host. Giữ bản đang có.",
    );
  }

  return {
    ok: true,
    artifact: {
      format,
      version,
      phish: phish.entries,
      legit: legit.entries,
      soft: soft.entries,
    },
  };
}

export function afblContains(entries: BigUint64Array, candidate: bigint): boolean {
  let low = 0;
  let high = entries.length - 1;

  while (low <= high) {
    const middle = (low + high) >>> 1;
    const entry = entries[middle];
    if (entry === candidate) {
      return true;
    }
    if (entry < candidate) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return false;
}

export function afblEtag(format: number, version: number): string {
  return `"afbl-${format}-${version}"`;
}

export function afblPinnedPath(format: number, version: number): string {
  return `/v1/blocklist/v/${version}?format=${format}`;
}

function assertUint32(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > AFBL_MAX_UINT32) {
    throw new Error(`${label} phải là số nguyên trong [0, ${AFBL_MAX_UINT32}], nhận ${value}.`);
  }
}

export function encodeAfbl(input: {
  readonly version: number;
  readonly format?: number;
  readonly phish: readonly bigint[];
  readonly legit: readonly bigint[];
  readonly soft?: readonly bigint[];
}): Uint8Array {
  const format = input.format ?? AFBL_FORMAT;
  const soft = input.soft ?? [];

  if (soft.length > 0 && !afblCarriesSoft(format)) {
    throw new Error(
      `Format ${format} không có mảng mềm, mà lời gọi đưa vào ${soft.length} entry mềm. Entry mềm chỉ đi trong format ${AFBL_SOFT_FORMAT}: gộp chúng vào mảng phish của format ${AFBL_FORMAT} là bắt một client cũ sơn badge đỏ cho một kết luận chưa người nào xác nhận.`,
    );
  }

  assertUint32(input.version, "version của artifact");
  assertUint32(input.phish.length, "phish_n");
  assertUint32(input.legit.length, "legit_n");
  assertUint32(soft.length, "soft_n");

  const bytes = new Uint8Array(
    afblByteLength(input.phish.length, input.legit.length, soft.length, format),
  );
  const view = new DataView(bytes.buffer);

  bytes.set(AFBL_MAGIC_BYTES, 0);
  view.setUint16(AFBL_FORMAT_OFFSET, format, true);
  view.setUint32(AFBL_VERSION_OFFSET, input.version, true);
  view.setUint32(AFBL_PHISH_COUNT_OFFSET, input.phish.length, true);
  view.setUint32(AFBL_LEGIT_COUNT_OFFSET, input.legit.length, true);
  if (afblCarriesSoft(format)) {
    view.setUint32(AFBL_SOFT_COUNT_OFFSET, soft.length, true);
  }

  let offset = afblHeaderBytes(format);
  for (const entry of input.phish) {
    view.setBigUint64(offset, entry, true);
    offset += AFBL_ENTRY_BYTES;
  }
  for (const entry of input.legit) {
    view.setBigUint64(offset, entry, true);
    offset += AFBL_ENTRY_BYTES;
  }
  for (const entry of soft) {
    view.setBigUint64(offset, entry, true);
    offset += AFBL_ENTRY_BYTES;
  }

  return bytes;
}
