import { describe, expect, it } from "vitest";
import { SECRET_PATTERNS, maskSecret, scanSecretPatterns } from "../scripts/secret-patterns.ts";

const FILLER = "FAKE0NOT0A0REAL0SECRET00000";

function filler(length: number): string {
  return FILLER.repeat(Math.ceil(length / FILLER.length)).slice(0, length);
}

const FAKE_SAMPLES: Record<string, string> = {
  "openai-api-key": `sk-${filler(32)}`,
  "google-api-key": `AIza${filler(35)}`,
  "google-oauth-client-secret": `GOCSPX-${filler(24)}`,
  "cloudflare-api-token": `cfat${filler(28)}`,
  "turnstile-secret-key": `0x4AAAAAA${filler(16)}`,
  "postgres-url-with-password": `postgres://fakeuser:${filler(20)}@127.0.0.1:5432/db`,
  "pem-private-key": "-----BEGIN PRIVATE KEY-----",
  "json-web-token": `eyJ${filler(12)}.eyJ${filler(12)}.${filler(12)}`,
};

const CLEAN_BUNDLE = [
  'const API_BASE_URL="https://anti-fraud.omelet.tech";',
  'chrome.runtime.onInstalled.addListener(()=>{console.info("[phishing-detect] installed")});',
  'const task="task-runner";const mood="asking-for-trouble";',
].join("\n");

describe("scanSecretPatterns", () => {
  it("phủ đúng tám pattern secret mà plan liệt kê", () => {
    expect(SECRET_PATTERNS.map((pattern) => pattern.id).sort()).toEqual(
      Object.keys(FAKE_SAMPLES).sort(),
    );
  });

  for (const [id, sample] of Object.entries(FAKE_SAMPLES)) {
    it(`bắt được ${id}`, () => {
      const hits = scanSecretPatterns(`const leaked=${JSON.stringify(sample)};`);
      expect(hits.map((hit) => hit.patternId)).toContain(id);
    });
  }

  it("không báo động trên một bundle sạch", () => {
    expect(scanSecretPatterns(CLEAN_BUNDLE)).toEqual([]);
  });

  it("không in ra nguyên văn giá trị bắt được", () => {
    const sample = FAKE_SAMPLES["openai-api-key"];
    const hits = scanSecretPatterns(sample);
    expect(hits).toHaveLength(1);
    expect(hits[0].preview).not.toContain(sample);
    expect(hits[0].preview).toBe(maskSecret(sample));
  });
});
