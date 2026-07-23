import { describe, expect, it } from "vitest";
import { identityFromPlayerKey } from "../electron/services/player-identity.js";

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
