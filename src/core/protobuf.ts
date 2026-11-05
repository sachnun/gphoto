export type Wire = 0 | 1 | 2 | 5;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class Writer {
  private chunks: Uint8Array[] = [];
  private pending: number[] = [];

  private drain(): void {
    if (this.pending.length > 0) {
      this.chunks.push(Uint8Array.from(this.pending));
      this.pending = [];
    }
  }

  private varint(value: number | bigint): void {
    let v = typeof value === "bigint" ? value : BigInt(Math.trunc(value));
    if (v < 0n) v += 1n << 64n;
    do {
      let byte = Number(v & 0x7fn);
      v >>= 7n;
      if (v > 0n) byte |= 0x80;
      this.pending.push(byte);
    } while (v > 0n);
  }

  private tag(field: number, wire: Wire): void {
    this.varint((field << 3) | wire);
  }

  uint(field: number, value: number | bigint): this {
    this.tag(field, 0);
    this.varint(value);
    return this;
  }

  bool(field: number, value: boolean): this {
    return this.uint(field, value ? 1 : 0);
  }

  bytes(field: number, value: Uint8Array): this {
    this.tag(field, 2);
    this.varint(value.length);
    this.drain();
    this.chunks.push(value);
    return this;
  }

  string(field: number, value: string): this {
    return this.bytes(field, encoder.encode(value));
  }

  message(field: number, value: Uint8Array): this {
    return this.bytes(field, value);
  }

  finish(): Uint8Array {
    this.drain();
    const total = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

export interface Field {
  field: number;
  wire: Wire;
  value: Uint8Array | bigint;
}

export class Reader {
  private pos = 0;

  constructor(private readonly buf: Uint8Array) {}

  get done(): boolean {
    return this.pos >= this.buf.length;
  }

  private varint(): bigint {
    let shift = 0n;
    let out = 0n;
    for (;;) {
      if (this.pos >= this.buf.length) throw new Error("protobuf: truncated varint");
      const byte = this.buf[this.pos++]!;
      out |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return out;
      shift += 7n;
    }
  }

  next(): Field {
    const tag = Number(this.varint());
    const field = tag >>> 3;
    const wire = (tag & 7) as Wire;
    switch (wire) {
      case 0:
        return { field, wire, value: this.varint() };
      case 1: {
        const value = this.buf.subarray(this.pos, this.pos + 8);
        this.pos += 8;
        return { field, wire, value };
      }
      case 2: {
        const length = Number(this.varint());
        const value = this.buf.subarray(this.pos, this.pos + length);
        this.pos += length;
        return { field, wire, value };
      }
      case 5: {
        const value = this.buf.subarray(this.pos, this.pos + 4);
        this.pos += 4;
        return { field, wire, value };
      }
      default:
        throw new Error(`protobuf: unsupported wire type ${wire}`);
    }
  }
}

export function decodeFields(buf: Uint8Array): Field[] {
  const reader = new Reader(buf);
  const fields: Field[] = [];
  while (!reader.done) fields.push(reader.next());
  return fields;
}

export function bytesOf(value: Uint8Array | bigint): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array();
}

export function textOf(value: Uint8Array | bigint): string {
  return value instanceof Uint8Array ? decoder.decode(value) : String(value);
}

export function getBytes(fields: Field[], field: number): Uint8Array | undefined {
  const match = fields.find((entry) => entry.field === field && entry.wire === 2);
  return match ? bytesOf(match.value) : undefined;
}

export function getNumber(fields: Field[], field: number, fallback = 0): number {
  const match = fields.find((entry) => entry.field === field && entry.wire === 0);
  return match ? Number(match.value) : fallback;
}

export function getString(fields: Field[], field: number, fallback = ""): string {
  const bytes = getBytes(fields, field);
  return bytes ? decoder.decode(bytes) : fallback;
}

export function getMessages(fields: Field[], field: number): Uint8Array[] {
  return fields.filter((entry) => entry.field === field && entry.wire === 2).map((entry) => bytesOf(entry.value));
}

export function toUrlSafeBase64(text: string): string {
  return text.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
