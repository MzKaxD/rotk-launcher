import type {
  AttestationDevStatus,
  CompanionScanSummary,
  DevToolsCombatLog,
  DevToolsDefinitionLoad,
  DevToolsInstallHealth,
  DevToolsLogEntry,
  DevToolsLogLevel,
  DevToolsSecurity,
  DevToolsSnapshot,
  KillFeedSummary,
  LauncherPhase,
  OperatorConnection,
  OperatorIpBan,
  OperatorRemoteFeed,
  LauncherUpdateStatus,
  AssetSyncStatus,
} from "../../shared/contracts.js";
import type { LaunchProfileId, PlayerRole, ServerId } from "../../shared/launch-profile.js";

export const DEV_TOOLS_NOTE =
  "ROTK launcher operator diagnostics. Player keys, launch tickets, session gateway URLs and process command lines are omitted.";

export const DEV_LOG_LIMIT = 80;
export const COMBAT_LOG_MAX_LINES = 40;
export const COMBAT_LOG_MAX_CHARS = 12_000;

const HEX_KEY = /\b[0-9a-fA-F]{32}\b/g;
const SESSION_ID_ARGUMENT = /sessionid=[^&\s"]+/gi;
const SESSION_ID_XML = /<sessionid>[^<]*<\/sessionid>/gi;
const GATEWAY_URL = /https?:\/\/127\.0\.0\.1:\d+\/rest\/auth\/session\/create/gi;
const CLIENT_CONFIG_SECRET_LINES = /^(sessionid|SteamGatewayUrl)\s*=.*$/gim;
const CLIENT_CONFIG_LIMIT = 32_000;

export function redactSensitiveText(value: string): string {
  return value
    .replace(HEX_KEY, "[redacted-key]")
    .replace(SESSION_ID_ARGUMENT, "sessionid=[redacted]")
    .replace(SESSION_ID_XML, "<sessionid>[redacted]</sessionid>")
    .replace(GATEWAY_URL, "http://127.0.0.1:[redacted]/rest/auth/session/create");
}

export function redactClientConfig(value: string): string {
  const trimmed = value.length > CLIENT_CONFIG_LIMIT
    ? `${value.slice(0, CLIENT_CONFIG_LIMIT)}\n…`
    : value;
  const withoutSecrets = trimmed.replace(CLIENT_CONFIG_SECRET_LINES, (line) => {
    const key = line.split("=")[0]?.trim() ?? "unknown";
    return `${key}=[redacted]`;
  });
  return redactSensitiveText(withoutSecrets);
}

export function operatorToolsAvailable(_input: {
  packaged: boolean;
  role: PlayerRole;
  adminKeyConfigured: boolean;
}): boolean {
  return true;
}

export function tailCombatLog(
  value: string,
  maxLines = COMBAT_LOG_MAX_LINES,
  maxChars = COMBAT_LOG_MAX_CHARS,
): string {
  const trimmed = value.length > maxChars ? value.slice(-maxChars) : value;
  const lines = trimmed.replace(/\r\n/g, "\n").split("\n");
  return redactSensitiveText(lines.slice(-maxLines).join("\n").trimEnd());
}

export class DevLogBuffer {
  private entries: DevToolsLogEntry[] = [];

  push(level: DevToolsLogLevel, message: string, at = new Date()): void {
    this.entries.push({
      at: at.toISOString(),
      level,
      message: redactSensitiveText(message),
    });
    if (this.entries.length > DEV_LOG_LIMIT) {
      this.entries = this.entries.slice(-DEV_LOG_LIMIT);
    }
  }

  clear(): void {
    this.entries = [];
  }

  list(): DevToolsLogEntry[] {
    return [...this.entries];
  }
}

export interface DevToolsInput {
  appVersion: string;
  electronVersion: string;
  chromeVersion: string;
  nodeVersion: string;
  packaged: boolean;
  isolatedUserData: boolean;
  viteDevServer: boolean;
  security: DevToolsSecurity;
  paths: DevToolsSnapshot["paths"];
  launch: {
    phase: LauncherPhase;
    gamePid: number | null;
    gameRunning: boolean;
    canPlay: boolean;
    updateRequired: boolean;
    sessionGatewayListening: boolean;
    attestation: {
      status: AttestationDevStatus;
      reason: string | null;
    };
  };
  runtime: {
    serverId: ServerId;
    role: PlayerRole;
    environment: "development" | "production";
    label: string;
    websiteOrigin: string;
    gatewayOrigin: string;
    voiceGrantOrigin: string;
    loginList: string;
    launchTicketUrl: string;
    attestationChallengeUrl: string;
  };
  identityConfigured: Record<LaunchProfileId, boolean>;
  assetSync: {
    enabled: boolean;
    status: AssetSyncStatus;
    packVersion: string | null;
  };
  launcherUpdate: {
    status: LauncherUpdateStatus;
    availableVersion: string | null;
  };
  installHealth: DevToolsInstallHealth;
  clientConfig: string | null;
  ipcChannels: string[];
  companionScan: CompanionScanSummary;
  combatLogs: DevToolsCombatLog[];
  killFeed: KillFeedSummary;
  definitions: DevToolsDefinitionLoad[];
  preferTestServer: boolean;
  operatorWatching: boolean;
  lastSessionDossier: string | null;
  operatorConnections: OperatorConnection[];
  operatorIpBans: OperatorIpBan[];
  operatorRemote: OperatorRemoteFeed;
  logs: DevToolsLogEntry[];
}

export function buildDevToolsSnapshot(input: DevToolsInput, now = new Date()): DevToolsSnapshot {
  return {
    note: DEV_TOOLS_NOTE,
    capturedAt: now.toISOString(),
    appVersion: input.appVersion,
    electronVersion: input.electronVersion,
    chromeVersion: input.chromeVersion,
    nodeVersion: input.nodeVersion,
    packaged: input.packaged,
    isolatedUserData: input.isolatedUserData,
    viteDevServer: input.viteDevServer,
    security: input.security,
    paths: input.paths,
    launch: {
      ...input.launch,
      attestation: {
        status: input.launch.attestation.status,
        reason: input.launch.attestation.reason
          ? redactSensitiveText(input.launch.attestation.reason)
          : null,
      },
    },
    runtime: input.runtime,
    identityConfigured: input.identityConfigured,
    assetSync: input.assetSync,
    launcherUpdate: input.launcherUpdate,
    installHealth: {
      ...input.installHealth,
      error: input.installHealth.error
        ? redactSensitiveText(input.installHealth.error)
        : null,
    },
    clientConfig: input.clientConfig ? redactClientConfig(input.clientConfig) : null,
    ipcChannels: [...input.ipcChannels],
    companionScan: input.companionScan,
    combatLogs: input.combatLogs.map((entry) => ({
      name: entry.name,
      excerpt: entry.excerpt ? tailCombatLog(entry.excerpt) : null,
      path: entry.path,
      updatedAt: entry.updatedAt,
      highlights: [...entry.highlights],
    })),
    killFeed: {
      kills: input.killFeed.kills,
      headshots: input.killFeed.headshots,
      windowStartedAt: input.killFeed.windowStartedAt,
      windowEndedAt: input.killFeed.windowEndedAt,
      players: input.killFeed.players.map((player) => ({ ...player })),
    },
    definitions: [...input.definitions],
    preferTestServer: input.preferTestServer,
    operatorWatching: input.operatorWatching,
    lastSessionDossier: input.lastSessionDossier,
    operatorConnections: input.operatorConnections.map((entry) => ({ ...entry })),
    operatorIpBans: input.operatorIpBans.map((entry) => ({ ...entry })),
    operatorRemote: {
      ...input.operatorRemote,
      sessions: input.operatorRemote.sessions.map((entry) => ({ ...entry })),
      bans: input.operatorRemote.bans.map((entry) => ({ ...entry })),
    },
    logs: input.logs.map((entry) => ({
      ...entry,
      message: redactSensitiveText(entry.message),
    })),
  };
}

export function formatDevDiagnostics(snapshot: DevToolsSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}
