import { describe, expect, test } from "bun:test";
import { parseMediaItem, parseSnapshot } from "../../src/core/media.ts";
import { albumNode, mediaItemNode, SAMPLE_ALBUMS, SAMPLE_ITEMS, snapshotNode } from "../fixtures/library.ts";

describe("parseSnapshot", () => {
  test("reads tokens, items and albums", () => {
    const snapshot = parseSnapshot(snapshotNode({ items: SAMPLE_ITEMS, albums: SAMPLE_ALBUMS }));
    expect(snapshot.syncToken).toBe("sync-token");
    expect(snapshot.resumeToken).toBe("resume-token");
    expect(snapshot.items).toHaveLength(4);
    expect(snapshot.albums.map((album) => album.title)).toEqual(["Aho Girl", "BanG Dream!"]);
  });

  test("returns empty structures for an empty state", () => {
    const snapshot = parseSnapshot({});
    expect(snapshot.items).toEqual([]);
    expect(snapshot.albums).toEqual([]);
    expect(snapshot.deletedMediaKeys).toEqual([]);
    expect(snapshot.syncToken).toBe("");
  });

  test("collects deleted media keys of type 1", () => {
    const snapshot = parseSnapshot(snapshotNode({ deleted: ["gone-a", "gone-b"] }));
    expect(snapshot.deletedMediaKeys).toEqual(["gone-a", "gone-b"]);
  });

  test("ignores deletion entries with other types", () => {
    const state = snapshotNode();
    const root = state["1"] as Record<string, unknown>;
    root["9"] = [{ "1": { "1": 7, "2": { "1": "not-deleted" } } }];
    expect(parseSnapshot(state).deletedMediaKeys).toEqual([]);
  });

  test("maps album fields including cover key", () => {
    const snapshot = parseSnapshot(snapshotNode({ albums: [albumNode({ albumKey: "K1", title: "T", itemCount: 3, coverMediaKey: "C1" })] }));
    expect(snapshot.albums[0]).toEqual({ albumKey: "K1", title: "T", itemCount: 3, coverMediaKey: "C1" });
  });
});

describe("parseMediaItem", () => {
  test("parses a photo", () => {
    const item = parseMediaItem(mediaItemNode({ mediaKey: "P1", fileName: "a.jpg", sizeBytes: 2048, width: 100, height: 50 }))!;
    expect(item.mediaKey).toBe("P1");
    expect(item.fileName).toBe("a.jpg");
    expect(item.type).toBe(0);
    expect(item.sizeBytes).toBe(2048);
    expect(item.width).toBe(100);
    expect(item.height).toBe(50);
    expect(item.isCanonical).toBe(true);
  });

  test("parses a video with renditions", () => {
    const item = parseMediaItem(
      mediaItemNode({
        mediaKey: "V1",
        fileName: "v.mp4",
        type: 2,
        durationMs: 30000,
        renditions: [{ itag: 22, width: 1280, height: 720, url: "https://cdn.test/22.mp4" }],
      }),
    )!;
    expect(item.type).toBe(2);
    expect(item.durationMs).toBe(30000);
    expect(item.renditions).toEqual([{ itag: 22, width: 1280, height: 720, url: "https://cdn.test/22.mp4" }]);
  });

  test("marks album-only entries as non canonical", () => {
    const item = parseMediaItem(mediaItemNode({ mediaKey: "A1", albumOnly: true, collectionId: "ALBUM" }))!;
    expect(item.isCanonical).toBe(false);
    expect(item.collectionId).toBe("ALBUM");
  });

  test("carries flags for archived, favorite and locked", () => {
    const item = parseMediaItem(mediaItemNode({ mediaKey: "F1", archived: true, favorite: true, locked: true }))!;
    expect(item.isArchived).toBe(true);
    expect(item.isFavorite).toBe(true);
    expect(item.isLocked).toBe(true);
  });

  test("reads trash timestamp", () => {
    const item = parseMediaItem(mediaItemNode({ mediaKey: "T1", trashTimestamp: 1700000300 }))!;
    expect(item.trashTimestamp).toBe(1700000300);
  });

  test("keeps quota charged bytes", () => {
    const item = parseMediaItem(mediaItemNode({ mediaKey: "Q1", quotaChargedBytes: 4096 }))!;
    expect(item.quotaChargedBytes).toBe(4096);
  });

  test("falls back to the media key when the file name is missing", () => {
    const node = mediaItemNode({ mediaKey: "NONAME" });
    const d2 = node["2"] as Record<string, unknown>;
    delete d2["4"];
    expect(parseMediaItem(node)!.fileName).toBe("NONAME.bin");
  });

  test("falls back to the media key when the dedup key is missing", () => {
    const node = mediaItemNode({ mediaKey: "NODEDUP" });
    const d2 = node["2"] as Record<string, unknown>;
    delete d2["21"];
    expect(parseMediaItem(node)!.dedupKey).toBe("NODEDUP");
  });

  test("derives the dedup key from the sha1 field when present", () => {
    const node = mediaItemNode({ mediaKey: "HASHED" });
    const d2 = node["2"] as Record<string, unknown>;
    delete d2["21"];
    d2["13"] = { "1": new Uint8Array(Buffer.from("0123456789abcdefghij", "utf8")) };
    const item = parseMediaItem(node)!;
    expect(item.dedupKey).not.toBe("HASHED");
    expect(item.dedupKey.length).toBeGreaterThan(0);
  });

  test("returns null when the media key is absent", () => {
    expect(parseMediaItem({})).toBeNull();
  });
});
