# gphoto

Google Photos CLI. Uploads keep the original file and don't use your storage quota.

> [!WARNING]
> This is an unofficial tool. It uses a private Google API, which violates Google's terms and can get your account restricted or banned. Try it with a throwaway account first.

## Install

Needs [Bun](https://bun.sh). The package isn't on npm, so install it from GitHub:

```bash
bun install -g github:sachnun/gphoto          # add #v0.1.0 to pin a version
bunx -p github:sachnun/gphoto gphoto --help   # or run without installing
```

## Usage

```bash
gphoto login
gphoto upload ./season/ -r --album "Aho Girl"
gphoto ls
gphoto watch "Aho Girl"
```

## Docs

Tutorials and the full CLI reference are in the [wiki](https://github.com/sachnun/gphoto/wiki).
