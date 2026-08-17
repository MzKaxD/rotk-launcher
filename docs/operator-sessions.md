# Operator sessions (moderator launcher)

Moderators should see live GAME 2 / TEST connecting IPs in the launcher without
running a zone on their PC. The launcher never observes those addresses
itself: only the account service (HTTPS launch tickets) and the zone/login
process do.

## Account service

Record `ip` (and HWID digest) when a launch ticket is issued. Serve them only
to accounts with moderator or administrator permission.

### `POST /api/launcher/operator/sessions`

Same origin as the launch ticket (`https://rotk.app` or `https://test.rotk.app`).
HTTPS only. Body:

```json
{ "launcherKey": "<32 hex>", "launcherVersion": "1.4.3" }
```

Responses:

| Status | Meaning |
| --- | --- |
| `200` | `{ "ok": true, "role": "moderator" \| "admin", "sessions": [...], "bans": [...] }` |
| `401` | Key rejected |
| `403` | Authenticated, but not a moderator |
| `404` / `501` | Route not deployed yet; the launcher shows “unavailable” and keeps working |

Session rows:

```json
{
  "name": "Jin",
  "loginSessionId": "…",
  "ip": "203.0.113.10",
  "at": "2026-08-17T15:00:00.000Z"
}
```

Do not return player keys, tickets, or raw HWID. A HWID digest is optional later.

### `POST /api/launcher/operator/bans`

```json
{ "launcherKey": "<32 hex>", "ip": "203.0.113.10", "reason": "cheat" }
```

Refuse loopback. Shared NAT/VPN can hit innocents; pair IP bans with account
and HWID when possible.

## Launcher

The DEV panel polls sessions every 20s when operator tools are open and a
launcher key is configured. Ban from a row calls the bans route when it exists,
and still writes the local-zone file on this PC (`%APPDATA%\h1emu\operator`).
