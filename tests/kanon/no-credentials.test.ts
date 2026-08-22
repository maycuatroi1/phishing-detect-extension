import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_API_BASE_URL } from "../../src/config.ts";
import { hostEntryOf, hostSha256Hex } from "../../src/lib/host.ts";
import {
  LOOKUP_PREFIX_HEX_LENGTH,
  LOOKUP_PREFIX_PARAM,
  prefixOfHashHex,
} from "../../src/lib/lookup.ts";
import { createLookupBatcher } from "../../src/lib/lookup-batch.ts";
import { lookupHostTier1 } from "../../src/lib/tier1.ts";
import { manualClock } from "../helpers/clock.ts";
import { describeRequest, echoEmptyBuckets, tapFetch } from "../helpers/wire.ts";

const HOST = "ngan-hang-xac-thuc-otp-2026.kanon.example";

const URL_VISITED = `https://${HOST}/dang-nhap?tk=nguyenanhbinh&otp=884201`;

const CREDENTIAL_HEADERS = [
  "authorization",
  "cookie",
  "cookie2",
  "proxy-authorization",
  "x-install-token",
  "x-api-key",
  "x-client-id",
];

async function driveOneLookup() {
  const clock = manualClock();
  const tap = tapFetch(echoEmptyBuckets);
  const batcher = createLookupBatcher({
    baseUrl: DEFAULT_API_BASE_URL,
    random: () => 0.5,
    fetchImpl: tap.fetchImpl,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  const pending = lookupHostTier1(HOST, batcher);
  await clock.settle();
  const result = await pending;
  return { tap, result };
}

describe("không credential nào rời khỏi máy trên đường tier 1", () => {
  it("request đi ra không mang Authorization, không mang Cookie, không mang header tự chế nào", async () => {
    const { tap } = await driveOneLookup();

    expect(tap.requests).toHaveLength(1);
    const request = tap.requests[0];

    expect(request.headerNames).toEqual([]);
    for (const name of CREDENTIAL_HEADERS) {
      expect(request.headers[name], `header ${name} không được có mặt`).toBeUndefined();
    }
    expect(request.credentials).toBe("omit");
    expect(request.referrerPolicy).toBe("no-referrer");
    expect(request.body).toBe("");
  });

  it("query chỉ chứa p, mỗi p đúng 5 ký tự hex thường", async () => {
    const { tap } = await driveOneLookup();
    const request = tap.requests[0];

    expect(request.paramNames).toEqual([LOOKUP_PREFIX_PARAM]);
    expect(request.prefixes).toHaveLength(1);
    for (const prefix of request.prefixes) {
      expect(prefix).toMatch(/^[0-9a-f]{5}$/);
      expect(prefix).toHaveLength(LOOKUP_PREFIX_HEX_LENGTH);
    }

    const hashHex = await hostSha256Hex(HOST);
    expect(request.prefixes[0]).toBe(prefixOfHashHex(hashHex));
    expect(new URL(request.url).pathname).toBe("/v1/lookup");
  });

  it("không byte nào của request suy ra được host, kể cả 6 ký tự hex đầu của băm", async () => {
    const { tap } = await driveOneLookup();
    const wire = describeRequest(tap.requests[0]);

    const hashHex = await hostSha256Hex(HOST);
    const tier0Entry = (await hostEntryOf(HOST)).toString(16).padStart(16, "0");

    expect(wire).not.toContain(HOST);
    expect(wire).not.toContain(URL_VISITED);
    expect(wire).not.toContain("dang-nhap");
    expect(wire).not.toContain("nguyenanhbinh");
    for (const label of HOST.split(".").filter((part) => part.length >= 4)) {
      expect(wire, `nhãn "${label}" của host không được xuất hiện`).not.toContain(label);
    }

    expect(wire).not.toContain(hashHex);
    expect(wire).not.toContain(tier0Entry);
    expect(
      wire,
      "6 ký tự hex đầu là 24 bit, endpoint này chỉ được biết 20 bit",
    ).not.toContain(hashHex.slice(0, 6));
    expect(wire).toContain(hashHex.slice(0, LOOKUP_PREFIX_HEX_LENGTH));
  });

  it("mã nguồn đường tier 1 không nhắc tới token, Bearer hay cookie ở bất kỳ đâu", () => {
    const root = resolve(process.cwd(), "src");
    const files = [
      "lib/lookup.ts",
      "lib/lookup-batch.ts",
      "lib/tier1.ts",
      "background/tier1.ts",
    ];

    for (const relative of files) {
      const text = readFileSync(resolve(root, relative), "utf8").toLowerCase();
      for (const banned of ["authorization", "bearer", "install_token", "installtoken", "document.cookie", "aft1_"]) {
        expect(text, `${relative} nhắc tới "${banned}"`).not.toContain(banned);
      }
    }
  });

  it("mọi request tier 1 dùng credentials omit, đọc thẳng từ mã nguồn", () => {
    const text = readFileSync(resolve(process.cwd(), "src/lib/lookup.ts"), "utf8");
    expect(text).toContain('credentials: "omit"');
    expect(text).toContain('referrerPolicy: "no-referrer"');
    expect(text.includes("headers:")).toBe(false);
  });
});
