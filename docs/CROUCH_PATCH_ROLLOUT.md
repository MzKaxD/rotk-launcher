# Mandatory crouch patch rollout

## Scope

ROTK Launcher 1.4.0 ships the ADS-safe crouch parity v11 hook inside the
open-source Vivox 5 compatibility proxy. The launcher does not patch
`H1Z1.exe` on disk.

The supported client is pinned to:

- build: `h1z1-1.0.326.439939`;
- `H1Z1.exe` size: `82158616` bytes;
- `H1Z1.exe` SHA-256:
  `5F5A4922B0671E4ED8FD415E753BE096EF7A17E360AE80E025F11544C8DB9261`;
- Vivox+crouch proxy SHA-256:
  `159A7F24CA2C7E99F3EA17B9A180DAC593ED2FB92B1DB2C10D9B4EA1AE8EDEE8`.

The native hook also validates the BR1315 PE timestamp, image size and target
machine-code signatures before modifying memory. An unknown client build is
rejected by the launcher before any client file is changed.

## Enforced client state

Installation, adoption and every launch enforce all of the following:

1. preserve the verified stock Vivox 4 DLL as
   `vivoxsdk_x64.original.dll`;
2. install and verify the official Vivox 5 runtime;
3. install and verify the ROTK Vivox+crouch proxy;
4. write the exact `rotk-crouch-parity.ini` production marker;
5. repair missing, stale or corrupt proxy/runtime/marker files;
6. fail the launch if the final state cannot be verified.

Replacement files use a same-directory temporary file followed by an atomic
rename. A verified legacy backup named `vivoxsdk_x64_original.dll` is
migrated to the canonical name without overwriting the only known-good stock
copy.

The launcher repairs the patch once before integrity attestation, so the first
launch after an update cannot attest the previous proxy, and verifies it again
immediately before spawning H1Z1.

## Production marker

```ini
mode=patch-v2
animation=v11-ads-safe-pose-only-js-sine-idle400-200-move250
cameraScalePitch=disabled
h1z1Sha256=5F5A4922B0671E4ED8FD415E753BE096EF7A17E360AE80E025F11544C8DB9261
proxySha256=159A7F24CA2C7E99F3EA17B9A180DAC593ED2FB92B1DB2C10D9B4EA1AE8EDEE8
```

The direct camera hook must remain disabled. The v11 hook replaces only the
trajectory/transform weight and preserves Morpheme event, sampled-event and
sync-event weights, which is the ADS-safe behavior validated in the client.

## Release order

1. Merge the launcher changes into `main`.
2. Publish the signed `v1.4.0` launcher release and its update metadata.
3. Verify an existing 1.3.0 installation upgrades and repairs an old proxy.
4. Verify one fresh Steam-copy installation and one adopted isolated client.
5. Only after the update is publicly available, set the account/ticket
   service minimum launcher version to `1.4.0`.

The last step is what makes the patch mandatory for every server-authenticated
player. Enabling the server gate before the release is downloadable would
block all players.

## Release gates

- `npm ci`;
- `npm audit --omit=dev --audit-level=high`;
- `npm run dist`;
- two proxy builds from different output paths must have the same SHA-256;
- all unit tests must pass;
- the packaged proxy hash must match the source rebuild and sidecar;
- migration from the legacy backup name and repair after deliberate corruption
  must pass on a copy of the real BR1315 files;
- a runtime smoke load must succeed with the official Vivox 5 DLL present.

## Rollback

Do not remove or overwrite the verified stock backup. If a production-only
regression appears, publish a higher launcher version containing the corrected
proxy, verify its new hash throughout CI/release/attestation, and move the
server minimum to that version. Do not ask players to manually replace DLLs or
disable the marker.
