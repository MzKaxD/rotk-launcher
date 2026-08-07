/**
 * A launch profile is the pair the launcher actually authenticates with: the
 * ROTK server the client connects to, and the role the launch runs under.
 *
 * The two axes are independent and both are needed to pick a credential. The
 * account service issues a distinct launcher key per account, an administrator
 * key lives on a different account than the player key, and the test server has
 * its own database — so a single stored key can never serve all four cases.
 */
export const SERVER_IDS = ["game2", "test"] as const;
export type ServerId = (typeof SERVER_IDS)[number];

export const PLAYER_ROLES = ["player", "admin"] as const;
/** `admin` covers the moderator/administrator key: the backend grants one role. */
export type PlayerRole = (typeof PLAYER_ROLES)[number];

export const DEFAULT_SERVER_ID: ServerId = "game2";
export const DEFAULT_PLAYER_ROLE: PlayerRole = "player";

export type LaunchProfileId = `${ServerId}:${PlayerRole}`;

export const LAUNCH_PROFILE_IDS: readonly LaunchProfileId[] = Object.freeze(
  SERVER_IDS.flatMap((serverId) => PLAYER_ROLES.map((role) => `${serverId}:${role}` as LaunchProfileId)),
);

export function isServerId(value: unknown): value is ServerId {
  return typeof value === "string" && (SERVER_IDS as readonly string[]).includes(value);
}

export function isPlayerRole(value: unknown): value is PlayerRole {
  return typeof value === "string" && (PLAYER_ROLES as readonly string[]).includes(value);
}

export function launchProfileId(serverId: ServerId, role: PlayerRole): LaunchProfileId {
  return `${serverId}:${role}`;
}

export function isLaunchProfileId(value: unknown): value is LaunchProfileId {
  return typeof value === "string" && (LAUNCH_PROFILE_IDS as readonly string[]).includes(value);
}
