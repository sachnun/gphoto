# gphoto

Google Photos CLI.

```bash
npx gphoto login
npx gphoto upload ./anime/ -r --album "Aho Girl"
npx gphoto watch "Aho Girl"
```

## Install

```bash
bun install -g gphoto      # global
npx gphoto --help          # on demand
bun run src/main.ts --help # from source
```

Requires Bun.

## Commands

| Command | Purpose |
|---|---|
| `gphoto login` | Authenticate and store credentials |
| `gphoto logout` | Remove stored credentials |
| `gphoto whoami` | Active account, item counts, quota charged |
| `gphoto upload <path…>` | Upload files or directories |
| `gphoto ls` | List library items |
| `gphoto album` | Create, rename, and manage albums |
| `gphoto watch <target>` | Signed direct-download URLs |
| `gphoto download <target>` | Download originals |
| `gphoto trash` | List, trash, restore, delete |
| `gphoto quota` | Google storage usage |

`<target>` accepts a filename, a media key, or an album title.

## Login

```bash
gphoto login
```

Open <https://accounts.google.com/EmbeddedSetup>, sign in, copy the `oauth_token` cookie from DevTools, and paste it back. Checkin, token exchange, and verification happen automatically.

Non-interactive alternatives:

```bash
gphoto login --email you@gmail.com --cookies ./cookies.txt   # from an exported jar
gphoto login --email you@gmail.com --oauth-token '<cookie>'
gphoto login --auth-data 'androidId=…&app=com.google.android.apps.photos&…'
```

The `oauth_token` cookie is single-use and short-lived, and Google blocks headless browsers on that page, so sign-in must happen in a real browser. Credentials are stored in `~/.config/gphoto/config.json` with mode `600`; `GP_AUTH_DATA` overrides the stored profile.

To keep credentials in a local file instead, copy `.env.example` to `.env` and fill in `GP_AUTH_DATA`. Bun loads `.env` from the current directory only.

## Upload

```bash
gphoto upload video.mkv                        # single file
gphoto upload ./season/ -r --album "Aho Girl"  # directory into a new album
gphoto upload ./season/ -r --album-id AF1Qip…  # append to an existing album
gphoto upload ./x/ -r --album AUTO             # one album per subdirectory
gphoto upload ./x/ --threads 4 --delete-from-host
gphoto upload ./x/ --filter '\.mkv$' --regex
```

Existing files are detected by SHA-1 before upload; `--force` bypasses that check.

| Profile | Flag | Quota |
|---|---|---|
| default | — | not charged |
| saver | `--saver` | not charged, recompressed |
| quota | `--use-quota` | charged |

## Direct links

```bash
gphoto watch "Aho Girl"          # every episode in the album
gphoto watch Otakudesu.net_SxF.S2--01_720p.mp4
```

Signed `video-downloads.googleusercontent.com` URLs need no Google login and return the original file. They expire, so regenerate them.

## Storage model

Album membership is stored as extra media entries that share one `dedup_key` with the canonical item. They are not duplicates and cost no space.

| Action | Effect |
|---|---|
| `trash add <file>` | Trashes every entry sharing the `dedup_key`, including the canonical one |
| `album rm <key>` | Trashes album-only entries; the album itself must be deleted in the web UI |
| `restore` | Restores the entries |

## Testing

```bash
bun test              # full suite
bun test --watch      # re-run on change
bun test --coverage   # line and function coverage
bun run check         # typecheck + tests
```

The suite never touches the network or real credentials. Commands build their client through `src/cli/api-factory.ts`, so tests inject `FakePhotosApi`; `GP_CONFIG_DIR` points the credential store at a temp directory, and `globalThis.fetch` is stubbed per test.

## Notes

- Direct links and cookies are equivalent to account access. Do not share them.
- `gphoto quota` requests a Drive-scoped token under the GMS identity, because the Photos app identity is restricted from that scope.
