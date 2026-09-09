import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm, writeFile, type FileHandle } from "node:fs/promises";
import { join } from "node:path";

const MAX_LINE = 32 * 1024;
const MAX_CHAINS = 32;
const MAX_FILE = 16 * 1024 * 1024;
const LONG_FRAME_MS = 50;
const RELATIVE_MIN_MS = 8;
const RELATIVE_MULTIPLIER = 3;
const EWMA_ALPHA = 0.05;
const HISTOGRAM_MS = [1, 2, 4, 8, 12, 16.667, 20, 25, 33.334, 50, 75, 100, 150, 250, 500, 1000, 2000, 5000, 10000, 30000, 28_800_000];

export interface DiagnosticFrameTimesOptions { executable: string; pid: number; directory: string; sessionId: string }
/** The optional second constructor argument provides bounded test seams. */
export interface FrameTimesDependencies {
  spawn?: typeof spawn;
  now?: () => number;
  maxFileBytes?: number;
  stopTimeoutMs?: number;
}
export interface DiagnosticFrameSample {
  pid: number;
  swapChainId: number;
  qpcTime: number;
  presentMonTimeSeconds: number;
  receivedAtUtcMs: number;
  msBetweenPresents: number;
  msInPresentAPI?: number;
  msUntilRenderComplete?: number;
  msUntilDisplayed?: number;
  msBetweenDisplayChange?: number;
  msGPUActive?: number;
  dropped?: number;
  syncInterval?: number;
  presentFlags?: number;
  allowsTearing?: number;
}
type Failure = "invalid-pid" | "helper-missing" | "integrity-check-failed" | "permission-denied" | "session-conflict"
  | "helper-failed" | "output-unavailable" | "no-present-events" | "forced-stop" | "stopped-before-start" | "trace-loss-detected";
type Status = "starting" | "recording" | "complete" | "unavailable" | "partial";

/** Single-line CSV only: PresentMon's numeric frame schema never needs multiline fields. */
export function parseFrameTimesCsvLine(line: string): string[] | null {
  if (line.length > MAX_LINE) return null;
  const columns: string[] = [];
  let field = "", quoted = false, closed = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else field += c;
    } else if (c === ",") {
      columns.push(field.trim()); field = ""; closed = false;
      if (columns.length >= 96) return null;
    } else if (c === '"' && field === "" && !closed) quoted = true;
    else if (closed && !/\s/.test(c)) return null;
    else field += c;
  }
  if (quoted) return null;
  columns.push(field.trim());
  return columns;
}

function numeric(value: string | undefined, maximum = 28_800_000): number | undefined {
  if (!value || !/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= maximum ? number : undefined;
}

/** No source strings (application names, paths, or raw addresses) leave this parser. */
export class PresentMonFrameParser {
  private columns = new Map<string, number>();
  private chains = new Map<string, { id: number; lastQpc: number }>();
  private buffer = "";
  private discardLine = false;
  readonly counts = { rows: 0, accepted: 0, foreignPid: 0, invalid: 0, oversized: 0, excessSwapChains: 0, outOfOrder: 0 };
  constructor(private readonly pid: number) {}

  feed(chunk: string, receivedAtUtcMs: number, emit: (sample: DiagnosticFrameSample) => void): void {
    // Iterate without concatenating unbounded chunks or accepting the tail of an oversized line.
    let offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf("\n", offset);
      const end = newline < 0 ? chunk.length : newline;
      if (!this.discardLine) {
        if (this.buffer.length + end - offset > MAX_LINE) {
          this.buffer = ""; this.discardLine = true; this.counts.oversized++;
        } else this.buffer += chunk.slice(offset, end);
      }
      if (newline < 0) break;
      if (!this.discardLine) this.line(this.buffer.replace(/\r$/, ""), receivedAtUtcMs, emit);
      this.buffer = ""; this.discardLine = false; offset = newline + 1;
    }
  }

  finish(): void {
    // An unterminated final row may be a killed helper's partial output.
    if (this.buffer || this.discardLine) this.counts.invalid++;
    this.buffer = ""; this.discardLine = false;
  }

  private line(line: string, receivedAtUtcMs: number, emit: (sample: DiagnosticFrameSample) => void): void {
    if (!line.trim()) return;
    const fields = parseFrameTimesCsvLine(line.replace(/^\uFEFF/, ""));
    if (!fields) { this.counts.invalid++; return; }
    const header = fields.map(field => field.toLowerCase());
    if (header.includes("processid") && header.includes("msbetweenpresents")) {
      this.columns.clear();
      if (new Set(header).size !== header.length) { this.counts.invalid++; return; }
      for (const required of ["processid", "swapchainaddress", "msbetweenpresents", "timeinseconds", "qpctime"]) {
        if (!header.includes(required)) { this.counts.invalid++; return; }
      }
      header.forEach((field, index) => this.columns.set(field, index)); return;
    }
    this.counts.rows++;
    const get = (key: string) => fields[this.columns.get(key) ?? -1];
    if (!this.columns.size || fields.length !== this.columns.size) { this.counts.invalid++; return; }
    const pidText = get("processid");
    if (!pidText || !/^\d+$/.test(pidText) || !Number.isSafeInteger(Number(pidText))) { this.counts.invalid++; return; }
    if (Number(pidText) !== this.pid) { this.counts.foreignPid++; return; }
    const address = get("swapchainaddress");
    const qpcText = get("qpctime"), qpc = Number(qpcText);
    const interval = numeric(get("msbetweenpresents"));
    const seconds = numeric(get("timeinseconds"), 86400);
    if (!address || !/^0x[0-9a-f]{1,16}$/i.test(address) || !qpcText || !/^\d+$/.test(qpcText)
      || !Number.isSafeInteger(qpc) || qpc <= 0 || interval === undefined || seconds === undefined
      || !Number.isSafeInteger(receivedAtUtcMs) || receivedAtUtcMs <= 0) { this.counts.invalid++; return; }
    const chainKey = BigInt(address).toString(16);
    let chain = this.chains.get(chainKey);
    if (!chain) {
      if (this.chains.size >= MAX_CHAINS) { this.counts.excessSwapChains++; return; }
      chain = { id: this.chains.size + 1, lastQpc: 0 }; this.chains.set(chainKey, chain);
    }
    if (qpc <= chain.lastQpc) { this.counts.outOfOrder++; return; }
    chain.lastQpc = qpc;
    const sample: DiagnosticFrameSample = { pid: this.pid, swapChainId: chain.id, qpcTime: qpc,
      presentMonTimeSeconds: seconds, receivedAtUtcMs, msBetweenPresents: interval };
    for (const key of ["msInPresentAPI", "msUntilRenderComplete", "msUntilDisplayed", "msBetweenDisplayChange", "msGPUActive"] as const) {
      const value = numeric(get(key.toLowerCase())); if (value !== undefined) sample[key] = value;
    }
    for (const [key, maximum] of [["dropped", 1], ["syncInterval", 16], ["presentFlags", 0xffffffff], ["allowsTearing", 1]] as const) {
      const value = numeric(get(key.toLowerCase()), maximum);
      if (value !== undefined && Number.isInteger(value)) sample[key] = value;
    }
    this.counts.accepted++; emit(sample);
  }
}

export class FrameTimesHistogram {
  private chains = new Map<number, { samples: number; intervals: number; zeroIntervals: number; sumMs: number; minMs: number;
    maxMs: number; bins: number[]; longFrames: number; relativeStutters: number; baselineMs: number | null; firstQpc: number; lastQpc: number }>();
  private longestFrames: DiagnosticFrameSample[] = [];
  private relativeStutters: Array<DiagnosticFrameSample & { baselineBeforeMs: number; thresholdMs: number; multipleOfBaseline: number }> = [];
  add(sample: DiagnosticFrameSample): void {
    let chain = this.chains.get(sample.swapChainId);
    if (!chain) {
      if (this.chains.size >= MAX_CHAINS) return;
      chain = { samples: 0, intervals: 0, zeroIntervals: 0, sumMs: 0, minMs: Infinity, maxMs: 0,
        bins: HISTOGRAM_MS.map(() => 0), longFrames: 0, relativeStutters: 0, baselineMs: null, firstQpc: sample.qpcTime, lastQpc: sample.qpcTime };
      this.chains.set(sample.swapChainId, chain);
    }
    chain.samples++; chain.lastQpc = sample.qpcTime;
    const ms = sample.msBetweenPresents;
    if (ms <= 0) { chain.zeroIntervals++; return; }
    chain.intervals++; chain.sumMs += ms; chain.minMs = Math.min(chain.minMs, ms); chain.maxMs = Math.max(chain.maxMs, ms);
    chain.bins[HISTOGRAM_MS.findIndex(upper => ms <= upper)]++;
    if (ms >= LONG_FRAME_MS) {
      chain.longFrames++;
      this.longestFrames.push(sample); this.longestFrames.sort((a, b) => b.msBetweenPresents - a.msBetweenPresents);
      if (this.longestFrames.length > 16) this.longestFrames.pop();
    }
    const threshold = Math.max(RELATIVE_MIN_MS, RELATIVE_MULTIPLIER * (chain.baselineMs ?? ms));
    if (chain.baselineMs !== null && ms > threshold) {
      chain.relativeStutters++;
      this.relativeStutters.push({ ...sample, baselineBeforeMs: chain.baselineMs, thresholdMs: threshold,
        multipleOfBaseline: ms / Math.max(0.000001, chain.baselineMs) });
      this.relativeStutters.sort((a, b) => b.multipleOfBaseline - a.multipleOfBaseline);
      if (this.relativeStutters.length > 16) this.relativeStutters.pop();
    }
    chain.baselineMs = chain.baselineMs === null ? ms : EWMA_ALPHA * ms + (1 - EWMA_ALPHA) * chain.baselineMs;
  }
  summary() {
    const swapChains = [...this.chains].map(([swapChainId, chain]) => {
      const percentile = (fraction: number) => {
        let count = 0;
        if (!chain.intervals) return null;
        for (let i = 0; i < chain.bins.length; i++) { count += chain.bins[i]; if (count >= Math.ceil(chain.intervals * fraction)) return HISTOGRAM_MS[i]; }
        return null;
      };
      return { swapChainId, samples: chain.samples, intervals: chain.intervals, zeroIntervals: chain.zeroIntervals,
        firstQpc: chain.firstQpc, lastQpc: chain.lastQpc, meanMs: chain.intervals ? chain.sumMs / chain.intervals : null,
        minMs: chain.intervals ? chain.minMs : null, maxMs: chain.intervals ? chain.maxMs : null,
        p50UpperBoundMs: percentile(0.5), p95UpperBoundMs: percentile(0.95), p99UpperBoundMs: percentile(0.99),
        histogramCounts: chain.bins, longFrames: chain.longFrames, relativeStutters: chain.relativeStutters,
        baselineEwmaMs: chain.baselineMs };
    });
    return { histogramUpperBoundsMs: HISTOGRAM_MS, swapChains, longestFrames: this.longestFrames, relativeStutters: this.relativeStutters };
  }
}

class FrameWriter {
  private file: FileHandle | null = null;
  private bytes = 0;
  private buffer = "";
  private bufferSamples = 0;
  rotations = 0;
  writtenSamples = 0;
  constructor(private readonly path: string, private readonly limit: number) {}
  async start(): Promise<void> { this.file = await open(this.path, "wx"); }
  async add(sample: DiagnosticFrameSample): Promise<void> {
    const line = JSON.stringify(sample) + "\n";
    if (this.buffer.length + line.length > Math.min(64 * 1024, this.limit)) await this.flush();
    this.buffer += line; this.bufferSamples++;
  }
  async flush(): Promise<void> {
    if (!this.buffer || !this.file) return;
    const bytes = Buffer.byteLength(this.buffer);
    if (this.bytes + bytes > this.limit) {
      await this.file.close(); this.file = null;
      await rm(`${this.path}.1`, { force: true }); await rename(this.path, `${this.path}.1`);
      this.file = await open(this.path, "wx"); this.bytes = 0; this.rotations++;
    }
    const buffer = this.buffer, samples = this.bufferSamples;
    this.buffer = ""; this.bufferSamples = 0;
    await this.file.writeFile(buffer); this.bytes += bytes; this.writtenSamples += samples;
  }
  async close(): Promise<void> {
    try { await this.flush(); } finally { await this.file?.close(); this.file = null; }
  }
}

function classifyFailure(text: string): Failure | null {
  if (/access.denied|permission|requires?.*(?:admin|elevat)|starttrace[^\r\n]{0,100}\b(?:0x0*5|5)\b|failed to start (?:etw )?(?:trace|session)[^\r\n]{0,80}\b5\b/i.test(text)) return "permission-denied";
  if (/already exists|already running|ERROR_ALREADY_EXISTS|starttrace[^\r\n]{0,100}\b183\b/i.test(text)) return "session-conflict";
  return null;
}
async function within(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try { return await Promise.race([promise.then(() => true, () => true), new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), ms); })]); }
  finally { if (timer) clearTimeout(timer); }
}

/** Optional ETW observer. All failures are report metadata, never game launch failures. */
export class DiagnosticFrameTimes {
  private child: ChildProcessWithoutNullStreams | null = null;
  private started: Promise<void> | null = null;
  private stopped: Promise<void> | null = null;
  private completed: Promise<void> = Promise.resolve();
  private stopping = false;
  private ownsOutput = false;
  private status: Status = "starting";
  private reason: Failure | null = null;
  private exitCode: number | null = null;
  private startedAtUtcMs = 0;
  private endedAtUtcMs: number | null = null;
  private lastSummaryAt = 0;
  private summaryWrite: Promise<void> = Promise.resolve();
  private stderrTail = "";
  private readonly traceLoss = { detected: false, etwEventsLost: 0, etwBuffersLost: 0, overflowedPresents: 0 };
  private readonly now: () => number;
  private readonly spawnProcess: typeof spawn;
  private readonly parser: PresentMonFrameParser;
  private readonly histogram = new FrameTimesHistogram();
  private readonly writer: FrameWriter;
  private readonly sessionName: string;

  constructor(private readonly options: DiagnosticFrameTimesOptions, private readonly dependencies: FrameTimesDependencies = {}) {
    this.now = dependencies.now ?? Date.now; this.spawnProcess = dependencies.spawn ?? spawn;
    this.parser = new PresentMonFrameParser(options.pid);
    const limit = Math.min(MAX_FILE, Math.max(1024, dependencies.maxFileBytes ?? MAX_FILE));
    this.writer = new FrameWriter(join(options.directory, "frame-times.jsonl"), limit);
    // Random ownership suffix prevents a reused report ID from stopping another ETW session.
    this.sessionName = `ROTK-${createHash("sha256").update(options.sessionId).digest("hex").slice(0, 16)}-${randomUUID()}`;
  }

  start(): Promise<void> { return this.started ??= this.begin(); }
  private async verifyExecutable(): Promise<void> {
    const [binaryInfo, sidecarInfo] = await Promise.all([lstat(this.options.executable), lstat(`${this.options.executable}.sha256`)]);
    if (!binaryInfo.isFile() || binaryInfo.isSymbolicLink() || binaryInfo.size > 64 * 1024 * 1024
      || !sidecarInfo.isFile() || sidecarInfo.isSymbolicLink() || sidecarInfo.size > 4096) throw new Error("integrity");
    const [binary, sidecar] = await Promise.all([readFile(this.options.executable), readFile(`${this.options.executable}.sha256`, "utf8")]);
    const expected = sidecar.trim().split(/\s+/)[0]?.toLowerCase();
    if (!expected || !/^[a-f0-9]{64}$/.test(expected) || createHash("sha256").update(binary).digest("hex") !== expected) throw new Error("integrity");
  }

  private async begin(): Promise<void> {
    this.startedAtUtcMs = this.now();
    try {
      await mkdir(this.options.directory, { recursive: true });
      // Claim once; never replace the evidence of another collector using this directory.
      await writeFile(join(this.options.directory, "frame-times-summary.json"), "{}\n", { flag: "wx" }); this.ownsOutput = true;
      if (!Number.isSafeInteger(this.options.pid) || this.options.pid <= 0 || this.options.pid > 0xffffffff) {
        this.reason = "invalid-pid"; throw new Error("unavailable");
      }
      try { await this.verifyExecutable(); } catch (error) {
        this.reason = (error as NodeJS.ErrnoException).code === "ENOENT" ? "helper-missing" : "integrity-check-failed"; throw error;
      }
      if (this.stopping) { this.reason = "stopped-before-start"; throw new Error("stopped"); }
      await this.writer.start();
      const child = this.spawnProcess(this.options.executable, ["--process_id", String(this.options.pid), "--output_stdout",
        "--no_console_stats", "--no_track_input", "--session_name", this.sessionName, "--terminate_on_proc_exit",
        "--timed", "28800", "--terminate_after_timed", "--v1_metrics", "--qpc_time"],
      { windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
      this.child = child;
      const closed = new Promise<void>(resolve => {
        child.once("error", () => { this.reason ??= "helper-failed"; });
        child.once("close", (code) => { this.exitCode = code; if (this.child === child) this.child = null; resolve(); });
      });
      child.stdin.on("error", () => undefined);
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        const text = this.stderrTail + chunk.slice(0, MAX_LINE);
        this.reason ??= classifyFailure(text);
        // PresentMon 2.5.1 MainThread.cpp emits these final warnings even on exit 0.
        for (const [key, pattern] of [
          ["etwEventsLost", /\b(\d+) ETW events were lost\b/gi],
          ["etwBuffersLost", /\b(\d+) ETW buffers were lost\b/gi],
          ["overflowedPresents", /\b(\d+) overflowed present events detected\b/gi],
        ] as const) {
          for (const match of text.matchAll(pattern)) {
            const count = Number(match[1]);
            if (Number.isSafeInteger(count) && count > 0) {
              this.traceLoss[key] = Math.max(this.traceLoss[key], count); this.traceLoss.detected = true;
            }
          }
        }
        if (/\b(?:lost|dropped)\s+(?:[1-9]\d*\s+)?(?:ETW\s+)?(?:events|buffers)\b|\b[1-9]\d*\s+(?:ETW\s+)?(?:events|buffers)\s+(?:were\s+)?(?:lost|dropped)\b/i.test(text)) this.traceLoss.detected = true;
        if (this.traceLoss.detected) this.reason ??= "trace-loss-detected";
        this.stderrTail = text.slice(-4096); // memory only; never write arbitrary helper output.
      });
      child.stderr.on("error", () => undefined);
      this.completed = this.consume(child, closed);
      await this.persistSummary();
    } catch {
      this.reason ??= "output-unavailable"; this.status = "unavailable"; this.endedAtUtcMs = this.now();
      await this.writer.close().catch(() => undefined); await this.persistSummary();
    }
  }

  private async consume(child: ChildProcessWithoutNullStreams, closed: Promise<void>): Promise<void> {
    try {
      child.stdout.setEncoding("utf8");
      // Async iteration gives the pipe backpressure while disk writes are pending.
      for await (const chunk of child.stdout) {
        const text = String(chunk);
        for (let offset = 0; offset < text.length; offset += 64 * 1024) {
          const samples: DiagnosticFrameSample[] = [];
          this.parser.feed(text.slice(offset, offset + 64 * 1024), this.now(), sample => samples.push(sample));
          for (const sample of samples) { this.histogram.add(sample); await this.writer.add(sample); }
          if (samples.length) this.status = "recording";
        }
        await this.writer.flush();
        if (this.now() - this.lastSummaryAt >= 5000) await this.persistSummary();
      }
    } catch {
      this.reason ??= "output-unavailable";
      // Stop only this optional helper if its output can no longer be stored.
      void this.stop();
    }
    await closed;
    this.parser.finish(); this.stderrTail = "";
    try { await this.writer.close(); } catch { this.reason ??= "output-unavailable"; }
    if (!this.reason && this.exitCode !== 0) this.reason = this.exitCode === 5 ? "permission-denied" : "helper-failed";
    if (!this.parser.counts.accepted) { this.status = "unavailable"; this.reason ??= "no-present-events"; }
    else this.status = this.reason ? "partial" : "complete";
    this.endedAtUtcMs = this.now(); await this.persistSummary();
  }

  private persistSummary(): Promise<void> {
    this.summaryWrite = this.summaryWrite.then(() => this.writeSummary()).catch(() => { this.reason ??= "output-unavailable"; });
    return this.summaryWrite;
  }
  private async writeSummary(): Promise<void> {
    if (!this.ownsOutput) return;
    const path = join(this.options.directory, "frame-times-summary.json");
    const temporary = `${path}.${randomUUID()}.tmp`;
    this.lastSummaryAt = this.now();
    const summary = { schemaVersion: 1, source: "PresentMon 2.5.1 / v1_metrics", status: this.status, reason: this.reason,
      pid: this.options.pid, startedAtUtcMs: this.startedAtUtcMs, endedAtUtcMs: this.endedAtUtcMs, updatedAtUtcMs: this.lastSummaryAt,
      exitCode: this.exitCode, maxDurationSeconds: 28800, traceLoss: this.traceLoss,
      metric: "msBetweenPresents: interval between presentation calls on the same swapchain; not simulation ticks or displayed-frame duration.",
      timing: "qpcTime is the event's raw Windows QPC. receivedAtUtcMs is UTC at pipe receipt, including buffering delay; use native QPC/UTC anchors for accurate log correlation. TimeInSeconds is relative to the PresentMon trace.",
      scope: "Only the requested PID. Swapchains are separate; no combined FPS. Percentiles are histogram upper bounds. Zero intervals are excluded from interval statistics.",
      retention: { maxBytesPerFile: Math.min(MAX_FILE, Math.max(1024, this.dependencies.maxFileBytes ?? MAX_FILE)), files: 2,
        rotations: this.writer.rotations, writtenSamples: this.writer.writtenSamples, summaryCoversAllAcceptedSamples: true },
      counts: this.parser.counts, longFrameThresholdMs: LONG_FRAME_MS,
      relativeStutterThreshold: { minimumExclusiveMs: RELATIVE_MIN_MS, baselineMultiplier: RELATIVE_MULTIPLIER, ewmaAlpha: EWMA_ALPHA,
        baseline: "previous intervals on the same swapchain; a threshold crossing does not establish a cause" },
      ...this.histogram.summary() };
    try { await writeFile(temporary, JSON.stringify(summary, null, 2) + "\n", { flag: "wx" }); await rename(temporary, path); }
    catch { this.reason ??= "output-unavailable"; }
    finally { await rm(temporary, { force: true }).catch(() => undefined); }
  }

  stop(): Promise<void> { this.stopping = true; return this.stopped ??= this.end(); }
  private async end(): Promise<void> {
    await this.started;
    const child = this.child;
    const timeout = this.dependencies.stopTimeoutMs ?? 2500;
    if (child) {
      try {
        await this.verifyExecutable();
        // PresentMon has no stdin shutdown protocol. ControlTrace only our unique ETW session.
        const stopper = this.spawnProcess(this.options.executable, ["--session_name", this.sessionName, "--terminate_existing_session"],
          { windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
        const stopperClosed = new Promise<void>(resolve => { stopper.once("error", () => resolve()); stopper.once("close", () => resolve()); });
        stopper.stdin.on("error", () => undefined);
        stopper.stdout.on("error", () => undefined); stopper.stderr.on("error", () => undefined);
        stopper.stdout.resume(); stopper.stderr.resume();
        if (!await within(stopperClosed, timeout)) stopper.kill();
      } catch { /* A missing helper during shutdown cannot affect the game. */ }
      if (!await within(this.completed, timeout) && this.child === child) {
        this.reason ??= "forced-stop";
        try { child.kill(); } catch { /* Never propagate a failed optional helper termination into gameplay. */ }
        if (!await within(this.completed, timeout)) {
          child.stdout.destroy(); child.stderr.destroy(); child.unref();
          this.status = this.parser.counts.accepted ? "partial" : "unavailable";
          this.endedAtUtcMs = this.now(); await this.persistSummary();
        }
      }
    } else await this.completed;
  }
}
