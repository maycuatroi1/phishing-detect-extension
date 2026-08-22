import { afblContains } from "./afbl.ts";
import { readStoredBlocklist, type StoredBlocklist } from "./blocklist-store.ts";
import { hostEntryOf } from "./host.ts";

export type Tier0Verdict = "phishing" | "soft" | "legit" | "unknown" | "no_artifact";

export interface Tier0Result {
  readonly host: string;
  readonly verdict: Tier0Verdict;
  readonly artifactVersion: number | null;
}

let cached: StoredBlocklist | null = null;
let cacheLoaded = false;

export function invalidateTier0Cache(): void {
  cached = null;
  cacheLoaded = false;
}

async function currentArtifact(): Promise<StoredBlocklist | null> {
  if (cacheLoaded) {
    return cached;
  }
  cached = await readStoredBlocklist();
  cacheLoaded = true;
  return cached;
}

export async function lookupHost(host: string): Promise<Tier0Result> {
  const artifact = await currentArtifact();
  if (artifact === null) {
    return { host, verdict: "no_artifact", artifactVersion: null };
  }

  const entry = await hostEntryOf(host);

  if (afblContains(artifact.phish, entry)) {
    return { host, verdict: "phishing", artifactVersion: artifact.version };
  }
  if (afblContains(artifact.legit, entry)) {
    return { host, verdict: "legit", artifactVersion: artifact.version };
  }
  if (afblContains(artifact.soft, entry)) {
    return { host, verdict: "soft", artifactVersion: artifact.version };
  }
  return { host, verdict: "unknown", artifactVersion: artifact.version };
}
