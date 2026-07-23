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
}

export type ClientSourceKind = "direct" | "copy-required";

export interface RuntimeSummary {
  environment: "development" | "production";
  label: string;
  websiteOrigin: string;
}

export interface PlayerIdentitySummary {
  configured: boolean;
  playerKey: string | null;
}

export interface LauncherSnapshot {
  appVersion: string;
  phase: LauncherPhase;
  selection: InstallSelection;
  installationRoot: string | null;
  updates: PublishedUpdate[];
  runtime: RuntimeSummary;
  playerIdentity: PlayerIdentitySummary;
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
  selectSource(): Promise<OperationResult<{ sourceRoot: string }>>;
  selectDestination(): Promise<OperationResult<{ destinationRoot: string }>>;
  install(): Promise<OperationResult<{ installationRoot: string }>>;
  cancelInstall(): Promise<void>;
  play(): Promise<OperationResult<{ pid: number }>>;
  openWebsite(path: string): Promise<OperationResult>;
  minimizeWindow(): Promise<void>;
  closeWindow(): Promise<void>;
  onSnapshot(listener: (snapshot: LauncherSnapshot) => void): () => void;
}

export const IPC_CHANNELS = {
  getSnapshot: "launcher:get-snapshot",
  setLocale: "launcher:set-locale",
  setPlayerKey: "launcher:set-player-key",
  copyPlayerKey: "launcher:copy-player-key",
  selectSource: "launcher:select-source",
  selectDestination: "launcher:select-destination",
  install: "launcher:install",
  cancelInstall: "launcher:cancel-install",
  play: "launcher:play",
  openWebsite: "launcher:open-website",
  minimizeWindow: "window:minimize",
  closeWindow: "window:close",
  snapshotChanged: "launcher:snapshot-changed",
} as const;
import type { AppLocale } from "./locale.js";
