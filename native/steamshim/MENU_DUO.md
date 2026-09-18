# Native menu Duo presentation

The main-menu static view selects characters from the native Steam lobby member
list. The launcher initializes the shim's observer-local lobby through the
existing compact `thirdPartyCommandLine=+connect_lobby109775241000000001` argument.
Without a matching server/UI frame, the shim continues to expose only the owner.

The server publishes the admitted presentation actor through an owner-only
`ROTK_MENU_DUO_V1` broadcast. The matching UIRoot forwards its bounded text using
SteamSendChatToLobby; the engine prefixes it with `@CHAT:`. `menu_duo_native.h`
validates the monotone sequence, exact u64 identities, display-actor namespace,
URI-encoded name and clear grammar before staging an update. Native callbacks
run on SteamAPI_RunCallbacks, outside the UI call. Expiry after 20 seconds or an
explicit clear removes the member. This does not change authoritative Social
party membership or gameplay admission. No runtime file adapter is used.

Run `npm run test:native:menu-duo` with Zig 0.15.2 available. The test compiles the
actual shim code and exercises matchmaking calls, deferred callbacks, exact IDs,
UTF-8 names, replacement, leave/rejoin, expiry and malformed/stale input. Checks
explicitly remain enabled when Zig -O2 defines NDEBUG.

The generated `native/steamshim/dist/menu-duo-test.exe --wire` additionally reads
four server-generated frames from stdin (join, replacement, clear, rejoin). The
matching server repository provides `prove-menu-duo-native-wire1315.ts` for this
cross-language contract check.

The corrected network integration was visually accepted in two isolated game
clients on 2026-09-18; read-only native diagnostics confirmed two members each.
Rebuilt UIRoot assets and server opt-in `H1Z1_MENU_DUO_SCENE=1` must ship together
with this shim. This change does not itself publish a launcher or enable servers.
