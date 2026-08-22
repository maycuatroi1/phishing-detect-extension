import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  MANIFEST_ENTRY_NAME,
  PACKAGE_ZIP_NAME,
  WHY_REFUSED,
  htmlAssetPaths,
  manifestAssetPaths,
  missingAmong,
  partitionPackEntries,
  wrongSizedIcons,
} from "./pack-rules.ts";
import { scanSecretPatterns } from "./secret-patterns.ts";
import { buildZip, readZip, type ZipEntry } from "./zip.ts";

const REPO_ROOT = process.cwd();
const DIST_DIR = resolve(REPO_ROOT, "dist");
const ZIP_PATH = resolve(DIST_DIR, PACKAGE_ZIP_NAME);

function listNames(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      found.push(...listNames(full));
    } else {
      found.push(relative(DIST_DIR, full).split("\\").join("/"));
    }
  }
  return found;
}

function die(lines: readonly string[]): never {
  console.error("");
  for (const line of lines) {
    console.error(line);
  }
  process.exit(1);
}

function looksBinary(data: Buffer): boolean {
  return data.subarray(0, 8192).includes(0);
}

function main(): void {
  let names: string[];
  try {
    names = listNames(DIST_DIR);
  } catch {
    die(["package: không đọc được thư mục dist/. Chạy `pnpm build` trước."]);
  }

  const { packed, refused } = partitionPackEntries(names);
  if (!packed.includes(MANIFEST_ENTRY_NAME)) {
    die([`package: dist/ không có ${MANIFEST_ENTRY_NAME} ở gốc, gói này Chrome không nạp được.`]);
  }

  const entries: ZipEntry[] = packed.map((name) => ({
    name,
    data: readFileSync(resolve(DIST_DIR, name)),
  }));
  const byName = new Map(entries.map((entry) => [entry.name, entry.data]));

  let manifest: unknown;
  try {
    manifest = JSON.parse((byName.get(MANIFEST_ENTRY_NAME) as Buffer).toString("utf8"));
  } catch (cause) {
    die([`package: ${MANIFEST_ENTRY_NAME} không phải JSON đọc được: ${String(cause)}`]);
  }

  const missingManifest = missingAmong(packed, manifestAssetPaths(manifest));
  if (missingManifest.length > 0) {
    die([
      "package: manifest trỏ tới file không có trong gói:",
      ...missingManifest.map((name) => `  ${name}`),
      "Manifest trỏ vào hư không thì Chrome báo lỗi ngay lúc nạp.",
    ]);
  }

  const brokenHtml: string[] = [];
  for (const entry of entries) {
    if (!entry.name.endsWith(".html")) {
      continue;
    }
    for (const target of missingAmong(packed, htmlAssetPaths(entry.name, entry.data.toString("utf8")))) {
      brokenHtml.push(`${entry.name} -> ${target}`);
    }
  }
  if (brokenHtml.length > 0) {
    die([
      "package: trang HTML trong gói tham chiếu file không có trong gói:",
      ...brokenHtml.map((line) => `  ${line}`),
    ]);
  }

  const icons = (manifest as { icons?: Record<string, string> }).icons ?? {};
  const badIcons = wrongSizedIcons(icons, (name) => byName.get(name) ?? null);
  if (badIcons.length > 0) {
    die(["package: icon trong manifest không dùng được:", ...badIcons.map((line) => `  ${line}`)]);
  }

  const archive = buildZip(entries);

  let readBack: ZipEntry[];
  try {
    readBack = readZip(archive);
  } catch (cause) {
    die([`package: zip vừa dựng đọc lại không được: ${String(cause)}`]);
  }

  const readBackNames = readBack.map((entry) => entry.name);
  if (readBackNames.join("\n") !== packed.join("\n")) {
    die([
      "package: danh sách entry đọc lại từ zip khác danh sách vừa gói.",
      `  gói:      ${packed.join(", ")}`,
      `  đọc lại:  ${readBackNames.join(", ")}`,
    ]);
  }

  const leaks: string[] = [];
  let scannedEntries = 0;
  let skippedBinary = 0;
  for (const entry of readBack) {
    if (looksBinary(entry.data)) {
      skippedBinary += 1;
      continue;
    }
    scannedEntries += 1;
    for (const match of scanSecretPatterns(entry.data.toString("utf8"))) {
      leaks.push(`${entry.name}: ${match.label} ở byte ${match.index}, ${match.preview}`);
    }
  }
  if (leaks.length > 0) {
    die([
      `package: THẤT BẠI, ${leaks.length} pattern secret nằm trong ${PACKAGE_ZIP_NAME}:`,
      ...leaks.map((line) => `  ${line}`),
      "File zip là file ai cũng tải được. Rotate thứ vừa lộ rồi build lại.",
    ]);
  }

  writeFileSync(ZIP_PATH, archive);

  console.log(`package: ${PACKAGE_ZIP_NAME} có ${readBack.length} entry, ${archive.length} byte.`);
  console.log(`package: sha256 ${createHash("sha256").update(archive).digest("hex")}`);
  console.log(
    `package: quét ${scannedEntries} entry văn bản bên trong zip, bỏ qua ${skippedBinary} entry nhị phân, không thấy pattern secret nào.`,
  );
  for (const decision of refused) {
    console.log(
      `package: bỏ ngoài gói ${decision.name} (${decision.refusal}: ${WHY_REFUSED[decision.refusal]}).`,
    );
  }
  console.log(`package: ghi ${relative(REPO_ROOT, ZIP_PATH).split("\\").join("/")}.`);
}

main();
