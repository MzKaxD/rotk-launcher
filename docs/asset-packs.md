# Asset packs — publishing custom assets through the dedicated GitHub repo

Issue: [#10](https://github.com/MzKaxD/rotk-launcher/issues/10)

## 1. Overview

The launcher synchronizes custom ROTK assets from a dedicated GitHub repository
(`h1z1rotk/assets`) before every launch and right after an installation, without
requiring a launcher release. The pipeline is implemented by
`electron/services/asset-sync.ts` (+ `electron/services/zip-archive.ts`):

1. Fetch `feed.json` from
   `https://raw.githubusercontent.com/h1z1rotk/assets/main/feed.json`
   (HTTPS only, 10 s timeout, 1 MB cap).
2. Diff against the local state (`asset-state.v1.json` in the launcher `userData`):
   an asset is (re)installed when it is new, its `version`/`sha256` changed, or one of
   its installed files is missing (the **Verify files** action additionally re-hashes
   every installed file).
3. Download into `userData/asset-cache/` (a cached pack with the right SHA-256 is
   reused without any network call), verify the streamed SHA-256 against the manifest,
   then install atomically (staging file + `rename`) into the ROTK installation.
4. Client files overwritten for the first time are backed up under
   `userData/asset-backups/` — **Restore vanilla client** puts them back and deletes
   everything the feed added.
5. Assets removed from the manifest are uninstalled on the next sync (backup restored
   or file deleted).

A feed that cannot be fetched **never blocks the game** once a first sync completed:
the launcher shows a warning and starts with the assets already on disk. Only a first
sync that never completed is blocking (players can also disable the sync entirely in
the setup panel — offline/dev mode).

## 2. The `h1z1rotk/assets` repository

- `feed.json` at the root of `main` — the always-current manifest.
- Binaries attached as **GitHub Release assets** (never committed): stable URLs, no
  git size limits.
- Publishing an update = upload a release (`assets-vX.Y.Z`) + one commit updating
  `feed.json` (URLs + SHA-256 + sizes + bumped `packVersion`).

## 3. Manifest format

```json
{
  "manifestVersion": 1,
  "packVersion": "1.0.0",
  "assets": [
    {
      "name": "rotk-ui-pack",
      "version": "1.0.0",
      "url": "https://github.com/h1z1rotk/assets/releases/download/assets-v1.0.0/rotk-ui-pack.zip",
      "sha256": "<sha256 of the zip>",
      "size": 12345678,
      "installPath": ".",
      "type": "zip"
    },
    {
      "name": "rotk-sound-bank",
      "version": "1.0.0",
      "url": "https://github.com/h1z1rotk/assets/releases/download/assets-v1.0.0/rotk-sounds.pack",
      "sha256": "<sha256 of the file>",
      "size": 4567890,
      "installPath": "Resources/Assets/rotk-sounds.pack",
      "type": "file"
    }
  ]
}
```

- `installPath` is **relative to the ROTK installation root**, `/`-separated.
  `type: "zip"` extracts the archive at `installPath` (`"."` = root);
  `type: "file"` copies the payload as-is to `installPath`.
- `sha256` is the hash of the downloaded file (before extraction), `size` its exact
  byte count (enforced during the stream).
- `version` drives re-installation: bump it (or just change `sha256`) whenever the
  payload changes. `packVersion` is informational and shown in the launcher UI.

## 4. Validation rules (enforced by the launcher)

The launcher refuses the whole pack if any rule fails — nothing is written halfway:

- URLs: `https://` only, hosts limited to `github.com` / `raw.githubusercontent.com`
  (redirects may only land on `objects.githubusercontent.com` /
  `release-assets.githubusercontent.com`).
- Paths (manifest `installPath` **and** every zip entry): no absolute paths, no `..`,
  no `\`, no alternate data streams (`:`), no Windows reserved device names, no
  trailing dots/spaces, no `steam`/`steamapps`/`steamlibrary`/`common`/`battleye`
  segments.
- Protected targets: `H1Z1.exe`, `ClientConfig.ini`, `steam_api64.dll`,
  `.rotk-installation.json` and any `*.original.*` backup can never be overwritten.
- **No executable content**: `.exe`, `.dll`, `.sys`, `.bat`, `.cmd`, `.ps1`, `.msi`,
  `.scr`, `.com`, `.vbs`, `.lnk` are rejected. Sensitive binaries stay in the signed
  launcher (`resources/patches/`), never in the feed.
- Zips: plain store/deflate central-directory archives only (no zip64, no encryption),
  ≤ 20 000 entries, per-entry and total uncompressed sizes are bounded and enforced
  during inflation (zip-bomb guard).
- Sizes: ≤ 512 MB per asset, ≤ 2 GB total.

## 5. Publishing checklist

1. Build the payloads (`.zip` for trees, plain files otherwise). Avoid blocked
   extensions and protected paths (section 4).
2. Compute for each payload: `sha256` (`Get-FileHash -Algorithm SHA256 <file>`) and
   size in bytes.
3. Create the GitHub release `assets-vX.Y.Z` on `h1z1rotk/assets` and attach the payloads.
4. Update `feed.json` on `main`: new URLs, `sha256`, `size`, bumped `version` for the
   changed assets and a bumped `packVersion`.
5. Done — launchers pick the update up at the next launch. To roll back, point
   `feed.json` back to the previous release assets.

## 6. Launcher UX

- The pre-launch sync reports progress in the footer (`UPDATING ASSETS — n%`);
  the setup panel shows the pack version, warnings, a **Verify files** (repair) and a
  **Restore vanilla client** action, plus the automatic-sync toggle (persisted in
  `config.v1.json` as `assetSyncEnabled`).
