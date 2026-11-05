import { encodeNode, type ProtoNode } from "../../src/core/generic-encode.ts";

export const AUTH_DATA =
  "androidId=392d0518e52acdaf&app=com.google.android.apps.photos&client_sig=24bb24c05e47e0aefa68a58a766179d9b613a600&callerPkg=com.google.android.apps.photos&callerSig=24bb24c05e47e0aefa68a58a766179d9b613a600&device_country=us&Email=test%40example.com&google_play_services_version=240913000&lang=en_US&oauth2_foreground=1&sdk_version=28&service=oauth2%3Ahttps%3A%2F%2Fwww.googleapis.com%2Fauth%2Fphotos.native&Token=master-token";

export const SHA1_HEX = "0a0b0c0d0e0f1a1b1c1d1e1f2a2b2c2d3e3f4a4b";
export const SHA1_BYTES = new Uint8Array(Buffer.from(SHA1_HEX, "hex"));
export const SHA1_BASE64 = Buffer.from(SHA1_BYTES).toString("base64");
export const SHA1_URLSAFE = SHA1_BASE64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export interface MediaItemSeed {
  mediaKey: string;
  fileName?: string;
  dedupKey?: string;
  type?: number;
  sizeBytes?: number;
  quotaChargedBytes?: number;
  collectionId?: string;
  utcTimestamp?: number;
  trashTimestamp?: number;
  width?: number;
  height?: number;
  durationMs?: number;
  albumOnly?: boolean;
  archived?: boolean;
  favorite?: boolean;
  locked?: boolean;
  caption?: string;
  renditions?: { itag: number; width: number; height: number; url: string }[];
}

export function mediaItemNode(seed: MediaItemSeed): ProtoNode {
  const videoData: ProtoNode = {
    "4": {
      "1": seed.durationMs ?? 0,
      "2": (seed.renditions ?? []).map((entry) => ({ "1": entry.itag, "2": entry.width, "3": entry.height, "4": entry.url })),
      "4": seed.width ?? 0,
      "5": seed.height ?? 0,
    },
  };

  return {
    "1": seed.mediaKey,
    "2": {
      "1": { "1": seed.collectionId ?? "" },
      "4": seed.fileName ?? `${seed.mediaKey}.bin`,
      "5": seed.albumOnly ? [{ "1": 27 }] : [{ "1": 1 }],
      "7": seed.utcTimestamp ?? 1_700_000_000,
      "10": seed.sizeBytes ?? 1024,
      "16": { "3": seed.trashTimestamp ?? 0 },
      "21": { "1": seed.dedupKey ?? seed.mediaKey },
      "26": 1,
      "29": { "1": seed.archived ? 1 : 0 },
      "31": { "1": seed.favorite ? 1 : 0 },
      "35": { "2": seed.quotaChargedBytes ?? 0, "3": 2 },
      "39": { "1": seed.locked ? 1 : 0 },
    },
    "5": { "1": seed.type ?? 0, "3": videoData },
  };
}

export interface AlbumSeed {
  albumKey: string;
  title: string;
  itemCount: number;
  coverMediaKey?: string;
}

export function albumNode(seed: AlbumSeed): ProtoNode {
  return {
    "1": seed.albumKey,
    "2": {
      "5": seed.title,
      "7": seed.itemCount,
      "17": { "1": seed.coverMediaKey ?? "" },
    },
  };
}

export interface SnapshotSeed {
  syncToken?: string;
  resumeToken?: string;
  items?: ProtoNode[];
  albums?: ProtoNode[];
  deleted?: string[];
}

export function snapshotNode(seed: SnapshotSeed = {}): ProtoNode {
  return {
    "1": {
      "1": seed.resumeToken ?? "resume-token",
      "2": seed.items ?? [],
      "3": seed.albums ?? [],
      "6": seed.syncToken ?? "sync-token",
      "9": (seed.deleted ?? []).map((key) => ({ "1": { "1": 1, "2": { "1": key } } })),
    },
  };
}

export function snapshotBytes(seed: SnapshotSeed = {}): Uint8Array {
  return encodeNode(snapshotNode(seed));
}

export const SAMPLE_ITEMS: ProtoNode[] = [
  mediaItemNode({
    mediaKey: "AF1QipPHOTO000000000000000000000000000000001",
    fileName: "IMG_0001.jpg",
    dedupKey: "dedup-photo-1",
    sizeBytes: 2_048_000,
    width: 4032,
    height: 3024,
    utcTimestamp: 1_700_000_100,
  }),
  mediaItemNode({
    mediaKey: "AF1QipVIDEO000000000000000000000000000000002",
    fileName: "clip.mp4",
    dedupKey: "dedup-video-1",
    type: 2,
    sizeBytes: 18_000_000,
    width: 1920,
    height: 1080,
    durationMs: 30_000,
    utcTimestamp: 1_700_000_200,
    renditions: [
      { itag: 18, width: 640, height: 360, url: "https://example.test/18.mp4" },
      { itag: 22, width: 1280, height: 720, url: "https://example.test/22.mp4" },
    ],
  }),
  mediaItemNode({
    mediaKey: "AF1QipALBUMONLY0000000000000000000000000003",
    fileName: "clip.mp4",
    dedupKey: "dedup-video-1",
    type: 2,
    sizeBytes: 18_000_000,
    collectionId: "ALBUM_KEY_1",
    albumOnly: true,
    utcTimestamp: 1_700_000_200,
  }),
  mediaItemNode({
    mediaKey: "AF1QipTRASHED0000000000000000000000000000004",
    fileName: "old.png",
    dedupKey: "dedup-trash-1",
    sizeBytes: 512,
    trashTimestamp: 1_700_000_300,
    utcTimestamp: 1_700_000_000,
  }),
];

export const SAMPLE_ALBUMS: ProtoNode[] = [
  albumNode({ albumKey: "ALBUM_KEY_1", title: "Aho Girl", itemCount: 12, coverMediaKey: "AF1QipALBUMONLY0000000000000000000000000003" }),
  albumNode({ albumKey: "ALBUM_KEY_2", title: "BanG Dream!", itemCount: 39 }),
];
