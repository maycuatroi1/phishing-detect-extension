import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_API_BASE_URL } from "../../src/config.ts";
import { decodeAfbl } from "../../src/lib/afbl.ts";
import { probeBlocklist } from "../helpers/production.ts";
import { hostSha256Hex } from "../../src/lib/host.ts";
import {
  LOOKUP_MAX_PREFIXES_PER_REQUEST,
  fetchLookup,
  matchFullHash,
  prefixOfHashHex,
  type LookupEntry,
} from "../../src/lib/lookup.ts";

const BASE_URL = process.env.PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL;

const OFFLINE_IS_OK = process.env.ALLOW_OFFLINE_CONTRACT === "1";

const TIMEOUT_MS = 30_000;

const MAX_SEARCH_STEPS = 500_000;

interface Collision {
  readonly host: string;
  readonly hashHex: string;
  readonly prefix: string;
}

let corpusPrefixes: Set<string> | null = null;
let unreachable: string | null = null;

function skipping(): boolean {
  console.warn(
    `[kanon] bỏ qua vế production vì ALLOW_OFFLINE_CONTRACT=1 và không tới được ${BASE_URL}: ${unreachable}`,
  );
  return true;
}

async function findCollisions(prefixes: Set<string>, wanted: number): Promise<Collision[]> {
  const found: Collision[] = [];
  const taken = new Set<string>();

  for (let step = 0; step < MAX_SEARCH_STEPS && found.length < wanted; step += 1) {
    const host = `probe-${step}.kanon.example`;
    const hashHex = await hostSha256Hex(host);
    const prefix = prefixOfHashHex(hashHex);
    if (prefixes.has(prefix) && !taken.has(prefix)) {
      taken.add(prefix);
      found.push({ host, hashHex, prefix });
    }
  }

  return found;
}

beforeAll(async () => {
  try {
    const probe = await probeBlocklist(BASE_URL, TIMEOUT_MS);
    const decoded = decodeAfbl(probe.bytes);
    if (!decoded.ok) {
      unreachable = `artifact production không decode được: ${decoded.refusal.code}`;
      return;
    }
    const prefixes = new Set<string>();
    for (const entries of [decoded.artifact.phish, decoded.artifact.legit, decoded.artifact.soft]) {
      for (const entry of entries) {
        prefixes.add(entry.toString(16).padStart(16, "0").slice(0, 5));
      }
    }
    corpusPrefixes = prefixes;
  } catch (cause) {
    unreachable = String(cause);
  }
}, TIMEOUT_MS + 5_000);

describe("k-anonymity chứng minh trên corpus production thật tại " + BASE_URL, () => {
  it("tới được production và có prefix thật để đụng độ", () => {
    if (corpusPrefixes === null && OFFLINE_IS_OK) {
      expect(skipping()).toBe(true);
      return;
    }
    expect(
      unreachable,
      `Không tới được ${BASE_URL}. Đặt ALLOW_OFFLINE_CONTRACT=1 nếu đang chạy offline có chủ ý.`,
    ).toBeNull();
    expect(corpusPrefixes?.size ?? 0).toBeGreaterThan(0);
  });

  it(
    "một request không auth, 16 prefix, và chính extension quyết định host nào khớp",
    async () => {
      if (corpusPrefixes === null) return void skipping();

      const collisions = await findCollisions(corpusPrefixes, LOOKUP_MAX_PREFIXES_PER_REQUEST);
      expect(collisions).toHaveLength(LOOKUP_MAX_PREFIXES_PER_REQUEST);

      const seen: RequestInit[] = [];
      const tapped = ((input: RequestInfo | URL, init?: RequestInit) => {
        seen.push(init ?? {});
        return fetch(input, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
      }) as typeof fetch;

      const outcome = await fetchLookup({
        baseUrl: BASE_URL,
        prefixes: collisions.map((collision) => collision.prefix),
        fetchImpl: tapped,
      });

      expect(seen).toHaveLength(1);
      expect(seen[0].headers).toBeUndefined();
      expect(seen[0].credentials).toBe("omit");
      expect(seen[0].referrerPolicy).toBe("no-referrer");

      expect(outcome.kind, outcome.kind === "buckets" ? "" : JSON.stringify(outcome)).toBe("buckets");
      if (outcome.kind !== "buckets") return;

      expect(outcome.buckets.size).toBe(LOOKUP_MAX_PREFIXES_PER_REQUEST);

      let proved = 0;
      for (const collision of collisions) {
        const entries: readonly LookupEntry[] = outcome.buckets.get(collision.prefix) ?? [];
        if (entries.length === 0) {
          continue;
        }
        proved += 1;

        for (const entry of entries) {
          expect(entry.h.slice(0, 5)).toBe(collision.prefix);
        }

        expect(
          matchFullHash(entries, collision.hashHex),
          `host ${collision.host} trùng 20 bit đầu với corpus nhưng không phải entry nào của nó`,
        ).toBeNull();

        expect(matchFullHash(entries, entries[0].h)?.h).toBe(entries[0].h);
      }

      expect(
        proved,
        "không bucket production nào có entry, không chứng minh được gì",
      ).toBeGreaterThan(0);
    },
    TIMEOUT_MS + 10_000,
  );

  it(
    "server chỉ nhận 5 ký tự hex, và mọi thứ dài hơn không có đường rời khỏi máy",
    async () => {
      if (corpusPrefixes === null) return void skipping();

      const hashHex = await hostSha256Hex("gui-ca-bam.kanon.example");
      const url = new URL("/v1/lookup", BASE_URL);
      url.searchParams.set("p", hashHex.slice(0, 6));

      const response = await fetch(url, {
        cache: "no-store",
        credentials: "omit",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("invalid_prefix");
      expect(body.error.message).not.toContain(hashHex.slice(0, 6));
    },
    TIMEOUT_MS,
  );

  it(
    "hỏi 17 prefix bị từ chối, nên lô 16 không phải là con số bịa ra",
    async () => {
      if (corpusPrefixes === null) return void skipping();

      const url = new URL("/v1/lookup", BASE_URL);
      for (let index = 0; index <= LOOKUP_MAX_PREFIXES_PER_REQUEST; index += 1) {
        url.searchParams.append("p", index.toString(16).padStart(5, "0"));
      }

      const response = await fetch(url, {
        cache: "no-store",
        credentials: "omit",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("too_many_prefixes");
    },
    TIMEOUT_MS,
  );
});
