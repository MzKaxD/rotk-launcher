import { describe, expect, it } from "vitest";
import { gameLauncherInternals } from "../electron/services/game-launcher.js";
import { DEFAULT_RUNTIME_CONFIG, serverList } from "../electron/services/runtime-config.js";

describe("public ROTK runtime", () => {
  it("targets the GAME 2 gateway and every public login listener", () => {
    expect(DEFAULT_RUNTIME_CONFIG.environment).toBe("production");
    expect(DEFAULT_RUNTIME_CONFIG.label).toBe("ROTK GAME 2");
    // The Gateway moved off :80 so Nginx can own it for the website; the port
    // must travel into every URL the client is handed.
    expect(DEFAULT_RUNTIME_CONFIG.gatewayOrigin).toBe("http://162.19.94.95:8080");
    expect(DEFAULT_RUNTIME_CONFIG.voiceGrantOrigin).toBe(
      "https://vps-c717eb9e.vps.ovh.net",
    );
    expect(serverList(DEFAULT_RUNTIME_CONFIG)).toBe(
      "162.19.94.95:20042;162.19.94.95:20043;162.19.94.95:20044;162.19.94.95:20045",
    );
  });

  it("passes only the short ticket and bounded GAME 2 endpoints to H1Z1", () => {
    const durableKey = "0123456789abcdef0123456789abcdef";
    const launchTicket = "T".repeat(43);
    const args = gameLauncherInternals.buildLaunchArguments(
      launchTicket,
      DEFAULT_RUNTIME_CONFIG,
      "C:\\ROTK\\logs",
      "install-1",
      "http://127.0.0.1:49152/rest/auth/session/create",
    );

    expect(args).toContain(`sessionid=${launchTicket}`);
    expect(args.join(" ")).not.toContain(durableKey);
    expect(args).toContain(
      `server=162.19.94.95:20042;162.19.94.95:20043;162.19.94.95:20044;162.19.94.95:20045`,
    );
    expect(args).toContain(
      "SteamGatewayUrl=http://127.0.0.1:49152/rest/auth/session/create",
    );
    expect(args).toContain(
      "VivoxGrantUrl=https://vps-c717eb9e.vps.ovh.net",
    );
    expect(args).toContain("CommandQueue:motd_uri=http://162.19.94.95:8080/");
    expect(args.some((argument) => (
      argument.includes("162.19.94.95:8080/rest/auth/session/create")
    ))).toBe(false);
    expect(args.join(" ")).not.toMatch(
      /token.?key|private.?key|client.?secret|password/i,
    );
  });

  it("accepts only a credential-free HTTPS origin for voice grants", () => {
    expect(
      gameLauncherInternals.validateVoiceGrantOrigin("https://voice.rotk.app"),
    ).toBe("https://voice.rotk.app");
    expect(() =>
      gameLauncherInternals.validateVoiceGrantOrigin("http://voice.rotk.app"),
    ).toThrow(/voice grant origin/i);
    expect(() =>
      gameLauncherInternals.validateVoiceGrantOrigin(
        "https://user:password@voice.rotk.app",
      ),
    ).toThrow(/voice grant origin/i);
    expect(() =>
      gameLauncherInternals.validateVoiceGrantOrigin(
        "https://voice.rotk.app/voice/v1/login?token=secret",
      ),
    ).toThrow(/voice grant origin/i);
  });

  it("uses only the account-service Steam identity for the shim environment", () => {
    const environment = gameLauncherInternals.sanitizedEnvironment({
      steamId: "76561198000000001",
      displayName: "ROTK Player",
    });

    expect(environment.STEAMID).toBe("76561198000000001");
    expect(environment.H1Z1_OVERRIDE_STEAMID).toBe("76561198000000001");
    expect(environment.H1Z1_OVERRIDE_PERSONA).toBe("ROTK Player");
  });
});
