import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildSessionDossier,
  combatLogHighlights,
  emptyKillFeedSummary,
  gameLogDirectories,
  parseDefinitionLoads,
  parseKillFeed,
  parseKillFeedLine,
  recentKillFeedEvents,
  sessionDossierFileName,
  summarizeKillFeed,
  toCombatLogEntry,
} from "../electron/services/operator-session.js";

describe("operator session helpers", () => {
  it("lists the client Logs folder and the launcher install log folder", () => {
    expect(gameLogDirectories("C:\\Games\\ROTK", "C:\\dev\\logs", "install-1")).toEqual([
      join("C:\\Games\\ROTK", "Logs"),
      join("C:\\dev\\logs", "install-1"),
    ]);
    expect(gameLogDirectories(null, null, null)).toEqual([]);
  });

  it("keeps the last load count per definition type", () => {
    const loads = parseDefinitionLoads([
      "(Font) Loaded 3 definitions, result=1.",
      "(CheatReportType) Loaded 11 definitions, result=1.",
      "(CheatReportType) Loaded 11 definitions, result=1.",
      "(ClientSteamItems) Loaded 1707 definitions, result=1.",
    ].join("\n"));
    expect(loads).toEqual([
      { name: "CheatReportType", count: 11 },
      { name: "ClientSteamItems", count: 1707 },
      { name: "Font", count: 3 },
    ]);
  });

  it("flags failed hits and kill-feed headshots without treating every kill as a cheat", () => {
    expect(combatLogHighlights("HitReg.log", "<FailHitCount:1> <FailHitObj:Door>")).toEqual(["failed-hit"]);
    expect(combatLogHighlights("KillFeed.log", "Jin KILLED HeroicTeSeS HEADSHOT")).toEqual(["headshot"]);
    expect(combatLogHighlights("KillFeed.log", "Jin KILLED HeroicTeSeS")).toEqual([]);
  });

  it("writes a redacted session dossier with duration", () => {
    const dossier = buildSessionDossier({
      startedAt: "2026-08-17T04:00:00.000Z",
      endedAt: "2026-08-17T04:12:00.000Z",
      pid: 4242,
      serverId: "game2",
      role: "player",
      environment: "production",
      label: "ROTK GAME 2",
      packVersion: "12",
      companion: {
        status: "ok",
        scannedAt: "2026-08-17T04:00:01.000Z",
        processCount: 10,
        flags: [],
        error: null,
      },
      combatLogs: [toCombatLogEntry(
        "HitReg.log",
        "sessionid=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n<FailHitCount:1>",
        "C:\\Games\\ROTK\\Logs\\HitReg.log",
        new Date("2026-08-17T04:11:00.000Z"),
      )],
      killFeed: {
        kills: 2,
        headshots: 1,
        windowStartedAt: "2026-08-17T04:00:00.000Z",
        windowEndedAt: "2026-08-17T04:11:00.000Z",
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
    });
    expect(dossier.durationMs).toBe(12 * 60_000);
    expect(dossier.combatLogs[0]?.excerpt).toContain("sessionid=[redacted]");
    expect(dossier.combatLogs[0]?.excerpt).not.toContain("AAAAAAAA");
    expect(sessionDossierFileName(dossier.endedAt)).toBe("session-2026-08-17T04-12-00-000Z.json");
    expect(dossier.killFeed.players[0]?.name).toBe("Jin");
    expect(JSON.stringify(dossier)).not.toContain("AAAAAAAA");
  });

  it("parses KillFeed actors without exposing GUIDs in the summary", () => {
    const content = readFileSync(fileURLToPath(new URL("./fixtures/kill-feed.log", import.meta.url)), "utf8");
    const events = parseKillFeed(content);
    expect(events).toHaveLength(4);
    expect(parseKillFeedLine(content.split(/\r?\n/)[0] ?? "")).toMatchObject({
      killer: "Skasa.",
      victim: "Jin",
      headshot: false,
      killerPing: 3,
    });
    expect(events[2]).toMatchObject({ killer: "b2kk", victim: "HeroicTeSeS", headshot: true });
    const summary = summarizeKillFeed(events);
    expect(summary.kills).toBe(4);
    expect(summary.headshots).toBe(2);
    expect(summary.players.map((player) => player.name).sort()).toEqual([
      "HeroicTeSeS",
      "Jin",
      "RetourLobby",
      "Skasa.",
      "b2kk",
    ]);
    expect(JSON.stringify(summary)).not.toMatch(/\d{10,}/);
    expect(emptyKillFeedSummary().kills).toBe(0);
  });

  it("keeps a recent window of kills and reports the tightest gap per player", () => {
    const events = [
      { at: "2026-08-17T00:29:49", atMs: Date.parse("2026-08-17T00:29:49"), killer: "Jin", victim: "A", headshot: true, killerPing: 3, victimPing: 3 },
      { at: "2026-08-17T00:29:50", atMs: Date.parse("2026-08-17T00:29:50"), killer: "Jin", victim: "B", headshot: false, killerPing: 3, victimPing: 3 },
      { at: "2026-08-17T00:10:00", atMs: Date.parse("2026-08-17T00:10:00"), killer: "Old", victim: "C", headshot: false, killerPing: 3, victimPing: 3 },
    ];
    const recent = recentKillFeedEvents(events, null, Date.parse("2026-08-17T00:30:00"), 10 * 60_000);
    expect(recent.map((event) => event.killer)).toEqual(["Jin", "Jin"]);
    const summary = summarizeKillFeed(recent);
    expect(summary.players[0]?.minKillGapMs).toBe(1000);
    expect(summary.players[0]?.headshotPercent).toBe(50);
  });
});
