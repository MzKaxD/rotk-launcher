# ROTK Anti-Cheat integration — protocol 2 / agent 0.2.4

The packaged launcher streams SHA-256 over actual `H1Z1.exe`, its own process
executable, physical `resources/app.asar`, and bundled
`resources/fairplay/FairPlay.exe`. It uses Electron `original-fs` for the
physical archive. Development Electron sessions are explicitly unavailable:
no placeholder hash stands in for a packaged component.

The account service decides whether integrity is observational or enforced.
The agent must match its compiled digest before it can execute. The launcher
EXE and ASAR digests are never embedded inside ASAR, which would create a
circular hash. The approved complete tuple lives in the web service.

## Session and collection

The player explicitly accepts versioned conditions in the launcher before play.
An unchecked box explains that senior administrators may request game-window
screenshots and executable names/PIDs during games without another pop-up.
One bounded local receipt is scoped to the actual account key and service
origin, and pins both the document version and its content digest. Changes
require new acceptance. The main process checks the receipt before launching;
legacy optional permissions are never migrated into acceptance.

The authenticated bootstrap echoes the receipt, the server stores it on the
account's session, and each dispatched command carries its accepted version.
The native agent skips its legacy prompt only when both the launcher/server
receipt and this command agree. Missing or mismatching command authorization
cannot collect evidence silently. Older sessions retain their optional prompts.
Release integrity adds only four file hashes; no component paths are transmitted.

Before spawning the game, the launcher sends protocolVersion 2, its real PID,
the four hashes, agent version, short launch ticket and consent to
`POST /api/fairplay/sessions`. Its strict `integrityPolicy` response contains
revision, releaseId, challenge, expected complete tuple and enforcement mode.
In enforce mode all four current hashes must match the selected release before
game spawn. The server selects the active release or one complete previous
release during bounded grace; components from different releases never mix.

After game spawn, scoped token, policy, game PID, launcher PID and measured
game hash reach native stdin only. The agent derives the real paths and
measures files in a background worker. A missing measurement is not a mismatch.
Workers drain their output pipe after child exit, including a write/exit racing
with an empty pipe peek. Hashing is bounded to 45 seconds and repeats every two
minutes, without blocking readiness or heartbeats.

The authenticated launch ticket explicitly advertises ROTK Anti-Cheat's mode. In
observation mode bootstrap outages, missing/corrupt agent files, failed native
startup, agent crashes, missing checks and network interruptions never close
the game. Unverified agent files are not executed. If collection cannot start,
the game remains playable with unavailable coverage. Explicit enforcement
retains admission requirements and supervision; unknown ticket modes default
to enforcement for compatibility with older servers. A live downgrade to
observation is honored by both the native agent and launcher.

Game exit stops the agent. Launcher updates remain refused while the game is
launching/running. The latest session's availability and numeric/hex game exit
code are saved to one bounded local diagnostics file under the existing game
logs directory, with no account IDs, tokens, paths or process inventory.

In explicit enforcement the game may authenticate before native readiness. The server's bounded
initial-integrity wait preserves the requirement for a matching first
heartbeat, without a silent bootstrap exemption. Server gameplay checks and
periodic loss-of-coverage enforcement remain independent.

## Prepare a release and its final manifest

The bundled native executable is a local unsigned candidate, not an approved
production release. Native source/private build files stay outside the public
launcher repository. Distribution contains EXE, checksum, license and player
notice only; no native source or PDB.

1. Build and, for production signing, sign ROTK Anti-Cheat in its private build process.
   Stage those final bytes. Staging executes the trusted build's inert
   `--self-test` and derives its version from the result; it never relabels an
   older executable as a new protocol version.
2. Package the launcher. Its native digest is compiled into ASAR, so the
   packager excludes ROTK Anti-Cheat from subsequent signing. The afterPack check
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
$env:ROTK_FAIRPLAY_RELEASE_LABEL = 'LOCAL-CANDIDATE-ROTK Anti-Cheat-0.2.0'
npm run dist:dir
```

Instead of GAME_EXE, a previously verified base hash may be supplied through
`ROTK_FAIRPLAY_GAME_SHA256` plus required `ROTK_FAIRPLAY_GAME_HASH_SOURCE`.
The script does not pretend to independently verify caller-supplied provenance.

To regenerate after an external signing operation:

```powershell
npm run manifest:fairplay -- --package release/win-unpacked `
  --game 'E:\H1Z1-MODDING\Z1BR\H1Z1.exe' --game-version 2016-livepcmeasured `
  --label LOCAL-CANDIDATE-ROTK Anti-Cheat-0.2.0 --output release/fairplay-release-candidate.json
```

Import JSON has exactly schemaVersion, label, gameVersion, launcherVersion,
agentVersion and hashes. Hash keys are gameSha256, launcherSha256,
launcherAsarSha256, agentSha256. A separate local `.provenance.json` receipt
records origin without uploading developer paths. Outputs must be outside
the package and cannot be symbolic/hard links. The default hook output is
`release/ROTK Anti-Cheat-release-candidate.json`; override with
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
