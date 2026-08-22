import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parse as parseDotenv } from "dotenv";
import { scanSecretPatterns } from "./secret-patterns.ts";

const REPO_ROOT = process.cwd();
const DIST_DIR = resolve(REPO_ROOT, "dist");
const PUBLIC_PREFIX = "PUBLIC_";

const ENV_NAME_SHAPE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;
const ENV_REFERENCE =
  /(?:process\s*\.\s*env|import\s*\.\s*meta\s*\.\s*env)\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*(?:"([^"]+)"|'([^']+)')\s*\])/g;

const VITE_BUILTIN_ENV_KEYS = new Set(["MODE", "DEV", "PROD", "SSR", "BASE_URL", "LEGACY"]);

const NOISE_ENV_NAMES = new Set([
  "ALLUSERSPROFILE", "APPDATA", "CI", "COLORTERM", "COMMONPROGRAMFILES", "COMMONPROGRAMFILES(X86)",
  "COMMONPROGRAMW6432", "COMPUTERNAME", "COMSPEC", "CONDA_DEFAULT_ENV", "CONDA_EXE", "CONDA_PREFIX",
  "CONDA_PROMPT_MODIFIER", "CONDA_PYTHON_EXE", "CONDA_SHLVL", "DRIVERDATA", "EDITOR", "EXEPATH",
  "GIT_EDITOR", "GOPATH", "HOME", "HOMEDRIVE", "HOMEPATH", "INIT_CWD", "JAVA_HOME", "LANG", "LC_ALL",
  "LOCALAPPDATA", "LOGONSERVER", "MSYSTEM", "NODE_ENV", "NODE_OPTIONS", "NODE_PATH", "NODE_VERSION",
  "NUMBER_OF_PROCESSORS", "ONEDRIVE", "OS", "PAGER", "PATH", "PATHEXT", "PLINK_PROTOCOL",
  "PROCESSOR_ARCHITECTURE", "PROCESSOR_ARCHITEW6432", "PROCESSOR_IDENTIFIER", "PROCESSOR_LEVEL",
  "PROCESSOR_REVISION", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432", "PROMPT",
  "PSMODULEPATH", "PUBLIC", "PWD", "SESSIONNAME", "SHELL", "SHLVL", "SSL_CERT_FILE", "SYSTEMDRIVE",
  "SYSTEMROOT", "TEMP", "TERM", "TERM_PROGRAM", "TMP", "TMPDIR", "USERDOMAIN",
  "USERDOMAIN_ROAMINGPROFILE", "USERNAME", "USERPROFILE", "VIRTUAL_ENV", "WINDIR", "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME", "XDG_DATA_HOME",
]);

const NOISE_ENV_PREFIXES = ["npm_", "NPM_", "PNPM_", "COREPACK_", "WARP_", "EFC_", "FPS_BROWSER_", "__"];

const SKIPPABLE_VALUES =
  /^(?:true|false|yes|no|on|off|production|development|staging|test|local|none|null|undefined)$/i;

const PROCESS_ENV_MIN_VALUE_LENGTH = 16;
const DOTENV_MIN_VALUE_LENGTH = 8;
const MIN_SCANNED_NAME_LENGTH = 6;

interface EnvEntry {
  readonly name: string;
  readonly value: string;
  readonly source: string;
  readonly trustValue: boolean;
}

type FindingKind = "env-var-name" | "env-var-value" | "env-var-reference" | "secret-pattern";

interface Finding {
  readonly kind: FindingKind;
  readonly variable: string;
  readonly chunk: string;
  readonly detail: string;
}

function isNoiseName(name: string): boolean {
  if (NOISE_ENV_NAMES.has(name.toUpperCase())) return true;
  return NOISE_ENV_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function isPublic(name: string): boolean {
  return name.startsWith(PUBLIC_PREFIX);
}

function collectEnvEntries(): EnvEntry[] {
  const entries: EnvEntry[] = [];
  for (const [name, value] of Object.entries(process.env)) {
    if (typeof value !== "string") continue;
    entries.push({ name, value, source: "process.env", trustValue: true });
  }
  const envFiles = readdirSync(REPO_ROOT)
    .filter((file) => file === ".env" || file.startsWith(".env."))
    .sort();
  for (const file of envFiles) {
    const full = join(REPO_ROOT, file);
    if (!statSync(full).isFile()) continue;
    const parsed = parseDotenv(readFileSync(full, "utf8"));
    for (const [name, value] of Object.entries(parsed)) {
      entries.push({ name, value, source: file, trustValue: file !== ".env.example" });
    }
  }
  return entries;
}

function isNameScannable(entry: EnvEntry): boolean {
  if (isPublic(entry.name)) return false;
  if (entry.name.length < MIN_SCANNED_NAME_LENGTH) return false;
  if (!ENV_NAME_SHAPE.test(entry.name)) return false;
  if (entry.source === "process.env" && isNoiseName(entry.name)) return false;
  return true;
}

function isValueScannable(entry: EnvEntry): boolean {
  if (isPublic(entry.name)) return false;
  if (!entry.trustValue) return false;
  if (entry.source === "process.env" && isNoiseName(entry.name)) return false;
  const value = entry.value;
  const floor =
    entry.source === "process.env" ? PROCESS_ENV_MIN_VALUE_LENGTH : DOTENV_MIN_VALUE_LENGTH;
  if (value.length < floor) return false;
  if (/^[0-9]+$/.test(value)) return false;
  if (SKIPPABLE_VALUES.test(value)) return false;
  if (value.includes(";")) return false;
  if (value.includes("\\")) return false;
  if (/^[A-Za-z]:[\\/]/.test(value)) return false;
  if (/^\/(?:[A-Za-z]|usr|bin|home|etc|opt|var|tmp|mnt|proc|dev)\//.test(value)) return false;
  if (value.includes("node_modules")) return false;
  return true;
}

function listFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      found.push(...listFiles(full));
    } else {
      found.push(full);
    }
  }
  return found;
}

function looksBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, 8192).includes(0);
}

function chunkName(file: string): string {
  return relative(DIST_DIR, file).split("\\").join("/");
}

function occurrencesOf(haystack: string, needle: string): number[] {
  const positions: number[] = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return positions;
    positions.push(at);
    from = at + needle.length;
  }
}

function main(): void {
  if (!existsSync(DIST_DIR)) {
    console.error("check-no-secrets: không thấy thư mục dist/. Chạy `vite build` trước.");
    process.exit(2);
  }

  const files = listFiles(DIST_DIR);
  if (files.length === 0) {
    console.error("check-no-secrets: dist/ rỗng, không có gì để quét.");
    process.exit(2);
  }

  const envEntries = collectEnvEntries();
  const nameTargets = envEntries.filter(isNameScannable);
  const valueTargets = envEntries.filter(isValueScannable);

  const findings: Finding[] = [];
  let scannedFiles = 0;
  let skippedBinary = 0;
  let scannedBytes = 0;

  for (const file of files) {
    const buffer = readFileSync(file);
    if (looksBinary(buffer)) {
      skippedBinary += 1;
      continue;
    }
    const chunk = chunkName(file);
    const text = buffer.toString("utf8");
    scannedFiles += 1;
    scannedBytes += buffer.length;

    for (const entry of nameTargets) {
      for (const at of occurrencesOf(text, entry.name)) {
        findings.push({
          kind: "env-var-name",
          variable: entry.name,
          chunk,
          detail: `tên biến xuất hiện nguyên văn ở byte ${at}, nguồn ${entry.source}`,
        });
      }
    }

    for (const entry of valueTargets) {
      for (const at of occurrencesOf(text, entry.value)) {
        findings.push({
          kind: "env-var-value",
          variable: entry.name,
          chunk,
          detail: `giá trị của biến nằm trong chunk ở byte ${at}, nguồn ${entry.source}`,
        });
      }
    }

    const references = new RegExp(ENV_REFERENCE.source, ENV_REFERENCE.flags);
    let reference: RegExpExecArray | null = references.exec(text);
    while (reference !== null) {
      const name = reference[1] ?? reference[2] ?? reference[3] ?? "";
      const flaggable =
        name.length > 0 && !isPublic(name) && !VITE_BUILTIN_ENV_KEYS.has(name) && !isNoiseName(name);
      if (flaggable) {
        findings.push({
          kind: "env-var-reference",
          variable: name,
          chunk,
          detail: `chunk còn đọc biến môi trường lúc chạy ở byte ${reference.index}`,
        });
      }
      reference = references.exec(text);
    }

    for (const match of scanSecretPatterns(text)) {
      findings.push({
        kind: "secret-pattern",
        variable: match.patternId,
        chunk,
        detail: `${match.label} ở byte ${match.index}, ${match.preview}`,
      });
    }
  }

  console.log(
    `check-no-secrets: quét ${scannedFiles} file văn bản (${scannedBytes} byte) trong dist/, bỏ qua ${skippedBinary} file nhị phân.`,
  );
  console.log(
    `check-no-secrets: đối chiếu ${nameTargets.length} tên biến và ${valueTargets.length} giá trị biến không có tiền tố ${PUBLIC_PREFIX}.`,
  );

  if (findings.length === 0) {
    console.log(
      "check-no-secrets: OK, không có biến ngoài PUBLIC_ và không có pattern secret nào trong bundle.",
    );
    return;
  }

  console.error("");
  console.error(`check-no-secrets: THẤT BẠI, ${findings.length} phát hiện trong dist/.`);
  for (const finding of findings) {
    console.error(`  [${finding.kind}] biến=${finding.variable} chunk=${finding.chunk}`);
    console.error(`      ${finding.detail}`);
  }
  console.error("");
  console.error(
    `Bundle của extension là file công khai ai cũng tải được. Đổi tên biến sang tiền tố ${PUBLIC_PREFIX} nếu nó thật sự công khai, hoặc bỏ nó ra khỏi bundle. Chi tiết trong AGENTS.md.`,
  );
  process.exit(1);
}

main();
