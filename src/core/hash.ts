import { createHash } from "node:crypto";

export interface HashedFile {
  sha1: Uint8Array;
  base64: string;
  hex: string;
  size: number;
}

export async function sha1File(path: string, onProgress?: (done: number, total: number) => void): Promise<HashedFile> {
  const file = Bun.file(path);
  const size = file.size;
  const hash = createHash("sha1");
  const stream = file.stream();
  const reader = stream.getReader();
  let done = 0;
  for (;;) {
    const { value, done: finished } = await reader.read();
    if (finished) break;
    hash.update(value);
    done += value.length;
    onProgress?.(done, size);
  }
  const digest = new Uint8Array(hash.digest());
  return {
    sha1: digest,
    base64: Buffer.from(digest).toString("base64"),
    hex: Buffer.from(digest).toString("hex"),
    size,
  };
}

const HEX_SHA1 = /^[0-9a-fA-F]{40}$/;

export function normalizeSha1(input: string): HashedFile {
  if (HEX_SHA1.test(input)) {
    const bytes = new Uint8Array(Buffer.from(input, "hex"));
    return { sha1: bytes, base64: Buffer.from(bytes).toString("base64"), hex: input.toLowerCase(), size: 0 };
  }
  const bytes = new Uint8Array(Buffer.from(input, "base64"));
  if (bytes.length !== 20) throw new Error("invalid SHA-1: expected 40 hex chars or 20 base64 bytes");
  return { sha1: bytes, base64: input, hex: Buffer.from(bytes).toString("hex"), size: 0 };
}
