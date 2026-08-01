import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { join, basename, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  safeStorage,
  session,
  shell,
  type IpcMainInvokeEvent,
} from "electron";
import {
  IPC_CHANNELS,
  type AssetSyncProgress,
  type AssetSyncStatus,
  type AssetSyncSummary,
  type AssetSyncWarning,
  type ClientSourceKind,
  type LauncherPhase,
  type LauncherSnapshot,
  type OperationResult,
  type PlayerIdentitySummary,
} from "../shared/contracts.js";
import { isAppLocale, type AppLocale } from "../shared/locale.js";
import {
  APP_NAME,
  RECOMMENDED_INSTALL_PARENT_NAME,
  ROTK_INSTALL_DIRECTORY_NAME,
  WEBSITE_ORIGIN,
  resolveBundledShimPath,
  resolveBundledVivoxProxyPath,
  resolveBundledVivoxRuntimePath,
} from "./constants.js";
import { ConfigStore } from "./services/config-store.js";
import { adoptExistingClient, installClient } from "./services/installer.js";
import { GameLauncher, validateInstalledClient } from "./services/game-launcher.js";
import { classifyClientSource, validateInstallDestination } from "./services/path-policy.js";
import { locateSteamClient } from "./services/steam-locator.js";
import { DEFAULT_RUNTIME_CONFIG } from "./services/runtime-config.js";
import { UpdateFeedService } from "./services/update-feed.js";
import { AssetSyncService } from "./services/asset-sync.js";
import { LauncherUpdateService } from "./services/launcher-update.js";
import electronUpdater from "electron-updater";
import { localizeServiceError, MAIN_COPY } from "./i18n.js";
import {
  identityFromPlayerKey,
  type PlayerIdentity,
} from "./services/player-identity.js";
import { PlayerKeyStore } from "./services/player-key-store.js";
import { readInstallationMarker } from "./services/installer.js";
import {
  BASE_MANIFEST_URL,
  loadBaseManifest,
  mergeExpectedFiles,
  readLauncherOverrides,
} from "./services/base-manifest.js";
import {
  buildAttestationResult,
  measureInstallation,
  requestAttestationChallenge,
  type AttestationProgress,
} from "./services/integrity-attestation.js";

app.setName(APP_NAME);
if (!app.isPackaged && process.env.ROTK_USER_DATA_DIR) {
  app.setPath("userData", resolve(process.env.ROTK_USER_DATA_DIR));
} else {
  // Keep the installation record stable across launcher versions, executable
  // names and installation directories. Electron's implicit directory is
  // product-name based, which made development and packaged builds drift.
  app.setPath("userData", join(app.getPath("appData"), APP_NAME));
}
const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) app.quit();

const usesIsolatedDevelopmentData = !app.isPackaged && Boolean(process.env.ROTK_USER_DATA_DIR);
const legacyUserDataDirectories = usesIsolatedDevelopmentData
  ? []
  : [
      ...["rotk-launcher", "h1z1-server-kotk"].map((name) => join(app.getPath("appData"), name)),
      ...(!app.isPackaged ? [join(app.getAppPath(), ".dev-data")] : []),
    ];

let mainWindow: BrowserWindow | null = null;
let configStore: ConfigStore;
let playerKeyStore: PlayerKeyStore;
let updateFeed: UpdateFeedService;
let assetSync: AssetSyncService;
let launcherUpdate: LauncherUpdateService;
const gameLauncher = new GameLauncher();
const LAUNCHER_UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1_000;
let installAbortController: AbortController | null = null;
let phase: LauncherPhase = "unconfigured";
let sourceRoot: string | null = null;
let destinationRoot: string | null = null;
let sourceKind: ClientSourceKind | null = null;
let sourceDetected = false;
let destinationRecommended = false;
let progress: LauncherSnapshot["progress"] = null;
let updates: LauncherSnapshot["updates"] = [];
let lastErrorRaw: string | null = null;
let gamePid: number | null = null;
let currentLocale: AppLocale = "en";
let playerIdentity: PlayerIdentity | null = null;
let quitWhenGameExits = false;
let assetSyncEnabled = true;
let assetSyncRunning = false;
let assetSyncStatus: AssetSyncStatus = "idle";
let assetSyncWarning: AssetSyncWarning | null = null;
let assetSyncProgress: AssetSyncProgress | null = null;
let attestationProgress: AttestationProgress | null = null;
let assetSyncPackVersion: string | null = null;
let assetSyncLastAt: string | null = null;

function rawErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") return "Installation annulée.";
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (typeof code === "string" && /^[A-Z0-9_]+$/.test(code)) return `Erreur système (${code}).`;
    return error.message;
  }
  return "Une erreur inattendue est survenue.";
}

function errorMessage(error: unknown): string {
  return localizeServiceError(rawErrorMessage(error), currentLocale);
}

async function installationRoot(): Promise<string | null> {
  return (await configStore.load()).installation?.root ?? null;
}

function recommendedDestinationPath(): string {
  const systemDrive = process.env.SystemDrive ?? "C:";
  return join(`${systemDrive}${sep}`, RECOMMENDED_INSTALL_PARENT_NAME, ROTK_INSTALL_DIRECTORY_NAME);
}

/**
 * Pre-fill the ROTK destination with the recommended default so a detected or
 * freshly selected Steam client only needs one Install click. Best-effort: an
 * already existing folder (the installer requires an empty target) or a
 * failing path policy leaves the destination for manual selection.
 */
async function applyRecommendedDestination(): Promise<void> {
  if (sourceKind !== "copy-required" || !sourceRoot) return;
  try {
    const candidate = recommendedDestinationPath();
    const existing = await stat(candidate).catch(() => null);
    if (existing) return;
    destinationRoot = await validateInstallDestination(candidate, sourceRoot);
    destinationRecommended = true;
    phase = "destination-selected";
  } catch {
    destinationRoot = null;
    destinationRecommended = false;
  }
}

function assetSyncSummary(): AssetSyncSummary {
  return {
    enabled: assetSyncEnabled,
    status: assetSyncEnabled ? assetSyncStatus : "disabled",
    packVersion: assetSyncPackVersion,
    lastSyncAt: assetSyncLastAt,
    progress: assetSyncProgress,
    warning: assetSyncWarning,
  };
}

/**
 * Synchronize the custom asset packs with the published feed. With `soft`,
 * a failure after at least one completed sync is downgraded to a warning so
 * the feed never prevents the game from launching with the assets on disk.
 */
async function runAssetSync(mode: "sync" | "verify", soft: boolean): Promise<OperationResult> {
  const root = await installationRoot();
  if (!root) return { ok: false, error: MAIN_COPY[currentLocale].clientNotReady };
  if (!assetSyncEnabled) return { ok: true };
  if (assetSyncRunning) return { ok: false, error: MAIN_COPY[currentLocale].assets.busy };
  assetSyncRunning = true;
  assetSyncStatus = "checking";
  assetSyncWarning = null;
  assetSyncProgress = null;
  await broadcastSnapshot();
  try {
    const outcome = mode === "verify" ? await assetSync.verify(root) : await assetSync.sync(root);
    assetSyncPackVersion = outcome.packVersion;
    assetSyncLastAt = new Date().toISOString();
    if (outcome.status === "offline-warning") {
      assetSyncStatus = "warning";
      assetSyncWarning = "feed-unavailable";
    } else {
      assetSyncStatus = "up-to-date";
    }
    return { ok: true };
  } catch (error) {
    if (soft && (await assetSync.readState().catch(() => null))) {
      assetSyncStatus = "warning";
      assetSyncWarning = "sync-failed";
      return { ok: true };
    }
    assetSyncStatus = "error";
    return operationError(error);
  } finally {
    assetSyncRunning = false;
    assetSyncProgress = null;
    await broadcastSnapshot();
  }
}

/**
 * Runs one integrity attestation pass and returns the block the launch ticket
 * request carries. Returns null only when attestation genuinely cannot run
 * (no policy published, manifest unreachable and never cached) — it is the
 * backend, not the launcher, that decides whether a null is acceptable.
 *
 * A tampered installation still attests: the deviations are reported and the
 * evidence will not match, so the rejection is logged for the admin studio
 * instead of being silently hidden by the client.
 */
async function attestInstallation(playerKey: string): Promise<unknown | null> {
  const root = await installationRoot();
  if (!root) return null;
  const userDataDirectory = app.getPath("userData");
  const launcherVersion = app.getVersion();
  try {
    const marker = await readInstallationMarker(root);
    if (!marker) return null;

    const challenge = await requestAttestationChallenge(
      playerKey,
      DEFAULT_RUNTIME_CONFIG.attestationChallengeUrl,
      launcherVersion,
    );
    const baseManifest = await loadBaseManifest({
      url: BASE_MANIFEST_URL,
      userDataDirectory,
      expectedBuildId: challenge.baseBuildId,
    });
    const assetState = await assetSync.readState().catch(() => null);
    const installedAssets = (assetState?.assets ?? []).flatMap((asset) =>
      asset.installedFiles.map((file) => ({
        path: file.path,
        size: file.size,
        sha256: file.sha256,
      })));
    // The shim replaces steam_api64.dll: expect the launcher's artifact, not
    // the vanilla hash, so the file stays attested instead of excluded.
    const overrides = await readLauncherOverrides([
      { installPath: "steam_api64.dll", bundledPath: resolveBundledShimPath() },
    ]);

    const measurement = await measureInstallation({
      installationRoot: root,
      userDataDirectory,
      expected: mergeExpectedFiles(baseManifest.files, installedAssets, overrides),
      // Report undeclared .pack2/.dll/.exe dropped into the game tree. Costs
      // one directory walk; the per-file hashing dominates anyway.
      detectUnexpected: true,
      onProgress: (progress) => {
        attestationProgress = progress.phase === "done" ? null : progress;
        void broadcastSnapshot();
      },
    });
    attestationProgress = null;
    if (measurement.deviations.length > 0) {
      console.warn(
        `Integrity attestation found ${measurement.deviations.length} deviation(s); reporting them.`,
      );
    }
    return buildAttestationResult(challenge, measurement, launcherVersion);
  } catch (error) {
    attestationProgress = null;
    // A challenge or manifest we cannot obtain is reported as "no attestation";
    // the backend applies its enforcement policy to that.
    console.warn("Integrity attestation could not complete", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}

async function snapshot(): Promise<LauncherSnapshot> {
  const configuredRoot = await installationRoot();
  return {
    appVersion: app.getVersion(),
    phase,
    selection: { sourceRoot, destinationRoot, sourceKind, sourceDetected, destinationRecommended },
    installationRoot: configuredRoot,
    updates,
    runtime: {
      environment: DEFAULT_RUNTIME_CONFIG.environment,
      label: DEFAULT_RUNTIME_CONFIG.label,
      websiteOrigin: DEFAULT_RUNTIME_CONFIG.websiteOrigin,
    },
    playerIdentity: identitySummary(),
    launcherUpdate: launcherUpdate.state,
    assetSync: assetSyncSummary(),
    integrityCheck: attestationProgress
      ? {
        hashedFiles: attestationProgress.hashedFiles,
        totalFiles: attestationProgress.totalFiles,
        hashedBytes: attestationProgress.hashedBytes,
        totalBytes: attestationProgress.totalBytes,
      }
      : null,
    progress,
    error: lastErrorRaw ? localizeServiceError(lastErrorRaw, currentLocale) : null,
    gamePid,
    canPlay:
      phase === "ready"
      && configuredRoot !== null
      && playerIdentity !== null
      && !gameLauncher.isRunning(),
  };
}

function identitySummary(): PlayerIdentitySummary {
  return {
    configured: playerIdentity !== null,
    playerKey: playerIdentity?.playerKey ?? null,
  };
}

async function broadcastSnapshot(): Promise<void> {
  const value = await snapshot();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC_CHANNELS.snapshotChanged, value);
  }
}

function ensureTrustedSender(event: IpcMainInvokeEvent): void {
  if (
    !mainWindow
    || mainWindow.isDestroyed()
    || event.sender !== mainWindow.webContents
    || event.senderFrame !== mainWindow.webContents.mainFrame
  ) {
    throw new Error("Untrusted IPC sender");
  }
  const senderUrl = event.senderFrame?.url ?? "";
  if (!isTrustedRendererUrl(senderUrl)) throw new Error("Untrusted IPC sender");
}

function isTrustedRendererUrl(candidate: string): boolean {
  try {
    const developmentServerUrl = process.env.VITE_DEV_SERVER_URL;
    if (!app.isPackaged && developmentServerUrl) {
      const developmentOrigin = new URL(developmentServerUrl).origin;
      return new URL(candidate).origin === developmentOrigin;
    }

    const parsed = new URL(candidate);
    if (parsed.protocol !== "file:") return false;
    parsed.hash = "";
    parsed.search = "";
    const expected = resolve(join(app.getAppPath(), "dist", "index.html")).toLocaleLowerCase("en-US");
    const actual = resolve(fileURLToPath(parsed)).toLocaleLowerCase("en-US");
    return actual === expected;
  } catch {
    return false;
  }
}

function trustedHandler<T extends unknown[], R>(
  handler: (event: IpcMainInvokeEvent, ...args: T) => Promise<R> | R,
): (event: IpcMainInvokeEvent, ...args: T) => Promise<R> {
  return async (event, ...args) => {
    ensureTrustedSender(event);
    return handler(event, ...args);
  };
}

function operationError<T = undefined>(error: unknown): OperationResult<T> {
  lastErrorRaw = rawErrorMessage(error);
  return { ok: false, error: localizeServiceError(lastErrorRaw, currentLocale) };
}

function registerIpc(): void {
  ipcMain.handle(IPC_CHANNELS.getSnapshot, trustedHandler(async () => snapshot()));
  ipcMain.handle(
    IPC_CHANNELS.setLocale,
    trustedHandler(async (_event, locale: unknown) => {
      if (!isAppLocale(locale)) throw new Error("Unsupported launcher locale");
      currentLocale = locale;
      await broadcastSnapshot();
    }),
  );
  ipcMain.handle(
    IPC_CHANNELS.setPlayerKey,
    trustedHandler(async (_event, value: unknown): Promise<OperationResult<PlayerIdentitySummary>> => {
      if (gameLauncher.isRunning() || phase === "launching" || phase === "running") {
        return { ok: false, error: MAIN_COPY[currentLocale].identityLocked };
      }
      try {
        const identity = identityFromPlayerKey(value);
        await playerKeyStore.save(identity.playerKey);
        playerIdentity = identity;
        lastErrorRaw = null;
        await broadcastSnapshot();
        return { ok: true, value: identitySummary() };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    }),
  );
  ipcMain.handle(
    IPC_CHANNELS.copyPlayerKey,
    trustedHandler(async (): Promise<OperationResult> => {
      if (!playerIdentity) return { ok: false, error: MAIN_COPY[currentLocale].keyRequired };
      clipboard.writeText(playerIdentity.playerKey);
      return { ok: true };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.detectSource,
    trustedHandler(async (): Promise<OperationResult<{ sourceRoot: string | null }>> => {
      const copy = MAIN_COPY[currentLocale];
      if (gameLauncher.isRunning() || phase === "launching" || phase === "running") {
        return { ok: false, error: copy.clientInUse };
      }
      if (installAbortController) return { ok: false, error: copy.installationInProgress };
      if (sourceRoot) return { ok: true, value: { sourceRoot } };
      try {
        const located = await locateSteamClient();
        if (!located) return { ok: true, value: { sourceRoot: null } };
        const selectedClient = await classifyClientSource(located);
        sourceRoot = selectedClient.root;
        sourceKind = selectedClient.kind;
        sourceDetected = true;
        destinationRoot = null;
        destinationRecommended = false;
        phase = "source-selected";
        await applyRecommendedDestination();
        lastErrorRaw = null;
        await broadcastSnapshot();
        return { ok: true, value: { sourceRoot } };
      } catch {
        // Discovery is best-effort: any failure simply leaves the manual flow.
        return { ok: true, value: { sourceRoot: null } };
      }
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.selectSource,
    trustedHandler(async (): Promise<OperationResult<{ sourceRoot: string }>> => {
      const copy = MAIN_COPY[currentLocale];
      if (gameLauncher.isRunning() || phase === "launching" || phase === "running") {
        return { ok: false, error: copy.clientInUse };
      }
      if (!mainWindow) return { ok: false, error: copy.windowUnavailable };
      const selected = await dialog.showOpenDialog(mainWindow, {
        title: copy.sourceDialog.title,
        message: copy.sourceDialog.message,
        buttonLabel: copy.sourceDialog.button,
        properties: ["openDirectory"],
      });
      if (selected.canceled || selected.filePaths.length === 0) return { ok: false, cancelled: true };
      try {
        const selectedClient = await classifyClientSource(selected.filePaths[0]);
        sourceRoot = selectedClient.root;
        sourceKind = selectedClient.kind;
        sourceDetected = false;
        destinationRoot = null;
        destinationRecommended = false;
        phase = "source-selected";
        await applyRecommendedDestination();
        lastErrorRaw = null;
        await broadcastSnapshot();
        return { ok: true, value: { sourceRoot } };
      } catch (error) {
        const result = operationError<{ sourceRoot: string }>(error);
        phase = "error";
        await broadcastSnapshot();
        return result;
      }
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.selectDestination,
    trustedHandler(async (): Promise<OperationResult<{ destinationRoot: string }>> => {
      const copy = MAIN_COPY[currentLocale];
      if (!sourceRoot) return { ok: false, error: copy.selectSourceFirst };
      if (sourceKind !== "copy-required") return { ok: false, error: copy.destinationNotNeeded };
      if (!mainWindow) return { ok: false, error: copy.windowUnavailable };
      const selected = await dialog.showOpenDialog(mainWindow, {
        title: copy.destinationDialog.title,
        message: copy.destinationDialog.message(ROTK_INSTALL_DIRECTORY_NAME),
        buttonLabel: copy.destinationDialog.button,
        properties: ["openDirectory", "createDirectory"],
      });
      if (selected.canceled || selected.filePaths.length === 0) return { ok: false, cancelled: true };
      try {
        const parent = selected.filePaths[0];
        const candidate = basename(parent).toLocaleLowerCase("en-US") === ROTK_INSTALL_DIRECTORY_NAME.toLocaleLowerCase("en-US")
          ? parent
          : join(parent, ROTK_INSTALL_DIRECTORY_NAME);
        destinationRoot = await validateInstallDestination(candidate, sourceRoot);
        destinationRecommended = false;
        phase = "destination-selected";
        lastErrorRaw = null;
        await broadcastSnapshot();
        return { ok: true, value: { destinationRoot } };
      } catch (error) {
        const result = operationError<{ destinationRoot: string }>(error);
        phase = "error";
        await broadcastSnapshot();
        return result;
      }
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.install,
    trustedHandler(async (): Promise<OperationResult<{ installationRoot: string }>> => {
      const copy = MAIN_COPY[currentLocale];
      if (!sourceRoot || !sourceKind) return { ok: false, error: copy.selectSourceFirst };
      if (sourceKind === "copy-required" && !destinationRoot) return { ok: false, error: copy.selectBoth };
      if (gameLauncher.isRunning() || phase === "launching" || phase === "running") {
        return { ok: false, error: copy.clientInUse };
      }
      if (installAbortController) return { ok: false, error: MAIN_COPY[currentLocale].installationInProgress };
      installAbortController = new AbortController();
      phase = "installing";
      progress = null;
      lastErrorRaw = null;
      await broadcastSnapshot();
      try {
        const onProgress = (nextProgress: NonNullable<LauncherSnapshot["progress"]>): void => {
          progress = nextProgress;
          void broadcastSnapshot();
        };
        const installationRoot = sourceKind === "direct"
          ? sourceRoot
          : destinationRoot as string;
        const marker = sourceKind === "direct"
          ? await adoptExistingClient({
              root: sourceRoot,
              shimPath: resolveBundledShimPath(),
              vivoxProxyPath: resolveBundledVivoxProxyPath(),
              vivoxRuntimePath: resolveBundledVivoxRuntimePath(),
              launcherVersion: app.getVersion(),
              onProgress,
            })
          : await installClient({
              sourceRoot,
              destinationRoot: installationRoot,
              shimPath: resolveBundledShimPath(),
              vivoxProxyPath: resolveBundledVivoxProxyPath(),
              vivoxRuntimePath: resolveBundledVivoxRuntimePath(),
              launcherVersion: app.getVersion(),
              signal: installAbortController.signal,
              onProgress,
            });
        await configStore.setInstallation({
          installId: marker.installId,
          clientBuildId: marker.clientBuildId,
          root: installationRoot,
          sourceRoot,
          installedAt: marker.installedAt,
          criticalHashes: marker.criticalHashes,
        });
        phase = "ready";
        progress = null;
        await broadcastSnapshot();
        // Best-effort first asset sync: a feed problem surfaces in the asset
        // summary without turning the completed installation into a failure.
        await runAssetSync("sync", true);
        return { ok: true, value: { installationRoot } };
      } catch (error) {
        const cancelled = installAbortController.signal.aborted;
        const result = operationError<{ installationRoot: string }>(error);
        result.cancelled = cancelled;
        phase = "error";
        progress = null;
        await broadcastSnapshot();
        return result;
      } finally {
        installAbortController = null;
      }
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.cancelInstall,
    trustedHandler(async () => {
      installAbortController?.abort(new DOMException("Installation cancelled", "AbortError"));
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.play,
    trustedHandler(async (): Promise<OperationResult<{ pid: number }>> => {
      if (phase !== "ready") return { ok: false, error: MAIN_COPY[currentLocale].clientNotReady };
      if (!playerIdentity) return { ok: false, error: MAIN_COPY[currentLocale].keyRequired };
      const launchCredential = playerIdentity;
      phase = "launching";
      lastErrorRaw = null;
      await broadcastSnapshot();
      // A discovered update must be fully downloaded and installed before
      // starting the game; launching with a partially updated asset set is unsafe.
      const assetResult = await runAssetSync("sync", false);
      if (!assetResult.ok) {
        phase = "ready";
        await broadcastSnapshot();
        return { ok: false, error: assetResult.error };
      }
      try {
        const pid = await gameLauncher.launch({
          config: await configStore.load(),
          identity: launchCredential,
          runtime: DEFAULT_RUNTIME_CONFIG,
          logsRoot: join(app.getPath("userData"), "logs"),
          bundledShimPath: resolveBundledShimPath(),
          bundledVivoxProxyPath: resolveBundledVivoxProxyPath(),
          bundledVivoxRuntimePath: resolveBundledVivoxRuntimePath(),
          attest: () => attestInstallation(launchCredential.playerKey),
          onExit: () => {
            gamePid = null;
            phase = "ready";
            void broadcastSnapshot();
            if (quitWhenGameExits && !mainWindow) app.quit();
          },
        });
        gamePid = pid;
        phase = "running";
        await broadcastSnapshot();
        return { ok: true, value: { pid } };
      } catch (error) {
        const result = operationError<{ pid: number }>(error);
        // Keep Play retryable after a transient launch failure while retaining
        // the concrete error in the snapshot.
        phase = "ready";
        await broadcastSnapshot();
        if (quitWhenGameExits && !mainWindow) app.quit();
        return result;
      }
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.openWebsite,
    trustedHandler(async (_event, path: string): Promise<OperationResult> => {
      try {
        if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) {
          throw new Error(MAIN_COPY[currentLocale].unauthorizedLink);
        }
        const target = new URL(path, WEBSITE_ORIGIN);
        if (target.origin !== WEBSITE_ORIGIN) throw new Error(MAIN_COPY[currentLocale].unauthorizedLink);
        await shell.openExternal(target.href);
        return { ok: true };
      } catch (error) {
        return operationError(error);
      }
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.checkLauncherUpdate,
    trustedHandler(async () => launcherUpdate.check()),
  );

  ipcMain.handle(
    IPC_CHANNELS.downloadLauncherUpdate,
    trustedHandler(async (): Promise<OperationResult> => {
      const failure = launcherUpdate.download();
      if (!failure) return { ok: true };
      return { ok: false, error: MAIN_COPY[currentLocale].update[failure] };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.installLauncherUpdate,
    trustedHandler(async (): Promise<OperationResult> => {
      if (gameLauncher.isRunning() || phase === "launching" || phase === "running") {
        return { ok: false, error: MAIN_COPY[currentLocale].update.gameRunning };
      }
      const failure = launcherUpdate.install();
      if (!failure) return { ok: true };
      return { ok: false, error: MAIN_COPY[currentLocale].update[failure] };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.verifyAssets,
    trustedHandler(async (): Promise<OperationResult> => {
      const copy = MAIN_COPY[currentLocale];
      if (gameLauncher.isRunning() || phase === "launching" || phase === "running") {
        return { ok: false, error: copy.clientInUse };
      }
      if (phase === "installing") return { ok: false, error: copy.installationInProgress };
      if (!assetSyncEnabled) return { ok: false, error: copy.assets.disabled };
      return runAssetSync("verify", false);
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.restoreVanillaAssets,
    trustedHandler(async (): Promise<OperationResult> => {
      const copy = MAIN_COPY[currentLocale];
      if (gameLauncher.isRunning() || phase === "launching" || phase === "running") {
        return { ok: false, error: copy.clientInUse };
      }
      if (phase === "installing") return { ok: false, error: copy.installationInProgress };
      if (assetSyncRunning) return { ok: false, error: copy.assets.busy };
      const root = await installationRoot();
      if (!root) return { ok: false, error: copy.clientNotReady };
      try {
        await assetSync.restore(root);
        assetSyncStatus = "idle";
        assetSyncWarning = null;
        assetSyncPackVersion = null;
        assetSyncLastAt = null;
        lastErrorRaw = null;
        await broadcastSnapshot();
        return { ok: true };
      } catch (error) {
        const result = operationError(error);
        await broadcastSnapshot();
        return result;
      }
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.setAssetSyncEnabled,
    trustedHandler(async (_event, enabled: unknown): Promise<OperationResult> => {
      if (typeof enabled !== "boolean") throw new Error("Unsupported asset sync setting");
      if (assetSyncRunning) return { ok: false, error: MAIN_COPY[currentLocale].assets.busy };
      await configStore.setAssetSyncEnabled(enabled);
      assetSyncEnabled = enabled;
      assetSyncStatus = enabled ? "idle" : "disabled";
      assetSyncWarning = null;
      await broadcastSnapshot();
      return { ok: true };
    }),
  );

  ipcMain.handle(IPC_CHANNELS.minimizeWindow, trustedHandler(async () => mainWindow?.minimize()));
  ipcMain.handle(IPC_CHANNELS.closeWindow, trustedHandler(async () => mainWindow?.close()));
}

function createWindow(): BrowserWindow {
  const currentDirectory = fileURLToPath(new URL(".", import.meta.url));
  const window = new BrowserWindow({
    width: 1280,
    height: 760,
    minWidth: 1080,
    minHeight: 660,
    show: false,
    frame: false,
    backgroundColor: "#090909",
    title: "ROTK Launcher",
    webPreferences: {
      preload: join(currentDirectory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  // loadFile() is the only initial navigation and its target is constructed by
  // the main process below. Register the deny-all guard after that navigation
  // completes: doing it earlier can reject Electron's app.asar file URL before
  // the renderer is available. External ROTK links always go through the
  // allowlisted openWebsite IPC channel.
  window.webContents.once("did-finish-load", () => {
    window.webContents.on("will-navigate", (event) => event.preventDefault());
  });
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  Menu.setApplicationMenu(null);

  const devServer = process.env.VITE_DEV_SERVER_URL;
  if (devServer && !app.isPackaged) void window.loadURL(devServer);
  else void window.loadFile(join(app.getAppPath(), "dist", "index.html"));
  return window;
}

async function initialize(): Promise<void> {
  configStore = new ConfigStore(
    app.getPath("userData"),
    legacyUserDataDirectories,
    async (installation) => {
      try {
        await validateInstalledClient(installation);
        return true;
      } catch {
        return false;
      }
    },
  );
  playerKeyStore = new PlayerKeyStore(
    join(app.getPath("userData"), "player-key.v1.json"),
    {
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: (value) => safeStorage.encryptString(value),
      decryptString: (value) => safeStorage.decryptString(value),
    },
  );
  const storedPlayerKey = await playerKeyStore.load();
  playerIdentity = storedPlayerKey ? identityFromPlayerKey(storedPlayerKey) : null;
  updateFeed = new UpdateFeedService(app.getPath("userData"));
  assetSync = new AssetSyncService({
    userDataDirectory: app.getPath("userData"),
    onProgress: (value) => {
      assetSyncStatus = value.phase === "checking"
        ? "checking"
        : value.phase === "downloading" ? "downloading" : "installing";
      assetSyncProgress = value;
      void broadcastSnapshot();
    },
  });
  const config = await configStore.load();
  assetSyncEnabled = config.assetSyncEnabled ?? true;
  const assetState = await assetSync.readState().catch(() => null);
  assetSyncPackVersion = assetState?.packVersion ?? null;
  assetSyncLastAt = assetState?.syncedAt ?? null;
  if (config.installation) {
    try {
      await validateInstalledClient(config.installation);
      phase = "ready";
    } catch (error) {
      phase = "error";
      lastErrorRaw = rawErrorMessage(error);
    }
  }
  launcherUpdate = new LauncherUpdateService({
    // In development there is no installed package to update against;
    // the updater stays inert and the snapshot reports "idle".
    updater: app.isPackaged ? electronUpdater.autoUpdater : null,
    onChange: () => void broadcastSnapshot(),
  });
  registerIpc();
  mainWindow = createWindow();
  updates = await updateFeed.getLatest();
  await broadcastSnapshot();
  void launcherUpdate.check();
  setInterval(() => void launcherUpdate.check(), LAUNCHER_UPDATE_CHECK_INTERVAL_MS);
}

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

void app
  .whenReady()
  .then(async () => {
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    await initialize();
  })
  .catch((error: unknown) => {
    const copy = MAIN_COPY[currentLocale];
    dialog.showErrorBox(
      copy.startupTitle,
      `${errorMessage(error)}\n\n${copy.startupSafety}`,
    );
    app.quit();
  });

app.on("window-all-closed", () => {
  if (gameLauncher.isRunning() || phase === "launching" || phase === "running") {
    quitWhenGameExits = true;
    return;
  }
  app.quit();
});

process.on("uncaughtException", (error) => {
  lastErrorRaw = `Erreur launcher ${randomUUID().slice(0, 8)} : ${error.message}`;
  phase = "error";
  void broadcastSnapshot();
});
