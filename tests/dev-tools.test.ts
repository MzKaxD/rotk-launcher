import { describe, expect, it } from "vitest";
import {
  DEV_LOG_LIMIT,
  DevLogBuffer,
  buildDevToolsSnapshot,
  formatDevDiagnostics,
  operatorToolsAvailable,
  redactClientConfig,
  redactSensitiveText,
  tailCombatLog,
} from "../electron/services/dev-tools.js";

const SAMPLE_KEY = "0123456789abcdef0123456789abcdef";
const SAMPLE_TICKET = "rotk-ticket-value";

describe("development diagnostics redaction", () => {
  it("strips player keys, session ids and loopback gateway URLs", () => {
    expect(redactSensitiveText(`saved ${SAMPLE_KEY}`)).toBe("saved [redacted-key]");
    expect(redactSensitiveText(`sessionid=${SAMPLE_TICKET} server=127.0.0.1:1115`)).toBe(
      "sessionid=[redacted] server=127.0.0.1:1115",
    );
    expect(redactSensitiveText(`<sessionid>${SAMPLE_TICKET}</sessionid>`)).toBe(
      "<sessionid>[redacted]</sessionid>",
    );
    expect(
      redactSensitiveText("http://127.0.0.1:54321/rest/auth/session/create"),
    ).toBe("http://127.0.0.1:[redacted]/rest/auth/session/create");
  });

  it("keeps a bounded, already-redacted log ring", () => {
    const logs = new DevLogBuffer();
    for (let index = 0; index < DEV_LOG_LIMIT + 5; index += 1) {
      logs.push("info", `event ${index} key=${SAMPLE_KEY}`);
    }
    const entries = logs.list();
    expect(entries).toHaveLength(DEV_LOG_LIMIT);
    expect(entries[0]?.message).toContain("event 5");
    expect(entries.every((entry) => !entry.message.includes(SAMPLE_KEY))).toBe(true);
    expect(entries.at(-1)?.message).toContain("[redacted-key]");
  });

  it("serializes a snapshot without secrets or a session gateway URL", () => {
    const snapshot = buildDevToolsSnapshot({
      appVersion: "1.4.2",
      electronVersion: "43.0.0",
      chromeVersion: "140.0.0",
      nodeVersion: "22.0.0",
      packaged: false,
      isolatedUserData: true,
      viteDevServer: true,
      security: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        encryptionAvailable: true,
      },
      paths: {
        userData: "C:\\dev\\userData",
        appPath: "C:\\dev\\app",
        logsRoot: "C:\\dev\\userData\\logs",
        installationRoot: "C:\\Games\\ROTK",
        installationRealPath: "C:\\Games\\ROTK",
        sourceRoot: "D:\\Steam\\H1Z1",
        destinationRoot: "C:\\Games\\ROTK",
      },
      launch: {
        phase: "running",
        gamePid: 4242,
        gameRunning: true,
        canPlay: false,
        updateRequired: false,
        sessionGatewayListening: true,
        attestation: { status: "attested", reason: null },
      },
      runtime: {
        serverId: "test",
        role: "player",
        environment: "development",
        label: "ROTK TEST",
        websiteOrigin: "https://test.rotk.app",
        gatewayOrigin: "http://51.255.160.224:8080",
        voiceGrantOrigin: "https://test.rotk.app",
        loginList: "51.255.160.224:20042",
        launchTicketUrl: "https://test.rotk.app/api/launcher/ticket",
        attestationChallengeUrl: "https://test.rotk.app/api/launcher/attestation/challenge",
      },
      identityConfigured: {
        "game2:player": true,
        "game2:admin": false,
        "test:player": true,
        "test:admin": false,
      },
      assetSync: { enabled: true, status: "up-to-date", packVersion: "12" },
      launcherUpdate: { status: "idle", availableVersion: null },
      installHealth: {
        ok: true,
        error: null,
        markerPresent: true,
        markerInstallId: "install-1",
        markerBuildId: "build-1",
        markerInstalledAt: "2026-08-16T00:00:00.000Z",
        markerMatchesConfig: true,
        files: [{ name: "H1Z1.exe", present: true }],
      },
      clientConfig: "sessionid=rotk-ticket-value\nSteamGatewayUrl=http://127.0.0.1:54321/rest/auth/session/create\nServer=127.0.0.1:1115\n",
      ipcChannels: ["launcher:get-snapshot"],
      companionScan: {
        status: "ok",
        scannedAt: "2026-08-16T11:59:00.000Z",
        processCount: 42,
        flags: [{
          name: "cheatengine-x86_64.exe",
          pid: 4321,
          title: "Cheat Engine 7.5",
          category: "cheat",
          matchedOn: "name",
        }],
        error: null,
      },
      combatLogs: [{
        name: "HitReg.log",
        excerpt: `sessionid=${SAMPLE_TICKET}\n<Victim:Ducky> <HitBone:HEAD>`,
        path: "C:\\Games\\ROTK\\Logs\\HitReg.log",
        updatedAt: "2026-08-16T12:00:00.000Z",
        highlights: ["failed-hit"],
      }],
      killFeed: {
        kills: 2,
        headshots: 1,
        windowStartedAt: "2026-08-16T11:59:00.000Z",
        windowEndedAt: "2026-08-16T12:00:00.000Z",
        players: [{
          name: "Jin",
          kills: 2,
          deaths: 0,
          headshots: 1,
          headshotPercent: 50,
          minKillGapMs: 3000,
        }],
      },
      definitions: [{ name: "CheatReportType", count: 11 }],
      preferTestServer: false,
      operatorWatching: true,
      lastSessionDossier: null,
      operatorConnections: [{
        loginSessionId: "sess-1",
        name: "Jin",
        ip: "203.0.113.10",
        at: "2026-08-17T12:00:00.000Z",
      }],
      operatorIpBans: [{
        ip: "203.0.113.10",
        reason: "cheat",
        at: "2026-08-17T12:01:00.000Z",
        active: true,
      }],
      operatorRemote: {
        status: "unavailable",
        role: null,
        sessions: [],
        bans: [],
        error: "The account service does not offer operator sessions yet.",
        fetchedAt: "2026-08-16T12:00:00.000Z",
      },
      logs: [{ at: "2026-08-16T00:00:00.000Z", level: "info", message: `sessionid=${SAMPLE_TICKET}` }],
    }, new Date("2026-08-16T12:00:00.000Z"));

    const serialized = formatDevDiagnostics(snapshot);
    expect(snapshot.packaged).toBe(false);
    expect(serialized).toContain("sessionGatewayListening");
    expect(serialized).not.toContain(SAMPLE_KEY);
    expect(serialized).not.toContain(SAMPLE_TICKET);
    expect(serialized).not.toContain("/rest/auth/session/create");
    expect(serialized).not.toContain("sessionid=rotk");
    expect(JSON.parse(serialized).identityConfigured["game2:player"]).toBe(true);
    expect(serialized).toContain("Server=127.0.0.1:1115");
    expect(serialized).toContain("SteamGatewayUrl=[redacted]");
    expect(JSON.parse(serialized).companionScan.flags[0].name).toBe("cheatengine-x86_64.exe");
    expect(JSON.parse(serialized).combatLogs[0].excerpt).toContain("<Victim:Ducky>");
    expect(JSON.parse(serialized).combatLogs[0].excerpt).not.toContain(SAMPLE_TICKET);
    expect(JSON.parse(serialized).killFeed.players[0].name).toBe("Jin");
    expect(JSON.parse(serialized).operatorConnections[0].ip).toBe("203.0.113.10");
    expect(JSON.parse(serialized).operatorIpBans[0].reason).toBe("cheat");
  });

  it("redacts ClientConfig.ini secrets while keeping server lines", () => {
    const redacted = redactClientConfig(
      "sessionid=rotk-ticket-value\r\nSteamGatewayUrl=http://127.0.0.1:9/rest/auth/session/create\r\nServer=127.0.0.1:1115\r\n",
    );
    expect(redacted).toContain("sessionid=[redacted]");
    expect(redacted).toContain("SteamGatewayUrl=[redacted]");
    expect(redacted).toContain("Server=127.0.0.1:1115");
    expect(redacted).not.toContain("rotk-ticket-value");
    expect(redacted).not.toContain("127.0.0.1:9");
  });

  it("exposes operator tools in unpackaged and packaged launches", () => {
    expect(operatorToolsAvailable({ packaged: false, role: "player", adminKeyConfigured: false })).toBe(true);
    expect(operatorToolsAvailable({ packaged: true, role: "player", adminKeyConfigured: false })).toBe(true);
    expect(operatorToolsAvailable({ packaged: true, role: "admin", adminKeyConfigured: true })).toBe(true);
  });

  it("tails combat logs and redacts secrets", () => {
    const excerpt = tailCombatLog(`keep-1\nkeep-2\nsessionid=${SAMPLE_TICKET}\nkeep-3`);
    expect(excerpt).toContain("keep-3");
    expect(excerpt).toContain("sessionid=[redacted]");
    expect(excerpt).not.toContain(SAMPLE_TICKET);
    expect(tailCombatLog(Array.from({ length: 50 }, (_, index) => `line-${index}`).join("\n")))
      .toContain("line-49");
    expect(tailCombatLog(Array.from({ length: 50 }, (_, index) => `line-${index}`).join("\n")))
      .not.toContain("line-0");
  });
});
