import { describe, expect, it } from "vitest";
import {
  clientConfigInternals,
  synchronizeClientConfig,
} from "../electron/services/client-config.js";
import type { RuntimeConfig } from "../electron/services/runtime-config.js";

const runtime: RuntimeConfig = {
  environment: "production",
  label: "ROTK Europe",
  gatewayOrigin: "https://gateway.rotk.app",
  loginHost: "login.rotk.app",
  loginPorts: [20042, 20043],
  websiteOrigin: "https://rotk.app",
  launchTicketUrl: "https://accounts.rotk.app/createLaunchTicket",
};
const authKey = "0123456789abcdef0123456789abcdef";
const localCreateSessionUrl = "http://127.0.0.1:49152/rest/auth/session/create";

describe("ClientConfig synchronization", () => {
  it("is idempotent and removes stale duplicate directives", () => {
    const original = [
      "sessionid=ffffffffffffffffffffffffffffffff",
      "Server=old.example:1",
      "Server=old.example:2",
      "SteamGatewayUrl=http://old.invalid/session",
      "",
      "[CommandQueue]",
      "motd_uri=http://old.invalid/",
      "motd_uri=http://duplicate.invalid/",
      "cb_uri=http://old.invalid/",
      "",
      "[LaunchTelemetry]",
      "Url=http://old.invalid/telemetry",
      "",
    ].join("\r\n");

    const once = synchronizeClientConfig(original, runtime, localCreateSessionUrl);
    const twice = synchronizeClientConfig(once, runtime, localCreateSessionUrl);

    expect(twice).toBe(once);
    expect(once.match(/^sessionid=/gim)).toBeNull();
    expect(once.match(/^Server=/gim)).toHaveLength(1);
    expect(once.match(/^motd_uri=/gim)).toHaveLength(1);
    expect(once).toContain("Server=login.rotk.app:20042;login.rotk.app:20043");
    expect(once).toContain(`SteamGatewayUrl=${localCreateSessionUrl}`);
    expect(once).not.toContain(authKey);
    expect(once).toContain("SoeAuthTicketUrl=https://gateway.rotk.app/rest/client/session/create");
  });

  it("inserts root directives before the first INI section", () => {
    const result = clientConfigInternals.upsertIniDirective("[CommandQueue]\nfoo=bar\n", {
      section: null,
      key: "Server",
      value: "127.0.0.1:20042",
    });

    expect(result.indexOf("Server=127.0.0.1:20042")).toBeLessThan(
      result.indexOf("[CommandQueue]"),
    );
  });

  it("preserves comments and rejects non-loopback session gateways", () => {
    const original = "; do not remove this comment\n[Custom]\nValue=kept\n";
    const result = synchronizeClientConfig(original, runtime, localCreateSessionUrl);
    expect(result).toContain("; do not remove this comment");
    expect(result).toMatch(/\[Custom]\r?\nValue=kept/);
    expect(() => synchronizeClientConfig(
      original,
      runtime,
      `http://51.255.160.224/rest/auth/session/create?sessionid=${authKey}`,
    )).toThrow(
      "Invalid local ROTK session gateway URL",
    );
  });

  it("does not persist a session ID anywhere in ClientConfig.ini", () => {
    const synchronized = synchronizeClientConfig(
      `sessionid=${authKey}\r\nSteamGatewayUrl=http://old.invalid/`,
      runtime,
      localCreateSessionUrl,
    );

    expect(synchronized).toContain(`SteamGatewayUrl=${localCreateSessionUrl}`);
    expect(synchronized).not.toContain(authKey);
    expect(synchronized).not.toMatch(/^sessionid=/gim);
  });
});
