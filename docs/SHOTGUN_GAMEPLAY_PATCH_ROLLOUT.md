# Mandatory shotgun gameplay patch rollout

## Scope and binary ownership

ROTK Launcher 1.4.3 ships the shotgun/sprint behavior in a dedicated
open-source `dinput8.dll` proxy. It does not add shotgun code to
`vivoxsdk_x64.dll`; the existing Vivox proxy remains responsible only for voice
compatibility and crouch parity.

Pinned production inputs:

- client build: `h1z1-1.0.326.439939`;
- `H1Z1.exe`: 82,158,616 bytes;
- `H1Z1.exe` SHA-256:
  `5f5a4922b0671e4ed8fd415e753be096ef7a17e360ae80e025f11544c8db9261`;
- PE timestamp: `0x5D56E9AB`;
- PE image size: `0x072B4000`;
- `dinput8.dll`: 24,064 bytes;
- `dinput8.dll` SHA-256:
  `307603aaebdebf52fa55ad0a7337abd785e5190d1bf71e07520240fed51fbd7a`.

The launcher validates both immutable files before changing the installation.
It then atomically installs or repairs `dinput8.dll` during install, adoption
and every launch. It creates no `dinput8.original.dll`; any such unknown DLL
remains visible to integrity attestation.

## Runtime behavior and guards

The proxy loads `%SystemRoot%\System32\dinput8.dll` by absolute path and forwards
all six system exports with their original ordinals. `DllMain` only disables
thread notifications. The bounded patch worker starts after the first forwarded
`DirectInput8Create` call, outside the Windows loader lock.

Before writing memory, the worker verifies the executable size and PE fields,
the complete 23-byte anti-slow signature, the complete 26-byte sprint decision
block and the unchanged `0x07` legacy canary. It revalidates those bytes after
making the two target pages writable and immediately before the first write.
The trampoline is written RW, changed to RX, flushed, and kept only if the
patch readback and original page-protection restoration succeed. Failure takes
the rollback path and never applies offsets to an unknown client.

The resulting behavior is:

- the post-shot shotgun movement branch uses the validated anti-slow condition;
- holding `Shift` across the shot emits a fresh sprint edge and rearms the
  controller latch as soon as the shot state permits it;
- releasing and pressing `Shift` manually no longer resumes faster than simply
  keeping it held.

## Packaging and attestation

The release pipeline rebuilds the DLL twice with Zig 0.15.2, requires identical
outputs, checks its exports and System32 forwarding, compares the source build
with the bundled binary and verifies the SHA sidecar. The DLL is intentionally
not Authenticode-modified after that comparison because signing would change
the byte-exact SHA; the signed installer, GitHub checksums/provenance and server
attestation protect its distribution and installed state.

`dinput8.dll` is a mandatory launcher override in the expected-file manifest.
The asset feed cannot replace it. Enforcement accepts only the root assigned to
the submitted launcher version, and the launch-ticket gate requires exactly
launcher 1.4.3 after cutover.

## Production cutover

1. Merge the launcher PR and build the `v1.4.3` release as a draft.
2. Verify the installer, update metadata, provenance and embedded
   `dinput8.dll` SHA, then publish the launcher update.
3. Publish the dual-root policy: keep the prior root for 1.4.2 challenge
   compatibility and assign the new root to 1.4.3. The ticket endpoint must
   nevertheless require exactly 1.4.3.
4. Stop the old ticket issuer, invalidate every unconsumed pre-cutover ticket,
   deploy the new API/login/zone build, run migrations and restart the servers.
   This removes the otherwise possible five-minute overlap from an old ticket.
5. Verify that 1.4.2 receives the mandatory-update refusal, an altered or absent
   `dinput8.dll` is repaired before measurement, and only the 1.4.3/new-root
   combination obtains and consumes a ticket.

Do not enable the exact 1.4.3 gate before the update is downloadable. For a
rollback, deliberately restore the preceding server policy/gate or publish a
higher launcher containing the fix; never distribute manual DLL replacements
or hide the gameplay DLL from attestation.
