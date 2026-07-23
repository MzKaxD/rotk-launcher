import { isValidPlayerKey, normalizePlayerKey } from "../../shared/player-key.js";

export interface PlayerIdentity {
  playerKey: string;
}

export function identityFromPlayerKey(value: unknown): PlayerIdentity {
  if (!isValidPlayerKey(value)) throw new Error("Invalid ROTK player key");
  const playerKey = normalizePlayerKey(value);
  return { playerKey };
}
