import { resolveAuthData } from "../core/config.ts";
import { parseSnapshot } from "../core/media.ts";
import { createApi } from "../cli/api-factory.ts";
import { authDataArg, jsonArg, proxyArg, yesArg } from "../cli/common.ts";
import { command, str } from "../cli/command.ts";
import { dim, fail, green, humanBytes, table, yellow } from "../lib/ui.ts";

function resolveTargets(
  items: ReturnType<typeof parseSnapshot>["items"],
  targets: string[],
  snapshot: ReturnType<typeof parseSnapshot>,
) {
  if (targets.length === 0) return [];
  const out = [];
  for (const target of targets) {
    const album = snapshot.albums.find((entry) => entry.title.toLowerCase() === target.toLowerCase());
    if (album) {
      out.push(...items.filter((item) => item.collectionId === album.albumKey));
      continue;
    }
    out.push(...items.filter((item) => item.mediaKey === target || item.fileName === target));
  }
  return [...new Map(out.map((item) => [item.mediaKey, item])).values()];
}

function targetsArgs() {
  return {
    target: {
      type: "positional" as const,
      description: "File name, media key, or album title",
      required: false,
    },
    json: jsonArg,
    yes: yesArg,
    authData: authDataArg,
    proxy: proxyArg,
  };
}

export const trashCommand = command({
  meta: { name: "trash", description: "List, trash, restore, or delete items" },
  default: "ls",
  subCommands: {
    ls: command({
      meta: { name: "ls", description: "List trashed items" },
      args: { json: jsonArg, authData: authDataArg, proxy: proxyArg },
      async run({ args }) {
        const auth = await resolveAuthData(str(args.authData));
        const api = createApi({ authData: auth.authData, proxy: str(args.proxy) });
        const snapshot = parseSnapshot(await api.getLibraryState());
        const items = snapshot.items.filter((item) => item.trashTimestamp > 0);
        if (args.json) {
          process.stdout.write(`${JSON.stringify(items, null, 2)}\n`);
          return;
        }
        if (items.length === 0) {
          process.stdout.write(`${dim("trash is empty")}\n`);
          return;
        }
        const rows = items.map((item) => [
          item.fileName,
          humanBytes(item.sizeBytes),
          new Date(item.trashTimestamp).toISOString().slice(0, 16),
          item.dedupKey,
        ]);
        process.stdout.write(`${table(rows, ["file", "size", "trashed at", "dedup key"])}\n`);
      },
    }),
    add: command({
      meta: { name: "add", description: "Move items to trash" },
      args: targetsArgs(),
      async run({ args }) {
        const auth = await resolveAuthData(str(args.authData));
        const api = createApi({ authData: auth.authData, proxy: str(args.proxy) });
        const snapshot = parseSnapshot(await api.getLibraryState());
        const items = resolveTargets(snapshot.items, args._, snapshot);
        if (items.length === 0) fail("no matching items");
        if (!args.yes) {
          process.stdout.write(`${yellow("would trash")} ${items.length} item(s):\n`);
          for (const item of items) process.stdout.write(`  ${item.fileName}\n`);
          fail("re-run with --yes to confirm");
        }
        for (const item of items) await api.moveToTrash([item.dedupKey]);
        process.stdout.write(`${green("trashed")} ${items.length} item(s)\n`);
        process.stdout.write(`${dim("note: trashing by dedup key also removes album copies of the same file")}\n`);
      },
    }),
    restore: command({
      meta: { name: "restore", description: "Restore items from trash" },
      args: targetsArgs(),
      async run({ args }) {
        const auth = await resolveAuthData(str(args.authData));
        const api = createApi({ authData: auth.authData, proxy: str(args.proxy) });
        const snapshot = parseSnapshot(await api.getLibraryState());
        const items = resolveTargets(snapshot.items, args._, snapshot);
        if (items.length === 0) fail("no matching items");
        for (const item of items) await api.restoreFromTrash([item.dedupKey]);
        process.stdout.write(`${green("restored")} ${items.length} item(s)\n`);
      },
    }),
    rm: command({
      meta: { name: "rm", description: "Delete permanently" },
      args: targetsArgs(),
      async run({ args }) {
        const auth = await resolveAuthData(str(args.authData));
        const api = createApi({ authData: auth.authData, proxy: str(args.proxy) });
        const snapshot = parseSnapshot(await api.getLibraryState());
        const items = resolveTargets(snapshot.items, args._, snapshot).filter((item) => item.trashTimestamp > 0);
        if (items.length === 0) fail("no trashed items matched");
        if (!args.yes) fail("refusing to delete permanently without --yes");
        for (const item of items) await api.deletePermanently([item.dedupKey]);
        process.stdout.write(`${green("deleted permanently")} ${items.length} item(s)\n`);
      },
    }),
  },
});
