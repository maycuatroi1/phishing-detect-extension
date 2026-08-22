import { LOOKUP_PREFIX_PARAM, type LookupEntry } from "../../src/lib/lookup.ts";

export interface WireRequest {
  readonly url: string;
  readonly method: string;
  readonly headerNames: readonly string[];
  readonly headers: Readonly<Record<string, string>>;
  readonly credentials: string | undefined;
  readonly referrerPolicy: string | undefined;
  readonly body: string;
  readonly prefixes: readonly string[];
  readonly paramNames: readonly string[];
}

export interface WireTap {
  readonly fetchImpl: typeof fetch;
  readonly requests: WireRequest[];
}

function headerRecord(init: RequestInit | undefined): Record<string, string> {
  const raw = init?.headers;
  if (raw === undefined) {
    return {};
  }
  const record: Record<string, string> = {};
  new Headers(raw).forEach((value, name) => {
    record[name.toLowerCase()] = value;
  });
  return record;
}

export function pathOf(request: WireRequest): string {
  return new URL(request.url).pathname;
}

export function describeRequest(request: WireRequest): string {
  const headers = Object.entries(request.headers)
    .map(([name, value]) => `${name}: ${value}`)
    .join("\n");
  return [request.method, request.url, headers, request.body].join("\n");
}

export function tapFetch(
  respond: (request: WireRequest) => Response | Promise<Response>,
): WireTap {
  const requests: WireRequest[] = [];

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers = headerRecord(init);
    const parsed = new URL(url);
    const request: WireRequest = {
      url,
      method: init?.method ?? "GET",
      headerNames: Object.keys(headers),
      headers,
      credentials: init?.credentials,
      referrerPolicy: init?.referrerPolicy,
      body: typeof init?.body === "string" ? init.body : "",
      prefixes: parsed.searchParams.getAll(LOOKUP_PREFIX_PARAM),
      paramNames: Array.from(new Set(Array.from(parsed.searchParams.keys()))),
    };
    requests.push(request);
    return respond(request);
  }) as unknown as typeof fetch;

  return { fetchImpl, requests };
}

export function bucketsResponse(buckets: Record<string, readonly LookupEntry[]>): Response {
  return new Response(JSON.stringify({ buckets }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-lookup-anonymity": "k-anonymity; no authentication; client identifiers not logged",
    },
  });
}

export function echoEmptyBuckets(request: WireRequest): Response {
  const buckets: Record<string, readonly LookupEntry[]> = {};
  for (const prefix of request.prefixes) {
    buckets[prefix] = [];
  }
  return bucketsResponse(buckets);
}
