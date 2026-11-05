import { describe, expect, test } from "bun:test";
import { buildAuthData, fetchAccessToken, parseAuthData, parseEmail, parseLanguage } from "../../src/core/auth.ts";
import { AUTH_DATA } from "../fixtures/library.ts";

describe("parseAuthData", () => {
  test("reads every mapped field", () => {
    const data = parseAuthData(AUTH_DATA);
    expect(data.androidId).toBe("392d0518e52acdaf");
    expect(data.email).toBe("test@example.com");
    expect(data.token).toBe("master-token");
    expect(data.service).toBe("oauth2:https://www.googleapis.com/auth/photos.native");
    expect(data.lang).toBe("en_US");
    expect(data.sdkVersion).toBe("28");
  });

  test("fills defaults for optional fields", () => {
    const data = parseAuthData("androidId=a1&Email=x%40y.z&Token=t&service=s");
    expect(data.app).toBe("com.google.android.apps.photos");
    expect(data.deviceCountry).toBe("us");
    expect(data.oauth2Foreground).toBe("1");
    expect(data.gmsVersion).toBe("240913000");
  });

  test("lists every missing required field", () => {
    expect(() => parseAuthData("androidId=a1")).toThrow("missing: email, token, service");
  });

  test("rejects empty input", () => {
    expect(() => parseAuthData("")).toThrow("incomplete auth data");
  });
});

describe("buildAuthData", () => {
  test("round-trips through parseAuthData", () => {
    const built = buildAuthData({ androidId: "dev-1", email: "a@b.c", masterToken: "tok" });
    const parsed = parseAuthData(built);
    expect(parsed.androidId).toBe("dev-1");
    expect(parsed.email).toBe("a@b.c");
    expect(parsed.token).toBe("tok");
    expect(parsed.service).toBe("oauth2:https://www.googleapis.com/auth/photos.native");
  });

  test("honours country and language overrides", () => {
    const parsed = parseAuthData(buildAuthData({ androidId: "d", email: "e@f.g", masterToken: "t", deviceCountry: "id", lang: "id_ID" }));
    expect(parsed.deviceCountry).toBe("id");
    expect(parsed.lang).toBe("id_ID");
  });
});

describe("parseEmail and parseLanguage", () => {
  test("extracts the email field", () => {
    expect(parseEmail("Email=me%40host.tld&x=1")).toBe("me@host.tld");
  });

  test("throws when the email is missing", () => {
    expect(() => parseEmail("x=1")).toThrow("no Email field");
  });

  test("defaults the language", () => {
    expect(parseLanguage("x=1")).toBe("en_US");
    expect(parseLanguage("lang=id_ID")).toBe("id_ID");
  });
});

describe("fetchAccessToken", () => {
  const data = parseAuthData(AUTH_DATA);

  test("returns the auth token and expiry from a success response", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("Auth=abc123\nExpiry=1700000000\ngrantedScopes=oauth2:x\n", { status: 200 })) as unknown as typeof fetch;
    try {
      const token = await fetchAccessToken(data);
      expect(token.value).toBe("abc123");
      expect(token.expiresAt).toBe(1700000000);
      expect(token.scopes).toBe("oauth2:x");
    } finally {
      globalThis.fetch = original;
    }
  });

  test("reports the rejection detail", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response("Error=BadAuthentication\n", { status: 200 })) as unknown as typeof fetch;
    try {
      await expect(fetchAccessToken(data)).rejects.toThrow("auth rejected: BadAuthentication");
    } finally {
      globalThis.fetch = original;
    }
  });

  test("reports the HTTP status on failure", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response("nope", { status: 403 })) as unknown as typeof fetch;
    try {
      await expect(fetchAccessToken(data)).rejects.toThrow("auth failed: HTTP 403");
    } finally {
      globalThis.fetch = original;
    }
  });
});
