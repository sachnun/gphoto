import { describe, expect, test } from "bun:test";
import type { ProtoNode } from "../../src/core/generic-encode.ts";
import { SAMPLE_ALBUMS, SAMPLE_ITEMS, snapshotNode } from "./library.ts";

export interface CapturedCall {
  method: string;
  args: unknown[];
}

export class FakePhotosApi {
  readonly auth = { androidId: "392d0518e52acdaf", email: "test@example.com" };
  readonly email = "test@example.com";
  readonly calls: CapturedCall[] = [];
  readonly state: ProtoNode;
  readonly downloadUrls: Record<string, { edited?: string; original?: string; all: string[] }>;
  readonly existingHashes: Set<string>;
  readonly albumKey: string;
  private readonly uploadToken: string;

  constructor(options: { state?: ProtoNode; downloadUrls?: Record<string, { edited?: string; original?: string; all: string[] }>; existingHashes?: string[]; albumKey?: string } = {}) {
    this.state = options.state ?? snapshotNode({ items: SAMPLE_ITEMS, albums: SAMPLE_ALBUMS });
    this.downloadUrls = options.downloadUrls ?? {};
    this.existingHashes = new Set(options.existingHashes ?? []);
    this.albumKey = options.albumKey ?? "NEW_ALBUM_KEY";
    this.uploadToken = "upload-token";
  }

  private record(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args });
  }

  async getLibraryState(syncToken = ""): Promise<ProtoNode> {
    this.record("getLibraryState", syncToken);
    return this.state;
  }

  async getDownloadUrls(mediaKey: string) {
    this.record("getDownloadUrls", mediaKey);
    return this.downloadUrls[mediaKey] ?? { original: `https://cdn.test/${mediaKey}`, all: [`https://cdn.test/${mediaKey}`] };
  }

  async findRemoteMediaByHash(sha1: Uint8Array): Promise<string | null> {
    const hex = Buffer.from(sha1).toString("hex");
    this.record("findRemoteMediaByHash", hex);
    return this.existingHashes.has(hex) ? "EXISTING_KEY" : null;
  }

  async getUploadToken(sha1Base64: string, fileSize: number): Promise<string> {
    this.record("getUploadToken", sha1Base64, fileSize);
    return this.uploadToken;
  }

  async uploadFile(
    file: Blob | Uint8Array,
    uploadToken: string,
    options: { size?: number; onProgress?: (bytesSent: number, bytesTotal: number) => void } = {},
  ): Promise<Uint8Array> {
    this.record("uploadFile", file, uploadToken);
    const total = options.size ?? (file instanceof Blob ? file.size : file.byteLength);
    options.onProgress?.(Math.floor(total / 2), total);
    options.onProgress?.(total, total);
    return new Uint8Array([1, 2, 3]);
  }

  async commitUpload(params: { fileName: string; quality?: string; model?: string }): Promise<string> {
    this.record("commitUpload", params);
    return `KEY_${params.fileName}`;
  }

  async createAlbum(name: string, mediaKeys: string[]): Promise<string> {
    this.record("createAlbum", name, mediaKeys);
    return this.albumKey;
  }

  async addMediaToAlbum(albumKey: string, mediaKeys: string[]): Promise<void> {
    this.record("addMediaToAlbum", albumKey, mediaKeys);
  }

  async renameAlbum(albumKey: string, title: string): Promise<void> {
    this.record("renameAlbum", albumKey, title);
  }

  async moveToTrash(dedupKeys: string[]): Promise<void> {
    this.record("moveToTrash", dedupKeys);
  }

  async restoreFromTrash(dedupKeys: string[]): Promise<void> {
    this.record("restoreFromTrash", dedupKeys);
  }

  async deletePermanently(dedupKeys: string[]): Promise<void> {
    this.record("deletePermanently", dedupKeys);
  }

  async gmsAccessTokenFor(service: string): Promise<string> {
    this.record("gmsAccessTokenFor", service);
    return "gms-token";
  }

  callsTo(method: string): CapturedCall[] {
    return this.calls.filter((call) => call.method === method);
  }
}
