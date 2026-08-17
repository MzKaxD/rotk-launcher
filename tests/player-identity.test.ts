import { describe, expect, it } from "vitest";
import { identityFromPlayerKey, resolveLaunchKey } from "../electron/services/player-identity.js";

describe("website-issued player identity", () => {
  it("normalizes the supplied website key without deriving an identity from it", () => {
    const identity = identityFromPlayerKey("  0123456789ABCDEF0123456789ABCDEF  ");

    expect(identity).toEqual({ playerKey: "0123456789abcdef0123456789abcdef" });
    expect(identity).not.toHaveProperty("steamId");
    expect(identity).not.toHaveProperty("persona");
  });

  it("rejects malformed or undersized keys", () => {
    expect(() => identityFromPlayerKey("not-a-key")).toThrow("Invalid ROTK player key");
    expect(() => identityFromPlayerKey("a".repeat(31))).toThrow("Invalid ROTK player key");
  });
});

describe("launch key resolution", () => {
  const playerKey = "0123456789abcdef0123456789abcdef";
  const adminKey = "fedcba9876543210fedcba9876543210";

  it("uses the selected slot when it is filled", () => {
    expect(resolveLaunchKey({ "game2:player": playerKey, "game2:admin": adminKey }, "game2", "admin")).toBe(adminKey);
    expect(resolveLaunchKey({ "game2:player": playerKey }, "game2", "player")).toBe(playerKey);
  });

  it("falls back to the same server's player key when admin is selected without an admin key", () => {
    expect(resolveLaunchKey({ "game2:player": playerKey }, "game2", "admin")).toBe(playerKey);
  });

  it("does not borrow a key from another server", () => {
    expect(resolveLaunchKey({ "game2:player": playerKey }, "test", "admin")).toBeNull();
    expect(resolveLaunchKey({ "test:admin": adminKey }, "game2", "admin")).toBeNull();
  });
});
