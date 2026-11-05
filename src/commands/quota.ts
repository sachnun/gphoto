import { resolveAuthData } from "../core/config.ts";
import { request } from "../core/http.ts";
import { createApi } from "../cli/api-factory.ts";
import { authDataArg, jsonArg, proxyArg } from "../cli/common.ts";
import { command, str } from "../cli/command.ts";
import { dim, fail, green, humanBytes, progressBar, table } from "../lib/ui.ts";

export const quotaCommand = command({
  meta: { name: "quota", description: "Show Google storage usage" },
  args: {
    json: jsonArg,
    authData: authDataArg,
    proxy: proxyArg,
  },
  async run({ args }) {
    const auth = await resolveAuthData(str(args.authData));
    const api = createApi({ authData: auth.authData, proxy: str(args.proxy) });

    const token = await api.gmsAccessTokenFor("oauth2:https://www.googleapis.com/auth/drive.readonly");
    const response = await request("https://www.googleapis.com/drive/v3/about?fields=storageQuota,user", {
      headers: { Authorization: `Bearer ${token}`, "Accept-Encoding": "gzip" },
      proxy: str(args.proxy),
    });

    if (response.status !== 200) fail(`Drive API returned HTTP ${response.status}: ${response.text.slice(0, 200)}`);

    const payload = JSON.parse(response.text) as {
      storageQuota?: { usage?: string; limit?: string; usageInDrive?: string; usageInDriveTrash?: string };
      user?: { emailAddress?: string; displayName?: string };
    };

    const quota = payload.storageQuota ?? {};
    const usage = Number(quota.usage ?? 0);
    const limit = Number(quota.limit ?? 0);
    const inDrive = Number(quota.usageInDrive ?? 0);
    const trash = Number(quota.usageInDriveTrash ?? 0);

    if (args.json) {
      process.stdout.write(`${JSON.stringify({ ...payload, usage, limit }, null, 2)}\n`);
      return;
    }

    process.stdout.write(
      `${table(
        [
          ["account", payload.user?.emailAddress ?? api.email],
          ["usage", humanBytes(usage)],
          ["limit", limit > 0 ? humanBytes(limit) : "unlimited"],
          ["drive", humanBytes(inDrive)],
          ["trash", humanBytes(trash)],
        ],
        ["field", "value"],
      )}\n`,
    );

    if (limit > 0) {
      process.stdout.write(`\n${progressBar(usage, limit, 32)} ${dim(`${((usage / limit) * 100).toFixed(2)}% of ${humanBytes(limit)}`)}\n`);
    }
    process.stdout.write(`${green("note")} Pixel-spoofed uploads report quota_charged_bytes = 0\n`);
  },
});
