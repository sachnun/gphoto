import { describe, expect, test } from "bun:test";
import { decodeFields, Writer } from "../../src/core/protobuf.ts";
import { parseSnapshot } from "../../src/core/media.ts";
import { encodeNode } from "../../src/core/generic-encode.ts";

describe("parseMediaItem edge cases", () => {
  test("keeps a missing collection id empty", () => {
    const state = encodeNode({ "1": { "2": [{ "1": "K", "2": { "4": "f.jpg" } }] } });
    const snapshot = parseSnapshot(decodeNode(state));
    expect(snapshot.items[0]!.collectionId).toBe("");
  });

  test("handles items without media data", () => {
    const state = encodeNode({ "1": { "2": [{ "1": "K", "2": { "4": "f.jpg" } }] } });
    const snapshot = parseSnapshot(decodeNode(state));
    expect(snapshot.items[0]!.type).toBe(0);
    expect(snapshot.items[0]!.renditions).toEqual([]);
  });
});

describe("decodeFields with fixed width fields", () => {
  test("reads 64 bit and 32 bit values", () => {
    const buf = new Uint8Array([
      0x09, 1, 0, 0, 0, 0, 0, 0, 0,
      0x0d, 2, 0, 0, 0,
    ]);
    const fields = decodeFields(buf);
    expect(fields).toHaveLength(2);
    expect(fields[0]!.wire).toBe(1);
    expect((fields[0]!.value as Uint8Array).length).toBe(8);
    expect(fields[1]!.wire).toBe(5);
    expect((fields[1]!.value as Uint8Array).length).toBe(4);
  });

  test("stops at the end of the buffer", () => {
    const buf = new Writer().uint(1, 1).uint(2, 2).finish();
    const reader = decodeFields(buf);
    expect(reader).toHaveLength(2);
  });
});

function decodeNode(buf: Uint8Array) {
  const out: Record<string, unknown> = {};
  for (const field of decodeFields(buf)) {
    const key = String(field.field);
    const value: unknown = field.wire === 2 ? decodeChild(field.value as Uint8Array) : Number(field.value);
    if (key in out) {
      const existing = out[key];
      out[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
    } else {
      out[key] = value;
    }
  }
  return out as never;
}

function decodeChild(buf: Uint8Array): unknown {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  if (/^[\x20-\x7e]*$/.test(text) && text.length > 0) return text;
  return decodeNode(buf);
}
