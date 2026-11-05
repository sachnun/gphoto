import { resolveAuthData } from "../core/config.ts";
import { parseSnapshot } from "../core/media.ts";
import { createApi } from "../cli/api-factory.ts";
import { authDataArg, jsonArg, proxyArg, targetArg } from "../cli/common.ts";
import { command, str } from "../cli/command.ts";
import { bold, cyan, dim, fail, humanBytes, humanDuration, table, yellow } from "../lib/ui.ts";

export const watchCommand = command({
  meta: { name: "watch", description: "Print signed direct-download URLs" },
  args: {
    target: { ...targetArg, description: "File name, media key, or album title", required: true },
    json: jsonArg,
    authData: authDataArg,
    proxy: proxyArg,
  },
  async run({ args }) {
    const auth = await resolveAuthData(str(args.authData));
    const api = createApi({ authData: auth.authData, proxy: str(args.proxy) });
    const target = str(args.target);
    if (!target) fail("usage: gphoto watch <fileName | mediaKey | albumName>");

    const snapshot = parseSnapshot(await api.getLibraryState());

    const album = snapshot.albums.find((entry) => entry.title.toLowerCase() === target.toLowerCase());
    if (album) {
      const members = snapshot.items
        .filter((item) => item.collectionId === album.albumKey)
        .sort((a, b) => a.fileName.localeCompare(b.fileName));
      if (args.json) {
        process.stdout.write(
          `${JSON.stringify(members.map((item) => ({ fileName: item.fileName, mediaKey: item.mediaKey })), null, 2)}\n`,
        );
        return;
      }
      process.stdout.write(`${bold(album.title)} ${dim(`(${members.length} items)`)}\n\n`);
      const rows: string[][] = [];
      for (const item of members) {
        const urls = await api.getDownloadUrls(item.mediaKey);
        rows.push([item.fileName, humanBytes(item.sizeBytes), humanDuration(item.durationMs), urls.original ?? ""]);
      }
      process.stdout.write(`${table(rows, ["file", "size", "duration", "direct url"])}\n`);
      process.stdout.write(`\n${yellow("note")} signed URLs expire; regenerate with \`gphoto watch\`\n`);
      return;
    }

    const item =
      snapshot.items.find((entry) => entry.mediaKey === target) ??
      snapshot.items.find((entry) => entry.fileName === target) ??
      snapshot.items.find((entry) => entry.fileName.toLowerCase().includes(target.toLowerCase()));

    if (!item) fail(`not found: ${target}`);

    const urls = await api.getDownloadUrls(item.mediaKey);
    if (args.json) {
      process.stdout.write(`${JSON.stringify({ ...item, downloadUrls: urls }, null, 2)}\n`);
      return;
    }

    const rows: string[][] = [
      ["file", item.fileName],
      ["mediaKey", item.mediaKey],
      ["size", humanBytes(item.sizeBytes)],
      ["resolution", item.width && item.height ? `${item.width}x${item.height}` : "-"],
      ["duration", humanDuration(item.durationMs)],
      ["quota charged", humanBytes(item.quotaChargedBytes)],
      ["renditions", item.renditions.map((entry) => `${entry.itag}:${entry.width}x${entry.height}`).join(", ") || "-"],
    ];
    process.stdout.write(`${table(rows, ["field", "value"])}\n\n`);
    process.stdout.write(`${bold("direct download")}\n${cyan(urls.original ?? urls.all.at(-1) ?? "")}\n`);
    if (urls.edited && urls.edited !== urls.original) {
      process.stdout.write(`\n${bold("edited download")}\n${cyan(urls.edited)}\n`);
    }
    process.stdout.write(
      `\n${dim("This URL works without any Google login. Anyone holding it can download the file.")}\n` +
        `${dim("Adaptive HLS/DASH playback still requires a signed-in browser session, not just the app token.")}\n`,
    );
  },
});
