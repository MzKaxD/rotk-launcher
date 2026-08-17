import { join } from "node:path";
import type {
  CompanionScanSummary,
  DevToolsCombatLog,
  DevToolsDefinitionLoad,
  KillFeedSummary,
} from "../../shared/contracts.js";
import { redactSensitiveText, tailCombatLog } from "./dev-tools.js";
import type { PlayerRole, ServerId } from "../../shared/launch-profile.js";

export const OPERATOR_COMBAT_LOGS = ["HitReg.log", "KillFeed.log", "WeaponErrors.log"] as const;
export const OPERATOR_DEFINITION_LOG = "StandardDefinitionManager.log";
export const COMBAT_LOG_READ_LIMIT = 16_000;
export const OPERATOR_LOG_WATCH_INTERVAL_MS = 3_000;

const DEFINITION_LOAD = /\(([^)]+)\) Loaded (\d+) definitions/g;
const KILL_FEED_ACTORS = /^(.+?) \((\d+)\) \[rank:([^\]]+)\] \[ping:(\d+)\] KILLED (.+?) \((\d+)\) \[rank:([^\]]+)\] \[ping:(\d+)\](.*)$/;
const KILL_FEED_TOP_PLAYERS = 8;
export const RECENT_KILL_FEED_WINDOW_MS = 20 * 60_000;
export const RECENT_KILL_FEED_LIMIT = 400;

export function gameLogDirectories(
  installRoot: string | null,
  launcherLogsRoot: string | null,
  installId: string | null,
): string[] {
  const directories: string[] = [];
  if (installRoot) directories.push(join(installRoot, "Logs"));
  if (launcherLogsRoot && installId) directories.push(join(launcherLogsRoot, installId));
  return directories;
}

export function emptyKillFeedSummary(): KillFeedSummary {
  return { kills: 0, headshots: 0, windowStartedAt: null, windowEndedAt: null, players: [] };
}

export interface KillFeedEvent {
  at: string;
  atMs: number;
  killer: string;
  victim: string;
  headshot: boolean;
  killerPing: number;
  victimPing: number;
}

export function parseKillFeedLine(line: string): KillFeedEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const fields = trimmed.split("\t");
  const message = fields.length >= 8 ? fields[7] ?? "" : trimmed;
  const match = KILL_FEED_ACTORS.exec(message.trim());
  if (!match) return null;
  const date = fields[0] ?? "";
  const time = fields[1] ?? "";
  const at = date && time ? `${date}T${time}` : "";
  const parsed = Date.parse(at);
  return {
    at,
    atMs: Number.isFinite(parsed) ? parsed : 0,
    killer: match[1]?.trim() ?? "",
    victim: match[5]?.trim() ?? "",
    headshot: /\bHEADSHOT\b/i.test(match[9] ?? ""),
    killerPing: Number.parseInt(match[4] ?? "", 10),
    victimPing: Number.parseInt(match[8] ?? "", 10),
  };
}

export function parseKillFeed(content: string): KillFeedEvent[] {
  const events: KillFeedEvent[] = [];
  for (const line of content.split(/\r?\n/)) {
    const event = parseKillFeedLine(line);
    if (event && event.killer && event.victim) events.push(event);
  }
  return events;
}

export function summarizeKillFeed(events: readonly KillFeedEvent[]): KillFeedSummary {
  const players = new Map<string, {
    name: string;
    kills: number;
    deaths: number;
    headshots: number;
    killTimes: number[];
  }>();
  const bump = (name: string) => {
    const existing = players.get(name);
    if (existing) return existing;
    const created = { name, kills: 0, deaths: 0, headshots: 0, killTimes: [] as number[] };
    players.set(name, created);
    return created;
  };
  for (const event of events) {
    const killer = bump(event.killer);
    killer.kills += 1;
    if (event.headshot) killer.headshots += 1;
    if (event.atMs > 0) killer.killTimes.push(event.atMs);
    bump(event.victim).deaths += 1;
  }
  const ranked = [...players.values()]
    .map((player) => {
      const gaps = player.killTimes
        .slice()
        .sort((left, right) => left - right)
        .flatMap((time, index, times) => (index === 0 ? [] : [time - times[index - 1]!]));
      return {
        name: player.name,
        kills: player.kills,
        deaths: player.deaths,
        headshots: player.headshots,
        headshotPercent: player.kills === 0 ? 0 : Math.round((player.headshots / player.kills) * 100),
        minKillGapMs: gaps.length === 0 ? null : Math.min(...gaps),
      };
    })
    .sort((left, right) => right.kills - left.kills || left.name.localeCompare(right.name, "en-US"))
    .slice(0, KILL_FEED_TOP_PLAYERS);
  const times = events.map((event) => event.atMs).filter((time) => time > 0);
  return {
    kills: events.length,
    headshots: events.filter((event) => event.headshot).length,
    windowStartedAt: times.length > 0 ? new Date(Math.min(...times)).toISOString() : null,
    windowEndedAt: times.length > 0 ? new Date(Math.max(...times)).toISOString() : null,
    players: ranked,
  };
}

export function recentKillFeedEvents(
  events: readonly KillFeedEvent[],
  sinceMs: number | null,
  nowMs = Date.now(),
  windowMs = RECENT_KILL_FEED_WINDOW_MS,
  limit = RECENT_KILL_FEED_LIMIT,
): KillFeedEvent[] {
  const floor = sinceMs != null && Number.isFinite(sinceMs) ? sinceMs : nowMs - windowMs;
  const filtered = events.filter((event) => event.atMs === 0 || event.atMs >= floor);
  return filtered.length > limit ? filtered.slice(-limit) : [...filtered];
}

export function parseDefinitionLoads(content: string): DevToolsDefinitionLoad[] {
  const last = new Map<string, number>();
  for (const match of content.matchAll(DEFINITION_LOAD)) {
    const name = match[1]?.trim();
    const count = Number.parseInt(match[2] ?? "", 10);
    if (!name || !Number.isInteger(count)) continue;
    last.set(name, count);
  }
  return [...last.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => left.name.localeCompare(right.name, "en-US"));
}

export function combatLogHighlights(name: string, excerpt: string): string[] {
  const highlights: string[] = [];
  if (/FailHitCount/i.test(excerpt) || /FailHitObj/i.test(excerpt)) highlights.push("failed-hit");
  if (name === "KillFeed.log" && /\bHEADSHOT\b/i.test(excerpt)) highlights.push("headshot");
  if (name === "WeaponErrors.log" && excerpt.trim().length > 0) highlights.push("weapon-error");
  return highlights;
}

export function emptyCombatLog(name: string): DevToolsCombatLog {
  return {
    name,
    excerpt: null,
    path: null,
    updatedAt: null,
    highlights: [],
  };
}

export function toCombatLogEntry(
  name: string,
  content: string,
  path: string,
  updatedAt: Date,
): DevToolsCombatLog {
  const excerpt = tailCombatLog(
    content.length > COMBAT_LOG_READ_LIMIT ? content.slice(-COMBAT_LOG_READ_LIMIT) : content,
  );
  return {
    name,
    excerpt: excerpt || null,
    path,
    updatedAt: updatedAt.toISOString(),
    highlights: excerpt ? combatLogHighlights(name, excerpt) : [],
  };
}

export function operatorWatchKey(
  combatLogs: readonly DevToolsCombatLog[],
  definitions: readonly DevToolsDefinitionLoad[],
  killFeed: KillFeedSummary = emptyKillFeedSummary(),
): string {
  return [
    ...combatLogs.map((entry) => `${entry.name}:${entry.updatedAt ?? ""}:${entry.excerpt?.length ?? 0}`),
    ...definitions.map((entry) => `${entry.name}:${entry.count}`),
    `${killFeed.kills}:${killFeed.headshots}:${killFeed.players.map((player) => `${player.name}:${player.kills}`).join(",")}`,
  ].join("|");
}

export interface SessionDossier {
  schemaVersion: 1;
  note: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  pid: number | null;
  serverId: ServerId;
  role: PlayerRole;
  environment: "development" | "production";
  label: string;
  packVersion: string | null;
  companion: CompanionScanSummary;
  combatLogs: DevToolsCombatLog[];
  killFeed: KillFeedSummary;
  definitions: DevToolsDefinitionLoad[];
}

export function buildSessionDossier(input: {
  startedAt: string;
  endedAt: string;
  pid: number | null;
  serverId: ServerId;
  role: PlayerRole;
  environment: "development" | "production";
  label: string;
  packVersion: string | null;
  companion: CompanionScanSummary;
  combatLogs: readonly DevToolsCombatLog[];
  killFeed: KillFeedSummary;
  definitions: readonly DevToolsDefinitionLoad[];
}): SessionDossier {
  const startedMs = Date.parse(input.startedAt);
  const endedMs = Date.parse(input.endedAt);
  return {
    schemaVersion: 1,
    note: "Redacted ROTK operator session. Player keys, launch tickets and session gateway URLs are omitted.",
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    durationMs: Number.isFinite(startedMs) && Number.isFinite(endedMs)
      ? Math.max(0, endedMs - startedMs)
      : 0,
    pid: input.pid,
    serverId: input.serverId,
    role: input.role,
    environment: input.environment,
    label: input.label,
    packVersion: input.packVersion,
    companion: {
      ...input.companion,
      flags: input.companion.flags.map((flag) => ({
        ...flag,
        title: redactSensitiveText(flag.title),
        name: redactSensitiveText(flag.name),
      })),
    },
    combatLogs: input.combatLogs.map((entry) => ({
      ...entry,
      excerpt: entry.excerpt ? tailCombatLog(entry.excerpt) : null,
    })),
    killFeed: {
      kills: input.killFeed.kills,
      headshots: input.killFeed.headshots,
      windowStartedAt: input.killFeed.windowStartedAt,
      windowEndedAt: input.killFeed.windowEndedAt,
      players: input.killFeed.players.map((player) => ({ ...player })),
    },
    definitions: [...input.definitions],
  };
}

export function sessionDossierFileName(endedAt: string): string {
  return `session-${endedAt.replace(/[:.]/g, "-")}.json`;
}
