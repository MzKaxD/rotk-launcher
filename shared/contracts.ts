export type LauncherPhase =
  | "unconfigured"
  | "source-selected"
  | "destination-selected"
  | "installing"
  | "ready"
  | "launching"
  | "running"
  | "error";

export interface PublishedUpdate {
  id: string;
  type: "dev" | "patch";
  title: string;
  summary: string;
  version: string | null;
  category: string;
  coverImageUrl: string;
  publishedAt: string;
  siteUrl: string;
}

export interface InstallProgress {
  phase: "scanning" | "copying" | "verifying" | "configuring" | "finalizing";
  completedBytes: number;
  totalBytes: number;
  filesCompleted: number;
  totalFiles: number;
  currentFile: string;
}

export interface InstallSelection {
  sourceRoot: string | null;
  destinationRoot: string | null;
  sourceKind: ClientSourceKind | null;
  /** The source was found by automatic Steam discovery, not a manual pick. */
  sourceDetected: boolean;
  /** The destination is the launcher-suggested default, not a manual pick. */
  destinationRecommended: boolean;
}

export type ClientSourceKind = "direct" | "copy-required";

export type AssetSyncStatus =
  | "idle"
  | "disabled"
  | "checking"
  | "downloading"
  | "installing"
  | "up-to-date"
  | "warning"
  | "error";

/** Localizable warning identifiers so the renderer picks the wording. */
export type AssetSyncWarning = "feed-unavailable" | "sync-failed";

export interface AssetSyncProgress {
  phase: "checking" | "downloading" | "installing";
  assetName: string;
  assetsCompleted: number;
  totalAssets: number;
  completedBytes: number;
  totalBytes: number;
}

export interface AssetSyncSummary {
  enabled: boolean;
  status: AssetSyncStatus;
  /** Pack version of the last completed sync, if any. */
  packVersion: string | null;
  lastSyncAt: string | null;
  progress: AssetSyncProgress | null;
  warning: AssetSyncWarning | null;
}

export interface ServerOption {
  id: ServerId;
  label: string;
  environment: "development" | "production";
  websiteOrigin: string;
  /** Live population. Null players means the server could not be reached. */
  players: number | null;
  capacity: number | null;
}

export interface RuntimeSummary {
  /** Server the next launch targets. */
  serverId: ServerId;
  environment: "development" | "production";
  label: string;
  websiteOrigin: string;
  /** Live population of the selected server; null while unknown. */
  players: number | null;
  capacity: number | null;
  /** Every selectable server, so the renderer never invents an identifier. */
  servers: ServerOption[];
}

export interface PlayerIdentitySummary {
  serverId: ServerId;
  /** Role the next launch runs under. */
  role: PlayerRole;
  /** A key is stored for the active server and role. */
  configured: boolean;
  /** Every server/role slot. Null when the slot holds no key yet. */
  keys: Record<LaunchProfileId, string | null>;
}

export type LauncherUpdateStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "update-available"
  | "downloading"
  | "downloaded"
  | "error";

export interface LauncherUpdateSummary {
  status: LauncherUpdateStatus;
  availableVersion: string | null;
  progressPercent: number | null;
  error: string | null;
}

/**
 * Progress of the pre-launch integrity check. Null when idle; hashing the whole
 * installation takes minutes on a first run and seconds afterwards (cached).
 */
export interface IntegrityCheckSummary {
  hashedFiles: number;
  totalFiles: number;
  hashedBytes: number;
  totalBytes: number;
}

export type DevToolsLogLevel = "info" | "warn" | "error";

export type CompanionFlagCategory = "cheat" | "injector" | "debugger";

export interface CompanionScanFlag {
  name: string;
  pid: number;
  title: string;
  category: CompanionFlagCategory;
  matchedOn: "name" | "title";
}

export interface CompanionScanSummary {
  status: "idle" | "ok" | "unavailable";
  scannedAt: string | null;
  processCount: number;
  flags: CompanionScanFlag[];
  error: string | null;
}

export interface DevToolsLogEntry {
  at: string;
  level: DevToolsLogLevel;
  message: string;
}

export type AttestationDevStatus = "idle" | "attested" | "not-applicable" | "unavailable";

export interface DevToolsFileCheck {
  name: string;
  present: boolean;
}

export interface DevToolsInstallHealth {
  ok: boolean;
  error: string | null;
  markerPresent: boolean;
  markerInstallId: string | null;
  markerBuildId: string | null;
  markerInstalledAt: string | null;
  markerMatchesConfig: boolean | null;
  files: DevToolsFileCheck[];
}

export interface DevToolsSecurity {
  sandbox: boolean;
  contextIsolation: boolean;
  nodeIntegration: boolean;
  webSecurity: boolean;
  encryptionAvailable: boolean;
}

export interface DevToolsCombatLog {
  name: string;
  excerpt: string | null;
  path: string | null;
  updatedAt: string | null;
  highlights: string[];
}

export interface DevToolsDefinitionLoad {
  name: string;
  count: number;
}

export interface KillFeedPlayerSummary {
  name: string;
  kills: number;
  deaths: number;
  headshots: number;
  headshotPercent: number;
  minKillGapMs: number | null;
}

/** Review hint only — battle-royale kills are often 2–4s apart. */
export const TIGHT_KILL_GAP_MS = 1_500;

export interface OperatorConnection {
  loginSessionId: string;
  name: string;
  ip: string;
  at: string;
}

export interface OperatorIpBan {
  ip: string;
  reason: string;
  at: string;
  active: boolean;
}

export type OperatorRemoteStatus = "idle" | "unavailable" | "forbidden" | "ok";

export interface OperatorRemoteFeed {
  status: OperatorRemoteStatus;
  role: "moderator" | "admin" | null;
  sessions: OperatorConnection[];
  bans: OperatorIpBan[];
  error: string | null;
  fetchedAt: string | null;
}

export interface KillFeedSummary {
  kills: number;
  headshots: number;
  windowStartedAt: string | null;
  windowEndedAt: string | null;
  players: KillFeedPlayerSummary[];
}

/**
 * Operator diagnostics. Never includes player keys, launch tickets,
 * session gateway URLs, or process command lines. The operator panel is
 * available in unpackaged and packaged launches. Chromium inspector stays
 * unpackaged-only.
 */
export interface DevToolsSnapshot {
  note: string;
  capturedAt: string;
  appVersion: string;
  electronVersion: string;
  chromeVersion: string;
  nodeVersion: string;
  packaged: boolean;
  isolatedUserData: boolean;
  viteDevServer: boolean;
  security: DevToolsSecurity;
  paths: {
    userData: string;
    appPath: string;
    logsRoot: string;
    installationRoot: string | null;
    installationRealPath: string | null;
    sourceRoot: string | null;
    destinationRoot: string | null;
  };
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

export interface LauncherSnapshot {
  appVersion: string;
  phase: LauncherPhase;
  selection: InstallSelection;
  installationRoot: string | null;
  updates: PublishedUpdate[];
  runtime: RuntimeSummary;
  playerIdentity: PlayerIdentitySummary;
  launcherUpdate: LauncherUpdateSummary;
  assetSync: AssetSyncSummary;
  integrityCheck: IntegrityCheckSummary | null;
  progress: InstallProgress | null;
  error: string | null;
  gamePid: number | null;
  /** The server refused a launch for an out-of-date launcher; Play is blocked
   *  until a newer version is installed. */
  updateRequired: boolean;
  canPlay: boolean;
  /** Present in unpackaged builds, and in packaged admin launches with a key. */
  devTools: DevToolsSnapshot | null;
}

export interface OperationResult<T = undefined> {
  ok: boolean;
  value?: T;
  error?: string;
  cancelled?: boolean;
}

export interface RotkLauncherApi {
  getSnapshot(): Promise<LauncherSnapshot>;
  setLocale(locale: AppLocale): Promise<void>;
  /** Selects the server and the role a launch runs under, in one operation. */
  setLaunchProfile(serverId: ServerId, role: PlayerRole): Promise<OperationResult<LauncherSnapshot>>;
  setPlayerKey(profile: LaunchProfileId, playerKey: string): Promise<OperationResult<PlayerIdentitySummary>>;
  clearPlayerKey(profile: LaunchProfileId): Promise<OperationResult<PlayerIdentitySummary>>;
  copyPlayerKey(profile: LaunchProfileId): Promise<OperationResult>;
  detectSource(): Promise<OperationResult<{ sourceRoot: string | null }>>;
  selectSource(): Promise<OperationResult<{ sourceRoot: string }>>;
  selectDestination(): Promise<OperationResult<{ destinationRoot: string }>>;
  install(): Promise<OperationResult<{ installationRoot: string }>>;
  cancelInstall(): Promise<void>;
  play(): Promise<OperationResult<{ pid: number }>>;
  /** Opens a ROTK site path; `serverId` picks which site, defaulting to the selected one. */
  openWebsite(path: string, serverId?: ServerId): Promise<OperationResult>;
  checkLauncherUpdate(): Promise<void>;
  downloadLauncherUpdate(): Promise<OperationResult>;
  installLauncherUpdate(): Promise<OperationResult>;
  verifyAssets(): Promise<OperationResult>;
  restoreVanillaAssets(): Promise<OperationResult>;
  setAssetSyncEnabled(enabled: boolean): Promise<OperationResult>;
  copyDevDiagnostics(): Promise<OperationResult>;
  exportDevDiagnostics(): Promise<OperationResult>;
  openUserDataFolder(): Promise<OperationResult>;
  openLogsFolder(): Promise<OperationResult>;
  openGameLogsFolder(): Promise<OperationResult>;
  openSessionsFolder(): Promise<OperationResult>;
  captureSessionDossier(): Promise<OperationResult>;
  clearDevLogs(): Promise<OperationResult>;
  openChromiumDevTools(): Promise<OperationResult>;
  reloadRenderer(): Promise<OperationResult>;
  revalidateInstall(): Promise<OperationResult>;
  scanCompanionProcesses(): Promise<OperationResult>;
  banOperatorIp(ip: string, reason?: string): Promise<OperationResult>;
  minimizeWindow(): Promise<void>;
  closeWindow(): Promise<void>;
  onSnapshot(listener: (snapshot: LauncherSnapshot) => void): () => void;
}

export const IPC_CHANNELS = {
  getSnapshot: "launcher:get-snapshot",
  setLocale: "launcher:set-locale",
  setLaunchProfile: "launcher:set-launch-profile",
  setPlayerKey: "launcher:set-player-key",
  clearPlayerKey: "launcher:clear-player-key",
  copyPlayerKey: "launcher:copy-player-key",
  detectSource: "launcher:detect-source",
  selectSource: "launcher:select-source",
  selectDestination: "launcher:select-destination",
  install: "launcher:install",
  cancelInstall: "launcher:cancel-install",
  play: "launcher:play",
  openWebsite: "launcher:open-website",
  checkLauncherUpdate: "launcher:update-check",
  downloadLauncherUpdate: "launcher:update-download",
  installLauncherUpdate: "launcher:update-install",
  verifyAssets: "asset-sync:verify",
  restoreVanillaAssets: "asset-sync:restore",
  setAssetSyncEnabled: "asset-sync:set-enabled",
  copyDevDiagnostics: "devtools:copy-diagnostics",
  exportDevDiagnostics: "devtools:export-diagnostics",
  openUserDataFolder: "devtools:open-user-data",
  openLogsFolder: "devtools:open-logs",
  openGameLogsFolder: "devtools:open-game-logs",
  openSessionsFolder: "devtools:open-sessions",
  captureSessionDossier: "devtools:capture-session",
  clearDevLogs: "devtools:clear-logs",
  openChromiumDevTools: "devtools:open-chromium",
  reloadRenderer: "devtools:reload-renderer",
  revalidateInstall: "devtools:revalidate-install",
  scanCompanionProcesses: "devtools:scan-companion-processes",
  banOperatorIp: "devtools:ban-ip",
  minimizeWindow: "window:minimize",
  closeWindow: "window:close",
  snapshotChanged: "launcher:snapshot-changed",
} as const;
import type { AppLocale } from "./locale.js";
import type { LaunchProfileId, PlayerRole, ServerId } from "./launch-profile.js";
