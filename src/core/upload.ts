import { basename, resolve } from "node:path";
import { stat, unlink } from "node:fs/promises";
import { PhotosApi } from "./api.ts";
import { sha1File, type HashedFile } from "./hash.ts";
import type { MediaItem } from "./media.ts";

export type Phase = "hashing" | "checking" | "uploading" | "finalizing" | "complete" | "skipped" | "error";

export interface ProgressEvent {
  version: 1;
  type: "progress";
  operation: "upload";
  phase: Phase;
  path: string;
  filename: string;
  bytesCompleted: number;
  bytesTotal: number;
}

export interface UploadOptions {
  files: string[];
  api: PhotosApi;
  threads?: number;
  force?: boolean;
  saver?: boolean;
  useQuota?: boolean;
  deleteFromHost?: boolean;
  onProgress?: (event: ProgressEvent) => void;
}

export interface UploadResult {
  path: string;
  fileName: string;
  mediaKey: string;
  size: number;
  skipped: boolean;
  error?: string;
}

const ALBUM_BATCH_SIZE = 500;

export async function uploadFiles(options: UploadOptions): Promise<UploadResult[]> {
  const threads = Math.max(1, options.threads ?? 1);
  const queue = [...options.files];
  const results: UploadResult[] = [];

  const worker = async (): Promise<void> => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      results.push(await uploadOne(next, options));
    }
  };

  await Promise.all(Array.from({ length: Math.min(threads, queue.length || 1) }, worker));
  return results;
}

async function uploadOne(path: string, options: UploadOptions): Promise<UploadResult> {
  const absolute = resolve(path);
  const fileName = basename(absolute);
  const emit = (phase: Phase, bytesCompleted: number, bytesTotal: number): void => {
    options.onProgress?.({
      version: 1,
      type: "progress",
      operation: "upload",
      phase,
      path: absolute,
      filename: fileName,
      bytesCompleted,
      bytesTotal,
    });
  };

  try {
    const info = await stat(absolute);
    if (!info.isFile()) throw new Error("not a regular file");
    if (info.size === 0) throw new Error("empty file");

    emit("hashing", 0, info.size);
    const hashed = await sha1File(absolute, (done, total) => emit("hashing", done, total));

    if (!options.force) {
      emit("checking", 0, info.size);
      const existing = await options.api.findRemoteMediaByHash(hashed.sha1);
      if (existing) {
        emit("skipped", info.size, info.size);
        if (options.deleteFromHost) await unlink(absolute);
        return { path: absolute, fileName, mediaKey: existing, size: info.size, skipped: true };
      }
    }

    emit("uploading", 0, info.size);
    const uploadToken = await options.api.getUploadToken(hashed.base64, info.size);
    const uploadResponse = await options.api.uploadFile(Bun.file(absolute), uploadToken);

    emit("finalizing", info.size, info.size);
    const mediaKey = await options.api.commitUpload({
      uploadResponse,
      fileName,
      sha1: hashed.sha1,
      uploadTimestamp: Math.floor(info.mtimeMs / 1000),
      quality: options.saver ? "saver" : "original",
      model: options.useQuota ? "Pixel 8" : options.saver ? "Pixel 2" : "Pixel XL",
    });

    if (options.deleteFromHost) await unlink(absolute);
    emit("complete", info.size, info.size);
    return { path: absolute, fileName, mediaKey, size: info.size, skipped: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const size = await stat(absolute).then((s) => s.size).catch(() => 0);
    emit("error", 0, size);
    return { path: absolute, fileName, mediaKey: "", size, skipped: false, error: message };
  }
}

export async function attachToAlbum(api: PhotosApi, mediaKeys: string[], albumId: string): Promise<void> {
  for (let index = 0; index < mediaKeys.length; index += ALBUM_BATCH_SIZE) {
    await api.addMediaToAlbum(albumId, mediaKeys.slice(index, index + ALBUM_BATCH_SIZE));
  }
}

export function hashedFromItem(item: MediaItem): HashedFile | null {
  if (!item.dedupKey) return null;
  const base64 = item.dedupKey.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const bytes = new Uint8Array(Buffer.from(padded, "base64"));
  if (bytes.length !== 20) return null;
  return { sha1: bytes, base64: padded, hex: Buffer.from(bytes).toString("hex"), size: item.sizeBytes };
}
