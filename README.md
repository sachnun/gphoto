# gphoto

A command-line tool for Google Photos: upload, browse, download, and manage your photos and videos. Uploads keep the original file and don't use your storage quota.

> [!WARNING]
> This is an unofficial tool. It uses a private Google API, which violates Google's terms and can get your account restricted or banned. Try it with a throwaway account first.

## Install

Needs [Bun](https://bun.sh). The package isn't on npm, so install it from GitHub:

```bash
bun install -g github:sachnun/gphoto          # add #v0.1.0 to pin a version
bunx -p github:sachnun/gphoto gphoto --help   # or run without installing
```

## Getting started

```bash
gphoto login          # sign in (see below)
gphoto whoami         # check the account and storage used
gphoto upload photo.jpg
```

## Commands

| Command | What it does |
|---|---|
| `gphoto login` / `logout` | Save or remove your account |
| `gphoto whoami` | Show the current account and storage |
| `gphoto upload <path…>` | Upload files or folders |
| `gphoto ls` | List your library |
| `gphoto album` | Create and manage albums |
| `gphoto watch <target>` | Print download links |
| `gphoto download <target>` | Download original files |
| `gphoto trash` | Trash, restore, or delete items |
| `gphoto quota` | Show Google storage usage |

A `<target>` is a filename, a media key, or an album title.

## Login

```bash
gphoto login
```

Open <https://accounts.google.com/EmbeddedSetup> in a normal browser, sign in, then copy the `oauth_token` cookie from DevTools and paste it at the prompt. Each cookie works only once.

You can also pass credentials directly:

```bash
gphoto login --email you@gmail.com --cookies ./cookies.txt
gphoto login --email you@gmail.com --oauth-token '<cookie>'
```

Credentials are saved to `~/.config/gphoto/config.json` with mode `600`.

## Upload

```bash
gphoto upload video.mkv
gphoto upload ./season/ -r --album "Aho Girl"   # create an album
gphoto upload ./season/ -r --album-id AF1Qip…   # add to an existing album
gphoto upload ./x/ -r --album AUTO              # one album per subfolder
gphoto upload ./x/ --threads 4 --delete-from-host
```

Files already in your library are skipped (checked by SHA-1). Use `--force` to upload anyway.

| Mode | Flag | Storage quota |
|---|---|---|
| default | none | not charged |
| saver | `--saver` | not charged, file is recompressed |
| quota | `--use-quota` | charged |

Other useful flags: `--filter 'mp4$'` (with `--regex`), `--json` for scripted output, `--proxy`, `--timeout`.

## Direct links

```bash
gphoto watch "Aho Girl"
```

The links need no login and serve the original file. They expire, so run `watch` again if one stops working.

## Development

```bash
bun test
bun run check   # typecheck + tests
```

Tests never touch the network or your real account.
