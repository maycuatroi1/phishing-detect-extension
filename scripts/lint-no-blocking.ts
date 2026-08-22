import { resolve } from "node:path";
import {
  NO_BLOCKING_RATIONALE,
  findBlockingViolations,
  type BlockingViolation,
} from "./no-blocking-rules.ts";

const REPO_ROOT = process.cwd();

function report(violations: readonly BlockingViolation[]): void {
  console.error("lint-no-blocking: THẤT BẠI.");
  for (const violation of violations) {
    console.error(`  [${violation.rule}] ${violation.where}: ${violation.what}.`);
    console.error(`      ${violation.why}`);
  }
  console.error("");
  for (const line of NO_BLOCKING_RATIONALE) {
    console.error(line);
  }
}

function main(): void {
  const violations = findBlockingViolations({
    root: REPO_ROOT,
    manifestPath: resolve(REPO_ROOT, "public/manifest.json"),
    sourceDir: resolve(REPO_ROOT, "src"),
  });

  if (violations.length === 0) {
    console.log("lint-no-blocking: OK, extension chỉ cảnh báo chứ không chặn.");
    return;
  }

  report(violations);
  process.exit(1);
}

main();
