# Inventory and map while holding Shift

The stock `InputProfile_Default.xml` sets `ignoreModifiers="false"` on
`Generic/ToggleInventory` and `Generic/OpenMap`. Their unmodified bindings do
not match while Shift is held for sprinting. This happens inside the client,
before a server inventory or map request.

Before spawning the game, the launcher now adds explicit `Shift+<key>` aliases
to `InputProfile_User.xml` for the player's current inventory and map keys.
With the stock bindings, those aliases are Shift+Tab, Shift+I and Shift+M.
It uses the default bindings for first launch or omitted user actions; an
explicitly unbound action stays unbound. Gamepad bindings and explicit
multi-key shortcuts are preserved. An existing Shift combination belonging
to another effective action takes precedence over a generated alias.

The default profile remains byte-identical, including its modifier policy.
In particular, Ctrl+Tab, Ctrl+M and Alt+M retain their existing meaning.
Only the already player-writable user profile changes; attestation rules and
immutable client assets are unchanged.

The original user profile is backed up once under the launcher's existing
per-installation logs directory, in `input-profile/`. The same directory
stores the list of generated aliases so subsequent launches can retire old
aliases after the player changes a binding. The game can serialize its XML
without relying on preservation of custom comments or attributes. Preparation
is idempotent and does not write unchanged profiles.

Validation:

- `npm run typecheck`
- `npx vitest run tests/interface-input-profile.test.ts tests/diagnostic-game-lifecycle.test.ts tests/client-config.test.ts`
- Live acceptance: hold left and right Shift while opening/closing inventory
  and map, repeat while moving, then verify Ctrl+Tab, Ctrl+M and Alt+M. Rebind
  one action, relaunch, and repeat with the new key. This native in-game check
  remains necessary; profile tests do not execute the H1Z1 input dispatcher.

This source change requires a launcher release to reach other players.
