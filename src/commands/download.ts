import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { resolveAuthData } from "../core/config.ts";
import { parseSnapshot } from "../core/media.ts";
import { createApi } from "../cli/api-factory.ts";
import { authDataArg, proxyArg, targetArg } from "../cli/common.ts";
import { command, str } from "../cli/command.ts";
import { dim, fail, green, humanBytes, progressBar } from "../lib/ui.ts";

export const downloadCommand = command({
  meta: { name: "download", description: "Download original files" },
  args: {
    target: { ...targetArg, required: true },
    out: { type: "string", description: "Destination directory", valueHint: "dir", default: "." },
    proxy: proxyArg,
    authData: authDataArg,
  },
  async run({ args }) {
    const target = str(args.target);
    if (!target) fail("usage: gphoto download <fileName | mediaKey | albumName> [--out dir]");

    const auth = await resolveAuthData(str(args.authData));
    const api = createApi({ authData: auth.authData, proxy: str(args.proxy) });
    const snapshot = parseSnapshot(await api.getLibraryState());

    const outDir = str(args.out) ?? ".";
    await mkdir(outDir, { recursive: true });

    const album = snapshot.albums.find((entry) => entry.title.toLowerCase() === target.toLowerCase());
    const items = album
      ? snapshot.items.filter((item) => item.collectionId === album.albumKey).sort((a, b) => a.fileName.localeCompare(b.fileName))
      : snapshot.items.filter((item) => item.mediaKey === target || item.fileName === target);

    if (items.length === 0) fail(`not found: ${target}`);

    for (const item of items) {
      const urls = await api.getDownloadUrls(item.mediaKey);
      const url = urls.original ?? urls.all.at(-1);
      if (!url) {
        process.stderr.write(`${dim("skip")} ${item.fileName}: no download URL\n`);
        continue;
      }
      await downloadTo(url, join(outDir, item.fileName), str(args.proxy));
    }
  },
});

async function downloadTo(url: string, destination: string, proxy?: string): Promise<void> {
  const existing = await stat(destination).catch(() => null);
  const response = await fetch(url, { proxy } as RequestInit);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${destination}`);
  const total = Number(response.headers.get("content-length") ?? 0);
  if (existing && total > 0 && existing.size === total) {
    process.stderr.write(`${dim("exists")} ${destination}\n`);
    return;
  }
  await mkdir(dirname(destination), { recursive: true });
  const sink = createWriteStream(destination);
  const finished = new Promise<void>((resolve, reject) => {
    sink.on("finish", () => resolve());
    sink.on("error", (error) => reject(error));
  });
  let done = 0;
  const reader = response.body!.getReader();
  for (;;) {
    const { value, done: ended } = await reader.read();
    if (ended) break;
    sink.write(value);
    done += value.length;
    if (process.stderr.isTTY && total > 0) {
      process.stderr.write(`\r\x1b[2K${progressBar(done, total)} ${dim(destination.slice(-40))}`);
    }
  }
  sink.end();
  await finished;
  if (process.stderr.isTTY) process.stderr.write("\r\x1b[2K");
  process.stderr.write(`${green("saved")} ${destination} ${dim(humanBytes(done))}\n`);
}
