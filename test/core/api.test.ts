import { afterEach, describe, expect, test } from "bun:test";
import { dedupKeyFromHash, PhotosApi } from "../../src/core/api.ts";
import { decodeFields, getBytes, getString, Writer } from "../../src/core/protobuf.ts";
import { AUTH_DATA, SHA1_BASE64 } from "../fixtures/library.ts";

const original = globalThis.fetch;
let requests: { url: string; init: RequestInit }[] = [];

interface Route {
  match: (url: string, init: RequestInit) => boolean;
  respond: (url: string, init: RequestInit) => Response;
}

let routes: Route[] = [];

function stubFetch(): void {
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    requests.push({ url: String(url), init });
    const route = routes.find((entry) => entry.match(String(url), init));
    if (!route) return new Response("unrouted", { status: 599 });
    return route.respond(String(url), init);
  }) as unknown as typeof fetch;
}

function authResponse(): Response {
  return new Response("Auth=access-token\nExpiry=9999999999\n", { status: 200 });
}

function protobufResponse(bytes: Uint8Array, headers: Record<string, string> = {}): Response {
  return new Response(bytes as unknown as BodyInit, { status: 200, headers });
}

beforeEachRoutes();
function beforeEachRoutes(): void {
  routes = [];
  requests = [];
}

afterEach(() => {
  globalThis.fetch = original;
  routes = [];
  requests = [];
});

function makeApi(): PhotosApi {
  stubFetch();
  routes.push({ match: (url) => url.includes("android.googleapis.com/auth"), respond: authResponse });
  return new PhotosApi({ authData: AUTH_DATA });
}

describe("PhotosApi construction", () => {
  test("parses auth data and exposes the email", () => {
    const api = new PhotosApi({ authData: AUTH_DATA });
    expect(api.email).toBe("test@example.com");
    expect(api.auth.androidId).toBe("392d0518e52acdaf");
    expect(api.language).toBe("en_US");
    expect(api.userAgent).toContain("Pixel XL");
  });

  test("rejects incomplete auth data", () => {
    expect(() => new PhotosApi({ authData: "androidId=only" })).toThrow("incomplete auth data");
  });
});

describe("bearer", () => {
  test("fetches once and caches the token", async () => {
    const api = makeApi();
    expect(await api.bearer()).toBe("access-token");
    expect(await api.bearer()).toBe("access-token");
    expect(requests.filter((entry) => entry.url.includes("/auth"))).toHaveLength(1);
  });

  test("requests a scoped token on demand", async () => {
    const api = makeApi();
    expect(await api.accessTokenFor("oauth2:scope")).toBe("access-token");
    const body = String(requests.at(-1)!.init.body);
    expect(body).toContain("service=oauth2%3Ascope");
  });

  test("switches identity for GMS scopes", async () => {
    const api = makeApi();
    expect(await api.gmsAccessTokenFor("oauth2:drive")).toBe("access-token");
    const body = String(requests.at(-1)!.init.body);
    expect(body).toContain("app=com.google.android.gms");
    expect(body).toContain("client_sig=38918a453d07199354f8b19af05ec6562ced5788");
  });
});

describe("getUploadToken", () => {
  test("returns the upload id from the response header", async () => {
    const api = makeApi();
    routes.push({
      match: (url) => url.includes("uploadmedia"),
      respond: () => protobufResponse(new Uint8Array(), { "x-guploader-uploadid": "upload-1" }),
    });
    expect(await api.getUploadToken(SHA1_BASE64, 1234)).toBe("upload-1");
    const init = requests.at(-1)!.init;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-Goog-Hash"]).toBe(`sha1=${SHA1_BASE64}`);
    expect((init.headers as Record<string, string>)["X-Upload-Content-Length"]).toBe("1234");
  });

  test("fails when the upload id is missing", async () => {
    const api = makeApi();
    routes.push({ match: (url) => url.includes("uploadmedia"), respond: () => protobufResponse(new Uint8Array()) });
    await expect(api.getUploadToken(SHA1_BASE64, 1)).rejects.toThrow("no X-GUploader-UploadID");
  });

  test("fails on a non 2xx status", async () => {
    const api = makeApi();
    routes.push({ match: (url) => url.includes("uploadmedia"), respond: () => new Response("nope", { status: 500 }) });
    await expect(api.getUploadToken(SHA1_BASE64, 1)).rejects.toThrow("HTTP 500");
  });
});

describe("uploadFile", () => {
  test("PUTs the payload to the upload id", async () => {
    const api = makeApi();
    routes.push({ match: (url) => url.includes("upload_id="), respond: () => protobufResponse(new Uint8Array([7])) });
    const bytes = await api.uploadFile(new Uint8Array([1, 2]), "token with space");
    expect(Array.from(bytes)).toEqual([7]);
    expect(requests.at(-1)!.init.method).toBe("PUT");
    expect(requests.at(-1)!.url).toContain("upload_id=token%20with%20space");
  });

  test("fails on a non 2xx status", async () => {
    const api = makeApi();
    routes.push({ match: (url) => url.includes("upload_id="), respond: () => new Response("nope", { status: 400 }) });
    await expect(api.uploadFile(new Uint8Array(), "t")).rejects.toThrow("upload file failed");
  });
});

describe("findRemoteMediaByHash", () => {
  test("returns the media key found in the nested response", async () => {
    const api = makeApi();
    const level3 = new Writer().string(1, "FOUND_KEY").finish();
    const level2 = new Writer().message(2, level3).finish();
    const level1 = new Writer().message(2, level2).finish();
    const root = new Writer().message(1, level1).finish();
    routes.push({ match: (url) => url.includes("5084965799730810217"), respond: () => protobufResponse(root) });
    expect(await api.findRemoteMediaByHash(new Uint8Array(20))).toBe("FOUND_KEY");
  });

  test("returns null when the response is empty", async () => {
    const api = makeApi();
    routes.push({ match: (url) => url.includes("5084965799730810217"), respond: () => protobufResponse(new Uint8Array()) });
    expect(await api.findRemoteMediaByHash(new Uint8Array(20))).toBeNull();
  });

  test("returns null when the nesting stops early", async () => {
    const api = makeApi();
    routes.push({ match: (url) => url.includes("5084965799730810217"), respond: () => protobufResponse(new Writer().message(1, new Uint8Array()).finish()) });
    expect(await api.findRemoteMediaByHash(new Uint8Array(20))).toBeNull();
  });
});

describe("commitUpload", () => {
  const params = { uploadResponse: new Uint8Array([1]), fileName: "a.jpg", sha1: new Uint8Array(20), uploadTimestamp: 1 };

  function commitResponse(mediaKey: string | null): Uint8Array {
    const level3 = mediaKey ? new Writer().string(1, mediaKey).finish() : new Uint8Array();
    const level1 = new Writer().message(3, level3).finish();
    return new Writer().message(1, level1).finish();
  }

  test("returns the media key", async () => {
    const api = makeApi();
    routes.push({ match: (url) => url.includes("16538846908252377752"), respond: () => protobufResponse(commitResponse("NEW_KEY")) });
    expect(await api.commitUpload(params)).toBe("NEW_KEY");
  });

  test("sends the Pixel XL device identity by default", async () => {
    const api = makeApi();
    routes.push({ match: (url) => url.includes("16538846908252377752"), respond: () => protobufResponse(commitResponse("K")) });
    await api.commitUpload(params);
    const body = requests.at(-1)!.init.body as Uint8Array;
    const text = new TextDecoder().decode(body);
    expect(text).toContain("Pixel XL");
    expect(text).toContain("Google");
  });

  test("encodes the saver quality flag", async () => {
    const api = makeApi();
    routes.push({ match: (url) => url.includes("16538846908252377752"), respond: () => protobufResponse(commitResponse("K")) });
    await api.commitUpload({ ...params, quality: "saver", model: "Pixel 2" });
    const fields = decodeFields(requests.at(-1)!.init.body as Uint8Array);
    const inner = decodeFields(getBytes(fields, 1)!);
    expect(inner.find((field) => field.field === 7)!.value).toBe(1n);
  });

  test("fails when the API rejects the commit", async () => {
    const api = makeApi();
    routes.push({ match: (url) => url.includes("16538846908252377752"), respond: () => protobufResponse(new Writer().message(1, new Uint8Array()).finish()) });
    await expect(api.commitUpload(params)).rejects.toThrow("rejected by the API");
  });

  test("fails on an empty response", async () => {
    const api = makeApi();
    routes.push({ match: (url) => url.includes("16538846908252377752"), respond: () => protobufResponse(new Uint8Array()) });
    await expect(api.commitUpload(params)).rejects.toThrow("empty response");
  });
});

describe("album calls", () => {
  test("createAlbum returns the album key", async () => {
    const api = makeApi();
    const level1 = new Writer().string(1, "ALBUM_KEY").finish();
    routes.push({ match: (url) => url.includes("8386163679468898444"), respond: () => protobufResponse(new Writer().message(1, level1).finish()) });
    expect(await api.createAlbum("Aho Girl", ["a", "b"])).toBe("ALBUM_KEY");
    const body = new TextDecoder().decode(requests.at(-1)!.init.body as Uint8Array);
    expect(body).toContain("Aho Girl");
    expect(body).toContain("Pixel XL");
  });

  test("createAlbum fails without a key", async () => {
    const api = makeApi();
    routes.push({ match: (url) => url.includes("8386163679468898444"), respond: () => protobufResponse(new Uint8Array()) });
    await expect(api.createAlbum("x", [])).rejects.toThrow("create album: empty response");
  });

  test("addMediaToAlbum posts every key", async () => {
    const api = makeApi();
    routes.push({ match: (url) => url.includes("484917746253879292"), respond: () => protobufResponse(new Uint8Array()) });
    await api.addMediaToAlbum("ALBUM", ["k1", "k2"]);
    const text = new TextDecoder().decode(requests.at(-1)!.init.body as Uint8Array);
    expect(text).toContain("k1");
    expect(text).toContain("k2");
    expect(text).toContain("ALBUM");
  });

  test("renameAlbum posts the new title", async () => {
    const api = makeApi();
    routes.push({ match: (url) => url.includes("PhotosSetCollectionTitle"), respond: () => protobufResponse(new Uint8Array()) });
    await api.renameAlbum("ALBUM", "New Title");
    expect(new TextDecoder().decode(requests.at(-1)!.init.body as Uint8Array)).toContain("New Title");
  });
});

describe("library calls", () => {
  test("getLibraryState decodes the response tree", async () => {
    const api = makeApi();
    const inner = new Writer().string(1, "media-key").finish();
    const item = new Writer().string(1, "media-key").message(2, inner).finish();
    const root = new Writer().message(1, new Writer().message(2, item).finish()).finish();
    routes.push({ match: (url) => url.includes("18047484249733410717"), respond: () => protobufResponse(root) });
    const state = await api.getLibraryState("sync-1");
    expect((state["1"] as Record<string, unknown>)["2"]).toBeDefined();
    expect(new TextDecoder().decode(requests.at(-1)!.init.body as Uint8Array)).toContain("sync-1");
  });

  test("propagates HTTP failures", async () => {
    const api = makeApi();
    routes.push({ match: (url) => url.includes("18047484249733410717"), respond: () => new Response("boom", { status: 500 }) });
    await expect(api.getLibraryState()).rejects.toThrow("HTTP 500");
  });

  test("getLibraryPageInit and getLibraryPage send their resume tokens", async () => {
    const api = makeApi();
    routes.push({ match: (url) => url.includes("18047484249733410717"), respond: () => protobufResponse(new Uint8Array()) });
    await api.getLibraryPageInit("resume-1");
    expect(new TextDecoder().decode(requests.at(-1)!.init.body as Uint8Array)).toContain("resume-1");
    await api.getLibraryPage("resume-2", "sync-2");
    const body = new TextDecoder().decode(requests.at(-1)!.init.body as Uint8Array);
    expect(body).toContain("resume-2");
    expect(body).toContain("sync-2");
  });
});

describe("trash calls", () => {
  test("moveToTrash sends the dedup keys and the trash mode", async () => {
    const api = makeApi();
    routes.push({ match: (url) => url.includes("17490284929287180316"), respond: () => protobufResponse(new Uint8Array()) });
    await api.moveToTrash(["dedup-1"]);
    const fields = decodeFields(requests.at(-1)!.init.body as Uint8Array);
    expect(fields.find((field) => field.field === 2)!.value).toBe(1n);
    expect(new TextDecoder().decode(requests.at(-1)!.init.body as Uint8Array)).toContain("dedup-1");
  });

  test("restoreFromTrash uses restore mode", async () => {
    const api = makeApi();
    routes.push({ match: (url) => url.includes("17490284929287180316"), respond: () => protobufResponse(new Uint8Array()) });
    await api.restoreFromTrash(["dedup-1"]);
    const fields = decodeFields(requests.at(-1)!.init.body as Uint8Array);
    expect(fields.find((field) => field.field === 2)!.value).toBe(3n);
  });

  test("deletePermanently uses delete mode", async () => {
    const api = makeApi();
    routes.push({ match: (url) => url.includes("17490284929287180316"), respond: () => protobufResponse(new Uint8Array()) });
    await api.deletePermanently(["dedup-1"]);
    const fields = decodeFields(requests.at(-1)!.init.body as Uint8Array);
    expect(fields.find((field) => field.field === 2)!.value).toBe(2n);
  });
});

describe("metadata calls", () => {
  test("setCaption sends the text", async () => {
    const api = makeApi();
    routes.push({ match: (url) => url.includes("1552790390512470739"), respond: () => protobufResponse(new Uint8Array()) });
    await api.setCaption("dedup", "hello caption");
    expect(new TextDecoder().decode(requests.at(-1)!.init.body as Uint8Array)).toContain("hello caption");
  });

  test("setFavorite encodes both directions", async () => {
    const api = makeApi();
    routes.push({ match: (url) => url.includes("5144645502632292153"), respond: () => protobufResponse(new Uint8Array()) });
    await api.setFavorite("dedup", true);
    let body = requests.at(-1)!.init.body as Uint8Array;
    expect(decodeFields(getBytes(decodeFields(body), 2)!).find((field) => field.field === 1)!.value).toBe(1n);
    await api.setFavorite("dedup", false);
    body = requests.at(-1)!.init.body as Uint8Array;
    expect(decodeFields(getBytes(decodeFields(body), 2)!).find((field) => field.field === 1)!.value).toBe(2n);
  });

  test("setArchived encodes both directions", async () => {
    const api = makeApi();
    routes.push({ match: (url) => url.includes("6715446385130606868"), respond: () => protobufResponse(new Uint8Array()) });
    await api.setArchived(["dedup"], true);
    expect(decodeFields(requests.at(-1)!.init.body as Uint8Array).find((field) => field.field === 3)!.value).toBe(1n);
    await api.setArchived(["dedup"], false);
    expect(decodeFields(requests.at(-1)!.init.body as Uint8Array).find((field) => field.field === 3)!.value).toBe(2n);
  });
});

describe("getDownloadUrls", () => {
  test("collects every URL and treats the last one as the original", async () => {
    const api = makeApi();
    const root = new Writer()
      .string(1, "https://cdn.test/edited.jpg")
      .string(2, "https://cdn.test/original.jpg")
      .finish();
    routes.push({ match: (url) => url.includes("PhotosPrepareDownload"), respond: () => protobufResponse(root) });
    const urls = await api.getDownloadUrls("KEY");
    expect(urls.all).toEqual(["https://cdn.test/edited.jpg", "https://cdn.test/original.jpg"]);
    expect(urls.edited).toBe("https://cdn.test/edited.jpg");
    expect(urls.original).toBe("https://cdn.test/original.jpg");
  });

  test("returns empty fields when no URL is present", async () => {
    const api = makeApi();
    routes.push({ match: (url) => url.includes("PhotosPrepareDownload"), respond: () => protobufResponse(new Uint8Array()) });
    const urls = await api.getDownloadUrls("KEY");
    expect(urls).toEqual({ edited: undefined, original: undefined, all: [] });
  });
});

describe("getThumbnail", () => {
  test("requests the sized URL", async () => {
    const api = makeApi();
    routes.push({ match: (url) => url.includes("lh3.googleusercontent.com"), respond: () => protobufResponse(new Uint8Array([9])) });
    const bytes = await api.getThumbnail("KEY", 64, 64);
    expect(Array.from(bytes)).toEqual([9]);
    expect(requests.at(-1)!.url).toBe("https://lh3.googleusercontent.com/p/KEY=w64-h64");
  });

  test("fails on a non 200 status", async () => {
    const api = makeApi();
    routes.push({ match: (url) => url.includes("lh3.googleusercontent.com"), respond: () => new Response("no", { status: 404 }) });
    await expect(api.getThumbnail("KEY")).rejects.toThrow("thumbnail failed: HTTP 404");
  });
});

describe("dedupKeyFromHash", () => {
  test("converts base64 to url safe form", () => {
    expect(dedupKeyFromHash("a+b/c==")).toBe("a-b_c");
  });
});
