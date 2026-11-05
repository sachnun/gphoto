import { afterEach, describe, expect, test } from "bun:test";
import { request, requestOk } from "../../src/core/http.ts";

const original = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = original;
});

function stub(response: Response, capture?: (init: RequestInit) => void): void {
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    capture?.(init);
    return response;
  }) as unknown as typeof fetch;
}

describe("request", () => {
  test("returns status, headers, bytes and text", async () => {
    stub(new Response("hello", { status: 200, headers: { "x-test": "1" } }));
    const response = await request("https://example.test/");
    expect(response.status).toBe(200);
    expect(response.text).toBe("hello");
    expect(response.bytes).toEqual(new TextEncoder().encode("hello"));
    expect(response.headers.get("x-test")).toBe("1");
  });

  test("defaults to GET", async () => {
    let method = "";
    stub(new Response(""), (init) => {
      method = init.method ?? "";
    });
    await request("https://example.test/");
    expect(method).toBe("GET");
  });

  test("forwards method, headers, body and proxy", async () => {
    let captured: RequestInit = {};
    stub(new Response(""), (init) => {
      captured = init;
    });
    await request("https://example.test/", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "payload",
      proxy: "http://proxy.test:8080",
    });
    expect(captured.method).toBe("POST");
    expect((captured.headers as Record<string, string>)["Content-Type"]).toBe("text/plain");
    expect(captured.body).toBe("payload");
    expect((captured as { proxy?: string }).proxy).toBe("http://proxy.test:8080");
  });

  test("passes an abort signal", async () => {
    let signal: AbortSignal | undefined;
    stub(new Response(""), (init) => {
      signal = init.signal as AbortSignal;
    });
    await request("https://example.test/", { timeoutMs: 5000 });
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  test("does not throw on error status", async () => {
    stub(new Response("boom", { status: 500 }));
    const response = await request("https://example.test/");
    expect(response.status).toBe(500);
    expect(response.text).toBe("boom");
  });
});

describe("requestOk", () => {
  test("returns the response for 2xx", async () => {
    stub(new Response("ok", { status: 201 }));
    const response = await requestOk("https://example.test/");
    expect(response.status).toBe(201);
  });

  test("throws with the status and body excerpt", async () => {
    stub(new Response("denied", { status: 403 }));
    await expect(requestOk("https://example.test/")).rejects.toThrow("HTTP 403 for https://example.test/: denied");
  });

  test("treats 3xx as an error", async () => {
    stub(new Response("moved", { status: 302 }));
    await expect(requestOk("https://example.test/")).rejects.toThrow("HTTP 302");
  });
});
