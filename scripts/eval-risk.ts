import { readFileSync } from "node:fs";
import { RISK_THRESHOLD, isHighRisk, scoreHost } from "../src/lib/risk.ts";

const DEFAULT_DIR = "../phishing-detect-web/exports/eval-v1";

function load(path: string): string[] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line.length > 0)
    .map((line) => line.split("/")[0]);
}

const dir = process.argv[2] ?? DEFAULT_DIR;
const black = load(`${dir}/eval_blacklist.txt`);
const white = load(`${dir}/eval_whitelist.txt`);

const caught = black.filter((host) => isHighRisk(scoreHost(host)));
const flagged = white.filter((host) => isHighRisk(scoreHost(host)));

console.log(`ngưỡng: ${RISK_THRESHOLD}`);
console.log(`blacklist: ${caught.length}/${black.length} = ${((caught.length / black.length) * 100).toFixed(1)}% bắt được`);
console.log(`whitelist: ${flagged.length}/${white.length} = ${((flagged.length / white.length) * 100).toFixed(2)}% báo nhầm`);

if (flagged.length > 0) {
  console.log("\nhost hợp lệ bị vượt ngưỡng:");
  for (const host of flagged) {
    const risk = scoreHost(host);
    console.log(`  ${risk.score}  ${host}  ${risk.signals.map((signal) => signal.id).join(",")}`);
  }
}

const distribution = new Map<number, number>();
for (const host of black) {
  const score = scoreHost(host).score;
  distribution.set(score, (distribution.get(score) ?? 0) + 1);
}
console.log("\nphân bố điểm trên blacklist:");
for (const score of Array.from(distribution.keys()).sort((left, right) => left - right)) {
  console.log(`  ${String(score).padStart(2)}: ${distribution.get(score)}`);
}
