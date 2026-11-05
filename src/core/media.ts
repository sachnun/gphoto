import type { ProtoNode, ProtoValue } from "./generic-encode.ts";
import { toUrlSafeBase64 } from "./protobuf.ts";

export interface MediaItem {
  mediaKey: string;
  fileName: string;
  dedupKey: string;
  isCanonical: boolean;
  type: number;
  caption: string;
  collectionId: string;
  sizeBytes: number;
  quotaChargedBytes: number;
  contentVersion: number;
  utcTimestamp: number;
  serverCreationTimestamp: number;
  trashTimestamp: number;
  isArchived: boolean;
  isFavorite: boolean;
  isLocked: boolean;
  isOriginalQuality: boolean;
  width: number;
  height: number;
  durationMs: number;
  remoteUrl: string;
  renditions: Rendition[];
}

export interface Rendition {
  itag: number;
  width: number;
  height: number;
  url: string;
}

export interface LibrarySnapshot {
  syncToken: string;
  resumeToken: string;
  items: MediaItem[];
  deletedMediaKeys: string[];
  albums: Album[];
}

export interface Album {
  albumKey: string;
  title: string;
  itemCount: number;
  coverMediaKey: string;
}

function asNode(value: ProtoValue | undefined): ProtoNode | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as ProtoNode) : undefined;
}

function asNodes(value: ProtoValue | undefined): ProtoNode[] {
  if (!value) return [];
  if (Array.isArray(value)) return (value as ProtoValue[]).map((entry) => asNode(entry)).filter((entry): entry is ProtoNode => Boolean(entry));
  const single = asNode(value);
  return single ? [single] : [];
}

function num(value: ProtoValue | undefined, fallback = 0): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function str(value: ProtoValue | undefined, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function nested(node: ProtoNode | undefined, ...path: string[]): ProtoValue | undefined {
  let current: ProtoValue | undefined = node;
  for (const key of path) {
    const container = asNode(current);
    if (!container) return undefined;
    current = container[key];
  }
  return current;
}

export function parseMediaItem(raw: ProtoNode): MediaItem | null {
  const mediaKey = str(raw["1"]);
  if (!mediaKey) return null;

  const d2 = asNode(raw["2"]) ?? {};
  const d5 = asNode(raw["5"]) ?? {};
  const d17 = asNode(raw["17"]) ?? {};

  let dedupKey = "";
  const dedupContainer = asNode(d2["21"]);
  if (dedupContainer) {
    for (const [key, value] of Object.entries(dedupContainer)) {
      if (key.startsWith("1")) {
        dedupKey = str(value);
        break;
      }
    }
  }
  if (!dedupKey) {
    const hash = nested(d2, "13", "1");
    if (hash instanceof Uint8Array) dedupKey = toUrlSafeBase64(Buffer.from(hash).toString("base64"));
  }
  if (!dedupKey) dedupKey = mediaKey;

  const props = asNodes(d2["5"]);
  const isCanonical = !props.some((prop) => num(prop["1"]) === 27);

  const captionRaw = Object.entries(d2).find(([key]) => key.startsWith("3"))?.[1];
  const videoData = asNode(d5["3"]);
  const renditions = asNodes(nested(videoData, "4", "2") as ProtoValue | undefined).map((entry) => ({
    itag: num(entry["1"]),
    width: num(entry["2"]),
    height: num(entry["3"]),
    url: str(entry["4"]),
  }));

  const videoMeta = asNode(videoData?.["4"]);
  const width = num(nested(videoMeta, "4")) || num(nested(d5, "2", "1", "9", "1"));
  const height = num(nested(videoMeta, "5")) || num(nested(d5, "2", "1", "9", "2"));

  return {
    mediaKey,
    fileName: str(d2["4"], `${mediaKey}.bin`),
    dedupKey,
    isCanonical,
    type: num(nested(d5, "1")),
    caption: str(captionRaw),
    collectionId: str(nested(d2, "1", "1")),
    sizeBytes: num(d2["10"]),
    quotaChargedBytes: num(nested(d2, "35", "2")),
    contentVersion: num(d2["26"]),
    utcTimestamp: num(d2["7"]),
    serverCreationTimestamp: num(d2["9"]),
    trashTimestamp: num(nested(d2, "16", "3")),
    isArchived: num(nested(d2, "29", "1")) === 1,
    isFavorite: num(nested(d2, "31", "1")) === 1,
    isLocked: num(nested(d2, "39", "1")) === 1,
    isOriginalQuality: num(nested(d2, "35", "3")) === 2,
    width,
    height,
    durationMs: num(nested(videoData, "4", "1")),
    remoteUrl: str(nested(videoData, "2", "1")) || str(nested(d5, "2", "1", "1")),
    renditions,
  };
}

export function parseSnapshot(state: ProtoNode): LibrarySnapshot {
  const root = asNode(state["1"]) ?? {};
  const items: MediaItem[] = [];
  for (const raw of asNodes(root["2"])) {
    const item = parseMediaItem(raw);
    if (item) items.push(item);
  }

  const deletedMediaKeys: string[] = [];
  for (const deletion of asNodes(root["9"])) {
    const type = num(nested(deletion, "1", "1"));
    if (type === 1) {
      const key = str(nested(deletion, "1", "2", "1"));
      if (key) deletedMediaKeys.push(key);
    }
  }

  const albums: Album[] = asNodes(root["3"]).map((album) => ({
    albumKey: str(album["1"]),
    title: str(nested(album, "2", "5")),
    itemCount: num(nested(album, "2", "7")),
    coverMediaKey: str(nested(album, "2", "17", "1")),
  }));

  return {
    syncToken: str(root["6"]),
    resumeToken: str(root["1"]),
    items,
    deletedMediaKeys,
    albums,
  };
}
