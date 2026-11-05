import { readFile } from "node:fs/promises";

export interface CookieRecord {
  domain: string;
  name: string;
  value: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expires: number;
}

export async function readCookieFile(path: string): Promise<CookieRecord[]> {
  const raw = await readFile(path, "utf8");
  return parseCookieFile(raw);
}

export function parseCookieFile(raw: string): CookieRecord[] {
  const out: CookieRecord[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#HttpOnly_")) {
      const record = parseNetscapeLine(trimmed.slice("#HttpOnly_".length), true);
      if (record) out.push(record);
      continue;
    }
    if (trimmed.startsWith("#")) continue;
    const record = parseNetscapeLine(trimmed, false);
    if (record) out.push(record);
  }
  return out;
}

function parseNetscapeLine(line: string, httpOnly: boolean): CookieRecord | null {
  const parts = line.split("\t");
  if (parts.length < 7) return null;
  return {
    domain: parts[0]!,
    httpOnly,
    path: parts[2]!,
    secure: parts[3]!.toUpperCase() === "TRUE",
    expires: Number(parts[4] ?? 0),
    name: parts[5]!,
    value: parts[6]!,
  };
}

export function findCookie(cookies: CookieRecord[], name: string): string | undefined {
  return cookies.find((cookie) => cookie.name === name)?.value;
}

export function extractOauthToken(input: string): string | undefined {
  const trimmed = input.trim();
  if (trimmed.startsWith("oauth2_") || trimmed.startsWith("oauth2-")) return trimmed;
  const named = trimmed.match(/oauth_token\s*[=:]\s*([^\s;]+)/);
  if (named) return named[1];
  const fromHeader = trimmed.match(/(?:^|;\s*)oauth_token=([^;\s]+)/);
  if (fromHeader) return fromHeader[1];
  return undefined;
}

export function toCookieHeader(cookies: CookieRecord[], domainSuffix: string): string {
  return cookies
    .filter((cookie) => cookie.domain.endsWith(domainSuffix) || domainSuffix.endsWith(cookie.domain))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}
