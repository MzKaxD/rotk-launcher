# Player Voice Volume

The BR1315 audio options shipped with `vchat.receive_volume` inside a disabled
XML comment. The launcher already bridges legacy speaker-volume requests to
Vivox 5, but that change alone does not expose a control in the game's menu.

This recipe enables **Player Voice Volume** under **Audio → Voice Chat**, before
the Voice Chat on/off switch. The same Audio section is used from the main menu
and from the in-match Escape settings menu. Its native callbacks are
`GetVoiceReceiveVolume` / `SetVoiceReceiveVolume`, with a 0–100 range, and the
client saves the value in `[Voice] ReceiveVolume`. Zero mutes received voices.
The player's microphone and the game's master/effects volumes are independent.

## Rebuild and validation

```powershell
npm run test:assets:voice-volume
npm run assets:prepare-voice-volume -- <current-client> <feed.json> <asset-payloads.v1.json> <new-output-directory> <X.Y.Z>
```

The optional `ROTK_VOICE_TEST_CLIENT` environment variable enables the additional
test against an installed BR1315 data pack. Never commit that installation.

The recipe verifies source sizes and hashes against the supplied current
manifest. It then changes only the options XML and code-string mapping table in
`data_x64_0.pack2`; the 502 other entries are preserved. The XML source is pinned
by SHA-256. Unknown options revisions and reused string IDs fail closed.

Code-string names `UI.ROTK.VoiceReceiveVolume` and
`UI.ROTK.VoiceReceiveVolumeDesc` map to text IDs 9105201 and 9105202. English uses
“Player Voice Volume”; French has a translation and other client languages use
the English fallback for these two new strings. Every existing locale row is
preserved, including multiline UTF-8 text. Data offsets, counts and checksums
are rebuilt and verified.

Output contains `data_x64_0.payload`, `locale_rotk.payload`, both updated
manifests and a verification report. Every archived file is read back and
checked. Other assets and installed-file ownership remain unchanged. Preparation
does not write to the input client or publish a release.

## Distribution

Publish both payloads together through the assets repository and coordinate the
matching installed-file attestation policy. `.payload` filenames intentionally
avoid the launcher's automatic latest-release ZIP discovery before the complete
feed is ready. Do not expose a feed whose release attachments are unavailable.
Players receive the updated control on their next launcher/game restart; further
volume adjustments take effect in the running game.

## Local verification, 2026-09-15

- Native audio UI displayed the new control and the final English label.
- Changing 65 to 10 immediately wrote `ReceiveVolume=10`; the value survived a
  full client restart and reopening Audio.
- Master volume stayed at 1.0 and microphone volume at 50.
- The production launcher installer verified all 23 generated files, avoided a
  second download, repaired corrupted data and locale files from its cache,
  and restored every original file. Existing `UserOptions.ini` was preserved.
- The installed proxy logged a successful speaker-level request after the UI
  change. The launcher proxy's existing real-SDK test passed 50 cycles across
  levels 0, 25, 50, 65 and 100.
- The dedicated in-match Escape traversal and a two-player listening test remain
  to be completed: the user stopped UI automation before that traversal. The
  main-menu check alone does not claim that live listening test.
