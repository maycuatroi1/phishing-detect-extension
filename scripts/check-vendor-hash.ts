import { checkVendoredContracts, readVendorLedger } from "./vendor-ledger.ts";

function main(): void {
  const ledger = readVendorLedger();
  const problems = checkVendoredContracts(ledger);
  const total = Object.keys(ledger.contracts).length;

  if (problems.length === 0) {
    console.log(
      `check-vendor-hash: OK, ${total} file seam vendor từ ${ledger.owner_repo}@${ledger.owner_commit.slice(0, 7)} khớp băm.`,
    );
    return;
  }

  console.error(`check-vendor-hash: THẤT BẠI, ${problems.length} vấn đề.`);
  for (const problem of problems) {
    console.error(`  [${problem.seam}] ${problem.path}`);
    console.error(`      ${problem.detail}`);
  }
  console.error("");
  console.error(
    `Hai file trong vendor/ là hợp đồng API thật của ${ledger.owner_repo}, không phải bản chép tay. Một digest lệch nghĩa là seam đã đổi: đọc diff của bản upstream trước, đừng sửa vendor/VENDORED.json cho hết đỏ.`,
  );
  process.exit(1);
}

main();
