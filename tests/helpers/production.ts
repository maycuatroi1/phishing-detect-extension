import { BLOCKLIST_REQUEST_FORMATS, blocklistRequestUrl } from "../../src/lib/blocklist-sync.ts";

export interface ProductionProbe {
  readonly status: number;
  readonly bytes: Uint8Array;
  readonly headers: Headers;
  readonly requestedFormat: number;
}

export async function probeBlocklist(
  baseUrl: string,
  timeoutMs: number,
): Promise<ProductionProbe> {
  let last: ProductionProbe | null = null;

  for (let index = 0; index < BLOCKLIST_REQUEST_FORMATS.length; index += 1) {
    const requestedFormat = BLOCKLIST_REQUEST_FORMATS[index];
    const response = await fetch(blocklistRequestUrl(baseUrl, null, requestedFormat), {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });

    last = {
      status: response.status,
      bytes: new Uint8Array(await response.arrayBuffer()),
      headers: response.headers,
      requestedFormat,
    };

    if (response.status !== 400) {
      return last;
    }
  }

  if (last === null) {
    throw new Error("BLOCKLIST_REQUEST_FORMATS rỗng, không có format nào để hỏi production");
  }
  return last;
}
