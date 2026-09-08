# FairPlay integration — 0.1.0

This change starts the separate native Windows x64 `FairPlay.exe` alongside
`H1Z1.exe`. The game executable must match the **signed base-game manifest**;
local asset-cache entries cannot override that identity. The launcher verifies
FairPlay against a digest compiled into its Electron main process. This is a
release consistency check, not proof that a player's machine is trustworthy.

## Player flow

Before launch, the player sees the collection notice. Optional process lists
and game screenshots default to disabled. Enabling optional requests permits
the agent to ask for separate approval for each request; it does not silently
authorize any future capture. Cancelling the notice cancels launch.

The launcher obtains a short game ticket, starts the account-bound FairPlay
session over HTTPS **before** spawning the game, and passes only a scoped
FairPlay token, PID and expected game hash to the native agent through stdin.
No durable launcher key, token-bearing command line, credential file or
credential environment variable is given to FairPlay. Only `rotk.app` and
`test.rotk.app` are allowed HTTPS origins; redirects are refused.

The launcher waits at most 20 seconds for the agent's ready message with the
expected PID and version. Readiness means initial binding/heartbeat succeeded;
the first full scan may still be pending. A failed start closes the spawned
game. An unexpected agent exit closes that game. A game exit stops the agent.
The backend independently controls admission and periodic stale-session
disconnection through its `ROTK_FAIRPLAY_ENFORCEMENT` setting.

## Native component and source boundary

`resources/fairplay/` contains only the compiled executable, checksum, player
notice and third-party JSON license. The native C++ source and build project are
maintained separately by ROTK and are not part of this launcher repository.
The Electron integration remains in this repository. Compiled native code can
still be disassembled or modified; hiding the source is not a security boundary.

The current included native executable is an **unsigned test build**. Before a
signed release, sign the native executable in its controlled private build
process, then stage that final signed file:

```powershell
node scripts/stage-fairplay.mjs <private-build-path>/FairPlay.exe
npm run verify:fairplay
npm run build
npm run dist:dir
```

Commit the resulting binary, checksum and generated `fairplay-release.ts`
together. Keep the player notice and JSON license in the directory. The
packager intentionally excludes `FairPlay.exe` from later signing: changing
the binary after its digest is compiled would prevent every launch.
`verify-fairplay-package.cjs` checks the packaged binary against the manifest
inside `app.asar` and rejects unexpected FairPlay files. It distributes no
native source or PDB. Bump the launcher release version before publishing a
new tag; this implementation branch retains the fetched main version.

## Backend release order

Deploy the server/web changes and migration `0035_fairplay.sql` to staging
before trying this launcher. Configure legitimate module hashes using the
server's signed FairPlay policy publisher. Start with backend observation
mode, test normal game sessions, return-to-menu relogin, optional consent,
DirectX screenshot support, network outages, killed agents and false positives.
Enable enforcement only after staging acceptance. This launcher does not
silently bypass FairPlay if the endpoint or verified manifest is unavailable.

## Verified locally

The launcher suite covers integrity tampering, exact HTTPS origins, scoped
stdin credentials, bootstrap refusal/oversize, readiness and agent/game
supervision. Native self-tests do not collect data. Browser tests use synthetic
sessions. A successful build is not evidence of reliable capture on the real
DirectX game or resistance to kernel-level cheats; those remain separate
acceptance and security-review tasks.
