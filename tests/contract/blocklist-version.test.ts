import "fake-indexeddb/auto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { clearStoredBlocklist, readStoredBlocklist } from "../../src/lib/blocklist-store.ts";
import {
  acceptsIncomingVersion,
  blocklistAgeMs,
  syncBlocklist,
} from "../../src/lib/blocklist-sync.ts";
import { invalidateTier0Cache, lookupHost } from "../../src/lib/tier0.ts";
import { PHISH_HOST, blocklistResponse, fixtureArtifact } from "../helpers/fixture.ts";

const BASE_URL = "https://anti-fraud.omelet.tech";

const SRC_DIR = resolve(process.cwd(), "src");

function listSourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      found.push(...listSourceFiles(full));
    } else if (name.endsWith(".ts")) {
      found.push(full);
    }
  }
  return found;
}

const CLOCK_TOKENS = [
  "new Date(",
  "Date.now()",
  "Date.parse(",
  "toISOString(",
  "getTime()",
  "* 1000",
  "/ 1000",
  "* 1_000",
  "/ 1_000",
];

async function seed(version: number): Promise<void> {
  const outcome = await syncBlocklist({
    baseUrl: BASE_URL,
    fetchImpl: (async () =>
      blocklistResponse(await fixtureArtifact(version), version)) as unknown as typeof fetch,
  });
  expect(outcome.kind).toBe("fresh");
  invalidateTier0Cache();
}

beforeEach(async () => {
  await clearStoredBlocklist();
  invalidateTier0Cache();
});

describe("version của artifact là số thứ tự thay đổi nội dung, không phải đồng hồ", () => {
  it("chỉ so mới hơn hoặc bằng, không suy ra thời điểm nào", () => {
    expect(acceptsIncomingVersion(null, 0)).toBe(true);
    expect(acceptsIncomingVersion(null, 4294967295)).toBe(true);
    expect(acceptsIncomingVersion(10, 11)).toBe(true);
    expect(acceptsIncomingVersion(10, 10)).toBe(true);
    expect(acceptsIncomingVersion(10, 9)).toBe(false);
    expect(acceptsIncomingVersion(83338345, 1)).toBe(false);
  });

  it("version lùi thì bỏ qua và giữ bản đang có", async () => {
    await seed(100);
    const outcome = await syncBlocklist({
      baseUrl: BASE_URL,
      fetchImpl: (async () =>
        blocklistResponse(await fixtureArtifact(99), 99)) as unknown as typeof fetch,
    });
    expect(outcome.kind).toBe("rejected_older");
    if (outcome.kind !== "rejected_older") return;
    expect(outcome.incomingVersion).toBe(99);
    expect(outcome.keptVersion).toBe(100);
    expect((await readStoredBlocklist())?.version).toBe(100);
  });

  it("corpus quay về nội dung cũ nhận version MỚI CAO HƠN, client phải nhận chứ không được đòi version cũ", async () => {
    const entriesAt = async (version: number, hosts: readonly string[]) =>
      blocklistResponse(await fixtureArtifact(version, hosts, []), version);

    await syncBlocklist({
      baseUrl: BASE_URL,
      fetchImpl: (async () => entriesAt(7, [PHISH_HOST])) as unknown as typeof fetch,
    });
    invalidateTier0Cache();
    expect((await lookupHost(PHISH_HOST)).verdict).toBe("phishing");

    await syncBlocklist({
      baseUrl: BASE_URL,
      fetchImpl: (async () => entriesAt(8, [])) as unknown as typeof fetch,
    });
    invalidateTier0Cache();
    expect((await lookupHost(PHISH_HOST)).verdict).toBe("unknown");

    const backToOldContent = await syncBlocklist({
      baseUrl: BASE_URL,
      fetchImpl: (async () => entriesAt(9, [PHISH_HOST])) as unknown as typeof fetch,
    });
    expect(backToOldContent.kind).toBe("fresh");
    if (backToOldContent.kind !== "fresh") return;
    expect(backToOldContent.version).toBe(9);

    invalidateTier0Cache();
    expect((await lookupHost(PHISH_HOST)).verdict).toBe("phishing");
    expect((await readStoredBlocklist())?.version).toBe(9);
  });

  it("version bằng nhau vẫn nhận, vì cùng version là cùng byte", async () => {
    await seed(100);
    const outcome = await syncBlocklist({
      baseUrl: BASE_URL,
      fetchImpl: (async () =>
        blocklistResponse(await fixtureArtifact(100), 100)) as unknown as typeof fetch,
    });
    expect(outcome.kind).toBe("fresh");
    expect((await readStoredBlocklist())?.version).toBe(100);
  });

  it("tuổi artifact tính từ fetchedAt của đồng hồ máy, version to hay nhỏ không đổi được nó", async () => {
    const now = 1_800_000_000_000;
    const record = {
      key: "current",
      format: 1,
      version: 1,
      phish: new BigUint64Array(0),
      legit: new BigUint64Array(0),
      etag: null,
      pinnedUrl: null,
      fetchedAt: now - 3_600_000,
    } as const;

    expect(blocklistAgeMs(record, now)).toBe(3_600_000);
    expect(blocklistAgeMs({ ...record, version: 4294967295 }, now)).toBe(3_600_000);
    expect(blocklistAgeMs({ ...record, version: 0 }, now)).toBe(3_600_000);
  });

  it("không file nào trong src/ đối xử version như một mốc thời gian", () => {
    const offenders: string[] = [];

    for (const file of listSourceFiles(SRC_DIR)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (!/version/i.test(line)) return;
        for (const token of CLOCK_TOKENS) {
          if (line.includes(token)) {
            offenders.push(
              `${relative(process.cwd(), file).split("\\").join("/")}:${index + 1} có "${token}" cùng dòng với version`,
            );
          }
        }
      });
    }

    expect(
      offenders,
      [
        "Version của artifact là SỐ THỨ TỰ THAY ĐỔI NỘI DUNG, không phải timestamp.",
        "Nội dung không đổi thì version đứng yên, và corpus quay về nội dung cũ nhận version mới cao hơn.",
        "Client chỉ được so mới hơn hoặc bằng. Muốn biết artifact cũ bao lâu thì dùng fetchedAt.",
      ].join(" "),
    ).toEqual([]);
  });
});
