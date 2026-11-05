import { describe, expect, test } from "bun:test";
import { bytesOf, decodeFields, getBytes, getMessages, getNumber, getString, Reader, toUrlSafeBase64, Writer } from "../../src/core/protobuf.ts";
import { encodeNode } from "../../src/core/generic-encode.ts";

describe("Writer and Reader", () => {
  test("round-trips uint, string and nested message fields", () => {
    const inner = new Writer().uint(1, 42).string(2, "hi").finish();
    const buf = new Writer().uint(1, 7).string(2, "name").message(3, inner).bool(4, true).finish();

    const fields = decodeFields(buf);
    expect(getNumber(fields, 1)).toBe(7);
    expect(getString(fields, 2)).toBe("name");
    expect(getNumber(fields, 4)).toBe(1);

    const nested = decodeFields(getBytes(fields, 3)!);
    expect(getNumber(nested, 1)).toBe(42);
    expect(getString(nested, 2)).toBe("hi");
  });

  test("encodes varints across byte boundaries", () => {
    const buf = new Writer().uint(1, 300).finish();
    expect(Array.from(buf)).toEqual([0x08, 0xac, 0x02]);
    expect(getNumber(decodeFields(buf), 1)).toBe(300);
  });

  test("encodes negative numbers as two's complement varints", () => {
    const buf = new Writer().uint(1, -1).finish();
    expect(buf.length).toBe(11);
    expect(decodeFields(buf)[0]!.value).toBe(18446744073709551615n);
  });

  test("returns every repeated message", () => {
    const buf = new Writer()
      .message(1, new Writer().string(1, "a").finish())
      .message(1, new Writer().string(1, "b").finish())
      .finish();
    const messages = getMessages(decodeFields(buf), 1);
    expect(messages).toHaveLength(2);
    expect(messages.map((entry) => getString(decodeFields(entry), 1))).toEqual(["a", "b"]);
  });

  test("reports truncation instead of looping", () => {
    const reader = new Reader(new Uint8Array([0x08, 0x80]));
    expect(() => reader.next()).toThrow("truncated varint");
  });

  test("rejects unsupported wire types", () => {
    const reader = new Reader(new Uint8Array([0x0b]));
    expect(() => reader.next()).toThrow("unsupported wire type");
  });

  test("returns an empty array for empty input", () => {
    expect(decodeFields(new Uint8Array())).toEqual([]);
  });

  test("ignores non-bytes values when asked for bytes", () => {
    const fields = decodeFields(new Writer().uint(1, 5).finish());
    expect(bytesOf(fields[0]!.value)).toEqual(new Uint8Array());
  });

  test("falls back for missing fields", () => {
    const fields = decodeFields(new Writer().uint(1, 5).finish());
    expect(getString(fields, 9, "fallback")).toBe("fallback");
    expect(getNumber(fields, 9, 3)).toBe(3);
    expect(getBytes(fields, 9)).toBeUndefined();
    expect(getMessages(fields, 9)).toEqual([]);
  });
});

describe("toUrlSafeBase64", () => {
  test("replaces unsafe characters and strips padding", () => {
    expect(toUrlSafeBase64("a+b/c==")).toBe("a-b_c");
    expect(toUrlSafeBase64("plain")).toBe("plain");
  });
});

describe("encodeNode", () => {
  test("encodes nested nodes, arrays and scalars", () => {
    const buf = encodeNode({ "1": "root", "2": { "1": 5 }, "3": [{ "1": "a" }, { "1": "b" }] });
    const fields = decodeFields(buf);
    expect(getString(fields, 1)).toBe("root");
    expect(getNumber(decodeFields(getBytes(fields, 2)!), 1)).toBe(5);
    expect(getMessages(fields, 3)).toHaveLength(2);
  });

  test("encodes booleans as 0 and 1", () => {
    const fields = decodeFields(encodeNode({ "1": true, "2": false }));
    expect(getNumber(fields, 1)).toBe(1);
    expect(getNumber(fields, 2)).toBe(0);
  });
});
