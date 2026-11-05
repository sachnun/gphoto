import { describe, expect, test } from "bun:test";
import { extractOauthToken, findCookie, parseCookieFile, toCookieHeader } from "../../src/core/cookies.ts";

const JAR = [
  "# Netscape HTTP Cookie File",
  "",
  "#HttpOnly_.google.com\tTRUE\t/\tTRUE\t1700000000\toauth_token\tsecret-token",
  ".google.com\tTRUE\t/\tFALSE\t0\tNID\tnid-value",
  ".example.com\tTRUE\t/\tFALSE\t0\tsession\tsession-value",
  "malformed line",
].join("\n");

describe("parseCookieFile", () => {
  test("skips comments and malformed lines", () => {
    const cookies = parseCookieFile(JAR);
    expect(cookies.map((cookie) => cookie.name)).toEqual(["oauth_token", "NID", "session"]);
  });

  test("marks HttpOnly rows", () => {
    const cookies = parseCookieFile(JAR);
    expect(cookies[0]!.httpOnly).toBe(true);
    expect(cookies[1]!.httpOnly).toBe(false);
  });

  test("parses secure, expiry and path", () => {
    const cookie = parseCookieFile(JAR)[0]!;
    expect(cookie.secure).toBe(true);
    expect(cookie.expires).toBe(1700000000);
    expect(cookie.path).toBe("/");
    expect(cookie.domain).toBe(".google.com");
  });

  test("returns nothing for an empty jar", () => {
    expect(parseCookieFile("")).toEqual([]);
  });
});

describe("findCookie", () => {
  test("returns the matching value", () => {
    expect(findCookie(parseCookieFile(JAR), "oauth_token")).toBe("secret-token");
  });

  test("returns undefined when absent", () => {
    expect(findCookie(parseCookieFile(JAR), "missing")).toBeUndefined();
  });
});

describe("extractOauthToken", () => {
  test("accepts a bare token", () => {
    expect(extractOauthToken("oauth2_4/abc")).toBe("oauth2_4/abc");
    expect(extractOauthToken("oauth2-4/abc")).toBe("oauth2-4/abc");
  });

  test("reads name=value and name: value forms", () => {
    expect(extractOauthToken("oauth_token=abc123")).toBe("abc123");
    expect(extractOauthToken("oauth_token: abc123")).toBe("abc123");
  });

  test("reads a token out of a cookie header", () => {
    expect(extractOauthToken("NID=x; oauth_token=abc123; SID=y")).toBe("abc123");
  });

  test("returns undefined for unrelated input", () => {
    expect(extractOauthToken("nothing here")).toBeUndefined();
  });
});

describe("toCookieHeader", () => {
  test("joins cookies for the requested domain", () => {
    expect(toCookieHeader(parseCookieFile(JAR), "google.com")).toBe("oauth_token=secret-token; NID=nid-value");
  });

  test("returns an empty header when nothing matches", () => {
    expect(toCookieHeader(parseCookieFile(JAR), "other.net")).toBe("");
  });
});
