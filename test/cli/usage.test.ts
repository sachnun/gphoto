import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { defineCommand, type CommandDef } from "citty";
import { renderHelp, renderVersion, resolveNode } from "../../src/cli/usage.ts";
import { packageVersion } from "../../src/lib/pkg.ts";
import { runCli } from "../../src/cli/run.ts";

const leaf = defineCommand({
  meta: { name: "leaf", description: "A leaf command" },
  args: {
    target: { type: "positional", description: "The target", required: true },
    verbose: { type: "boolean", alias: "v", description: "Be loud" },
    output: { type: "string", description: "Output file", valueHint: "file", default: "out.txt" },
  },
  run() {},
});

const branch = defineCommand({
  meta: { name: "branch", description: "A command with children" },
  default: "leaf",
  subCommands: { leaf },
});

const hidden = defineCommand({ meta: { name: "secret", description: "Hidden", hidden: true }, run() {} });

const root = defineCommand({
  meta: { name: "tool", version: "9.9.9", description: "Test tool" },
  subCommands: { branch, secret: hidden },
}) as CommandDef & { examples?: string[] };
root.examples = ["tool branch leaf"];

let chunks: string[];
let spies: { mockRestore: () => void }[] = [];

function capture(): void {
  chunks = [];
  spies = [
    spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
      return true;
    }),
    spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
      return true;
    }),
    spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code ?? 0})`);
    }) as never),
  ];
}

beforeEach(capture);
afterEach(() => {
  for (const spy of spies) spy.mockRestore();
});

const output = (): string => chunks.join("");

describe("resolveNode", () => {
  test("returns the root for an empty path", async () => {
    const node = await resolveNode(root, []);
    expect(node!.path).toEqual([]);
    expect(node!.cmd).toBe(root);
  });

  test("walks into nested subcommands", async () => {
    const node = await resolveNode(root, ["branch", "leaf"]);
    expect(node!.path).toEqual(["branch", "leaf"]);
    expect((node!.cmd.meta as { name: string }).name).toBe("leaf");
  });

  test("returns undefined for unknown paths", async () => {
    expect(await resolveNode(root, ["nope"])).toBeUndefined();
    expect(await resolveNode(root, ["branch", "nope"])).toBeUndefined();
  });

  test("returns undefined when descending past a leaf", async () => {
    expect(await resolveNode(root, ["branch", "leaf", "deeper"])).toBeUndefined();
  });
});

describe("renderHelp", () => {
  test("renders the root help with subcommands and examples", async () => {
    const text = await renderHelp({ cmd: root, path: [] }, root);
    expect(text).toContain("tool v9.9.9");
    expect(text).toContain("Test tool");
    expect(text).toContain("USAGE");
    expect(text).toContain("tool <command> [options]");
    expect(text).toContain("SUBCOMMANDS");
    expect(text).toContain("branch");
    expect(text).toContain("EXAMPLES");
  });

  test("hides commands marked hidden", async () => {
    const text = await renderHelp({ cmd: root, path: [] }, root);
    expect(text).not.toContain("secret");
  });

  test("renders arguments and options for a leaf", async () => {
    const node = await resolveNode(root, ["branch", "leaf"]);
    const text = await renderHelp(node!, root);
    expect(text).toContain("tool branch leaf");
    expect(text).toContain("ARGUMENTS");
    expect(text).toContain("<target>");
    expect(text).toContain("OPTIONS");
    expect(text).toContain("-v, --verbose");
    expect(text).toContain("--output <file>");
    expect(text).toContain("-h, --help");
  });

  test("shows the default value in the usage line only once", async () => {
    const node = await resolveNode(root, ["branch"]);
    const text = await renderHelp(node!, root);
    expect(text).toContain("<subcommand>");
  });

  test("appends notes when a command defines them", async () => {
    const withNotes = defineCommand({ meta: { name: "noted", description: "Has notes" }, run() {} });
    (withNotes as { notes?: string }).notes = "Extra note text";
    const text = await renderHelp({ cmd: withNotes, path: ["noted"] }, root);
    expect(text).toContain("Extra note text");
  });
});

describe("renderVersion", () => {
  test("prints the root version", async () => {
    expect(await renderVersion(root)).toBe("9.9.9\n");
  });

  test("falls back to the package version", async () => {
    const bare = defineCommand({ meta: { name: "bare" }, run() {} });
    expect(await renderVersion(bare)).toBe(`${packageVersion}\n`);
  });
});

describe("runCli", () => {
  test("prints root help without arguments", async () => {
    await runCli(root, []);
    expect(output()).toContain("tool v9.9.9");
  });

  test("prints help for --help", async () => {
    await runCli(root, ["branch", "--help"]);
    expect(output()).toContain("tool branch");
  });

  test("prints help for the help command", async () => {
    await runCli(root, ["help", "branch", "leaf"]);
    expect(output()).toContain("tool branch leaf");
  });

  test("prints the version for --version and version", async () => {
    await runCli(root, ["--version"]);
    expect(output()).toBe("9.9.9\n");
    chunks = [];
    await runCli(root, ["version"]);
    expect(output()).toBe("9.9.9\n");
  });

  test("rejects an unknown command in the help path", async () => {
    await expect(runCli(root, ["help", "nope"])).rejects.toThrow("process.exit(1)");
    expect(output()).toContain("unknown command: nope");
  });
});
