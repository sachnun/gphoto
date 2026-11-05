import { defineCommand, type ArgsDef, type CommandDef } from "citty";

export interface CommandOptions {
  notes?: string;
  variadic?: string;
  examples?: string[];
}

export type CliCommand = CommandDef<ArgsDef> & CommandOptions;

export function command<T extends ArgsDef>(definition: CommandDef<T>, options: CommandOptions = {}): CliCommand {
  return { ...(defineCommand(definition) as unknown as CommandDef<ArgsDef>), ...options };
}

export async function resolveValue<T>(value: T | Promise<T> | (() => T | Promise<T>) | undefined): Promise<T | undefined> {
  if (typeof value === "function") return await (value as () => T | Promise<T>)();
  return await value;
}

export function aliases(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function int(value: unknown): number | undefined {
  const text = str(value);
  if (text === undefined) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}
