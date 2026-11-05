import { resolveAuthData } from "../core/config.ts";
import { parseSnapshot } from "../core/media.ts";
import { createApi } from "../cli/api-factory.ts";
import { authDataArg, jsonArg, proxyArg, recursiveArg, yesArg } from "../cli/common.ts";
import { command, str } from "../cli/command.ts";
import { bold, dim, fail, green, table, yellow } from "../lib/ui.ts";
import { collectMedia } from "./upload.ts";

function lookupKeys(snapshot: ReturnType<typeof parseSnapshot>, files: string[]) {
  const byName = new Map(snapshot.items.map((item) => [item.fileName, item.mediaKey]));
  const keys: string[] = [];
  const missing: string[] = [];
  for (const file of files) {
    const name = file.split("/").at(-1)!;
    const key = byName.get(name);
    if (key) keys.push(key);
    else missing.push(name);
  }
  return { keys, missing };
}

export const albumCommand = command({
  meta: { name: "album", description: "Create, rename, and manage albums" },
  default: "ls",
  subCommands: {
    ls: command({
      meta: { name: "ls", description: "List albums" },
      args: { json: jsonArg, authData: authDataArg, proxy: proxyArg },
      async run({ args }) {
        const auth = await resolveAuthData(str(args.authData));
        const api = createApi({ authData: auth.authData, proxy: str(args.proxy) });
        const snapshot = parseSnapshot(await api.getLibraryState());
        if (args.json) {
          process.stdout.write(`${JSON.stringify(snapshot.albums, null, 2)}\n`);
          return;
        }
        if (snapshot.albums.length === 0) {
          process.stdout.write(`${dim("no albums")}\n`);
          return;
        }
        const rows = snapshot.albums.map((album) => [album.title, String(album.itemCount), album.albumKey]);
        process.stdout.write(`${table(rows, ["album", "items", "key"])}\n`);
      },
    }),
    create: command({
      meta: { name: "create", description: "Create an album from files already in the library" },
      args: {
        name: { type: "positional", description: "Album name", required: true },
        recursive: recursiveArg,
        authData: authDataArg,
        proxy: proxyArg,
      },
      async run({ args }) {
        const name = str(args.name);
        if (!name) fail("album name is required: gphoto album create <name> <path...>");
        const paths = args._.slice(1);
        if (paths.length === 0) fail("at least one media file is required");

        const auth = await resolveAuthData(str(args.authData));
        const api = createApi({ authData: auth.authData, proxy: str(args.proxy) });

        const files: string[] = [];
        for (const path of paths) files.push(...(await collectMedia(path, args.recursive === true)));

        const snapshot = parseSnapshot(await api.getLibraryState());
        const { keys, missing } = lookupKeys(snapshot, files);
        if (keys.length === 0) fail("none of those files exist in the library (upload them first)");

        const albumKey = await api.createAlbum(name, keys);
        process.stdout.write(`${green("created")} ${bold(name)} ${dim(albumKey)} with ${keys.length} item(s)\n`);
        if (missing.length > 0) process.stdout.write(`${yellow("skipped")} not in library: ${missing.join(", ")}\n`);
      },
    }),
    add: command({
      meta: { name: "add", description: "Add library files to an existing album" },
      args: {
        albumKey: { type: "positional", description: "Album key", required: true },
        recursive: recursiveArg,
        authData: authDataArg,
        proxy: proxyArg,
      },
      async run({ args }) {
        const albumKey = str(args.albumKey);
        const paths = args._.slice(1);
        if (!albumKey) fail("album key is required: gphoto album add <albumKey> <path...>");
        if (paths.length === 0) fail("at least one media file is required");

        const auth = await resolveAuthData(str(args.authData));
        const api = createApi({ authData: auth.authData, proxy: str(args.proxy) });

        const files: string[] = [];
        for (const path of paths) files.push(...(await collectMedia(path, args.recursive === true)));

        const snapshot = parseSnapshot(await api.getLibraryState());
        const { keys } = lookupKeys(snapshot, files);
        if (keys.length === 0) fail("none of those files exist in the library");

        await api.addMediaToAlbum(albumKey, keys);
        process.stdout.write(`${green("added")} ${keys.length} item(s) to ${albumKey}\n`);
      },
    }),
    rename: command({
      meta: { name: "rename", description: "Rename an album" },
      args: {
        albumKey: { type: "positional", description: "Album key", required: true },
        title: { type: "positional", description: "New title", required: true },
        authData: authDataArg,
        proxy: proxyArg,
      },
      async run({ args }) {
        const albumKey = str(args.albumKey);
        const title = args._.slice(1).join(" ");
        if (!albumKey || !title) fail("usage: gphoto album rename <albumKey> <new title>");
        const auth = await resolveAuthData(str(args.authData));
        const api = createApi({ authData: auth.authData, proxy: str(args.proxy) });
        await api.renameAlbum(albumKey, title);
        process.stdout.write(`${green("renamed")} ${albumKey} -> ${bold(title)}\n`);
      },
    }),
    rm: command({
      meta: { name: "rm", description: "Move album-only entries to trash" },
      args: {
        albumKey: { type: "positional", description: "Album key", required: true },
        yes: yesArg,
        authData: authDataArg,
        proxy: proxyArg,
      },
      async run({ args }) {
        const albumKey = str(args.albumKey);
        if (!albumKey) fail("usage: gphoto album rm <albumKey>");
        if (!args.yes) fail("refusing to delete without --yes");

        const auth = await resolveAuthData(str(args.authData));
        const api = createApi({ authData: auth.authData, proxy: str(args.proxy) });
        const snapshot = parseSnapshot(await api.getLibraryState());

        const album = snapshot.albums.find((entry) => entry.albumKey === albumKey);
        if (!album) fail(`album not found: ${albumKey}`);

        const members = snapshot.items.filter((item) => item.collectionId === albumKey);
        for (const item of members) {
          if (!item.isCanonical) await api.moveToTrash([item.dedupKey]);
        }
        process.stdout.write(`${green("emptied")} album "${album.title}" (${members.length} entries)\n`);
        process.stdout.write(`${yellow("note")} deleting the album itself requires the web UI\n`);
      },
    }),
  },
});
