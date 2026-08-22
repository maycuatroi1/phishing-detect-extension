import { parseApiError, unavailableReason, type ApiError } from "./api-error.ts";

export const INSTALL_PATH = "/v1/install";

export const INSTALL_TOKEN_PREFIX = "aft1_";

export const INSTALL_TOKEN_BODY_LENGTH = 43;

export const INSTALL_TOKEN_LENGTH = INSTALL_TOKEN_PREFIX.length + INSTALL_TOKEN_BODY_LENGTH;

export const INSTALL_REQUEST_BODY = "{}";

export const JSON_MEDIA_TYPE = "application/json";

const TOKEN_PATTERN = new RegExp(
  `^${INSTALL_TOKEN_PREFIX}[A-Za-z0-9_-]{${INSTALL_TOKEN_BODY_LENGTH}}$`,
);

export function isInstallToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

export function maskInstallToken(token: string): string {
  return `${token.slice(0, INSTALL_TOKEN_PREFIX.length)}<${token.length} ký tự bị che>`;
}

export interface MintedInstallToken {
  readonly token: string;
  readonly rotateAfterDays: number;
}

export type InstallOutcome =
  | { readonly kind: "minted"; readonly minted: MintedInstallToken }
  | { readonly kind: "refused"; readonly error: ApiError }
  | { readonly kind: "unavailable"; readonly reason: string };

export interface InstallDeps {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
}

export function parseInstallResponse(body: unknown): MintedInstallToken | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const record = body as Record<string, unknown>;
  if (!isInstallToken(record.install_token)) {
    return null;
  }
  const days = record.rotate_after_days;
  if (typeof days !== "number" || !Number.isInteger(days) || days < 1) {
    return null;
  }
  return { token: record.install_token, rotateAfterDays: days };
}

export async function mintInstallToken(deps: InstallDeps): Promise<InstallOutcome> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const url = new URL(INSTALL_PATH, deps.baseUrl).toString();

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      cache: "no-store",
      credentials: "omit",
      redirect: "follow",
      referrerPolicy: "no-referrer",
      headers: { "content-type": JSON_MEDIA_TYPE },
      body: INSTALL_REQUEST_BODY,
      signal: deps.signal,
    });
  } catch (cause) {
    return { kind: "unavailable", reason: `fetch /v1/install thất bại: ${String(cause)}` };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    return { kind: "unavailable", reason: `/v1/install trả body không phải JSON: ${String(cause)}` };
  }

  if (!response.ok) {
    const error = parseApiError(body);
    if (error === null) {
      return { kind: "unavailable", reason: unavailableReason(response.status) };
    }
    return { kind: "refused", error };
  }

  const minted = parseInstallResponse(body);
  if (minted === null) {
    return { kind: "unavailable", reason: "/v1/install trả body không đúng hình InstallResponse" };
  }
  return { kind: "minted", minted };
}
