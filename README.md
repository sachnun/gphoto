# gphoto

Google Photos CLI. Uploads originals without using storage quota.

## Install

The package is not on npm. Install from GitHub with Bun; `npx gphoto` runs an unrelated registry package and the entry point is TypeScript.

```bash
bun install -g github:sachnun/gphoto          # add #v0.1.0 to pin a tag
bunx -p github:sachnun/gphoto gphoto --help   # on demand
git clone https://github.com/sachnun/gphoto && cd gphoto && bun install
```

## Commands

| Command | Purpose |
|---|---|
| `gphoto login`, `logout` | Store or remove credentials |
| `gphoto whoami` | Active account, item counts, quota charged |
| `gphoto upload <path…>` | Upload files or directories |
| `gphoto ls` | List library items |
| `gphoto album` | Create, rename, and manage albums |
| `gphoto watch <target>` | Print signed download URLs |
| `gphoto download <target>` | Download originals |
| `gphoto trash` | List, trash, restore, and delete items |
| `gphoto quota` | Show Google storage usage |

`<target>` is a filename, a media key, or an album title.

## Login

```bash
gphoto login
```

Sign in at <https://accounts.google.com/EmbeddedSetup> in a real browser, since Google blocks headless ones there. Copy the `oauth_token` cookie from DevTools and paste it at the prompt. Each cookie works once. Other forms skip the prompt:

```bash
gphoto login --email you@gmail.com --cookies ./cookies.txt
gphoto login --email you@gmail.com --oauth-token '<cookie>'
gphoto login --email you@gmail.com --auth-data 'androidId=…&app=com.google.android.apps.photos&…'
```

Credentials go to `~/.config/gphoto/config.json` (mode `600`). `GP_AUTH_DATA` overrides the stored profile, and a `.env` in the current directory works too.

## Upload

```bash
gphoto upload video.mkv
gphoto upload ./season/ -r --album "Aho Girl"   # new album
gphoto upload ./season/ -r --album-id AF1Qip…   # existing album
gphoto upload ./x/ -r --album AUTO              # one album per subdirectory
gphoto upload ./x/ --threads 4 --delete-from-host
gphoto upload ./x/ --filter '\.mkv$' --regex
```

gphoto hashes each file with SHA-1 and skips what the library already has. `--force` ignores that check.

| Profile | Flag | Quota |
|---|---|---|
| default | none | not charged |
| saver | `--saver` | not charged, recompressed |
| quota | `--use-quota` | charged |

## Direct links

```bash
gphoto watch "Aho Girl"
```

`video-downloads.googleusercontent.com` links need no login and serve the original file. Expired links stop working; run `watch` again.

## Storage model

An album member is a second media entry sharing a `dedup_key` with the canonical item. It is not a duplicate and takes no extra space.

| Action | Effect |
|---|---|
| `trash add <file>` | Trashes every entry with that `dedup_key`, canonical included |
| `album rm <key>` | Trashes album-only entries; delete the album in the web UI |
| `restore` | Brings the trashed entries back |

## Testing

```bash
bun test
bun run check   # typecheck and tests
```

Tests never touch the network or real credentials: `src/cli/api-factory.ts` lets them inject `FakePhotosApi`, `GP_CONFIG_DIR` points at a temp directory, and each test stubs `fetch`.

## Notes

- A direct link or a cookie gives full access to the account.
- `gphoto quota` asks for a Drive-scoped token under the GMS identity, because the Photos identity cannot request that scope.
