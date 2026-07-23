import { describe, expect, it } from "vitest";
import { identifyClientBuild, SUPPORTED_CLIENT_BUILDS } from "../electron/services/client-build.js";

describe("supported H1Z1 client builds", () => {
  it("identifies the supported Steam executable by size and SHA-256", () => {
    const expected = SUPPORTED_CLIENT_BUILDS[0];
    expect(identifyClientBuild(expected.executableSize, expected.executableSha256)).toEqual(expected);
  });

  it("rejects an unknown or modified executable", () => {
    expect(() => identifyClientBuild(82_158_616, "0".repeat(64))).toThrow(/pas encore prise en charge/i);
  });
});
