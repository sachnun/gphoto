import { request } from "./http.ts";

const AUTH_URL = "https://android.googleapis.com/auth";

export interface ExchangeResult {
  masterToken: string;
  email: string;
  sid?: string;
  lsid?: string;
}

export async function exchangeMasterToken(email: string, oauthToken: string, androidId: string): Promise<string> {
  const result = await exchange(email, oauthToken, androidId);
  return result.masterToken;
}

export async function exchange(email: string, oauthToken: string, androidId: string): Promise<ExchangeResult> {
  const body = new URLSearchParams({
    accountType: "HOSTED_OR_GOOGLE",
    Email: email,
    has_permission: "1",
    add_account: "1",
    ACCESS_TOKEN: "1",
    Token: oauthToken,
    service: "ac2dm",
    source: "android",
    androidId,
    device_country: "us",
    operatorCountry: "us",
    lang: "en",
    sdk_version: "28",
    google_play_services_version: "240913000",
    client_sig: "38918a453d07199354f8b19af05ec6562ced5788",
    callerSig: "38918a453d07199354f8b19af05ec6562ced5788",
    droidguard_results: "dummy123",
  });

  const response = await request(AUTH_URL, {
    method: "POST",
    headers: {
      "Accept-Encoding": "identity",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "GoogleAuth/1.4",
    },
    body: body.toString(),
    timeoutMs: 60_000,
  });

  const parsed: Record<string, string> = {};
  for (const line of response.text.split("\n")) {
    const index = line.indexOf("=");
    if (index > 0) parsed[line.slice(0, index)] = line.slice(index + 1);
  }

  if (!parsed.Token) {
    const detail = parsed.Error ?? parsed.ErrorDetail ?? `HTTP ${response.status}`;
    throw new Error(`token exchange rejected: ${detail}`);
  }

  return { masterToken: parsed.Token, email: parsed.Email ?? email, sid: parsed.SID, lsid: parsed.LSID };
}
