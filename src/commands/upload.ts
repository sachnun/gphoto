import { readdir, stat } from "node:fs/promises";
import { extname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { resolveAuthData } from "../core/config.ts";
import { attachToAlbum, uploadFiles, type ProgressEvent, type UploadResult } from "../core/upload.ts";
import { createApi } from "../cli/api-factory.ts";
import { authDataArg, proxyArg } from "../cli/common.ts";
import { command, int, str } from "../cli/command.ts";
import { UploadProgress } from "../lib/progress.ts";
import { bold, dim, fail, green, humanBytes, progressLine, red, table, yellow } from "../lib/ui.ts";

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif", ".bmp", ".tif", ".tiff", ".avif", ".dng", ".cr2", ".cr3", ".nef", ".arw", ".raf", ".orf", ".rw2", ".pef", ".srw", ".sr2", ".3fr", ".erf", ".k25", ".kdc", ".mrw", ".x3f", ".raw"]);
const VIDEO_EXT = new Set([".mp4", ".mov", ".mkv", ".avi", ".wmv", ".flv", ".webm", ".m4v", ".mpg", ".mpeg", ".3gp", ".mts", ".m2ts", ".ts", ".ogv"]);

export function expandPath(input: string): string {
  if (input === "~") return homedir();
  if (input.startsWith("~/")) return join(homedir(), input.slice(2));
  return isAbsolute(input) ? input : resolve(process.cwd(), input);
}

function isMedia(file: string): boolean {
  const extension = extname(file).toLowerCase();
  return IMAGE_EXT.has(extension) || VIDEO_EXT.has(extension);
}

export async function collectMedia(target: string, recursive: boolean): Promise<string[]> {
  const info = await stat(target).catch(() => null);
  if (!info) fail(`path not found: ${target}`);
  if (info.isFile()) {
    if (!isMedia(target)) fail(`not a supported media file: ${target}`);
    return [target];
  }
  const entries = await readdir(target, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(target, entry.name);
    if (entry.isDirectory()) {
      if (recursive) out.push(...(await collectMedia(full, recursive)));
      continue;
    }
    if (entry.isFile() && isMedia(full)) out.push(full);
  }
  return out;
}

export const uploadCommand = command(
  {
    meta: { name: "upload", description: "Upload files or directories" },
    args: {
      path: { type: "positional", description: "File or directory", required: true },
      album: { type: "string", alias: "a", description: "Create an album with this name (\"AUTO\" = per directory)", valueHint: "name" },
      albumId: { type: "string", description: "Add uploads to an existing album", valueHint: "key" },
      recursive: { type: "boolean", alias: "r", description: "Recurse into subdirectories" },
      force: { type: "boolean", alias: "f", description: "Upload even if the file already exists" },
      saver: { type: "boolean", description: "Upload in storage-saver quality" },
      useQuota: { type: "boolean", description: "Charge the upload to your quota (Pixel 8 profile)" },
      deleteFromHost: { type: "boolean", description: "Delete local files after a successful upload" },
      threads: { type: "string", description: "Parallel uploads", valueHint: "n", default: "1" },
      filter: { type: "string", description: "Only upload paths matching this text", valueHint: "text" },
      exclude: { type: "boolean", description: "Invert --filter" },
      regex: { type: "boolean", description: "Treat --filter as a regular expression" },
      ignoreCase: { type: "boolean", description: "Case-insensitive --filter" },
      json: { type: "boolean", alias: "j", description: "Emit NDJSON progress on stderr, JSON result on stdout" },
      proxy: proxyArg,
      timeout: { type: "string", description: "Request timeout in seconds", valueHint: "seconds", default: "120" },
      authData: authDataArg,
    },
    async run({ args }) {
      const targets = args._.map(expandPath);
      if (targets.length === 0) fail("nothing to upload: pass a file or directory");

      const filter = str(args.filter);
      const useRegex = args.regex === true;
      const ignoreCase = args.ignoreCase === true;
      const exclude = args.exclude === true;

      let files: string[] = [];
      for (const target of targets) files.push(...(await collectMedia(target, args.recursive === true)));
      files = [...new Set(files)];

      if (filter) {
        const pattern = useRegex ? new RegExp(filter, ignoreCase ? "i" : "") : null;
        files = files.filter((file) => {
          const matches = pattern
            ? pattern.test(file)
            : ignoreCase
              ? file.toLowerCase().includes(filter.toLowerCase())
              : file.includes(filter);
          return exclude ? !matches : matches;
        });
      }

      if (files.length === 0) fail("no media files matched");

      const auth = await resolveAuthData(str(args.authData));
      const api = createApi({
        authData: auth.authData,
        proxy: str(args.proxy),
        timeoutMs: (int(args.timeout) ?? 120) * 1000,
      });

      const threads = int(args.threads) ?? 1;
      const jsonMode = args.json === true;
      const showProgress = !jsonMode && process.stderr.isTTY;

      process.stderr.write(`${dim("account")} ${auth.email}  ${dim("files")} ${files.length}  ${dim("threads")} ${threads}\n`);

      const totalBytes = (
        await Promise.all(files.map((file) => stat(file).then((info) => info.size).catch(() => 0)))
      ).reduce((sum, size) => sum + size, 0);
      const tracker = new UploadProgress(totalBytes);
      const renderIntervalMs = 100;
      let lastRender = 0;
      const onProgress = (event: ProgressEvent): void => {
        const snapshot = tracker.update(event);
        const terminal = event.phase === "complete" || event.phase === "skipped" || event.phase === "error";
        const now = Date.now();
        if (jsonMode) {
          if (!terminal && now - lastRender < renderIntervalMs) return;
          lastRender = now;
          process.stderr.write(`${JSON.stringify({ ...event, bytesPerSecond: Math.round(snapshot.bytesPerSecond) })}\n`);
          return;
        }
        if (!showProgress) return;
        if (!terminal && now - lastRender < renderIntervalMs) return;
        lastRender = now;
        const columns = process.stderr.columns ?? 100;
        const budget = Math.max(0, columns - 62);
        const name = budget > 8 ? event.filename.slice(0, budget) : "";
        const label = `${snapshot.completed}/${files.length} ${event.phase}${name ? ` ${name}` : ""}`;
        process.stderr.write(
          `\r\x1b[2K${progressLine({ done: snapshot.done, total: snapshot.total, bytesPerSecond: snapshot.bytesPerSecond, label })}`,
        );
        if (event.phase === "error") process.stderr.write("\n");
      };

      const started = Date.now();
      const results = await uploadFiles({
        api,
        files,
        threads,
        force: args.force === true,
        saver: args.saver === true,
        useQuota: args.useQuota === true,
        deleteFromHost: args.deleteFromHost === true,
        onProgress,
      });
      if (showProgress) process.stderr.write("\r\x1b[2K");

      const albumId = str(args.albumId);
      const albumName = str(args.album);
      const uploaded = results.filter((result) => !result.error && result.mediaKey);

      if (uploaded.length > 0) {
        if (albumId) {
          await attachToAlbum(api, uploaded.map((result) => result.mediaKey), albumId);
          process.stderr.write(`${green("album")} added ${uploaded.length} item(s) to ${albumId}\n`);
        } else if (albumName && albumName !== "AUTO") {
          const albumKey = await api.createAlbum(albumName, uploaded.map((result) => result.mediaKey));
          process.stderr.write(`${green("album")} created "${albumName}" ${dim(albumKey)}\n`);
        } else if (albumName === "AUTO") {
          const groups = new Map<string, UploadResult[]>();
          for (const result of uploaded) {
            const parent = resolve(result.path, "..");
            groups.set(parent, [...(groups.get(parent) ?? []), result]);
          }
          for (const [parent, group] of groups) {
            const name = parent.split("/").filter(Boolean).at(-1) ?? "album";
            const albumKey = await api.createAlbum(name, group.map((result) => result.mediaKey));
            process.stderr.write(`${green("album")} created "${name}" ${dim(albumKey)}\n`);
          }
        }
      }

      if (jsonMode) {
        process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
        return;
      }

      const failed = results.filter((result) => result.error);
      const skipped = results.filter((result) => result.skipped);
      const bytes = uploaded.reduce((sum, result) => sum + result.size, 0);
      const elapsedMs = Date.now() - started;
      const seconds = (elapsedMs / 1000).toFixed(1);
      const averageSpeed = elapsedMs > 0 ? bytes / (elapsedMs / 1000) : 0;

      process.stdout.write(
        `\n${table(
          [
            [green("uploaded"), String(uploaded.length - skipped.length)],
            [yellow("skipped"), String(skipped.length)],
            [failed.length ? red("failed") : dim("failed"), String(failed.length)],
            ["bytes", humanBytes(bytes)],
            ["elapsed", `${seconds}s`],
            ["speed", `${humanBytes(averageSpeed)}/s`],
          ],
          ["result", "count"],
        )}\n`,
      );

      if (failed.length > 0) {
        process.stdout.write(`\n${bold("failures")}\n`);
        for (const result of failed) {
          process.stdout.write(`  ${red("x")} ${result.fileName}: ${result.error}\n`);
        }
        process.exit(1);
      }
    },
  },
  { notes: `${bold("Albums")}  --album AUTO creates one album per source directory.`, variadic: "<path...>" },
);
