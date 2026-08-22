import { hostSha256Hex } from "./host.ts";
import { matchFullHash, prefixOfHashHex } from "./lookup.ts";
import type { LookupBatcher } from "./lookup-batch.ts";

export type Tier1Verdict = "phishing" | "legit" | "unknown" | "absent" | "unavailable";

export interface Tier1Result {
  readonly host: string;
  readonly prefix: string;
  readonly verdict: Tier1Verdict;
  readonly confirmed: boolean;
  readonly bucketSize: number;
}

export async function lookupHostTier1(
  host: string,
  batcher: LookupBatcher,
): Promise<Tier1Result> {
  const hashHex = await hostSha256Hex(host);
  const prefix = prefixOfHashHex(hashHex);

  const bucket = await batcher.bucketFor(prefix);
  if (bucket.kind === "unavailable") {
    return { host, prefix, verdict: "unavailable", confirmed: false, bucketSize: 0 };
  }

  const entry = matchFullHash(bucket.entries, hashHex);
  if (entry === null) {
    return { host, prefix, verdict: "absent", confirmed: false, bucketSize: bucket.entries.length };
  }

  return {
    host,
    prefix,
    verdict: entry.v,
    confirmed: entry.c === 1,
    bucketSize: bucket.entries.length,
  };
}
