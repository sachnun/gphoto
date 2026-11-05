import { randomBytes } from "node:crypto";
import { request } from "./http.ts";

const CHECKIN_URL = "https://android.googleapis.com/checkin";
const USER_AGENT = "Android-Checkin/2.0 (vbox86p JLS36G); gzip";

function varint(value: number | bigint): Uint8Array<ArrayBuffer> {
  let v = typeof value === "bigint" ? value : BigInt(Math.trunc(value));
  if (v < 0n) v += 1n << 64n;
  const bytes: number[] = [];
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) byte |= 0x80;
    bytes.push(byte);
  } while (v > 0n);
  return Uint8Array.from(bytes) as Uint8Array<ArrayBuffer>;
}

function tag(field: number, wire: 0 | 1 | 2): Uint8Array<ArrayBuffer> {
  return varint((field << 3) | wire);
}

function varintField(field: number, value: number | bigint): Uint8Array<ArrayBuffer> {
  return concat(tag(field, 0), varint(value));
}

function lenField(field: number, data: Uint8Array): Uint8Array<ArrayBuffer> {
  return concat(tag(field, 2), varint(data.length), data);
}

function fixed64Field(field: number, value: bigint): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(new ArrayBuffer(8));
  let v = value & 0xffffffffffffffffn;
  for (let index = 0; index < 8; index += 1) {
    buf[index] = Number(v & 0xffn);
    v >>= 8n;
  }
  return concat(tag(field, 1), buf);
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const enc = new TextEncoder();
const field = (value: string): Uint8Array<ArrayBuffer> => enc.encode(value) as Uint8Array<ArrayBuffer>;

function buildCheckinRequest(): Uint8Array<ArrayBuffer> {
  const nowMs = Date.now();

  const build = concat(
    lenField(1, field("google/marlin/marlin:10/QP1A.191005.007.A3/5973814:user/release-keys")),
    lenField(2, field("marlin")),
    lenField(3, field("google")),
    lenField(6, field("android-google")),
    varintField(7, 1577836800),
    lenField(9, field("marlin")),
    varintField(10, 29),
    lenField(11, field("Pixel XL")),
    lenField(12, field("Google")),
    lenField(13, field("marlin")),
  );

  const event = concat(lenField(1, field("event_log_start")), varintField(3, nowMs));

  const checkinBody = concat(
    lenField(1, build),
    varintField(2, 0),
    lenField(3, event),
    varintField(9, 0),
  );

  const loggingId = randomBytes(8).readBigUInt64BE() & 0x7fffffffffffffffn;

  return concat(
    varintField(2, 0),
    lenField(4, checkinBody),
    lenField(6, field("en_US")),
    varintField(7, loggingId),
    lenField(11, new Uint8Array(new ArrayBuffer(0))),
    lenField(12, field("GMT")),
    varintField(14, 3),
    lenField(15, field("71Q6Rn2DDZl1zPDVaaeEHItd")),
    varintField(20, 0),
  );
}

export interface CheckinResult {
  androidId: bigint;
  androidIdHex: string;
  securityToken?: bigint;
}

export async function checkin(): Promise<CheckinResult> {
  const body = Bun.gzipSync(buildCheckinRequest());
  const response = await request(CHECKIN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-protobuffer",
      "Content-Encoding": "gzip",
      "Accept-Encoding": "gzip",
      "User-Agent": USER_AGENT,
    },
    body,
    timeoutMs: 60_000,
  });

  if (response.status !== 200) {
    throw new Error(`checkin failed: HTTP ${response.status}`);
  }

  let raw: Uint8Array = response.bytes;
  if (raw[0] === 0x1f && raw[1] === 0x8b) raw = new Uint8Array(Bun.gunzipSync(new Uint8Array(raw)));

  const result: { androidId?: bigint; securityToken?: bigint; statsOk?: boolean } = {};
  let pos = 0;
  const readVarint = (): bigint => {
    let shift = 0n;
    let out = 0n;
    for (;;) {
      const byte = raw[pos++]!;
      out |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return out;
      shift += 7n;
    }
  };

  while (pos < raw.length) {
    const key = Number(readVarint());
    const fieldNo = key >>> 3;
    const wire = key & 7;
    if (wire === 0) {
      const value = readVarint();
      if (fieldNo === 1) result.statsOk = value === 1n;
    } else if (wire === 1) {
      let value = 0n;
      for (let index = 7; index >= 0; index -= 1) value = (value << 8n) | BigInt(raw[pos + index]!);
      pos += 8;
      if (fieldNo === 7) result.androidId = value;
      if (fieldNo === 8) result.securityToken = value;
    } else if (wire === 2) {
      const length = Number(readVarint());
      pos += length;
    } else if (wire === 5) {
      pos += 4;
    } else {
      throw new Error(`checkin: unsupported wire type ${wire}`);
    }
  }

  if (!result.androidId) throw new Error("checkin: response has no androidId");
  return {
    androidId: result.androidId,
    androidIdHex: result.androidId.toString(16).padStart(16, "0"),
    securityToken: result.securityToken,
  };
}

export const checkinFields = { varintField, lenField, fixed64Field };
