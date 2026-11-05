import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "citty";
import { resetApiFactory, setApiFactory } from "../../src/cli/api-factory.ts";
import type { PhotosApi } from "../../src/core/api.ts";
import { FakePhotosApi } from "../fixtures/fake-api.ts";
import { SAMPLE_ALBUMS, SAMPLE_ITEMS, snapshotNode } from "../fixtures/library.ts";

let api: FakePhotosApi;
let stdout: string[];
let stderr: string[];
let spies: { mockRestore: () => void }[] = [];
let workdir: string;

function capture(): void {
  stdout = [];
  stderr = [];
  spies = [
    spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      stdout.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
      return true;
    }),
    spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      stderr.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
      return true;
    }),
    spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(stderr.join("").trim() || `process.exit(${code ?? 0})`);
    }) as never),
  ];
}

beforeEach(async () => {
  api = new FakePhotosApi({ state: snapshotNode({ items: SAMPLE_ITEMS, albums: SAMPLE_ALBUMS }) });
  setApiFactory(() => api as unknown as PhotosApi);
  workdir = await mkdtemp(join(tmpdir(), "gphoto-cmd-"));
  capture();
});

afterEach(async () => {
  for (const spy of spies) spy.mockRestore();
  resetApiFactory();
  await rm(workdir, { recursive: true, force: true });
});

const out = (): string => stdout.join("");
const err = (): string => stderr.join("");

async function run(command: Parameters<typeof runCommand>[0], argv: string[]): Promise<void> {
  await runCommand(command, { rawArgs: argv });
}

describe("upload command", () => {
  test("uploads a directory recursively and reports a table", async () => {
    const media = await mkdtemp(join(workdir, "media-"));
    await writeFile(join(media, "one.jpg"), "hello");
    await writeFile(join(media, "notes.txt"), "skip me");
    const { uploadCommand } = await import("../../src/commands/upload.ts");
    await run(uploadCommand, [media, "-r"]);
    expect(out()).toContain("uploaded");
    expect(out()).toContain("1");
    expect(api.callsTo("commitUpload")).toHaveLength(1);
  });

  test("creates an album when --album is given", async () => {
    const media = await mkdtemp(join(workdir, "media-"));
    await writeFile(join(media, "one.jpg"), "hello");
    const { uploadCommand } = await import("../../src/commands/upload.ts");
    await run(uploadCommand, [media, "--album", "Aho Girl"]);
    expect(api.callsTo("createAlbum")[0]!.args[0]).toBe("Aho Girl");
    expect(err()).toContain('created "Aho Girl"');
  });

  test("appends to an existing album with --album-id", async () => {
    const media = await mkdtemp(join(workdir, "media-"));
    await writeFile(join(media, "one.jpg"), "hello");
    const { uploadCommand } = await import("../../src/commands/upload.ts");
    await run(uploadCommand, [media, "--album-id", "ALBUM_KEY_1"]);
    expect(api.callsTo("addMediaToAlbum")[0]!.args[0]).toBe("ALBUM_KEY_1");
  });

  test("creates one album per directory with --album AUTO", async () => {
    const first = await mkdtemp(join(workdir, "season-one-"));
    const second = await mkdtemp(join(workdir, "season-two-"));
    await writeFile(join(first, "a.jpg"), "aaa");
    await writeFile(join(second, "b.jpg"), "bbb");
    const { uploadCommand } = await import("../../src/commands/upload.ts");
    await run(uploadCommand, [first, second, "--album", "AUTO"]);
    const names = api.callsTo("createAlbum").map((call) => call.args[0]);
    expect(names).toHaveLength(2);
    expect(names.every((name) => String(name).startsWith("season-"))).toBe(true);
  });

  test("emits JSON results and NDJSON progress", async () => {
    const media = await mkdtemp(join(workdir, "media-"));
    await writeFile(join(media, "one.jpg"), "hello");
    const { uploadCommand } = await import("../../src/commands/upload.ts");
    await run(uploadCommand, [media, "--json"]);
    const parsed = JSON.parse(out());
    expect(parsed).toHaveLength(1);
    expect(parsed[0].fileName).toBe("one.jpg");
    expect(err()).toContain('"type":"progress"');
  });

  test("applies the filter and its flags", async () => {
    const media = await mkdtemp(join(workdir, "media-"));
    await writeFile(join(media, "keep.jpg"), "keep");
    await writeFile(join(media, "drop.jpg"), "drop");
    const { uploadCommand } = await import("../../src/commands/upload.ts");
    await run(uploadCommand, [media, "--filter", "keep", "--json"]);
    const parsed = JSON.parse(out());
    expect(parsed).toHaveLength(1);
    expect(parsed[0].fileName).toBe("keep.jpg");
  });

  test("supports regex and inverted filters", async () => {
    const media = await mkdtemp(join(workdir, "media-"));
    await writeFile(join(media, "keep.jpg"), "keep");
    await writeFile(join(media, "drop.jpg"), "drop");
    const { uploadCommand } = await import("../../src/commands/upload.ts");
    await run(uploadCommand, [media, "--filter", "keep\\.jpg$", "--regex", "--json"]);
    expect(JSON.parse(out())).toHaveLength(1);
    stdout = [];
    await run(uploadCommand, [media, "--filter", "keep", "--exclude", "--json"]);
    expect(JSON.parse(out())[0].fileName).toBe("drop.jpg");
  });

  test("fails when nothing matches the filter", async () => {
    const media = await mkdtemp(join(workdir, "media-"));
    await writeFile(join(media, "keep.jpg"), "keep");
    const { uploadCommand } = await import("../../src/commands/upload.ts");
    await expect(run(uploadCommand, [media, "--filter", "zzz"])).rejects.toThrow("no media files matched");
  });

  test("fails on a missing path", async () => {
    const { uploadCommand } = await import("../../src/commands/upload.ts");
    await expect(run(uploadCommand, [join(workdir, "missing")])).rejects.toThrow("path not found");
  });

  test("deletes local files with --delete-from-host", async () => {
    const media = await mkdtemp(join(workdir, "media-"));
    const file = join(media, "one.jpg");
    await writeFile(file, "hello");
    const { uploadCommand } = await import("../../src/commands/upload.ts");
    await run(uploadCommand, [media, "--delete-from-host", "--json"]);
    expect(await readdir(media)).toEqual([]);
  });

  test("exits non zero when a file fails", async () => {
    const media = await mkdtemp(join(workdir, "media-"));
    const broken = join(media, "broken.jpg");
    await writeFile(broken, "");
    const { uploadCommand } = await import("../../src/commands/upload.ts");
    await expect(run(uploadCommand, [media])).rejects.toThrow();
    expect(out()).toContain("empty file");
  });

  test("passes the thread count and timeout through", async () => {
    const media = await mkdtemp(join(workdir, "media-"));
    await writeFile(join(media, "a.jpg"), "a");
    await writeFile(join(media, "b.jpg"), "b");
    const { uploadCommand } = await import("../../src/commands/upload.ts");
    await run(uploadCommand, [media, "--threads", "2", "--timeout", "30", "--json"]);
    expect(JSON.parse(out())).toHaveLength(2);
  });
});

describe("download command", () => {
  test("writes the file bytes to the output directory", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response("file-bytes", { status: 200, headers: { "content-length": "10" } })) as unknown as typeof fetch;
    try {
      const { downloadCommand } = await import("../../src/commands/download.ts");
      const target = join(workdir, "out");
      await run(downloadCommand, ["IMG_0001.jpg", "--out", target]);
      const written = await Bun.file(join(target, "IMG_0001.jpg")).text();
      expect(written).toBe("file-bytes");
      expect(err()).toContain("saved");
    } finally {
      globalThis.fetch = original;
    }
  });

  test("downloads every member of an album", async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("x", { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const { downloadCommand } = await import("../../src/commands/download.ts");
      await run(downloadCommand, ["Aho Girl", "--out", join(workdir, "album")]);
      expect(calls).toBe(1);
      expect(await readdir(join(workdir, "album"))).toEqual(["clip.mp4"]);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("fails for an unknown target", async () => {
    const { downloadCommand } = await import("../../src/commands/download.ts");
    await expect(run(downloadCommand, ["missing.jpg", "--out", join(workdir, "x")])).rejects.toThrow("not found: missing.jpg");
  });
});

describe("logout command", () => {
  test("reports when there is nothing to remove", async () => {
    process.env.GP_CONFIG_DIR = join(workdir, "cfg");
    try {
      const { logoutCommand } = await import("../../src/commands/whoami.ts");
      await run(logoutCommand, []);
      expect(out()).toContain("no stored profile to remove");
    } finally {
      delete process.env.GP_CONFIG_DIR;
    }
  });

  test("removes the active profile", async () => {
    process.env.GP_CONFIG_DIR = join(workdir, "cfg");
    try {
      const { saveProfile } = await import("../../src/core/config.ts");
      await saveProfile("test@example.com", "androidId=a&Email=t%40e.st&Token=t&service=s");
      const { logoutCommand } = await import("../../src/commands/whoami.ts");
      await run(logoutCommand, []);
      expect(out()).toContain("removed test@example.com");
      const { loadConfig } = await import("../../src/core/config.ts");
      expect((await loadConfig()).profiles).toEqual({});
    } finally {
      delete process.env.GP_CONFIG_DIR;
    }
  });
});
