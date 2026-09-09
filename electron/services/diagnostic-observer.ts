import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export interface NativeDiagnosticEvent { event: string; [key: string]: unknown }
export interface NativeObserverOptions {
  executable: string;
  pid: number;
  directory: string;
  debug?: boolean;
  onEvent(event: NativeDiagnosticEvent): void;
}

/** A failure of the observer must never terminate or prevent the game. */
export class DiagnosticObserver {
  private child: ChildProcessWithoutNullStreams | null = null;
  private attached = false;
  private pending: { resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout } | null = null;
  private completed: Promise<void> = Promise.resolve();
  private stopping = false;
  private dumpWatchdog: NodeJS.Timeout | null = null;
  private mayTerminateHelper = false;

  constructor(private readonly options: NativeObserverOptions) {}

  async start(snapshotMode?: "standard" | "full"): Promise<void> {
    if (!Number.isSafeInteger(this.options.pid) || this.options.pid <= 0) throw new Error("Invalid game process");
    try {
      const [binary, sidecar] = await Promise.all([readFile(this.options.executable), readFile(`${this.options.executable}.sha256`, "utf8")]);
      const expected = sidecar.trim().split(/\s+/)[0]?.toLowerCase();
      if (!expected || !/^[a-f0-9]{64}$/.test(expected) || createHash("sha256").update(binary).digest("hex") !== expected) {
        throw new Error("Diagnostic helper integrity check failed");
      }
      if (this.stopping) { this.rejectPending("Diagnostic capture was stopped"); return; }
      this.mayTerminateHelper = Boolean(snapshotMode);
      const child = spawn(this.options.executable, [snapshotMode ? "--snapshot" : "--watch", ...(!snapshotMode ? ["--counters-only"] : []), "--pid", String(this.options.pid), "--output", this.options.directory,
        ...(snapshotMode === "full" ? ["--full"] : []), ...(!snapshotMode && this.options.debug ? ["--debug"] : [])], {
        windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"],
      });
      this.child = child;
      this.completed = new Promise<void>((resolve) => {
        child.once("close", () => {
          this.clearDumpWatchdog();
          this.attached = false;
          this.rejectPending("Diagnostic observer stopped before capture completed");
          if (this.child === child) this.child = null;
          resolve();
        });
      });
      let buffer = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        buffer += chunk;
        if (buffer.length > 256 * 1024) { buffer = ""; return; }
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
          try {
            const event = JSON.parse(line) as NativeDiagnosticEvent;
            if (!event || typeof event.event !== "string") continue;
            if (event.event === "observer-ready" && event.pid === this.options.pid
              && event.mode === "passive" && event.debuggerAttached === false) {
              this.attached = false;
              this.mayTerminateHelper = true;
            }
            if (event.event === "attached") { this.attached = true; this.mayTerminateHelper = event.killOnExit === false; }
            if (event.event === "attach-failed") this.attached = false;
            if (this.options.debug && event.event === "performance-status" && event.pid === this.options.pid
              && event.status === "recording" && event.source === "windows-process-counters"
              && event.debuggerAttached === false && event.reason === "debugger-attach-unavailable") {
              // This explicit native handshake confirms sampling continues without a debugger attachment.
              this.attached = false;
              this.mayTerminateHelper = true;
            }
            if (event.event === "dump-started") {
              this.clearDumpWatchdog();
              this.dumpWatchdog = setTimeout(() => this.terminateStuckCapture(), event.full === true ? 200_000 : 70_000);
            }
            if (event.event === "dump-written" || event.event === "dump-failed") this.clearDumpWatchdog();
            if (event.event === "dump-written" && event.kind === "snapshot") {
              const pending = this.pending; this.pending = null;
              if (pending) { clearTimeout(pending.timer); pending.resolve(); }
            }
            if (event.event === "dump-failed") this.rejectPending("Windows could not write the requested dump");
            try { this.options.onEvent(event); } catch { /* Diagnostic callbacks never escape into gameplay. */ }
          } catch { /* Incomplete or non-JSON native messages cannot fail the launcher. */ }
        }
      });
      child.stderr.resume();
      child.stdin.on("error", () => this.rejectPending("Diagnostic observer is unavailable"));
      child.once("error", () => {
        this.rejectPending("Diagnostic helper could not be started");
        try { this.options.onEvent({ event: "attach-failed", reason: "helper-start-failed" }); } catch {}
      });
    } catch {
      this.rejectPending("Diagnostic helper is missing or invalid");
      try { this.options.onEvent({ event: "attach-failed", reason: "helper-missing-or-invalid" }); } catch {}
    }
  }

  isAttached(): boolean { return this.attached; }

  captureOnce(mode: "standard" | "full"): Promise<void> {
    if (this.child || this.pending) return Promise.reject(new Error("A diagnostic operation is already running"));
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => this.terminateStuckCapture(), mode === "full" ? 205_000 : 75_000);
      this.pending = { resolve, reject, timer };
      void this.start(mode).catch(() => this.rejectPending("Diagnostic helper could not be started"));
    });
  }

  snapshot(mode: "standard" | "full"): Promise<void> {
    if (!this.child || !this.attached || this.stopping) return Promise.reject(new Error("Native capture is unavailable for this game session"));
    if (this.pending) return Promise.reject(new Error("A dump capture is already running"));
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => this.terminateStuckCapture(), mode === "full" ? 205_000 : 75_000);
      this.pending = { resolve, reject, timer };
      this.child!.stdin.write(mode === "full" ? "full\n" : "snapshot\n", (error) => { if (error) this.rejectPending("Diagnostic observer is unavailable"); });
    });
  }

  private rejectPending(message: string): void {
    const pending = this.pending; this.pending = null;
    if (pending) { clearTimeout(pending.timer); pending.reject(new Error(message)); }
  }

  private clearDumpWatchdog(): void {
    if (this.dumpWatchdog) clearTimeout(this.dumpWatchdog);
    this.dumpWatchdog = null;
  }

  private terminateStuckCapture(): void {
    this.clearDumpWatchdog();
    this.stopping = true;
    this.rejectPending("Native memory capture exceeded its time budget");
    this.attached = false;
    if (this.child && this.mayTerminateHelper) this.child.kill();
    else if (this.child && !this.child.stdin.destroyed) this.child.stdin.end("stop\n");
    try { this.options.onEvent({ event: "attach-failed", reason: "capture-timeout" }); } catch {}
  }

  async drain(timeoutMs = 5000): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([this.completed, new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); })]);
    if (timer) clearTimeout(timer);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.rejectPending("Diagnostic capture was stopped");
    if (this.child && !this.child.stdin.destroyed) this.child.stdin.end("stop\n");
    await this.drain();
    // The helper confirms kill-on-exit was disabled, or that it only samples without attaching.
    // Never use taskkill /T, and never signal the game PID.
    if (this.child && this.mayTerminateHelper) this.child.kill();
    this.clearDumpWatchdog();
  }
}
