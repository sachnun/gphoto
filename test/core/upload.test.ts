import { describe, expect, test } from "bun:test";
import { attachToAlbum, hashedFromItem, uploadFiles } from "../../src/core/upload.ts";
import type { PhotosApi } from "../../src/core/api.ts";
import type { MediaItem } from "../../src/core/media.ts";
import { FakePhotosApi } from "../fixtures/fake-api.ts";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function withFiles(names: string[], body = "hello"): Promise<{ dir: string; files: string[]; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "gphoto-upload-"));
  const files: string[] = [];
  for (const name of names) {
    const file = join(dir, name);
    await writeFile(file, body);
    files.push(file);
  }
  return { dir, files, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

describe("uploadFiles", () => {
  test("uploads a new file and reports every phase", async () => {
    const { files, cleanup } = await withFiles(["a.jpg"]);
    try {
      const api = new FakePhotosApi();
      const phases: string[] = [];
      const results = await uploadFiles({
        api: api as unknown as PhotosApi,
        files,
        onProgress: (event) => phases.push(event.phase),
      });

      expect(results).toHaveLength(1);
      expect(results[0]!.mediaKey).toBe("KEY_a.jpg");
      expect(results[0]!.skipped).toBe(false);
      expect(results[0]!.error).toBeUndefined();
      expect(phases).toEqual(["hashing", "hashing", "checking", "uploading", "uploading", "uploading", "finalizing", "complete"]);
      expect(api.callsTo("commitUpload")[0]!.args[0]).toMatchObject({ fileName: "a.jpg", quality: "original", model: "Pixel XL" });
    } finally {
      await cleanup();
    }
  });

  test("reports upload byte progress", async () => {
    const { files, cleanup } = await withFiles(["a.jpg"], "hello world");
    try {
      const events: { phase: string; bytesCompleted: number; bytesTotal: number }[] = [];
      await uploadFiles({
        api: new FakePhotosApi() as unknown as PhotosApi,
        files,
        onProgress: (event) => events.push(event),
      });
      const uploading = events.filter((event) => event.phase === "uploading");
      expect(uploading.length).toBeGreaterThan(1);
      expect(uploading.at(-1)).toMatchObject({ bytesCompleted: 11, bytesTotal: 11 });
      expect(uploading.map((event) => event.bytesCompleted)).toEqual([...uploading.map((event) => event.bytesCompleted)].sort((a, b) => a - b));
    } finally {
      await cleanup();
    }
  });

  test("skips a file that already exists remotely", async () => {
    const { files, cleanup } = await withFiles(["dup.jpg"]);
    try {
      const hex = "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d";
      const api = new FakePhotosApi({ existingHashes: [hex] });
      const results = await uploadFiles({ api: api as unknown as PhotosApi, files });
      expect(results[0]!.skipped).toBe(true);
      expect(results[0]!.mediaKey).toBe("EXISTING_KEY");
      expect(api.callsTo("commitUpload")).toHaveLength(0);
    } finally {
      await cleanup();
    }
  });

  test("uploads anyway when force is set", async () => {
    const { files, cleanup } = await withFiles(["dup.jpg"]);
    try {
      const hex = "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d";
      const api = new FakePhotosApi({ existingHashes: [hex] });
      const results = await uploadFiles({ api: api as unknown as PhotosApi, files, force: true });
      expect(results[0]!.skipped).toBe(false);
      expect(api.callsTo("commitUpload")).toHaveLength(1);
    } finally {
      await cleanup();
    }
  });

  test("uses the saver and quota profiles", async () => {
    const { files, cleanup } = await withFiles(["a.jpg"]);
    try {
      const saverApi = new FakePhotosApi();
      await uploadFiles({ api: saverApi as unknown as PhotosApi, files, saver: true });
      expect(saverApi.callsTo("commitUpload")[0]!.args[0]).toMatchObject({ quality: "saver", model: "Pixel 2" });

      const quotaApi = new FakePhotosApi();
      await uploadFiles({ api: quotaApi as unknown as PhotosApi, files, useQuota: true });
      expect(quotaApi.callsTo("commitUpload")[0]!.args[0]).toMatchObject({ quality: "original", model: "Pixel 8" });
    } finally {
      await cleanup();
    }
  });

  test("captures per-file failures without aborting the batch", async () => {
    const { dir, files, cleanup } = await withFiles(["ok.jpg"]);
    try {
      const missing = join(dir, "missing.jpg");
      const api = new FakePhotosApi();
      const results = await uploadFiles({ api: api as unknown as PhotosApi, files: [missing, ...files] });
      expect(results).toHaveLength(2);
      expect(results.find((result) => result.fileName === "missing.jpg")!.error).toContain("ENOENT");
      expect(results.find((result) => result.fileName === "ok.jpg")!.error).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  test("rejects empty files", async () => {
    const { files, cleanup } = await withFiles(["empty.jpg"], "");
    try {
      const results = await uploadFiles({ api: new FakePhotosApi() as unknown as PhotosApi, files });
      expect(results[0]!.error).toBe("empty file");
    } finally {
      await cleanup();
    }
  });

  test("removes local files after upload when asked", async () => {
    const { files, cleanup } = await withFiles(["gone.jpg"]);
    try {
      const api = new FakePhotosApi();
      await uploadFiles({ api: api as unknown as PhotosApi, files, deleteFromHost: true });
      await expect(Bun.file(files[0]!).exists()).resolves.toBe(false);
    } finally {
      await cleanup();
    }
  });

  test("runs the queue with the requested thread count", async () => {
    const { files, cleanup } = await withFiles(["a.jpg", "b.jpg", "c.jpg"]);
    try {
      const api = new FakePhotosApi();
      const results = await uploadFiles({ api: api as unknown as PhotosApi, files, threads: 3 });
      expect(results.map((result) => result.fileName).sort()).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
      expect(api.callsTo("commitUpload")).toHaveLength(3);
    } finally {
      await cleanup();
    }
  });

  test("returns nothing for an empty file list", async () => {
    const api = new FakePhotosApi();
    expect(await uploadFiles({ api: api as unknown as PhotosApi, files: [] })).toEqual([]);
  });
});

describe("attachToAlbum", () => {
  test("splits large batches", async () => {
    const api = new FakePhotosApi();
    const keys = Array.from({ length: 1201 }, (_, index) => `K${index}`);
    await attachToAlbum(api as unknown as PhotosApi, keys, "ALBUM");
    const calls = api.callsTo("addMediaToAlbum");
    expect(calls.map((call) => (call.args[1] as string[]).length)).toEqual([500, 500, 201]);
    expect(calls.every((call) => call.args[0] === "ALBUM")).toBe(true);
  });

  test("does nothing for an empty list", async () => {
    const api = new FakePhotosApi();
    await attachToAlbum(api as unknown as PhotosApi, [], "ALBUM");
    expect(api.callsTo("addMediaToAlbum")).toHaveLength(0);
  });
});

describe("hashedFromItem", () => {
  const baseItem: MediaItem = {
    mediaKey: "K",
    fileName: "f.jpg",
    dedupKey: "",
    isCanonical: true,
    type: 0,
    caption: "",
    collectionId: "",
    sizeBytes: 10,
    quotaChargedBytes: 0,
    contentVersion: 1,
    utcTimestamp: 0,
    serverCreationTimestamp: 0,
    trashTimestamp: 0,
    isArchived: false,
    isFavorite: false,
    isLocked: false,
    isOriginalQuality: true,
    width: 0,
    height: 0,
    durationMs: 0,
    remoteUrl: "",
    renditions: [],
  };

  test("returns null for an empty dedup key", () => {
    expect(hashedFromItem(baseItem)).toBeNull();
  });

  test("returns null when the decoded key is not 20 bytes", () => {
    expect(hashedFromItem({ ...baseItem, dedupKey: "c2hvcnQ" })).toBeNull();
  });

  test("decodes a url safe dedup key", () => {
    const urlSafe = Buffer.from("0123456789abcdefghij").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const hashed = hashedFromItem({ ...baseItem, dedupKey: urlSafe })!;
    expect(hashed.sha1).toHaveLength(20);
    expect(hashed.hex).toBe(Buffer.from("0123456789abcdefghij").toString("hex"));
    expect(hashed.size).toBe(10);
  });
});
