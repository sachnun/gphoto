import { createInterface } from "node:readline/promises";
import { buildAuthData, fetchAccessToken, parseAuthData } from "../core/auth.ts";
import { checkin } from "../core/checkin.ts";
import { saveProfile } from "../core/config.ts";
import { extractOauthToken, findCookie, readCookieFile } from "../core/cookies.ts";
import { exchange } from "../core/exchange.ts";
import { command, str } from "../cli/command.ts";
import { bold, cyan, dim, fail, green, red, spinner, table, yellow } from "../lib/ui.ts";

const EMBEDDED_SETUP = "https://accounts.google.com/EmbeddedSetup";

export const loginCommand = command(
  {
    meta: { name: "login", description: "Authenticate and store credentials" },
    args: {
      email: { type: "string", description: "Google account email", valueHint: "address" },
      oauthToken: { type: "string", description: "oauth_token cookie (raw value or whole line)", valueHint: "value" },
      cookies: { type: "string", description: "Netscape cookie jar containing oauth_token", valueHint: "file" },
      androidId: { type: "string", description: "Reuse an existing androidId instead of checking in", valueHint: "hex" },
      authData: { type: "string", description: "Store a ready-made auth data string", valueHint: "string" },
    },
    async run({ args }) {
      const authDataFlag = str(args.authData) ?? process.env.GP_AUTH_DATA?.trim();
      if (authDataFlag) {
        await storeAuthData(authDataFlag);
        return;
      }

      const cookieFile = str(args.cookies);
      if (cookieFile) {
        const cookies = await readCookieFile(cookieFile);
        const token = findCookie(cookies, "oauth_token");
        const email = str(args.email) ?? process.env.GP_EMAIL;
        if (!token) fail(`no oauth_token cookie in ${cookieFile}`);
        if (!email) fail("--email is required with --cookies");
        await runChain(email, token, str(args.androidId));
        return;
      }

      const emailFlag = str(args.email) ?? process.env.GP_EMAIL?.trim();
      const tokenFlag = str(args.oauthToken) ?? process.env.GP_OAUTH_TOKEN?.trim();

      if (emailFlag && tokenFlag) {
        await runChain(emailFlag, tokenFlag, str(args.androidId));
        return;
      }

      await interactiveLogin(emailFlag, str(args.androidId));
    },
  },
  { notes: `${dim("Environment")}  GP_EMAIL, GP_OAUTH_TOKEN, GP_AUTH_DATA` },
);

async function interactiveLogin(prefillEmail: string | undefined, androidId: string | undefined): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    process.stdout.write(
      [
        "",
        bold("Step 1 — open EmbeddedSetup and sign in"),
        `  ${cyan(EMBEDDED_SETUP)}`,
        "",
        dim("  Sign in with the Google account you want to use. The page may finish on a"),
        dim("  blank \"Android Device\" screen; that is expected."),
        "",
        bold("Step 2 — copy the oauth_token cookie"),
        dim("  Chrome/Edge : DevTools (F12) > Application > Cookies > https://accounts.google.com"),
        dim("  Firefox     : DevTools (F12) > Storage > Cookies > https://accounts.google.com"),
        dim("  Safari      : Develop > Show Web Inspector > Storage > Cookies"),
        "",
        dim("  Or export the whole cookie jar and pass it later with --cookies <file>."),
        "",
        yellow("  The oauth_token value is single-use and grants account access. Do not share it."),
        "",
      ].join("\n"),
    );

    const email = (await rl.question(`Email${prefillEmail ? ` [${prefillEmail}]` : ""}: `)).trim() || prefillEmail || "";
    if (!email) fail("email is required");

    const secret = (await rl.question("oauth_token (or auth data string): ")).trim();
    if (!secret) fail("oauth_token is required");

    if (secret.includes("androidId=") && secret.includes("Token=")) {
      await storeAuthData(secret);
      return;
    }

    const token = extractOauthToken(secret);
    if (!token) fail("could not find an oauth_token value in that input");
    await runChain(email, token, androidId);
  } finally {
    rl.close();
  }
}

async function runChain(email: string, oauthToken: string, androidId?: string): Promise<void> {
  let deviceId = androidId;
  const spin = spinner("Registering a device (Android checkin)...");
  try {
    if (!deviceId) deviceId = (await checkin()).androidIdHex;
    spin.stop(`${green("ok")} androidId ${dim(deviceId!)}`);
  } catch (error) {
    spin.stop(`${yellow("warn")} checkin failed`);
    fail(error instanceof Error ? error.message : String(error));
  }

  const spin2 = spinner("Exchanging oauth_token for a master token...");
  let masterToken: string;
  try {
    masterToken = (await exchange(email, oauthToken, deviceId!)).masterToken;
    spin2.stop(`${green("ok")} master token acquired`);
  } catch (error) {
    spin2.stop(`${red("failed")}`);
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("BadAuthentication")) {
      fail(
        [
          "BadAuthentication — the oauth_token was rejected.",
          "",
          `  ${bold("Most likely causes")}`,
          "   - the cookie was already used (each oauth_token works once)",
          "   - the cookie expired (they are short-lived)",
          "   - the cookie was copied incompletely",
          "",
          `  ${bold("Fix")} open ${cyan(EMBEDDED_SETUP)} again, sign in, and copy a fresh`,
          `  oauth_token value. Then re-run ${bold("gphoto login")}.`,
        ].join("\n"),
      );
    }
    fail(message);
  }

  await storeAuthData(buildAuthData({ androidId: deviceId!, email, masterToken }));
}

async function storeAuthData(authData: string): Promise<void> {
  const parsed = parseAuthData(authData);
  const spin = spinner("Verifying credentials against Google...");
  try {
    const token = await fetchAccessToken(parsed);
    spin.stop(`${green("ok")} verified, token valid for ${Math.round((token.expiresAt - Date.now() / 1000) / 60)} min`);
  } catch (error) {
    spin.stop(`${red("failed")}`);
    fail(`credentials rejected: ${error instanceof Error ? error.message : error}`);
  }

  await saveProfile(parsed.email, authData);
  process.stdout.write(
    `\n${table(
      [
        ["account", parsed.email],
        ["androidId", parsed.androidId],
        ["service", parsed.service],
      ],
      ["field", "value"],
    )}\n\n${green("saved")} ${dim("~/.config/gphoto/config.json (mode 600)")}\n`,
  );
}
