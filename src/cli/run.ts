import { runCommand, type CommandDef } from "citty";
import { red } from "../lib/ui.ts";
import { resolveNode, renderHelp, renderVersion } from "./usage.ts";

export async function runCli(root: CommandDef, argv: string[]): Promise<void> {
  const helpIndex = argv.findIndex((arg) => arg === "-h" || arg === "--help");
  if (helpIndex >= 0) {
    const path = argv.slice(0, helpIndex).filter((arg) => !arg.startsWith("-"));
    const node = await resolveNode(root, path);
    process.stdout.write(await renderHelp(node ?? { cmd: root, path: [] }, root));
    return;
  }

  if (argv.length === 0 || argv[0] === "help") {
    const path = argv.slice(1).filter((arg) => !arg.startsWith("-"));
    const node = await resolveNode(root, path);
    if (path.length > 0 && !node) {
      process.stderr.write(`${red("error")} unknown command: ${path.join(" ")}\n`);
      process.exit(1);
    }
    process.stdout.write(await renderHelp(node ?? { cmd: root, path: [] }, root));
    return;
  }

  if (argv[0] === "version" || argv[0] === "--version" || argv[0] === "-v") {
    process.stdout.write(await renderVersion(root));
    return;
  }

  try {
    await runCommand(root, { rawArgs: argv });
  } catch (error) {
    process.stderr.write(`${red("error")} ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
