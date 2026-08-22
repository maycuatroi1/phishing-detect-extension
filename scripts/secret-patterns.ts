export interface SecretPattern {
  readonly id: string;
  readonly label: string;
  readonly regex: RegExp;
}

export const SECRET_PATTERNS: readonly SecretPattern[] = [
  {
    id: "openai-api-key",
    label: "khoá API kiểu OpenAI (sk-)",
    regex: /\bsk-(?:proj-|ant-|live-|test-|svcacct-)?[A-Za-z0-9_-]{20,}/g,
  },
  {
    id: "google-api-key",
    label: "khoá API Google (AIza)",
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  {
    id: "google-oauth-client-secret",
    label: "client secret Google OAuth (GOCSPX-)",
    regex: /\bGOCSPX-[A-Za-z0-9_-]{20,}/g,
  },
  {
    id: "cloudflare-api-token",
    label: "token API Cloudflare (cfat)",
    regex: /\bcfat[A-Za-z0-9_.-]{20,}/g,
  },
  {
    id: "turnstile-secret-key",
    label: "secret key Turnstile (0x4AAAAAA)",
    regex: /\b0x4AAAAAA[A-Za-z0-9_-]{10,}/g,
  },
  {
    id: "postgres-url-with-password",
    label: "chuỗi kết nối Postgres có mật khẩu",
    regex: /\bpostgres(?:ql)?:\/\/[^\s:@/"'`]+:[^\s:@/"'`]+@/g,
  },
  {
    id: "pem-private-key",
    label: "private key dạng PEM",
    regex: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/g,
  },
  {
    id: "json-web-token",
    label: "JSON Web Token",
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  },
];

export interface SecretPatternMatch {
  readonly patternId: string;
  readonly label: string;
  readonly index: number;
  readonly preview: string;
}

export function maskSecret(value: string): string {
  const head = value.slice(0, 4);
  return `${head}...<${value.length} ký tự bị che>`;
}

export function scanSecretPatterns(text: string): SecretPatternMatch[] {
  const matches: SecretPatternMatch[] = [];
  for (const pattern of SECRET_PATTERNS) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let hit: RegExpExecArray | null = regex.exec(text);
    while (hit !== null) {
      matches.push({
        patternId: pattern.id,
        label: pattern.label,
        index: hit.index,
        preview: maskSecret(hit[0]),
      });
      hit = regex.exec(text);
    }
  }
  return matches.sort((a, b) => a.index - b.index);
}
