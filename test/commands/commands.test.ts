import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { runCommand } from "citty";
import type { CommandDef } from "citty";
import { resetApiFactory, setApiFactory } from "../../src/cli/api-factory.ts";
import type { PhotosApi } from "../../src/core/api.ts";
import { FakePhotosApi } from "../fixtures/fake-api.ts";
import { SAMPLE_ALBUMS, SAMPLE_ITEMS, snapshotNode } from "../fixtures/library.ts";

let api: FakePhotosApi;
let stdout: string[];
let stderr: string[];
let spies: { mockRestore: () => void }[] = [];

function captureOutput(): void {
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
      const message = stderr.join("").trim();
      throw new Error(message || `process.exit(${code ?? 0})`);
    }) as never),
  ];
}

async function run(command: CommandDef, argv: string[]): Promise<void> {
  await runCommand(command, { rawArgs: argv });
}

beforeEach(() => {
  api = new FakePhotosApi({ state: snapshotNode({ items: SAMPLE_ITEMS, albums: SAMPLE_ALBUMS }) });
  setApiFactory(() => api as unknown as PhotosApi);
  captureOutput();
});

afterEach(() => {
  for (const spy of spies) spy.mockRestore();
  resetApiFactory();
});

const out = (): string => stdout.join("");
const err = (): string => stderr.join("");

describe("ls command", () => {
  test("lists items newest first and hides trashed entries", async () => {
    const { lsCommand } = await import("../../src/commands/ls.ts");
    await run(lsCommand, []);
    const text = out();
    expect(text).toContain("clip.mp4");
    expect(text).toContain("IMG_0001.jpg");
    expect(text).not.toContain("old.png");
    expect(text).toContain("3 items shown");
    expect(text).toContain("2 canonical");
  });

  test("lists only videos", async () => {
    const { lsCommand } = await import("../../src/commands/ls.ts");
    await run(lsCommand, ["--videos"]);
    expect(out()).toContain("clip.mp4");
    expect(out()).not.toContain("IMG_0001.jpg");
  });

  test("lists trashed items", async () => {
    const { lsCommand } = await import("../../src/commands/ls.ts");
    await run(lsCommand, ["--trash"]);
    expect(out()).toContain("old.png");
    expect(out()).not.toContain("IMG_0001.jpg");
  });

  test("lists albums", async () => {
    const { lsCommand } = await import("../../src/commands/ls.ts");
    await run(lsCommand, ["--albums"]);
    expect(out()).toContain("Aho Girl");
    expect(out()).toContain("ALBUM_KEY_1");
  });

  test("filters by name", async () => {
    const { lsCommand } = await import("../../src/commands/ls.ts");
    await run(lsCommand, ["--filter", "img_"]);
    expect(out()).toContain("IMG_0001.jpg");
    expect(out()).not.toContain("clip.mp4");
  });

  test("emits JSON when asked", async () => {
    const { lsCommand } = await import("../../src/commands/ls.ts");
    await run(lsCommand, ["--json", "--limit", "1"]);
    const parsed = JSON.parse(out());
    expect(parsed).toHaveLength(1);
    expect(parsed[0].fileName).toBe("clip.mp4");
  });

  test("honours the limit", async () => {
    const { lsCommand } = await import("../../src/commands/ls.ts");
    await run(lsCommand, ["--limit", "1"]);
    expect(out()).toContain("clip.mp4");
    expect(out()).not.toContain("IMG_0001.jpg");
  });
});

describe("album command", () => {
  test("defaults to listing albums", async () => {
    const { albumCommand } = await import("../../src/commands/album.ts");
    await run(albumCommand, []);
    expect(out()).toContain("Aho Girl");
  });

  test("renames an album", async () => {
    const { albumCommand } = await import("../../src/commands/album.ts");
    await run(albumCommand, ["rename", "ALBUM_KEY_1", "New", "Title"]);
    expect(api.callsTo("renameAlbum")[0]!.args).toEqual(["ALBUM_KEY_1", "New Title"]);
    expect(out()).toContain("renamed");
  });

  test("adds library files to an album", async () => {
    const { albumCommand } = await import("../../src/commands/album.ts");
    const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "gphoto-album-"));
    try {
      const file = join(dir, "IMG_0001.jpg");
      await writeFile(file, "x");
      await run(albumCommand, ["add", "ALBUM_KEY_2", file]);
      expect(api.callsTo("addMediaToAlbum")[0]!.args).toEqual(["ALBUM_KEY_2", ["AF1QipPHOTO000000000000000000000000000000001"]]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("empties an album by trashing album-only entries", async () => {
    const { albumCommand } = await import("../../src/commands/album.ts");
    await run(albumCommand, ["rm", "ALBUM_KEY_1", "--yes"]);
    expect(api.callsTo("moveToTrash")).toHaveLength(1);
    expect(api.callsTo("moveToTrash")[0]!.args[0]).toEqual(["dedup-video-1"]);
    expect(out()).toContain("emptied");
  });

  test("requires --yes before emptying an album", async () => {
    const { albumCommand } = await import("../../src/commands/album.ts");
    await expect(run(albumCommand, ["rm", "ALBUM_KEY_1"])).rejects.toThrow("refusing to delete without --yes");
    expect(api.callsTo("moveToTrash")).toHaveLength(0);
  });

  test("reports an unknown album key", async () => {
    const { albumCommand } = await import("../../src/commands/album.ts");
    await expect(run(albumCommand, ["rm", "MISSING", "--yes"])).rejects.toThrow("album not found: MISSING");
  });
});

describe("trash command", () => {
  test("lists trashed items", async () => {
    const { trashCommand } = await import("../../src/commands/trash.ts");
    await run(trashCommand, []);
    expect(out()).toContain("old.png");
  });

  test("reports an empty trash", async () => {
    api = new FakePhotosApi({ state: snapshotNode({ items: [], albums: [] }) });
    setApiFactory(() => api as unknown as PhotosApi);
    const { trashCommand } = await import("../../src/commands/trash.ts");
    await run(trashCommand, ["ls"]);
    expect(out()).toContain("trash is empty");
  });

  test("previews without --yes", async () => {
    const { trashCommand } = await import("../../src/commands/trash.ts");
    await expect(run(trashCommand, ["add", "clip.mp4"])).rejects.toThrow("re-run with --yes to confirm");
    expect(out()).toContain("would trash 2 item(s)");
    expect(api.callsTo("moveToTrash")).toHaveLength(0);
  });

  test("trashes every entry sharing a dedup key", async () => {
    const { trashCommand } = await import("../../src/commands/trash.ts");
    await run(trashCommand, ["add", "clip.mp4", "--yes"]);
    const calls = api.callsTo("moveToTrash");
    expect(calls.map((call) => call.args[0])).toEqual([["dedup-video-1"], ["dedup-video-1"]]);
    expect(out()).toContain("trashed 2 item(s)");
  });

  test("resolves an album title to its members", async () => {
    const { trashCommand } = await import("../../src/commands/trash.ts");
    await run(trashCommand, ["add", "Aho Girl", "--yes"]);
    expect(api.callsTo("moveToTrash")[0]!.args[0]).toEqual(["dedup-video-1"]);
  });

  test("restores items", async () => {
    const { trashCommand } = await import("../../src/commands/trash.ts");
    await run(trashCommand, ["restore", "old.png"]);
    expect(api.callsTo("restoreFromTrash")[0]!.args[0]).toEqual(["dedup-trash-1"]);
  });

  test("deletes only trashed items permanently", async () => {
    const { trashCommand } = await import("../../src/commands/trash.ts");
    await run(trashCommand, ["rm", "old.png", "--yes"]);
    expect(api.callsTo("deletePermanently")[0]!.args[0]).toEqual(["dedup-trash-1"]);
  });

  test("refuses to delete a live item permanently", async () => {
    const { trashCommand } = await import("../../src/commands/trash.ts");
    await expect(run(trashCommand, ["rm", "clip.mp4", "--yes"])).rejects.toThrow("no trashed items matched");
  });

  test("fails when nothing matches", async () => {
    const { trashCommand } = await import("../../src/commands/trash.ts");
    await expect(run(trashCommand, ["add", "nope", "--yes"])).rejects.toThrow("no matching items");
  });
});

describe("watch command", () => {
  test("prints a direct URL for a single file", async () => {
    const { watchCommand } = await import("../../src/commands/watch.ts");
    await run(watchCommand, ["clip.mp4"]);
    expect(out()).toContain("https://cdn.test/AF1QipVIDEO000000000000000000000000000000002");
    expect(out()).toContain("1920x1080");
  });

  test("lists every album member", async () => {
    const { watchCommand } = await import("../../src/commands/watch.ts");
    await run(watchCommand, ["Aho Girl"]);
    expect(out()).toContain("(1 items)");
    expect(out()).toContain("clip.mp4");
  });

  test("emits JSON for a media key", async () => {
    const { watchCommand } = await import("../../src/commands/watch.ts");
    await run(watchCommand, ["AF1QipPHOTO000000000000000000000000000000001", "--json"]);
    const parsed = JSON.parse(out());
    expect(parsed.fileName).toBe("IMG_0001.jpg");
    expect(parsed.downloadUrls.original).toContain("AF1QipPHOTO");
  });

  test("fails on an unknown target", async () => {
    const { watchCommand } = await import("../../src/commands/watch.ts");
    await expect(run(watchCommand, ["missing.mp4"])).rejects.toThrow("not found: missing.mp4");
  });
});

describe("whoami command", () => {
  test("summarizes storage and quota", async () => {
    const { whoamiCommand } = await import("../../src/commands/whoami.ts");
    await run(whoamiCommand, []);
    const text = out();
    expect(text).toContain("test@example.com");
    expect(text).toContain("4 (3 canonical)");
    expect(text).toContain("albums         2");
    expect(text).toContain("Pixel XL profile active");
  });
});

describe("quota command", () => {
  test("renders the Drive quota table", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          storageQuota: { usage: "1363148", limit: "5497558138880", usageInDrive: "956", usageInDriveTrash: "0" },
          user: { emailAddress: "test@example.com" },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    try {
      const { quotaCommand } = await import("../../src/commands/quota.ts");
      await run(quotaCommand, []);
      const text = out();
      expect(text).toContain("test@example.com");
      expect(text).toContain("1.3 MB");
      expect(text).toContain("5.0 TB");
      expect(text).toContain("0.00%");
      expect(api.callsTo("gmsAccessTokenFor")[0]!.args[0]).toContain("drive.readonly");
    } finally {
      globalThis.fetch = original;
    }
  });

  test("emits JSON", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ storageQuota: { usage: "100", limit: "200" } }), { status: 200 })) as unknown as typeof fetch;
    try {
      const { quotaCommand } = await import("../../src/commands/quota.ts");
      await run(quotaCommand, ["--json"]);
      const parsed = JSON.parse(out());
      expect(parsed.usage).toBe(100);
      expect(parsed.limit).toBe(200);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("surfaces a Drive API failure", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
    try {
      const { quotaCommand } = await import("../../src/commands/quota.ts");
      await expect(run(quotaCommand, [])).rejects.toThrow("Drive API returned HTTP 500");
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("additional coverage", () => {
  test("album ls emits JSON", async () => {
    const { albumCommand } = await import("../../src/commands/album.ts");
    await run(albumCommand, ["ls", "--json"]);
    const parsed = JSON.parse(out());
    expect(parsed).toHaveLength(2);
    expect(parsed[0].title).toBe("Aho Girl");
  });

  test("album ls reports an empty library", async () => {
    api = new FakePhotosApi({ state: snapshotNode({ items: [], albums: [] }) });
    setApiFactory(() => api as unknown as PhotosApi);
    const { albumCommand } = await import("../../src/commands/album.ts");
    await run(albumCommand, ["ls"]);
    expect(out()).toContain("no albums");
  });

  test("album create reports files missing from the library", async () => {
    const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "gphoto-create-"));
    try {
      await writeFile(join(dir, "IMG_0001.jpg"), "x");
      await writeFile(join(dir, "unknown.jpg"), "x");
      const { albumCommand } = await import("../../src/commands/album.ts");
      await run(albumCommand, ["create", "New Album", dir]);
      expect(out()).toContain("with 1 item(s)");
      expect(out()).toContain("skipped");
      expect(out()).toContain("unknown.jpg");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("album create requires a name", async () => {
    const { albumCommand } = await import("../../src/commands/album.ts");
    await expect(run(albumCommand, ["create"])).rejects.toThrow("Missing required positional argument: NAME");
  });

  test("watch emits album JSON", async () => {
    const { watchCommand } = await import("../../src/commands/watch.ts");
    await run(watchCommand, ["Aho Girl", "--json"]);
    const parsed = JSON.parse(out());
    expect(parsed).toEqual([{ fileName: "clip.mp4", mediaKey: "AF1QipALBUMONLY0000000000000000000000000003" }]);
  });

  test("watch prints the edited URL when it differs", async () => {
    api = new FakePhotosApi({
      state: snapshotNode({ items: SAMPLE_ITEMS, albums: SAMPLE_ALBUMS }),
      downloadUrls: {
        "AF1QipPHOTO000000000000000000000000000000001": {
          edited: "https://cdn.test/edited.jpg",
          original: "https://cdn.test/original.jpg",
          all: ["https://cdn.test/edited.jpg", "https://cdn.test/original.jpg"],
        },
      },
    });
    setApiFactory(() => api as unknown as PhotosApi);
    const { watchCommand } = await import("../../src/commands/watch.ts");
    await run(watchCommand, ["IMG_0001.jpg"]);
    expect(out()).toContain("edited download");
    expect(out()).toContain("https://cdn.test/edited.jpg");
  });

  test("ls renders a header only when the library is empty", async () => {
    api = new FakePhotosApi({ state: snapshotNode({ items: [], albums: [] }) });
    setApiFactory(() => api as unknown as PhotosApi);
    const { lsCommand } = await import("../../src/commands/ls.ts");
    await run(lsCommand, ["--albums"]);
    expect(out()).toContain("album");
    expect(out()).toContain("items");
  });

  test("trash ls emits JSON", async () => {
    const { trashCommand } = await import("../../src/commands/trash.ts");
    await run(trashCommand, ["ls", "--json"]);
    const parsed = JSON.parse(out());
    expect(parsed[0].fileName).toBe("old.png");
  });
});
