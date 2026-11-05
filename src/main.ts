#!/usr/bin/env bun
import "./lib/color-mode.ts";
import { command } from "./cli/command.ts";
import { runCli } from "./cli/run.ts";
import { albumCommand } from "./commands/album.ts";
import { downloadCommand } from "./commands/download.ts";
import { loginCommand } from "./commands/login.ts";
import { lsCommand } from "./commands/ls.ts";
import { quotaCommand } from "./commands/quota.ts";
import { trashCommand } from "./commands/trash.ts";
import { uploadCommand } from "./commands/upload.ts";
import { watchCommand } from "./commands/watch.ts";
import { logoutCommand, whoamiCommand } from "./commands/whoami.ts";

const root = command({
  meta: {
    name: "gphoto",
    version: "0.1.0",
    description: "Google Photos CLI with unlimited original-quality upload",
  },
  subCommands: {
    login: loginCommand,
    logout: logoutCommand,
    whoami: whoamiCommand,
    upload: uploadCommand,
    ls: lsCommand,
    album: albumCommand,
    watch: watchCommand,
    download: downloadCommand,
    trash: trashCommand,
    quota: quotaCommand,
  },
}, {
  examples: [
    "gphoto login",
    "gphoto upload ./anime/ -r --album \"Aho Girl\" --threads 4",
    "gphoto ls --videos",
    "gphoto watch \"Aho Girl\"",
    "gphoto quota",
  ],
});

runCli(root, Bun.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
