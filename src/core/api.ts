import { fetchAccessToken, parseAuthData, parseLanguage, type AccessToken, type AuthData } from "./auth.ts";
import { cloneNode, encodeNode, type ProtoNode } from "./generic-encode.ts";
import { request } from "./http.ts";
import { LIBRARY_PAGE, LIBRARY_PAGE_INIT, LIBRARY_STATE } from "./library-bodies.ts";
import { decodeFields, getBytes, getMessages, getNumber, getString, toUrlSafeBase64, Writer } from "./protobuf.ts";

export const ANDROID_API_VERSION = 28;
export const CLIENT_VERSION_CODE = 49029607;
export const MODEL = "Pixel XL";
export const MAKE = "Google";
export const PHOTOSDATA = "https://photosdata-pa.googleapis.com/6439526531001121323";
export const UPLOAD_BASE = "https://photos.googleapis.com/data/upload/uploadmedia/interactive";

const GMS_PACKAGE = "com.google.android.gms";
const GMS_CERT_SHA1 = "38918a453d07199354f8b19af05ec6562ced5788";

const RPC = {
  commitUpload: `${PHOTOSDATA}/16538846908252377752`,
  findByHash: `${PHOTOSDATA}/5084965799730810217`,
  createAlbum: `${PHOTOSDATA}/8386163679468898444`,
  addToAlbum: `${PHOTOSDATA}/484917746253879292`,
  library: `${PHOTOSDATA}/18047484249733410717`,
  caption: `${PHOTOSDATA}/1552790390512470739`,
  favorite: `${PHOTOSDATA}/5144645502632292153`,
  archive: `${PHOTOSDATA}/6715446385130606868`,
  trash: `${PHOTOSDATA}/17490284929287180316`,
  download: "https://photosdata-pa.googleapis.com/$rpc/social.frontend.photos.preparedownloaddata.v1.PhotosPrepareDownloadDataService/PhotosPrepareDownload",
  setCollectionTitle: "https://photosdata-pa.googleapis.com/$rpc/social.frontend.photos.data.v1.PhotosFeService/PhotosSetCollectionTitle",
};

const EXT_HEADERS = {
  "x-goog-ext-173412678-bin": "CgcIAhClARgC",
  "x-goog-ext-174067345-bin": "CgIIAg==",
};

export interface ApiOptions {
  authData: string;
  proxy?: string;
  language?: string;
  timeoutMs?: number;
}

export interface DownloadUrls {
  edited?: string;
  original?: string;
  all: string[];
}

export class PhotosApi {
  readonly auth: AuthData;
  readonly userAgent: string;
  readonly language: string;
  private readonly proxy?: string;
  private readonly timeoutMs: number;
  private token: AccessToken | null = null;

  constructor(options: ApiOptions) {
    this.auth = parseAuthData(options.authData);
    this.proxy = options.proxy;
    this.language = options.language ?? parseLanguage(options.authData) ?? "en_US";
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.userAgent = `com.google.android.apps.photos/${CLIENT_VERSION_CODE} (Linux; U; Android 9; ${this.language}; Pixel XL; Build/PQ2A.190205.001; Cronet/127.0.6510.5) (gzip)`;
  }

  get email(): string {
    return this.auth.email;
  }

  async bearer(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (!this.token || this.token.expiresAt <= now + 30) {
      this.token = await fetchAccessToken(this.auth, undefined, this.proxy);
    }
    return this.token.value;
  }

  async accessTokenFor(service: string): Promise<string> {
    const token = await fetchAccessToken(this.auth, service, this.proxy);
    return token.value;
  }

  async gmsAccessTokenFor(service: string): Promise<string> {
    const gms = {
      ...this.auth,
      app: GMS_PACKAGE,
      clientSig: GMS_CERT_SHA1,
      callerPkg: GMS_PACKAGE,
      callerSig: GMS_CERT_SHA1,
    };
    const token = await fetchAccessToken(gms, service, this.proxy);
    return token.value;
  }

  private async headers(extra: Record<string, string> = {}): Promise<Record<string, string>> {
    return {
      "Accept-Encoding": "gzip",
      "Accept-Language": this.language,
      "Content-Type": "application/x-protobuf",
      "User-Agent": this.userAgent,
      Authorization: `Bearer ${await this.bearer()}`,
      ...EXT_HEADERS,
      ...extra,
    };
  }

  private async post(url: string, body: Uint8Array, extra: Record<string, string> = {}): Promise<Uint8Array> {
    const response = await request(url, {
      method: "POST",
      headers: await this.headers(extra),
      body,
      timeoutMs: this.timeoutMs,
      proxy: this.proxy,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status} ${url}: ${response.text.slice(0, 200)}`);
    }
    return response.bytes;
  }

  async getUploadToken(sha1Base64: string, fileSize: number): Promise<string> {
    const body = new Writer().uint(1, 2).uint(2, 2).uint(3, 1).uint(4, 3).uint(7, fileSize).finish();
    const response = await request(UPLOAD_BASE, {
      method: "POST",
      headers: await this.headers({
        "X-Goog-Hash": `sha1=${sha1Base64}`,
        "X-Upload-Content-Length": String(fileSize),
      }),
      body,
      timeoutMs: this.timeoutMs,
      proxy: this.proxy,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`upload token failed: HTTP ${response.status} ${response.text.slice(0, 200)}`);
    }
    const uploadId = response.headers.get("x-guploader-uploadid");
    if (!uploadId) throw new Error("upload token response has no X-GUploader-UploadID");
    return uploadId;
  }

  async uploadFile(
    file: Blob | Uint8Array | ReadableStream<Uint8Array>,
    uploadToken: string,
    options: { size?: number; onProgress?: (bytesSent: number, bytesTotal: number) => void } = {},
  ): Promise<Uint8Array> {
    const size = options.size ?? (file instanceof Blob ? file.size : file instanceof Uint8Array ? file.byteLength : 0);
    const source = file instanceof Blob ? file.stream() : file instanceof Uint8Array ? singleChunk(file) : file;
    const body = options.onProgress && size > 0 ? countingStream(source, size, options.onProgress) : source;
    const headers: Record<string, string> = {
      "Accept-Encoding": "gzip",
      "Accept-Language": this.language,
      "User-Agent": this.userAgent,
      Authorization: `Bearer ${await this.bearer()}`,
    };
    if (body instanceof ReadableStream && size > 0) headers["Content-Length"] = String(size);
    if (file instanceof Blob && file.type) headers["Content-Type"] = file.type;
    const response = await request(`${UPLOAD_BASE}?upload_id=${encodeURIComponent(uploadToken)}`, {
      method: "PUT",
      headers,
      body,
      timeoutMs: Math.max(this.timeoutMs, 600_000),
      proxy: this.proxy,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`upload file failed: HTTP ${response.status} ${response.text.slice(0, 200)}`);
    }
    return response.bytes;
  }

  async findRemoteMediaByHash(sha1: Uint8Array): Promise<string | null> {
    const hashMessage = new Writer().bytes(1, sha1).finish();
    const inner = new Writer().message(1, hashMessage).message(2, new Uint8Array(0)).finish();
    const body = new Writer().message(1, inner).finish();
    const raw = await this.post(RPC.findByHash, body);
    const root = decodeFields(raw);
    const outer = getBytes(root, 1);
    if (!outer) return null;
    const level2 = getBytes(decodeFields(outer), 2);
    if (!level2) return null;
    const level3 = getBytes(decodeFields(level2), 2);
    if (!level3) return null;
    const key = getString(decodeFields(level3), 1);
    return key || null;
  }

  async commitUpload(params: {
    uploadResponse: Uint8Array;
    fileName: string;
    sha1: Uint8Array;
    uploadTimestamp: number;
    quality?: "original" | "saver";
    model?: string;
    make?: string;
  }): Promise<string> {
    const quality = params.quality === "saver" ? 1 : 3;
    const inner = new Writer()
      .message(1, params.uploadResponse)
      .string(2, params.fileName)
      .bytes(3, params.sha1)
      .message(4, new Writer().uint(1, params.uploadTimestamp).uint(2, 46000000).finish())
      .uint(7, quality)
      .uint(10, 1)
      .finish();
    const device = new Writer()
      .string(3, params.model ?? MODEL)
      .string(4, params.make ?? MAKE)
      .uint(5, ANDROID_API_VERSION)
      .finish();
    const body = new Writer().message(1, inner).message(2, device).bytes(3, Uint8Array.from([1, 3])).finish();
    const raw = await this.post(RPC.commitUpload, body);
    const root = decodeFields(raw);
    const level1 = getBytes(root, 1);
    if (!level1) throw new Error("commit upload: empty response");
    const level3 = getBytes(decodeFields(level1), 3);
    if (!level3) throw new Error("commit upload rejected by the API");
    const mediaKey = getString(decodeFields(level3), 1);
    if (!mediaKey) throw new Error("commit upload: missing media key");
    return mediaKey;
  }

  async createAlbum(name: string, mediaKeys: string[]): Promise<string> {
    const body = new Writer().string(1, name).uint(2, Math.floor(Date.now() / 1000)).uint(3, 1);
    for (const key of mediaKeys) {
      body.message(4, new Writer().message(1, new Writer().string(1, key).finish()).finish());
    }
    body.message(6, new Uint8Array(0));
    body.message(7, new Writer().uint(1, 3).finish());
    body.message(8, new Writer().string(3, MODEL).string(4, MAKE).uint(5, ANDROID_API_VERSION).finish());
    const raw = await this.post(RPC.createAlbum, body.finish());
    const level1 = getBytes(decodeFields(raw), 1);
    if (!level1) throw new Error("create album: empty response");
    const albumKey = getString(decodeFields(level1), 1);
    if (!albumKey) throw new Error("create album: missing album key");
    return albumKey;
  }

  async addMediaToAlbum(albumMediaKey: string, mediaKeys: string[]): Promise<void> {
    const body = new Writer();
    for (const key of mediaKeys) body.string(1, key);
    body.string(2, albumMediaKey);
    body.message(5, new Writer().uint(1, 2).finish());
    body.message(6, new Writer().string(3, MODEL).string(4, MAKE).uint(5, ANDROID_API_VERSION).finish());
    body.uint(7, Math.floor(Date.now() / 1000));
    await this.post(RPC.addToAlbum, body.finish());
  }

  async renameAlbum(albumMediaKey: string, title: string): Promise<void> {
    const body = new Writer().string(1, albumMediaKey).string(2, title).finish();
    await this.post(RPC.setCollectionTitle, body);
  }

  async getLibraryState(syncToken = ""): Promise<ProtoNode> {
    const body = cloneNode(LIBRARY_STATE);
    const root = body["1"] as Record<string, ProtoNode | string>;
    root["6"] = syncToken;
    const raw = await this.post(RPC.library, encodeNode(body));
    return decodeNode(raw);
  }

  async getLibraryPageInit(resumeToken: string): Promise<ProtoNode> {
    const body = cloneNode(LIBRARY_PAGE_INIT);
    const root = body["1"] as Record<string, ProtoNode | string>;
    root["4"] = resumeToken;
    const raw = await this.post(RPC.library, encodeNode(body));
    return decodeNode(raw);
  }

  async getLibraryPage(resumeToken: string, syncToken: string): Promise<ProtoNode> {
    const body = cloneNode(LIBRARY_PAGE);
    const root = body["1"] as Record<string, ProtoNode | string>;
    root["4"] = resumeToken;
    root["6"] = syncToken;
    const raw = await this.post(RPC.library, encodeNode(body));
    return decodeNode(raw);
  }

  async moveToTrash(dedupKeys: string[]): Promise<void> {
    const body = new Writer().uint(2, 1);
    for (const key of dedupKeys) body.string(3, key);
    body.uint(4, 1);
    body.message(
      8,
      new Writer()
        .message(
          4,
          new Writer()
            .message(2, new Uint8Array(0))
            .message(3, new Writer().message(1, new Uint8Array(0)).finish())
            .message(4, new Uint8Array(0))
            .message(5, new Writer().message(1, new Uint8Array(0)).finish())
            .finish(),
        )
        .finish(),
    );
    body.message(
      9,
      new Writer().uint(1, 5).message(2, new Writer().uint(1, CLIENT_VERSION_CODE).string(2, String(ANDROID_API_VERSION)).finish()).finish(),
    );
    await this.post(RPC.trash, body.finish());
  }

  async restoreFromTrash(dedupKeys: string[]): Promise<void> {
    const body = new Writer().uint(2, 3);
    for (const key of dedupKeys) body.string(3, key);
    body.uint(4, 2);
    body.message(
      8,
      new Writer()
        .message(4, new Writer().message(2, new Uint8Array(0)).message(3, new Writer().message(1, new Uint8Array(0)).finish()).finish())
        .finish(),
    );
    body.message(
      9,
      new Writer().uint(1, 5).message(2, new Writer().uint(1, CLIENT_VERSION_CODE).string(2, String(ANDROID_API_VERSION)).finish()).finish(),
    );
    await this.post(RPC.trash, body.finish());
  }

  async deletePermanently(dedupKeys: string[]): Promise<void> {
    const body = new Writer().uint(2, 2);
    for (const key of dedupKeys) body.string(3, key);
    body.uint(4, 2);
    body.message(
      8,
      new Writer()
        .message(
          4,
          new Writer()
            .message(2, new Uint8Array(0))
            .message(3, new Writer().message(1, new Uint8Array(0)).finish())
            .message(4, new Uint8Array(0))
            .message(5, new Writer().message(1, new Uint8Array(0)).finish())
            .finish(),
        )
        .finish(),
    );
    body.string(9, "");
    await this.post(RPC.trash, body.finish());
  }

  async setCaption(dedupKey: string, caption: string): Promise<void> {
    await this.post(RPC.caption, new Writer().string(2, caption).string(3, dedupKey).finish());
  }

  async setFavorite(dedupKey: string, isFavorite: boolean): Promise<void> {
    const body = new Writer()
      .message(1, new Writer().string(2, dedupKey).finish())
      .message(2, new Writer().uint(1, isFavorite ? 1 : 2).finish())
      .message(3, new Writer().message(1, new Uint8Array(0)).finish())
      .finish();
    await this.post(RPC.favorite, body);
  }

  async setArchived(dedupKeys: string[], isArchived: boolean): Promise<void> {
    const body = new Writer();
    for (const key of dedupKeys) {
      body.message(1, new Writer().string(1, key).message(2, new Writer().message(1, new Uint8Array(0)).finish()).finish());
    }
    body.uint(3, isArchived ? 1 : 2);
    await this.post(RPC.archive, body.finish());
  }

  async getDownloadUrls(mediaKey: string): Promise<DownloadUrls> {
    const body = new Writer()
      .message(1, new Writer().message(1, new Writer().string(1, mediaKey).finish()).finish())
      .message(
        2,
        new Writer()
          .message(1, new Writer().message(2, new Uint8Array(0)).finish())
          .message(5, new Writer().message(2, new Uint8Array(0)).message(3, new Uint8Array(0)).message(5, new Writer().message(1, new Uint8Array(0)).uint(3, 0).finish()).finish())
          .finish(),
      )
      .finish();
    const raw = await this.post(RPC.download, body);
    const urls = collectUrls(decodeNode(raw));
    const original = urls.at(-1);
    return { edited: urls[0], original, all: urls };
  }

  async getThumbnail(mediaKey: string, width = 256, height = 256): Promise<Uint8Array> {
    const url = `https://lh3.googleusercontent.com/p/${encodeURIComponent(mediaKey)}=w${width}-h${height}`;
    const response = await request(url, {
      headers: { "User-Agent": this.userAgent, Authorization: `Bearer ${await this.bearer()}` },
      timeoutMs: this.timeoutMs,
      proxy: this.proxy,
    });
    if (response.status !== 200) throw new Error(`thumbnail failed: HTTP ${response.status}`);
    return response.bytes;
  }
}

function decodeNode(buf: Uint8Array): ProtoNode {
  const out: Record<string, unknown> = {};
  for (const field of decodeFields(buf)) {
    const key = String(field.field);
    const value: unknown = field.wire === 2 ? tryDecode(field.value as Uint8Array) : Number(field.value);
    if (key in out) {
      const existing = out[key];
      out[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
    } else {
      out[key] = value;
    }
  }
  return out as ProtoNode;
}

function tryDecode(buf: Uint8Array): unknown {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    if (/^[\x20-\x7e]*$/.test(text) && text.length > 0) return text;
  } catch {}
  try {
    return decodeNode(buf);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(buf);
  }
}

function collectUrls(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") {
    if (node.startsWith("http")) out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const entry of node) collectUrls(entry, out);
    return out;
  }
  if (node && typeof node === "object") {
    for (const value of Object.values(node)) collectUrls(value, out);
  }
  return out;
}

export function dedupKeyFromHash(sha1Base64: string): string {
  return toUrlSafeBase64(sha1Base64);
}

function singleChunk(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function countingStream(
  source: ReadableStream<Uint8Array>,
  total: number,
  onProgress: (bytesSent: number, bytesTotal: number) => void,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      sent += value.length;
      onProgress(Math.min(sent, total), total);
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}
