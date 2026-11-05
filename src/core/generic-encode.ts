import { Writer } from "./protobuf.ts";

export interface ProtoNode {
  readonly [key: string]: ProtoValue;
}

export type ProtoValue = ProtoNode | string | number | boolean | readonly ProtoValue[];

function isNode(value: ProtoValue): value is ProtoNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function encodeValue(field: number, value: ProtoValue, out: Writer): void {
  if (Array.isArray(value)) {
    for (const entry of value as readonly ProtoValue[]) encodeValue(field, entry, out);
    return;
  }
  if (isNode(value)) {
    out.message(field, encodeNode(value));
    return;
  }
  if (typeof value === "string") {
    out.string(field, value);
    return;
  }
  if (typeof value === "boolean") {
    out.bool(field, value);
    return;
  }
  out.uint(field, value as number);
}

export function encodeNode(node: ProtoNode): Uint8Array {
  const out = new Writer();
  for (const [key, value] of Object.entries(node)) {
    encodeValue(Number(key), value, out);
  }
  return out.finish();
}

export function cloneNode(node: ProtoNode): ProtoNode {
  return JSON.parse(JSON.stringify(node)) as ProtoNode;
}
