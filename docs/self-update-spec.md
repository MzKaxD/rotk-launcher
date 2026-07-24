# Spec — Launcher self-update via GitHub Releases

Issue: [#1](https://github.com/MzKaxD/rotk-launcher/issues/1)

## 1. Approach

Use **`electron-updater`** (electron-builder ecosystem) with the GitHub provider, fully
user-driven (`autoDownload = false`, no install-on-quit). Rationale:

- Releases already publish `.exe` + `.blockmap` → differential updates for free.
- `verifyUpdateCodeSignature: true` is already enabled: a downloaded binary is rejected
  if its Authenticode signature does not match the declared publisher.
- CI creates releases as **drafts**: electron-updater ignores drafts, so publishing the
  release is what activates the update. Good rollout control.
- Rejected alternative: manual GitHub API check + download + run installer — reimplements
  signature verification, differential download and resume, for zero gain.

## 2. Configuration changes

- **package.json**: add the `electron-updater` dependency; in `build`: add
  `publish: [{ "provider": "github", "owner": "MzKaxD", "repo": "rotk-launcher" }]`
  (required to generate the embedded `app-update.yml` and the `latest.yml` next to the
  installer) and set `win.publisherName` to the certificate CN (required by the
  signature verification).
- **.github/workflows/release.yml**: add `release/latest.yml` to the uploaded workflow
  artifacts **and** to the files passed to `gh release create` — without it the client
  cannot resolve the latest version.

## 3. New service: `electron/services/launcher-update.ts`

Wrapper around `autoUpdater` with the updater **injected** (like the other services, for
unit testing). State machine exposed through the snapshot:

```
idle → checking → update-available → downloading → downloaded
                ↘ up-to-date            ↘ error (non-blocking)
```

- `check()`: at startup (after the initial `broadcastSnapshot`, non-blocking) then every
  4 hours; a network failure silently returns to `idle`.
- `download()`: only on user action; publishes progress into the snapshot.
- `install()`: `quitAndInstall()` only on user action, refused while the game is running
  (`phase === "running" | "launching"`).
- Disabled when `!app.isPackaged` (dev); drafts and pre-releases are ignored (native
  behavior).

## 4. Contracts & IPC (`shared/contracts.ts`)

- `LauncherSnapshot.launcherUpdate: { status, availableVersion: string | null,
  progressPercent: number | null, error: string | null }`.
- Three channels: `launcher:update-check`, `launcher:update-download`,
  `launcher:update-install` (+ the matching `RotkLauncherApi` methods), all going
  through `trustedHandler`.

## 5. UI (renderer)

- Discreet banner in the footer/window chrome: “Update vX.Y.Z available” + **Update**
  button → progress bar → **Restart to install**.
- Never a blocking modal; the user can decline (the banner stays, re-offered on next
  startup).
- en/fr strings added to both existing i18n layers.

## 6. Tests (`tests/launcher-update.test.ts`)

Injected fake updater: full state transitions, silent network failure, install refused
while the game is running, no download without user action, progress event mapping.

## 7. Out of scope (v1)

Beta/pre-release channel, rollback, game-client updates (separate topic),
auto-install-on-quit.
