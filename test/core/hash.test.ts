import { describe, expect, test } from "bun:test";
import { normalizeSha1, sha1File } from "../../src/core/hash.ts";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SHA1_BASE64, SHA1_BYTES, SHA1_HEX } from "../fixtures/library.ts";

describe("normalizeSha1", () => {
  test("accepts a 40 character hex digest", () => {
    const hashed = normalizeSha1(SHA1_HEX);
    expect(hashed.hex).toBe(SHA1_HEX);
    expect(hashed.base64).toBe(SHA1_BASE64);
    expect(hashed.sha1).toEqual(SHA1_BYTES);
  });

  test("accepts a base64 digest", () => {
    const hashed = normalizeSha1(SHA1_BASE64);
    expect(hashed.hex).toBe(SHA1_HEX);
    expect(hashed.size).toBe(0);
  });

  test("lowercases hex input", () => {
    expect(normalizeSha1(SHA1_HEX.toUpperCase()).hex).toBe(SHA1_HEX);
  });

  test("rejects digests of the wrong length", () => {
    expect(() => normalizeSha1("dG9vLXNob3J0")).toThrow("invalid SHA-1");
  });
});

describe("sha1File", () => {
  test("hashes a file and reports progress", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gphoto-hash-"));
    const file = join(dir, "sample.bin");
    try {
      await writeFile(file, "hello world");
      const progress: number[] = [];
      const hashed = await sha1File(file, (done) => progress.push(done));
      expect(hashed.size).toBe(11);
      expect(hashed.hex).toBe("2aae6c35c94fcfb415dbe95f408b9ce91ee846ed");
      expect(hashed.base64).toBe(Buffer.from(hashed.sha1).toString("base64"));
      expect(progress.at(-1)).toBe(11);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("hashes an empty file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gphoto-hash-"));
    const file = join(dir, "empty.bin");
    try {
      await writeFile(file, "");
      const hashed = await sha1File(file);
      expect(hashed.size).toBe(0);
      expect(hashed.hex).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
