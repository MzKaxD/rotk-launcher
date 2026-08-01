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

export interface RuntimeSummary {
  environment: "development" | "production";
  label: string;
  websiteOrigin: string;
}

export interface PlayerIdentitySummary {
  configured: boolean;
  playerKey: string | null;
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
  canPlay: boolean;
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
  setPlayerKey(playerKey: string): Promise<OperationResult<PlayerIdentitySummary>>;
  copyPlayerKey(): Promise<OperationResult>;
  detectSource(): Promise<OperationResult<{ sourceRoot: string | null }>>;
  selectSource(): Promise<OperationResult<{ sourceRoot: string }>>;
  selectDestination(): Promise<OperationResult<{ destinationRoot: string }>>;
  install(): Promise<OperationResult<{ installationRoot: string }>>;
  cancelInstall(): Promise<void>;
  play(): Promise<OperationResult<{ pid: number }>>;
  openWebsite(path: string): Promise<OperationResult>;
  checkLauncherUpdate(): Promise<void>;
  downloadLauncherUpdate(): Promise<OperationResult>;
  installLauncherUpdate(): Promise<OperationResult>;
  verifyAssets(): Promise<OperationResult>;
  restoreVanillaAssets(): Promise<OperationResult>;
  setAssetSyncEnabled(enabled: boolean): Promise<OperationResult>;
  minimizeWindow(): Promise<void>;
  closeWindow(): Promise<void>;
  onSnapshot(listener: (snapshot: LauncherSnapshot) => void): () => void;
}

export const IPC_CHANNELS = {
  getSnapshot: "launcher:get-snapshot",
  setLocale: "launcher:set-locale",
  setPlayerKey: "launcher:set-player-key",
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
  minimizeWindow: "window:minimize",
  closeWindow: "window:close",
  snapshotChanged: "launcher:snapshot-changed",
} as const;
import type { AppLocale } from "./locale.js";
