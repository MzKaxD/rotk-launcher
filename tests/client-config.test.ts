import { describe, expect, it } from "vitest";
import {
  clientConfigInternals,
  synchronizeClientConfig,
} from "../electron/services/client-config.js";
import type { RuntimeConfig } from "../electron/services/runtime-config.js";

const runtime: RuntimeConfig = {
  id: "game2",
  environment: "production",
  label: "ROTK Europe",
  gatewayOrigin: "https://gateway.rotk.app",
  voiceGrantOrigin: "https://voice.rotk.app",
  loginHost: "login.rotk.app",
  loginPorts: [20042, 20043],
  websiteOrigin: "https://rotk.app",
  launchTicketUrl: "https://accounts.rotk.app/createLaunchTicket",
  attestationChallengeUrl: "https://accounts.rotk.app/beginLauncherAttestation",
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
      "[CrashReporter]",
      "Address=recap.daybreakgames.com:15081",
      "NoUploadFromInit=1",
      "",
      "[WebResources]",
      "GameCrashUrl=https://www.h1z1.com/king-of-the-kill/game-error?code=G",
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
    expect(once).toContain("[WebResources]\r\nGameCrashUrl=https://rotk.app/game-error?code=G");
    expect(once).toContain("[CrashReporter]\r\nAddress=127.0.0.1:15081\r\nNoUploadFromInit=1");
    expect(once).toContain("[Help]\r\nPetitionUri=https://rotk.app/support?locale=%s");
  });

  it("leaves no Daybreak endpoint the client could open or upload to", () => {
    // The stock ClientConfig.ini shipped with the game, endpoint lines only.
    const stock = [
      "[INGAMEPURCHASE]",
      "SoeAuthTicketUrl=https://partner.soe.platformpublishing.com/rest/client/session/create",
      "",
      "[CrashReporter]",
      "Address=recap.daybreakgames.com:15081",
      "NoUploadFromInit=1",
      "",
      "[WebResources]",
      "GameCrashUrl=https://www.h1z1.com/king-of-the-kill/game-error?code=G",
      "",
      "[Help]",
      "PetitionUri=http://soe-%s.custhelp.com/app/answers/list/p/5833/c/5933",
      "",
      "[CommandQueue]",
      "motd_uri=http://assets.daybreakgames.com/",
      "",
    ].join("\r\n");

    const synchronized = synchronizeClientConfig(stock, runtime, localCreateSessionUrl);

    expect(synchronized).not.toMatch(/h1z1\.com|daybreakgames\.com|custhelp\.com|platformpublishing\.com/i);
    expect(synchronized.match(/^GameCrashUrl=/gim)).toHaveLength(1);
    expect(synchronized.match(/^Address=/gim)).toHaveLength(1);
    expect(synchronized.match(/^PetitionUri=/gim)).toHaveLength(1);
    // The client appends the code digits right after "G", then "&info=".
    expect(synchronized).toMatch(/^GameCrashUrl=https:\/\/rotk\.app\/game-error\?code=G$/m);
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
      `http://203.0.113.10/rest/auth/session/create?sessionid=${authKey}`,
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
