import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cacheDirFor, configDir, configPath, extractEmail, loadConfig, resolveAuthData, saveConfig, saveProfile } from "../../src/core/config.ts";
import { AUTH_DATA } from "../fixtures/library.ts";

let dir: string;
const previous = { auth: process.env.GP_AUTH_DATA, config: process.env.GP_CONFIG_DIR };

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gphoto-config-"));
  process.env.GP_CONFIG_DIR = dir;
  delete process.env.GP_AUTH_DATA;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  if (previous.auth === undefined) delete process.env.GP_AUTH_DATA;
  else process.env.GP_AUTH_DATA = previous.auth;
  if (previous.config === undefined) delete process.env.GP_CONFIG_DIR;
  else process.env.GP_CONFIG_DIR = previous.config;
});

describe("paths", () => {
  test("honours GP_CONFIG_DIR", () => {
    expect(configDir()).toBe(dir);
    expect(configPath()).toBe(join(dir, "config.json"));
    expect(cacheDirFor("a@b.c")).toBe(join(dir, "cache", "a@b.c"));
  });
});

describe("loadConfig", () => {
  test("returns an empty profile map when the file is missing", async () => {
    const config = await loadConfig();
    expect(config).toEqual({ version: 1, profiles: {} });
  });

  test("returns an empty profile map for invalid JSON", async () => {
    await writeFile(join(dir, "config.json"), "not json");
    expect(await loadConfig()).toEqual({ version: 1, profiles: {} });
  });

  test("repairs a config without a profiles map", async () => {
    await writeFile(join(dir, "config.json"), JSON.stringify({ version: 1 }));
    expect((await loadConfig()).profiles).toEqual({});
  });
});

describe("saveConfig", () => {
  test("writes readable JSON with mode 600", async () => {
    await saveConfig({ version: 1, activeEmail: "a@b.c", profiles: {} });
    const raw = await readFile(join(dir, "config.json"), "utf8");
    expect(JSON.parse(raw)).toEqual({ version: 1, activeEmail: "a@b.c", profiles: {} });
    const mode = (await stat(join(dir, "config.json"))).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

describe("saveProfile", () => {
  test("stores the profile and makes it active", async () => {
    await saveProfile("test@example.com", AUTH_DATA);
    const config = await loadConfig();
    expect(config.activeEmail).toBe("test@example.com");
    expect(config.profiles["test@example.com"]!.authData).toBe(AUTH_DATA);
    expect(config.profiles["test@example.com"]!.createdAt).toBeString();
  });

  test("keeps previously saved profiles", async () => {
    await saveProfile("a@b.c", AUTH_DATA);
    await saveProfile("d@e.f", AUTH_DATA);
    const config = await loadConfig();
    expect(Object.keys(config.profiles).sort()).toEqual(["a@b.c", "d@e.f"]);
    expect(config.activeEmail).toBe("d@e.f");
  });
});

describe("extractEmail", () => {
  test("reads the Email field", () => {
    expect(extractEmail(AUTH_DATA)).toBe("test@example.com");
  });

  test("throws when the field is absent", () => {
    expect(() => extractEmail("androidId=abc")).toThrow("auth data has no Email field");
  });
});

describe("resolveAuthData", () => {
  test("prefers an explicit value", async () => {
    const resolved = await resolveAuthData(AUTH_DATA);
    expect(resolved).toEqual({ authData: AUTH_DATA, email: "test@example.com", source: "flag" });
  });

  test("falls back to GP_AUTH_DATA", async () => {
    process.env.GP_AUTH_DATA = AUTH_DATA;
    expect((await resolveAuthData()).source).toBe("GP_AUTH_DATA");
  });

  test("ignores a blank GP_AUTH_DATA", async () => {
    process.env.GP_AUTH_DATA = "   ";
    await expect(resolveAuthData()).rejects.toThrow("no credentials");
  });

  test("reads the active stored profile", async () => {
    await saveProfile("test@example.com", AUTH_DATA);
    const resolved = await resolveAuthData();
    expect(resolved.source).toBe("config");
    expect(resolved.email).toBe("test@example.com");
  });

  test("throws when nothing is configured", async () => {
    await expect(resolveAuthData()).rejects.toThrow("no credentials: run `gphoto login` first");
  });
});
