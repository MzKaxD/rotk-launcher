export const PLAYER_KEY_HEX_LENGTH = 32;

const PLAYER_KEY_PATTERN = /^[a-f0-9]{32}$/;

export function normalizePlayerKey(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

export function isValidPlayerKey(value: unknown): value is string {
  return typeof value === "string" && PLAYER_KEY_PATTERN.test(normalizePlayerKey(value));
}
