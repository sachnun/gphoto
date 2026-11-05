import { resolveAuthData } from "../core/config.ts";
import { parseSnapshot, type MediaItem } from "../core/media.ts";
import { createApi } from "../cli/api-factory.ts";
import { authDataArg, jsonArg, proxyArg } from "../cli/common.ts";
import { command, int, str } from "../cli/command.ts";
import { cyan, dim, green, humanBytes, humanDuration, table, yellow } from "../lib/ui.ts";

export const lsCommand = command({
  meta: { name: "ls", description: "List library items or albums" },
  args: {
    all: { type: "boolean", description: "Show every item" },
    limit: { type: "string", description: "Max rows", valueHint: "n", default: "25" },
    albums: { type: "boolean", description: "List albums instead of items" },
    videos: { type: "boolean", description: "Only videos" },
    trash: { type: "boolean", description: "List trashed items" },
    filter: { type: "string", description: "Filter by filename or album title", valueHint: "text" },
    json: jsonArg,
    authData: authDataArg,
    proxy: proxyArg,
  },
  async run({ args }) {
    const auth = await resolveAuthData(str(args.authData));
    const api = createApi({ authData: auth.authData, proxy: str(args.proxy) });
    const snapshot = parseSnapshot(await api.getLibraryState());

    const limit = args.all ? Number.MAX_SAFE_INTEGER : (int(args.limit) ?? 25);
    const filter = str(args.filter)?.toLowerCase();

    if (args.albums) {
      const rows = snapshot.albums
        .filter((album) => !filter || album.title.toLowerCase().includes(filter))
        .map((album) => [album.title, String(album.itemCount), album.albumKey]);
      if (args.json) {
        process.stdout.write(`${JSON.stringify(snapshot.albums, null, 2)}\n`);
        return;
      }
      process.stdout.write(`${table(rows, ["album", "items", "key"])}\n`);
      return;
    }

    let items = snapshot.items.filter((item) => (args.trash ? item.trashTimestamp > 0 : item.trashTimestamp === 0));
    if (args.videos) items = items.filter((item) => item.type === 2);
    if (filter) items = items.filter((item) => item.fileName.toLowerCase().includes(filter));
    items.sort((a, b) => b.utcTimestamp - a.utcTimestamp);

    if (args.json) {
      process.stdout.write(`${JSON.stringify(items.slice(0, limit), null, 2)}\n`);
      return;
    }

    const albums = new Map(snapshot.albums.map((album) => [album.albumKey, album.title]));
    const rows = items.slice(0, limit).map((item) => renderRow(item, albums));
    const canonical = items.filter((item) => item.isCanonical);
    const usedQuota = items.reduce((sum, item) => sum + item.quotaChargedBytes, 0);

    process.stdout.write(`${table(rows, ["type", "name", "size", "resolution", "quota", "album"])}\n`);
    process.stdout.write(
      `\n${dim(`${items.length} items shown (${canonical.length} canonical) | quota charged ${humanBytes(usedQuota)} | sync ${snapshot.syncToken.length}b`)}\n`,
    );
  },
});

function renderRow(item: MediaItem, albums: Map<string, string>): string[] {
  const kind = item.type === 2 ? cyan("video") : green("photo");
  const resolution = item.width && item.height ? `${item.width}x${item.height}` : "-";
  const duration = item.durationMs > 0 ? ` ${humanDuration(item.durationMs)}` : "";
  const album = albums.get(item.collectionId) ?? (item.isCanonical ? dim("library") : dim("?"));
  return [
    kind,
    truncate(item.fileName, 46),
    humanBytes(item.sizeBytes),
    `${resolution}${duration}`,
    item.quotaChargedBytes === 0 ? dim("0") : yellow(humanBytes(item.quotaChargedBytes)),
    album,
  ];
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
