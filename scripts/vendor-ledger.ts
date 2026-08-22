import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = process.cwd();

export const VENDOR_LEDGER_PATH = resolve(REPO_ROOT, "vendor/VENDORED.json");

export interface VendoredContract {
  readonly seam: string;
  readonly owner: string;
  readonly source_path: string;
  readonly path: string;
  readonly algorithm: string;
  readonly digest: string;
  readonly bytes: number;
  readonly line_ending: string;
  readonly change_policy: string;
}

export interface VendorLedger {
  readonly schema: number;
  readonly owner_repo: string;
  readonly owner_commit: string;
  readonly contracts: Record<string, VendoredContract>;
}

export interface VendorProblem {
  readonly seam: string;
  readonly path: string;
  readonly detail: string;
}

export function readVendorLedger(): VendorLedger {
  return JSON.parse(readFileSync(VENDOR_LEDGER_PATH, "utf8")) as VendorLedger;
}

export function vendoredPath(contract: VendoredContract): string {
  return resolve(REPO_ROOT, contract.path);
}

export function readVendoredBytes(contract: VendoredContract): Buffer {
  return readFileSync(vendoredPath(contract));
}

export function checkVendoredContracts(ledger: VendorLedger): VendorProblem[] {
  const problems: VendorProblem[] = [];

  for (const [seam, contract] of Object.entries(ledger.contracts)) {
    const full = vendoredPath(contract);

    if (!existsSync(full)) {
      problems.push({
        seam,
        path: contract.path,
        detail: "file vendor không tồn tại, copy lại từ repo owner rồi chạy lại",
      });
      continue;
    }

    if (contract.algorithm !== "sha256") {
      problems.push({
        seam,
        path: contract.path,
        detail: `ledger khai algorithm ${contract.algorithm}, chỗ này chỉ biết sha256`,
      });
      continue;
    }

    const bytes = readFileSync(full);

    if (bytes.byteLength !== contract.bytes) {
      problems.push({
        seam,
        path: contract.path,
        detail: `độ dài ${bytes.byteLength} byte, ledger khai ${contract.bytes} byte`,
      });
    }

    if (contract.line_ending === "lf" && bytes.includes(0x0d)) {
      problems.push({
        seam,
        path: contract.path,
        detail:
          "file có byte CR nhưng ledger khai LF thuần. Kiểm tra dòng `vendor/** -text` trong .gitattributes rồi checkout lại",
      });
    }

    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== contract.digest) {
      problems.push({
        seam,
        path: contract.path,
        detail: `sha256 là ${digest}, ledger khai ${contract.digest}`,
      });
    }
  }

  return problems;
}
