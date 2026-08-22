import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { afblContains, decodeAfbl, encodeAfbl } from "../src/lib/afbl.ts";
import {
  BLOCKLIST_DB_NAME,
  BLOCKLIST_STORE_NAME,
  clearStoredBlocklist,
  readStoredBlocklist,
  writeStoredBlocklist,
} from "../src/lib/blocklist-store.ts";
import { invalidateTier0Cache, lookupHost } from "../src/lib/tier0.ts";
import { PHISH_HOST, UNSEEN_HOST, entriesFor, fixtureArtifact } from "./helpers/fixture.ts";

beforeEach(async () => {
  await clearStoredBlocklist();
  invalidateTier0Cache();
});

describe("artifact sống trong IndexedDB", () => {
  it("tên database và object store cố định, để một bản cài cũ vẫn tìm lại được artifact", () => {
    expect(BLOCKLIST_DB_NAME).toBe("anti-fraud-blocklist");
    expect(BLOCKLIST_STORE_NAME).toBe("artifact");
  });

  it("chưa ghi gì thì đọc ra null chứ không nổ", async () => {
    expect(await readStoredBlocklist()).toBeNull();
  });

  it("mảng uint64 đi qua IndexedDB rồi về vẫn nguyên kiểu và nguyên thứ tự", async () => {
    const phish = await entriesFor(["a.example", "b.example", "c.example"]);
    await writeStoredBlocklist({
      format: 1,
      version: 12,
      phish: BigUint64Array.from(phish),
      legit: new BigUint64Array(0),
      etag: '"afbl-1-12"',
      pinnedUrl: "/v1/blocklist/v/12?format=1",
      fetchedAt: 1_800_000_000_000,
    });

    const record = await readStoredBlocklist();
    expect(record).not.toBeNull();
    expect(record!.phish).toBeInstanceOf(BigUint64Array);
    expect(Array.from(record!.phish)).toEqual(phish);
    expect(record!.version).toBe(12);
    expect(record!.etag).toBe('"afbl-1-12"');
    expect(record!.fetchedAt).toBe(1_800_000_000_000);
  });

  it("ghi lần hai đè lên đúng một bản ghi, không tích luỹ artifact cũ", async () => {
    const base = {
      format: 1,
      legit: new BigUint64Array(0),
      etag: null,
      pinnedUrl: null,
      fetchedAt: 1,
    };
    await writeStoredBlocklist({ ...base, version: 1, phish: BigUint64Array.from([1n]) });
    await writeStoredBlocklist({ ...base, version: 2, phish: BigUint64Array.from([1n, 2n]) });

    expect((await readStoredBlocklist())?.version).toBe(2);

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(BLOCKLIST_DB_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const count = await new Promise<number>((resolve, reject) => {
      const request = db.transaction(BLOCKLIST_STORE_NAME).objectStore(BLOCKLIST_STORE_NAME).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    expect(count).toBe(1);
  });

  it("artifact lớn tra bằng nhị phân vẫn ra đúng kết quả", async () => {
    const noise = Array.from({ length: 20_000 }, (_, index) => BigInt(index) * 1_000_003n);
    const target = (await entriesFor([PHISH_HOST]))[0];
    const phish = Array.from(new Set([...noise, target])).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    const decoded = decodeAfbl(encodeAfbl({ version: 77, phish, legit: [] }));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.artifact.phish.length).toBe(phish.length);
    expect(afblContains(decoded.artifact.phish, target)).toBe(true);

    await writeStoredBlocklist({
      format: decoded.artifact.format,
      version: decoded.artifact.version,
      phish: decoded.artifact.phish,
      legit: decoded.artifact.legit,
      etag: null,
      pinnedUrl: null,
      fetchedAt: 1,
    });
    invalidateTier0Cache();

    expect((await lookupHost(PHISH_HOST)).verdict).toBe("phishing");
    expect((await lookupHost(UNSEEN_HOST)).verdict).toBe("unknown");
    expect((await lookupHost(PHISH_HOST)).artifactVersion).toBe(77);
  });

  it("artifact rỗng lưu được và tra ra unknown chứ không ra lỗi", async () => {
    const decoded = decodeAfbl(await fixtureArtifact(9, [], []));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;

    await writeStoredBlocklist({
      format: decoded.artifact.format,
      version: decoded.artifact.version,
      phish: decoded.artifact.phish,
      legit: decoded.artifact.legit,
      etag: null,
      pinnedUrl: null,
      fetchedAt: 1,
    });
    invalidateTier0Cache();

    expect((await lookupHost(PHISH_HOST)).verdict).toBe("unknown");
    expect((await lookupHost(PHISH_HOST)).artifactVersion).toBe(9);
  });
});
