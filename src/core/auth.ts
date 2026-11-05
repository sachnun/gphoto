import { request } from "./http.ts";

const AUTH_URL = "https://android.googleapis.com/auth";

const PHOTOS_PACKAGE = "com.google.android.apps.photos";
const PHOTOS_CERT_SHA1 = "24bb24c05e47e0aefa68a58a766179d9b613a600";

const DEFAULTS: Omit<AuthData, "androidId" | "email" | "token" | "service"> = {
  app: PHOTOS_PACKAGE,
  clientSig: PHOTOS_CERT_SHA1,
  callerPkg: PHOTOS_PACKAGE,
  callerSig: PHOTOS_CERT_SHA1,
  deviceCountry: "us",
  gmsVersion: "240913000",
  lang: "en_US",
  oauth2Foreground: "1",
  sdkVersion: "28",
};

export interface AuthData {
  androidId: string;
  app: string;
  clientSig: string;
  callerPkg: string;
  callerSig: string;
  deviceCountry: string;
  email: string;
  gmsVersion: string;
  lang: string;
  oauth2Foreground: string;
  sdkVersion: string;
  service: string;
  token: string;
}

const KEY_MAP: Record<string, keyof AuthData> = {
  androidId: "androidId",
  app: "app",
  client_sig: "clientSig",
  callerPkg: "callerPkg",
  callerSig: "callerSig",
  device_country: "deviceCountry",
  Email: "email",
  google_play_services_version: "gmsVersion",
  lang: "lang",
  oauth2_foreground: "oauth2Foreground",
  sdk_version: "sdkVersion",
  service: "service",
  Token: "token",
};

export function parseAuthData(raw: string): AuthData {
  const params = new URLSearchParams(raw.trim());
  const data: Partial<AuthData> = {};
  for (const [key, field] of Object.entries(KEY_MAP)) {
    const value = params.get(key);
    if (value !== null) data[field] = value;
  }
  const missing = ["androidId", "email", "token", "service"].filter((field) => !data[field as keyof AuthData]);
  if (missing.length > 0) throw new Error(`incomplete auth data, missing: ${missing.join(", ")}`);
  return {
    ...DEFAULTS,
    ...data,
  } as AuthData;
}

export function buildAuthData(input: {
  androidId: string;
  email: string;
  masterToken: string;
  deviceCountry?: string;
  lang?: string;
}): string {
  const params = new URLSearchParams({
    androidId: input.androidId,
    app: PHOTOS_PACKAGE,
    client_sig: PHOTOS_CERT_SHA1,
    callerPkg: PHOTOS_PACKAGE,
    callerSig: PHOTOS_CERT_SHA1,
    device_country: input.deviceCountry ?? "us",
    Email: input.email,
    google_play_services_version: "240913000",
    lang: input.lang ?? "en_US",
    oauth2_foreground: "1",
    sdk_version: "28",
    service: "oauth2:https://www.googleapis.com/auth/photos.native",
    Token: input.masterToken,
  });
  return params.toString();
}

export interface AccessToken {
  value: string;
  expiresAt: number;
  scopes: string;
}

export async function fetchAccessToken(data: AuthData, service?: string, proxy?: string): Promise<AccessToken> {
  const form = new URLSearchParams({
    androidId: data.androidId,
    app: data.app,
    client_sig: data.clientSig,
    callerPkg: data.callerPkg,
    callerSig: data.callerSig,
    device_country: data.deviceCountry,
    Email: data.email,
    google_play_services_version: data.gmsVersion,
    lang: data.lang,
    oauth2_foreground: data.oauth2Foreground,
    sdk_version: data.sdkVersion,
    service: service ?? data.service,
    Token: data.token,
  });

  const response = await request(AUTH_URL, {
    method: "POST",
    headers: {
      "Accept-Encoding": "gzip",
      app: data.app,
      Connection: "Keep-Alive",
      "Content-Type": "application/x-www-form-urlencoded",
      device: data.androidId,
      "User-Agent": "GoogleAuth/1.4 (Pixel XL PQ2A.190205.001); gzip",
    },
    body: form.toString(),
    proxy,
  });

  if (response.status !== 200) {
    throw new Error(`auth failed: HTTP ${response.status} ${response.text.slice(0, 200)}`);
  }

  const parsed: Record<string, string> = {};
  for (const line of response.text.split("\n")) {
    const index = line.indexOf("=");
    if (index > 0) parsed[line.slice(0, index)] = line.slice(index + 1);
  }

  if (!parsed.Auth) {
    const detail = parsed.Error ?? parsed.ErrorDetail ?? response.text.slice(0, 200);
    throw new Error(`auth rejected: ${detail}`);
  }

  return {
    value: parsed.Auth,
    expiresAt: Number(parsed.Expiry ?? 0),
    scopes: parsed.grantedScopes ?? "",
  };
}

export function parseEmail(raw: string): string {
  const value = new URLSearchParams(raw.trim()).get("Email");
  if (!value) throw new Error("auth data has no Email field");
  return value;
}

export function parseLanguage(raw: string): string {
  return new URLSearchParams(raw.trim()).get("lang") ?? "en_US";
}
