import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectMedia, expandPath } from "../../src/commands/upload.ts";

describe("expandPath", () => {
  test("expands the home shortcut", () => {
    expect(expandPath("~")).toBe(process.env.HOME!);
    expect(expandPath("~/media")).toBe(join(process.env.HOME!, "media"));
  });

  test("resolves relative paths against the working directory", () => {
    expect(expandPath("media")).toBe(join(process.cwd(), "media"));
  });

  test("keeps absolute paths", () => {
    expect(expandPath("/srv/media")).toBe("/srv/media");
  });
});

describe("collectMedia", () => {
  test("finds media files and honours recursion", async () => {
    const root = await mkdtemp(join(tmpdir(), "gphoto-media-"));
    try {
      await writeFile(join(root, "a.jpg"), "x");
      await writeFile(join(root, "notes.txt"), "x");
      await mkdir(join(root, "nested"));
      await writeFile(join(root, "nested", "b.mp4"), "x");

      const flat = await collectMedia(root, false);
      expect(flat.map((file) => file.split("/").at(-1))).toEqual(["a.jpg"]);

      const deep = await collectMedia(root, true);
      expect(deep.map((file) => file.split("/").at(-1)).sort()).toEqual(["a.jpg", "b.mp4"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("accepts a single media file", async () => {
    const root = await mkdtemp(join(tmpdir(), "gphoto-media-"));
    try {
      const file = join(root, "single.png");
      await writeFile(file, "x");
      expect(await collectMedia(file, false)).toEqual([file]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
