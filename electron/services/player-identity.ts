import { isValidPlayerKey, normalizePlayerKey } from "../../shared/player-key.js";
import { launchProfileId, type PlayerRole, type ServerId } from "../../shared/launch-profile.js";
import type { PlayerKeySet } from "./player-key-store.js";

export interface PlayerIdentity {
  playerKey: string;
}

export function identityFromPlayerKey(value: unknown): PlayerIdentity {
  if (!isValidPlayerKey(value)) throw new Error("Invalid ROTK player key");
  const playerKey = normalizePlayerKey(value);
  return { playerKey };
}

/**
 * The credential a launch actually sends. An admin slot with no key falls
 * back to that server's player key instead of blocking Play. The account
 * service still authenticates the player key as a player; this does not
 * mint administrator privileges.
 */
export function resolveLaunchKey(
  keys: PlayerKeySet,
  serverId: ServerId,
  role: PlayerRole,
): string | null {
  const selected = keys[launchProfileId(serverId, role)];
  if (selected) return selected;
  if (role === "admin") return keys[launchProfileId(serverId, "player")] ?? null;
  return null;
}
