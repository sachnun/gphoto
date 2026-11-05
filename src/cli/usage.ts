import type { ArgDef, ArgsDef, CommandDef } from "citty";
import { aliases, resolveValue, type CommandOptions } from "./command.ts";
import { bold, cyan, dim } from "../lib/ui.ts";

const VERSION = "0.1.0";

export interface ResolvedNode {
  cmd: CommandDef;
  path: string[];
}

interface NamedArg {
  name: string;
  def: ArgDef;
}

function options(cmd: CommandDef): CommandOptions {
  return cmd as CommandOptions;
}

function kebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

function flagLabel(entry: NamedArg): string {
  const shorts = aliases((entry.def as { alias?: string | string[] }).alias).map((alias) => `-${alias}`);
  const long = `--${kebab(entry.name)}`;
  if (entry.def.type === "string" || entry.def.type === "enum") {
    const hint =
      entry.def.valueHint ?? (entry.def.type === "enum" && entry.def.options?.length ? entry.def.options.join("|") : kebab(entry.name));
    return [...shorts, `${long} <${hint}>`].join(", ");
  }
  return [...shorts, long].join(", ");
}

function positionalLabel(entry: NamedArg): string {
  const required = entry.def.required === true || entry.def.required === undefined;
  return required ? `<${kebab(entry.name)}>` : `[${kebab(entry.name)}]`;
}

function align(rows: string[][], indent = "  "): string[] {
  const width = rows.reduce((max, row) => Math.max(max, (row[0] ?? "").length), 0);
  return rows.map(([left = "", right = ""]) => (right ? `${indent}${left.padEnd(width)}  ${right}` : `${indent}${left}`));
}

function section(title: string, lines: string[]): string[] {
  return lines.length === 0 ? [] : ["", bold(title), ...lines];
}

async function argEntries(cmd: CommandDef): Promise<{ positionals: string[][]; options: string[][] }> {
  const defs = ((await resolveValue(cmd.args)) ?? {}) as ArgsDef;
  const positionals: string[][] = [];
  const options: string[][] = [];
  for (const [name, def] of Object.entries(defs)) {
    const entry = { name, def };
    const description = def.description ?? "";
    if (def.type === "positional") positionals.push([positionalLabel(entry), description]);
    else options.push([flagLabel(entry), description]);
  }
  options.push(["-h, --help", "Show this help"]);
  return { positionals, options };
}

async function subCommandEntries(cmd: CommandDef): Promise<string[][]> {
  const subs = await resolveValue(cmd.subCommands);
  if (!subs) return [];
  const rows: string[][] = [];
  for (const [name, entry] of Object.entries(subs)) {
    const sub = await resolveValue(entry);
    if (!sub) continue;
    const meta = (await resolveValue(sub.meta)) ?? {};
    if (meta.hidden) continue;
    rows.push([name, meta.description ?? ""]);
  }
  return rows;
}

export async function resolveNode(root: CommandDef, path: string[]): Promise<ResolvedNode | undefined> {
  let current = root;
  const walked: string[] = [];
  for (const name of path) {
    const subs = await resolveValue(current.subCommands);
    if (!subs) return undefined;
    let found: CommandDef | undefined;
    for (const [key, entry] of Object.entries(subs)) {
      const sub = await resolveValue(entry);
      if (!sub) continue;
      const meta = (await resolveValue(sub.meta)) ?? {};
      if (key === name || aliases(meta.alias).includes(name)) {
        found = sub;
        break;
      }
    }
    if (!found) return undefined;
    current = found;
    walked.push(name);
  }
  return { cmd: current, path: walked };
}

export async function renderHelp(node: ResolvedNode, root?: CommandDef): Promise<string> {
  const rootCmd = root ?? node.cmd;
  const rootMeta = (await resolveValue(rootCmd.meta)) ?? {};
  const rootName = rootMeta.name ?? "gphoto";
  const rootExamples = options(rootCmd).examples ?? [];

  const meta = (await resolveValue(node.cmd.meta)) ?? {};
  const isRoot = node.path.length === 0;
  const name = [rootName, ...node.path].join(" ");
  const { positionals, options: flagRows } = await argEntries(node.cmd);
  const subs = await subCommandEntries(node.cmd);
  const variadic = options(node.cmd).variadic;
  const usagePositionals = variadic ? [variadic] : positionals.map(([label]) => label ?? "");
  const lines: string[] = [];

  const heading = isRoot
    ? `${bold(rootName)} ${dim(`v${meta.version ?? VERSION}`)} — ${meta.description ?? ""}`
    : `${bold(name)} ${dim("—")} ${meta.description ?? ""}`;
  lines.push(heading, "");

  const usageParts = isRoot
    ? [`${rootName} <command> [options]`]
    : [name, ...(flagRows.length > 0 ? ["[options]"] : []), ...usagePositionals];
  if (!isRoot && subs.length > 0) usageParts.push("<subcommand>");
  lines.push(bold("USAGE"), `  ${cyan(usageParts.join(" ").replace(/\s+/g, " ").trim())}`);

  if (subs.length > 0) lines.push(...section("SUBCOMMANDS", align(subs)));
  if (positionals.length > 0) lines.push(...section("ARGUMENTS", align(positionals)));
  if (flagRows.length > 0) lines.push(...section("OPTIONS", align(flagRows)));

  if (isRoot) {
    if (rootExamples.length > 0) lines.push(...section("EXAMPLES", rootExamples.map((example) => `  ${example}`)));
    lines.push("", dim(`Run \`${rootName} <command> --help\` for command-specific options.`));
  }

  const notes = options(node.cmd).notes;
  if (notes) lines.push("", notes);

  return `${lines.join("\n")}\n`;
}

export async function renderVersion(root: CommandDef): Promise<string> {
  const meta = (await resolveValue(root.meta)) ?? {};
  return `${meta.version ?? VERSION}\n`;
}
