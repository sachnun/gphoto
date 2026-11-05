import { configPath, loadConfig, resolveAuthData } from "../core/config.ts";
import { parseSnapshot } from "../core/media.ts";
import { createApi } from "../cli/api-factory.ts";
import { authDataArg, proxyArg } from "../cli/common.ts";
import { command, str } from "../cli/command.ts";
import { bold, dim, green, humanBytes, table, yellow } from "../lib/ui.ts";

export const whoamiCommand = command({
  meta: { name: "whoami", description: "Show the active account and quota status" },
  args: { authData: authDataArg, proxy: proxyArg },
  async run({ args }) {
    const auth = await resolveAuthData(str(args.authData));
    const api = createApi({ authData: auth.authData, proxy: str(args.proxy) });
    const snapshot = parseSnapshot(await api.getLibraryState());

    const canonical = snapshot.items.filter((item) => item.isCanonical);
    const bytes = canonical.reduce((sum, item) => sum + item.sizeBytes, 0);
    const charged = snapshot.items.reduce((sum, item) => sum + item.quotaChargedBytes, 0);

    process.stdout.write(
      `${table(
        [
          ["account", bold(api.email)],
          ["source", auth.source],
          ["androidId", api.auth.androidId],
          ["items", `${snapshot.items.length} (${canonical.length} canonical)`],
          ["albums", String(snapshot.albums.length)],
          ["storage", humanBytes(bytes)],
          ["quota charged", charged === 0 ? green("0 B") : yellow(humanBytes(charged))],
          ["config", configPath()],
        ],
        ["field", "value"],
      )}\n`,
    );

    if (charged === 0 && canonical.length > 0) {
      process.stdout.write(`\n${green("Pixel XL profile active")} ${dim("— uploads are not charged to your quota")}\n`);
    }
  },
});

export const logoutCommand = command({
  meta: { name: "logout", description: "Remove stored credentials" },
  args: {
    email: { type: "string", description: "Account email (default: active profile)", valueHint: "address" },
  },
  async run({ args }) {
    const config = await loadConfig();
    const email = str(args.email) ?? config.activeEmail;
    if (!email || !config.profiles[email]) {
      process.stdout.write(`${dim("no stored profile to remove")}\n`);
      return;
    }
    delete config.profiles[email];
    const remaining = Object.keys(config.profiles);
    config.activeEmail = remaining[0];
    const { saveConfig } = await import("../core/config.ts");
    await saveConfig(config);
    process.stdout.write(`${green("removed")} ${email}\n`);
  },
});
