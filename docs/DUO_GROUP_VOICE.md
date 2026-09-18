# Native Duo Group Chat

The proxy now submits the exact requested channel to the Gateway using
`X-ROTK-Vivox-Channel`. This lets the server authorize both Proximity and the
player's private Group room. Both native join requests (`0x10`, `0x08`) use the
same bounded extraction and keep their original URI. Tokens are injected only
when the signed account/channel match. Group membership comes from the server.

No key binding changes: the game selects Proximity or Group through its existing
separate push-to-talk controls. Ship alongside the server Duo Group Chat change;
older servers authorize only proximity. No live launcher release is included.

`npm run test:native:duo-voice` compiles the shipping C implementation and checks
the two join layouts, the 63-byte boundary, malformed input and header injection.
The resulting `native/vivoxproxy/dist/tests/duo_group_voice_test.exe` can be supplied
as `DUO_VOICE_NATIVE_PROBE` to the server's `prove:duo-group-voice` proof. That
exercises real WinHTTP requests and token injection for both rooms/ABIs.

Run `npm run prepare:vivox` to rebuild the distributable DLL and run the existing
native checks. Two-client in-game audio validation remains a release check.

Vivox 5 session-added events leave the legacy URI field empty. The proxy restores
it from each event's own URI-based session handle, which was set on its authorized
join request. It must never use a global last-joined room: Proximity and Group can
complete in either order, including after a lobby/match handoff or a new Duo.
The native test suite checks both Duo response orders, all 24 permutations of two
old and two new room events, logout, malformed handles, and SDK string ownership.
