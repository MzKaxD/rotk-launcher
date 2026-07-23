import { spawn, type ChildProcess } from "node:child_process";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { InstalledClientConfig, LauncherConfig } from "./config-store.js";
import type { RuntimeConfig } from "./runtime-config.js";
import { serverList } from "./runtime-config.js";
import { synchronizeClientConfig, validateLocalCreateSessionUrl } from "./client-config.js";
import { validateInstallDestination } from "./path-policy.js";
import type { PlayerIdentity } from "./player-identity.js";
import { startLocalSessionGateway } from "./session-gateway.js";
import { readInstallationMarker } from "./installer.js";
import {
  assertLaunchTicketFresh,
  createLaunchTicket,
  type LaunchTicketIdentity,
} from "./launch-ticket.js";

export interface LaunchRequest {
  config: LauncherConfig;
  identity: PlayerIdentity;
  runtime: RuntimeConfig;
  logsRoot: string;
  bundledShimPath: string;
  onExit(exitCode: number | null): void;
}

async function validateMarker(installation: InstalledClientConfig): Promise<void> {
  const marker = await readInstallationMarker(installation.root);
  if (!marker) {
    throw new Error("L’installation ROTK est incomplète : son marqueur est introuvable.");
  }
  if (marker.schemaVersion !== 1 || marker.installId !== installation.installId) {
    throw new Error("L’installation ROTK ne correspond plus à celle enregistrée par le launcher.");
  }
}

export async function validateInstalledClient(installation: InstalledClientConfig): Promise<string> {
  const root = await validateInstallDestination(installation.root);
  await validateMarker({ ...installation, root });

  const executable = await stat(join(root, "H1Z1.exe")).catch(() => null);
  if (!executable?.isFile()) throw new Error("H1Z1.exe est introuvable dans l’installation ROTK.");
  if (!existsSync(join(root, "steam_api64.original.dll"))) {
    throw new Error("La sauvegarde de steam_api64.dll est absente. Réimporte le client.");
  }
  return root;
}

function sanitizedEnvironment(identity: LaunchTicketIdentity): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(environment)) {
    const normalized = key.toLocaleUpperCase("en-US");
    if (
      normalized.startsWith("H1Z1_") ||
      normalized === "STEAMID" ||
      normalized === "STEAMAPPID" ||
      normalized === "STEAMGAMEID"
    ) {
      delete environment[key];
    }
  }
  environment.H1Z1_OVERRIDE_PERSONA = identity.displayName;
  environment.H1Z1_OVERRIDE_STEAMID = identity.steamId;
  environment.STEAMID = identity.steamId;
  return environment;
}

async function prepareClient(
  request: LaunchRequest,
  root: string,
  localCreateSessionUrl: string,
  launchIdentity: LaunchTicketIdentity,
): Promise<string> {
  // All subsequent I/O and the spawned process use the same physical root that
  // passed policy validation. This prevents a logical junction alias from
  // steering configuration and execution to a different tree.
  const activeShimPath = join(root, "steam_api64.dll");
  await copyFile(request.bundledShimPath, activeShimPath);

  const configPath = join(root, "ClientConfig.ini");
  const configBackupPath = join(root, "ClientConfig.original.ini");
  if (!existsSync(configBackupPath)) await copyFile(configPath, configBackupPath);
  const synchronized = synchronizeClientConfig(
    await readFile(configPath, "utf8"),
    request.runtime,
    localCreateSessionUrl,
  );
  await writeFile(configPath, synchronized, "ascii");
  await writeFile(join(root, "steam_persona_name.txt"), `${launchIdentity.displayName}\n`, "utf8");

  const battleyePath = join(root, "BattlEye", "BEClient_x64.cfg");
  if (existsSync(battleyePath)) {
    const current = await readFile(battleyePath, "utf8");
    const patched = current.replace(/MasterPort\s+\d+/i, "MasterPort 20099");
    if (patched !== current) await writeFile(battleyePath, patched, "ascii");
  }
  return root;
}

function buildLaunchArguments(
  launchTicket: string,
  runtime: RuntimeConfig,
  logsRoot: string,
  installId: string,
  localCreateSessionUrl: string,
): string[] {
  const gatewayCreateSession = validateLocalCreateSessionUrl(localCreateSessionUrl);
  const localLogs = join(logsRoot, installId, "local");
  const failureLogs = join(logsRoot, installId, "failure");
  return [
    `sessionid=${launchTicket}`,
    `server=${serverList(runtime)}`,
    `SteamGatewayUrl=${gatewayCreateSession}`,
    `CommandQueue:motd_uri=${runtime.gatewayOrigin}/`,
    `CommandQueue:cb_uri=${runtime.gatewayOrigin}/`,
    `CommandQueue:eula_uri=${runtime.gatewayOrigin}/`,
    `LaunchTelemetry:Url=${runtime.gatewayOrigin}/h1z1xx/live/`,
    "Logging:ConsoleLogLevel=999",
    "Logging:FileLogLevel=999",
    "Logging:LocalLogLevel=999",
    `Logging:Directory=${join(logsRoot, installId)}`,
    `Logging:LocalDirectory=${localLogs}`,
    `Logging:FailureDirectory=${failureLogs}`,
  ];
}

export class GameLauncher {
  private child: ChildProcess | null = null;

  isRunning(): boolean {
    return this.child !== null && this.child.exitCode === null && !this.child.killed;
  }

  async launch(request: LaunchRequest): Promise<number> {
    if (this.isRunning()) throw new Error("H1Z1 est déjà lancé depuis cette installation.");
    const installation = request.config.installation;
    if (!installation) throw new Error("Installe d’abord le client ROTK.");
    const installationRoot = await validateInstalledClient(installation);
    const localLogs = join(request.logsRoot, installation.installId, "local");
    const failureLogs = join(request.logsRoot, installation.installId, "failure");
    await mkdir(localLogs, { recursive: true });
    await mkdir(failureLogs, { recursive: true });

    // The durable website key reaches only the HTTPS account service. H1Z1
    // receives a short ticket and the Steam identity authenticated by it.
    const launchIdentity = await createLaunchTicket(
      request.identity.playerKey,
      request.runtime.launchTicketUrl,
    );
    const sessionGateway = await startLocalSessionGateway(launchIdentity.ticket);

    try {
      await prepareClient(
        request,
        installationRoot,
        sessionGateway.createSessionUrl,
        launchIdentity,
      );

      const args = buildLaunchArguments(
        launchIdentity.ticket,
        request.runtime,
        request.logsRoot,
        installation.installId,
        sessionGateway.createSessionUrl,
      );
      assertLaunchTicketFresh(launchIdentity.expiresAt);

      const executable = join(installationRoot, "H1Z1.exe");
      const child = spawn(executable, args, {
        cwd: installationRoot,
        env: sanitizedEnvironment(launchIdentity),
        detached: true,
        stdio: "ignore",
        windowsHide: false,
        shell: false,
      });
      if (!child.pid) throw new Error("Windows n’a pas retourné l’identifiant du processus H1Z1.");
      this.child = child;
      let finalized = false;
      const finalize = (code: number | null): void => {
        if (finalized) return;
        finalized = true;
        if (this.child === child) this.child = null;
        void sessionGateway.close().catch(() => undefined);
        request.onExit(code);
      };
      child.once("exit", (code) => finalize(code));
      child.once("error", () => finalize(null));
      child.unref();
      return child.pid;
    } catch (error) {
      await sessionGateway.close().catch(() => undefined);
      throw error;
    }
  }
}

export const gameLauncherInternals = {
  sanitizedEnvironment,
  validateMarker,
  validateInstalledClient,
  prepareClient,
  buildLaunchArguments,
};
