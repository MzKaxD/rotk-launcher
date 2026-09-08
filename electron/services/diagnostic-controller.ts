import { createReadStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { DiagnosticCaptureRequest, DiagnosticState } from "../../shared/diagnostics.js";
import type { GameLaunchDiagnostics } from "./game-launcher.js";
import { DiagnosticObserver } from "./diagnostic-observer.js";
import { DiagnosticReportService, type DiagnosticSessionContext } from "./diagnostic-reports.js";
import { collectDiagnosticSystemInfo, collectGameWindowsEvents } from "./diagnostic-system.js";

interface ActiveRecording {
  id: string;
  observer: DiagnosticObserver | null;
  startedAt: string;
  systemInfo: Promise<void>;
  outputBytes: number;
  pid: number | null;
  finalizing: Promise<void> | null;
}

async function binaryInventory(root: string | undefined): Promise<Record<string, unknown>[]> {
  if (!root) return [];
  const results: Record<string, unknown>[] = [];
  for (const name of ["H1Z1.exe", "steam_api64.dll", "vivoxsdk_x64.dll", "vivoxsdk_x64_v5.dll", "dinput8.dll"]) {
    try {
      const file = join(root, name);
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 512 * 1024 * 1024) { results.push({ name, status: "skipped" }); continue; }
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
      results.push({ name, bytes: info.size, sha256: hash.digest("hex"), modifiedAt: info.mtime.toISOString() });
    } catch { results.push({ name, status: "unavailable" }); }
  }
  return results;
}

export class DiagnosticController {
  readonly reports: DiagnosticReportService;
  private active: ActiveRecording | null = null;
  private busy = false;
  private enabled = true;
  private error: string | null = null;
  private changeTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: {
    directory: string;
    helperPath: string;
    knownSecrets: () => string[];
    onChange: (state: DiagnosticState) => void;
  }) {
    this.reports = new DiagnosticReportService({ directory: options.directory, knownSecrets: options.knownSecrets, onChange: () => this.changed() });
  }

  async initialize(enabled: boolean): Promise<void> { this.enabled = enabled; await this.reports.initialize(); }
  isBusy(): boolean { return this.busy; }
  async state(): Promise<DiagnosticState> {
    return { reports: await this.reports.listReports(), recordingId: this.active?.id ?? null, busy: this.busy,
      advancedCaptureEnabled: this.enabled, error: this.error };
  }
  private changed(): void {
    if (this.changeTimer) return;
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null;
      void this.state().then(this.options.onChange).catch(() => undefined);
    }, 100);
  }
  setEnabled(enabled: boolean): void {
    if (this.active) throw new Error("Cannot change native diagnostics during a game session");
    this.enabled = enabled; this.changed();
  }

  async beginLaunch(context: DiagnosticSessionContext): Promise<{ id: string; hooks: GameLaunchDiagnostics }> {
    if (this.active) throw new Error("A game diagnostic session is still being finalized");
    const created = await this.reports.beginSession(context);
    const record = await this.reports.getReport(created.id);
    const active: ActiveRecording = { id: created.id, observer: null, startedAt: record.summary.startedAt,
      systemInfo: Promise.resolve(), outputBytes: 0, pid: null, finalizing: null };
    this.active = active;
    const captureEnabled = this.enabled;
    try {
      await this.reports.updateSession(active.id, { captureStatus: captureEnabled ? "pending" : "disabled" });
    } catch (error) {
      if (this.active === active) this.active = null;
      this.changed();
      throw error;
    }
    active.systemInfo = collectDiagnosticSystemInfo()
      .then(async (systemInfo) => { await this.reports.updateSession(active.id, { systemInfo }); }).catch(() => undefined);
    this.changed();
    return {
      id: created.id,
      hooks: {
        onIdentity: (identity) => {
          void this.reports.updateSession(active.id, { playerName: identity.displayName, steamId: identity.steamId }).catch(() => undefined);
        },
        onSpawned: (pid) => {
          active.pid = pid;
          // Client preparation repairs the proxies. Inventory the actual files
          // used by this process, after preparation rather than before it.
          active.systemInfo = Promise.all([active.systemInfo, binaryInventory(context.installationRoot)])
            .then(async ([, binaries]) => { await this.reports.updateSession(active.id, { binaries, binariesCapturedAt: new Date().toISOString() }); }).catch(() => undefined);
          void this.reports.updateSession(active.id, { pid, processStartedAt: new Date().toISOString() }).catch(() => undefined);
          void this.reports.appendEvent(active.id, "game_spawned", { pid }).catch(() => undefined);
          if (!captureEnabled) return;
          active.observer = new DiagnosticObserver({ executable: this.options.helperPath, pid, directory: created.directory,
            onEvent: (event) => {
              if (event.event === "attached" || event.event === "attach-failed") {
                void this.reports.appendEvent(active.id, "native_observer_status", event).catch(() => undefined);
                void this.reports.updateSession(active.id, { captureStatus: event.event === "attached" ? "attached" : "unavailable",
                  ...(event.event === "attach-failed" ? { warnings: ["Native exception capture was unavailable; text diagnostics remain available."] } : {}) }).catch(() => undefined);
              }
              // Native events already persist directly to disk. Only state changes go through IPC.
              if (event.event === "dump-written" || event.event === "dump-failed" || event.event === "attach-failed") this.changed();
            } });
          void active.observer.start().catch(() => undefined);
        },
        onOutput: (stream, text) => {
          if (active.outputBytes >= 1024 * 1024) return;
          const chunk = text.slice(0, Math.min(16 * 1024, 1024 * 1024 - active.outputBytes));
          active.outputBytes += Buffer.byteLength(chunk, "utf8");
          void this.reports.appendEvent(active.id, `game_${stream}`, { text: chunk }).catch(() => undefined);
        },
        onExit: (code, signal) => this.finish(active, code, signal),
      },
    };
  }

  async launchFailed(id: string, error: unknown): Promise<void> {
    const active = this.active;
    if (!active || active.id !== id) return;
    // If Windows already reported a native exit, do not overwrite it with the
    // launcher's more generic "closed during startup" error.
    if (active.finalizing) { await active.finalizing; return; }
    await this.finish(active, null, null, error);
  }

  private finish(active: ActiveRecording, code: number | null, signal: NodeJS.Signals | null, error?: unknown): Promise<void> {
    if (active.finalizing) return active.finalizing;
    const endedAt = new Date().toISOString();
    active.finalizing = (async () => {
      try {
        await this.reports.appendEvent(active.id, "game_exited", { code, signal, endedAt });
        await this.reports.finalizeSession(active.id, { exitCode: code, signal, error, endedAt });
        await active.observer?.drain();
        const finalRecord = await this.reports.getReport(active.id);
        if (finalRecord.summary.captureStatus === "pending") {
          await this.reports.updateSession(active.id, { captureStatus: "unavailable",
            warnings: ["The game ended before native exception capture could attach. Exit code and available logs were preserved."] });
        }
        await active.systemInfo;
        const windowsEvents = await collectGameWindowsEvents(active.pid, active.startedAt, endedAt);
        await this.reports.updateSession(active.id, { windowsEvents, processEndedAt: endedAt });
        await this.reports.collectSession(active.id);
      } finally {
        await active.observer?.stop().catch(() => undefined);
        if (this.active === active) this.active = null;
        this.changed();
      }
    })().catch(() => { this.error = "Diagnostic collection was incomplete. Existing evidence is still available."; this.changed(); });
    return active.finalizing;
  }

  async capture(request: DiagnosticCaptureRequest, context: DiagnosticSessionContext): Promise<import("../../shared/diagnostics.js").DiagnosticReportSummary> {
    if (this.busy) throw new Error("A diagnostic operation is already running");
    this.busy = true; this.error = null; this.changed();
    try { return await this.captureAvailable(request, context); }
    finally { this.busy = false; this.changed(); }
  }

  private async captureAvailable(request: DiagnosticCaptureRequest, context: DiagnosticSessionContext): Promise<import("../../shared/diagnostics.js").DiagnosticReportSummary> {
    const active = this.active;
    if (active) {
      if (active.finalizing) await active.finalizing;
      else {
        await this.reports.appendEvent(active.id, "manual_capture_requested", { mode: request.mode, description: request.description });
        if (active.observer?.isAttached()) {
          await active.observer.snapshot(request.mode).catch(async () => {
            await this.reports.updateSession(active.id, { warnings: ["Requested memory capture did not complete. Check native-events.jsonl for the exact reason."] });
          });
        } else {
          if (active.pid) {
            const snapshot = new DiagnosticObserver({ executable: this.options.helperPath, pid: active.pid,
              directory: this.reports.getDirectory(active.id), onEvent: () => undefined });
            try { await snapshot.captureOnce(request.mode); }
            catch { await this.reports.updateSession(active.id, { warnings: ["Requested memory capture was unavailable; logs and system information were collected."] }); }
            finally { await snapshot.stop(); }
          } else {
            await this.reports.updateSession(active.id, { warnings: ["The game process was not available for memory capture."] });
          }
        }
      }
      await this.reports.updateSession(active.id, { notes: request.description, systemInfoAtCapture: await collectDiagnosticSystemInfo() });
      return await this.reports.collectSession(active.id);
    }
    const report = await this.reports.beginSession({ ...context, manual: true, notes: request.description });
    await this.reports.updateSession(report.id, { captureStatus: "disabled", systemInfo: await collectDiagnosticSystemInfo(),
      warnings: ["No game was running. This is a manual system report, not a crash dump."] });
    await this.reports.finalizeSession(report.id, { exitCode: null });
    await this.reports.updateSession(report.id, { kind: "manual" });
    return await this.reports.collectSession(report.id);
  }

  async exportReport(id: string, destination: string, options: { includeDumps: boolean; description: string }): Promise<void> {
    if (this.busy) throw new Error("A diagnostic operation is already running");
    this.busy = true; this.error = null; this.changed();
    try { await this.exportAvailable(id, destination, options); }
    finally { this.busy = false; this.changed(); }
  }

  private async exportAvailable(id: string, destination: string, options: { includeDumps: boolean; description: string }): Promise<void> {
    const active = this.active;
    if (active?.id === id && active.finalizing) await active.finalizing;
    const record = await this.reports.getReport(id);
    if (record.summary.endedAt) {
      const windowsEvents = await collectGameWindowsEvents(record.context.pid ?? null, record.summary.startedAt, record.summary.endedAt);
      await this.reports.updateSession(id, { windowsEvents });
    }
    await this.reports.exportReport(id, destination, options);
  }

  /** A player declares an incident; the launcher selects and packages its evidence. */
  async reportCrash(destinationDirectory: string, context: DiagnosticSessionContext): Promise<{ path: string; fileName: string }> {
    if (this.busy) throw new Error("A diagnostic operation is already running");
    this.busy = true; this.error = null; this.changed();
    const description = "Le joueur a déclaré un crash depuis le launcher. La déclaration ne prouve pas à elle seule une exception native ; consulter les preuves jointes.";
    try {
      await mkdir(destinationDirectory, { recursive: true });
      let reportId: string | null = null;
      const active = this.active;
      if (active) {
        if (active.finalizing) { await active.finalizing; reportId = active.id; }
        else reportId = (await this.captureAvailable({ mode: "standard", description }, context)).id;
      } else {
        // Prefer the latest game, even when its exit code looked normal. A
        // player declaration must not silently select an older known crash or
        // a newer system-only report made without a game.
        for (const candidate of await this.reports.listReports()) {
          if (candidate.kind === "manual") continue;
          const record = await this.reports.getReport(candidate.id);
          if (record.context.manual === true) continue;
          reportId = candidate.id; break;
        }
        if (!reportId) reportId = (await this.captureAvailable({ mode: "standard", description }, context)).id;
      }
      const declaredAt = new Date().toISOString();
      await this.reports.updateSession(reportId, { playerReportedCrash: true, playerReportedAt: declaredAt });
      await this.reports.appendEvent(reportId, "player_reported_crash", { at: declaredAt });
      const report = await this.reports.getReport(reportId);
      const date = /^\d{4}-\d{2}-\d{2}T/.test(report.summary.startedAt) ? report.summary.startedAt.slice(0, 10) : declaredAt.slice(0, 10);
      const fileName = `ROTK-crash-${date}-${reportId.slice(0, 8)}-${randomUUID().slice(0, 8)}.zip`;
      const path = join(destinationDirectory, fileName);
      await this.exportAvailable(reportId, path, { includeDumps: true, description });
      return { path, fileName };
    } finally { this.busy = false; this.changed(); }
  }

  async recordLauncherError(kind: string, error: unknown): Promise<void> {
    if (this.active) {
      await this.reports.appendEvent(this.active.id, kind, { error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error) });
    }
  }
}

export const diagnosticControllerInternals = { binaryInventory };
