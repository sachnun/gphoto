import type { BooleanArgDef, StringArgDef } from "citty";

export const authDataArg: StringArgDef = {
  type: "string",
  description: "Override stored credentials",
  valueHint: "string",
};

export const proxyArg: StringArgDef = {
  type: "string",
  description: "HTTP proxy",
  valueHint: "url",
};

export const jsonArg: BooleanArgDef = {
  type: "boolean",
  alias: "j",
  description: "Output JSON",
};

export const yesArg: BooleanArgDef = {
  type: "boolean",
  alias: "y",
  description: "Skip confirmation",
};

export const recursiveArg: BooleanArgDef = {
  type: "boolean",
  alias: "r",
  description: "Recurse into directories",
};

export const targetArg = {
  type: "positional",
  description: "File name, media key, or album title",
  required: false,
} as const;
