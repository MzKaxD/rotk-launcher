# FairPlay integration — protocol 2 / agent 0.2.0

The packaged launcher streams SHA-256 over actual `H1Z1.exe`, its own process
executable, physical `resources/app.asar`, and bundled
`resources/fairplay/FairPlay.exe`. It uses Electron `original-fs` for the
physical archive. Development Electron sessions are explicitly unavailable:
no placeholder hash stands in for a packaged component.

The game must still match the signed base-game manifest; local asset state
cannot override it. The agent must match its compiled digest. The launcher
EXE and ASAR digests are never embedded inside ASAR, which would create a
circular hash. The approved complete tuple lives in the web service.

## Session and collection

The player accepts the notice before launch. Process inventory and game
screenshots default to disabled; when enabled, each request still requires
separate local consent. Release integrity adds only four file hashes; no
component paths are transmitted.

Before spawning the game, the launcher sends protocolVersion 2, its real PID,
the four hashes, agent version, short launch ticket and consent to
`POST /api/fairplay/sessions`. Its strict `integrityPolicy` response contains
revision, releaseId, challenge, expected complete tuple and enforcement mode.
In enforce mode all four current hashes must match the selected release before
game spawn. The server selects the active release or one complete previous
release during bounded grace; components from different releases never mix.

After game spawn, scoped token, policy, game PID, launcher PID and signed-base
game hash reach native stdin only. The agent independently derives the real
paths and measures the files before its first integrity heartbeat. Readiness
must arrive within 20 seconds. Failed start or unexpected agent exit closes
the game; game exit stops the agent. Launcher updates are refused while the
game is launching/running; native file handles prevent ordinary component
updates during the session.

The game may authenticate before native readiness. The server's bounded
initial-integrity wait preserves the requirement for a matching first
heartbeat, without a silent bootstrap exemption. Server gameplay checks and
periodic loss-of-coverage enforcement remain independent.

## Prepare a release and its final manifest

The bundled native executable is a local unsigned candidate, not an approved
production release. Native source/private build files stay outside the public
launcher repository. Distribution contains EXE, checksum, license and player
notice only; no native source or PDB.

1. Build and, for production signing, sign FairPlay in its private build process.
   Stage those final bytes. Staging executes the trusted build's inert
   `--self-test` and derives its version from the result; it never relabels an
   older executable as a new protocol version.
2. Package the launcher. Its native digest is compiled into ASAR, so the
   packager excludes FairPlay from subsequent signing. The afterPack check
   verifies that digest and the native-directory allowlist.
3. Generate the four-component manifest after all signing, resource edits,
   fuse changes and packaging. The `afterAllArtifactBuild` hook does this,
   including for `--dir`, with explicit game source and version.
4. Import the JSON as a draft in Admin Studio, check the complete tuple, then
   explicitly activate it. No script publishes or activates a release policy.
   Any subsequent signature or byte change requires regenerating the tuple.

Example local candidate:

```powershell
node scripts/stage-fairplay.mjs <trusted-private-build>/FairPlay.exe
$env:ROTK_FAIRPLAY_GAME_EXE = 'E:\H1Z1-MODDING\Z1BR\H1Z1.exe'
$env:ROTK_FAIRPLAY_GAME_VERSION = '2016-livepcmeasured'
$env:ROTK_FAIRPLAY_RELEASE_LABEL = 'LOCAL-CANDIDATE-FairPlay-0.2.0'
npm run dist:dir
```

Instead of GAME_EXE, a previously verified base hash may be supplied through
`ROTK_FAIRPLAY_GAME_SHA256` plus required `ROTK_FAIRPLAY_GAME_HASH_SOURCE`.
The script does not pretend to independently verify caller-supplied provenance.

To regenerate after an external signing operation:

```powershell
npm run manifest:fairplay -- --package release/win-unpacked `
  --game 'E:\H1Z1-MODDING\Z1BR\H1Z1.exe' --game-version 2016-livepcmeasured `
  --label LOCAL-CANDIDATE-FairPlay-0.2.0 --output release/fairplay-release-candidate.json
```

Import JSON has exactly schemaVersion, label, gameVersion, launcherVersion,
agentVersion and hashes. Hash keys are gameSha256, launcherSha256,
launcherAsarSha256, agentSha256. A separate local `.provenance.json` receipt
records origin without uploading developer paths. Outputs must be outside
the package and cannot be symbolic/hard links. The default hook output is
`release/FairPlay-release-candidate.json`; override with
`ROTK_FAIRPLAY_RELEASE_MANIFEST`.

## Electron restrictions and validation

Packaged Electron disables RunAsNode, Node option environment variables and
CLI inspect arguments. OnlyLoadAppFromAsar and embedded ASAR integrity checking
are enabled. The app uses no child_process.fork dependency. Final manifest
generation reads actual executable fuse bits and refuses missing restrictions.
Electron-builder flips fuses before signing; the manifest hook runs after both.

References: [Electron fuses](https://www.electronjs.org/docs/latest/tutorial/fuses)
and [electron-builder integration](https://www.electron.build/docs/tutorials/adding-electron-fuses/).
These close ordinary ASAR fallback and Node entry paths. They cannot prove
that an attacker controlling the OS cannot forge clients, change memory or
spoof telemetry. Authoritative gameplay checks and review remain necessary.

Tests cover tuple/policy parsing, no development substitution, actual streamed
component changes, scoped IPC and consent, bootstrap failures/oversize,
supervision, actual Electron fuse bits, post-signing-style byte mutation,
native pin drift and linked report-output rejection. Local success does not
establish real Direct3D capture compatibility or kernel-level resistance.
