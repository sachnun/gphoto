import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface StoredProfile {
  email: string;
  authData: string;
  createdAt: string;
}

export interface StoredConfig {
  version: 1;
  activeEmail?: string;
  profiles: Record<string, StoredProfile>;
}

export function configDir(): string {
  const override = process.env.GP_CONFIG_DIR?.trim();
  return override ? override : join(homedir(), ".config", "gphoto");
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

export function cacheDirFor(email: string): string {
  return join(configDir(), "cache", email);
}

export async function loadConfig(): Promise<StoredConfig> {
  try {
    const raw = await readFile(configPath(), "utf8");
    const parsed = JSON.parse(raw) as StoredConfig;
    if (!parsed.profiles) parsed.profiles = {};
    return parsed;
  } catch {
    return { version: 1, profiles: {} };
  }
}

export async function saveConfig(config: StoredConfig): Promise<void> {
  const path = configPath();
  await mkdir(configDir(), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

export async function saveProfile(email: string, authData: string): Promise<void> {
  const config = await loadConfig();
  config.profiles[email] = { email, authData, createdAt: new Date().toISOString() };
  config.activeEmail = email;
  await saveConfig(config);
}

export async function resolveAuthData(explicit?: string): Promise<{ authData: string; email: string; source: string }> {
  if (explicit) {
    return { authData: explicit, email: extractEmail(explicit), source: "flag" };
  }

  const env = process.env.GP_AUTH_DATA?.trim();
  if (env) {
    return { authData: env, email: extractEmail(env), source: "GP_AUTH_DATA" };
  }

  const config = await loadConfig();
  const active = config.activeEmail ? config.profiles[config.activeEmail] : undefined;
  if (active) {
    return { authData: active.authData, email: active.email, source: "config" };
  }

  throw new Error("no credentials: run `gphoto login` first, or set GP_AUTH_DATA");
}

export function extractEmail(authData: string): string {
  const email = new URLSearchParams(authData.trim()).get("Email");
  if (!email) throw new Error("auth data has no Email field");
  return email;
}
