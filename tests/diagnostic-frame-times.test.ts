import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiagnosticFrameTimes, FrameTimesHistogram, PresentMonFrameParser, parseFrameTimesCsvLine,
  type DiagnosticFrameSample } from "../electron/services/diagnostic-frame-times";

// PresentMon 2.5.1 CsvOutput.cpp: WriteCsvHeader<FrameMetrics1>, --v1_metrics --qpc_time.
const HEADER = "Application,ProcessID,SwapChainAddress,Runtime,SyncInterval,PresentFlags,Dropped,TimeInSeconds,msInPresentAPI,msBetweenPresents,AllowsTearing,PresentMode,msUntilRenderComplete,msUntilDisplayed,msBetweenDisplayChange,msGPUActive,QPCTime\r\n";
const UTC = 1_800_000_000_000;
const row = (qpc: number, interval = 2, chain = 1, pid = 4321) =>
  `"C:\\Users\\SECRET,private.exe",${pid},0x${chain.toString(16)},DXGI,1,0,0,${qpc / 10000000},0.03,${interval},1,Composed: Flip,1,2,2,0.5,${qpc}\r\n`;
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    const absolute = resolve(root);
    if (dirname(absolute) !== resolve(tmpdir()) || !absolute.startsWith(resolve(join(tmpdir(), "rotk-frame-times-")))) {
      throw new Error("Refusing to remove a path outside the frame-times test fixtures");
    }
    await rm(absolute, { recursive: true, force: true });
  }
});

function childFixture() {
  type FakeChild = Omit<ChildProcessWithoutNullStreams, "stdin" | "stdout" | "stderr"> & {
    stdin: PassThrough; stdout: PassThrough; stderr: PassThrough;
  };
  const emitter = new EventEmitter();
  const child = Object.assign(emitter, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    pid: 9001, unref: vi.fn(), kill: vi.fn(() => { finish(null); return true; }) }) as unknown as FakeChild;
  let done = false;
  function finish(code: number | null = 0) {
    if (done) return; done = true;
    child.stdout.end(); child.stderr.end(); child.emit("close", code, code === null ? "SIGTERM" : null);
  }
  return { child, finish };
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "rotk-frame-times-")); roots.push(root);
  const executable = join(root, "PresentMon.exe"), directory = join(root, "report");
  const binary = Buffer.from("fixture helper; it is never executed");
  await writeFile(executable, binary);
  await writeFile(`${executable}.sha256`, `${createHash("sha256").update(binary).digest("hex")}  PresentMon.exe\n`);
  const process = childFixture();
  const spawnMock = vi.fn(() => process.child);
  const options = { executable, directory, pid: 4321, sessionId: "test-session" };
  const collector = new DiagnosticFrameTimes(options, { spawn: spawnMock as unknown as typeof spawn, now: () => UTC, stopTimeoutMs: 10 });
  const summary = async () => JSON.parse(await readFile(join(directory, "frame-times-summary.json"), "utf8"));
  return { root, executable, directory, process, spawnMock, options, collector, summary };
}

describe("PresentMon's bounded numeric CSV parser", () => {
  it("parses official v1 columns, fragmented CRLF and quoted names while never exporting source strings", () => {
    const parser = new PresentMonFrameParser(4321), samples: DiagnosticFrameSample[] = [];
    const input = HEADER + row(100, 2) + row(110, 10, 2) + row(120, 12, 1, 1111);
    for (let offset = 0; offset < input.length; offset += 7) parser.feed(input.slice(offset, offset + 7), UTC, sample => samples.push(sample));
    parser.finish();
    expect(samples).toHaveLength(2); expect(parser.counts.foreignPid).toBe(1);
    expect(samples[0]).toMatchObject({ pid: 4321, swapChainId: 1, qpcTime: 100, msBetweenPresents: 2, receivedAtUtcMs: UTC, msGPUActive: 0.5 });
    expect(samples.every(sample => Object.values(sample).every(value => typeof value === "number" && Number.isFinite(value)))).toBe(true);
    expect(JSON.stringify(samples)).not.toMatch(/SECRET|private|DXGI|0x/);
  });

  it("does not derive frame times from interleaved swapchain timestamps or accept duplicate frames", () => {
    const parser = new PresentMonFrameParser(4321), samples: DiagnosticFrameSample[] = [];
    parser.feed(HEADER + row(100, 2, 1) + row(101, 18, 2) + row(200, 10, 1) + row(199, 100, 1) + row(200, 100, 1), UTC, sample => samples.push(sample));
    expect(samples.map(sample => [sample.swapChainId, sample.msBetweenPresents])).toEqual([[1, 2], [2, 18], [1, 10]]);
    expect(parser.counts.outOfOrder).toBe(2);
  });

  it("bounds malformed CSV, rejects nonfinite metrics and unsafe QPC, then recovers at a real newline", () => {
    const parser = new PresentMonFrameParser(4321), samples: DiagnosticFrameSample[] = [];
    parser.feed(HEADER + "x".repeat(40000), UTC, sample => samples.push(sample));
    parser.feed(row(1) + row(2), UTC, sample => samples.push(sample));
    parser.feed(row(3, Infinity) + row(Number.MAX_SAFE_INTEGER + 1) + row(4).trimEnd(), UTC, sample => samples.push(sample));
    parser.finish();
    expect(samples.map(sample => sample.qpcTime)).toEqual([2]);
    expect(parser.counts.oversized).toBe(1); expect(parser.counts.invalid).toBe(3);
    expect(parseFrameTimesCsvLine('"unclosed')).toBeNull();
    expect(parseFrameTimesCsvLine('"closed"bad,2')).toBeNull();
    expect(parseFrameTimesCsvLine(new Array(98).fill("1").join(","))).toBeNull();
    expect(parseFrameTimesCsvLine('"quote ""inside""",2')).toEqual(['quote "inside"', "2"]);
  });

  it("requires the exact time basis and a unique header, and caps swapchain identities", () => {
    const parser = new PresentMonFrameParser(4321), samples: DiagnosticFrameSample[] = [];
    parser.feed(HEADER.replace("QPCTime", "CPUStartQPC") + row(1), UTC, sample => samples.push(sample));
    parser.feed(HEADER.replace("Runtime", "ProcessID") + row(2), UTC, sample => samples.push(sample));
    parser.feed(HEADER, UTC, sample => samples.push(sample));
    for (let chain = 1; chain <= 34; chain++) parser.feed(row(chain + 100, 2, chain), UTC, sample => samples.push(sample));
    expect(samples).toHaveLength(32); expect(parser.counts.excessSwapChains).toBe(2);
    expect(parser.counts.invalid).toBeGreaterThanOrEqual(2);
  });
});

describe("per-swapchain frame interval statistics", () => {
  const sample = (qpcTime: number, msBetweenPresents: number, swapChainId = 1): DiagnosticFrameSample =>
    ({ qpcTime, msBetweenPresents, swapChainId, pid: 4321, receivedAtUtcMs: UTC, presentMonTimeSeconds: qpcTime / 1e7 });
  it("excludes zero intervals, keeps chains separate, and labels histogram percentile bounds", () => {
    const stats = new FrameTimesHistogram();
    stats.add(sample(1, 0)); stats.add(sample(2, 2)); stats.add(sample(3, 10)); stats.add(sample(4, 80, 2));
    const summary = stats.summary();
    expect(summary.swapChains[0]).toMatchObject({ samples: 3, intervals: 2, zeroIntervals: 1, meanMs: 6, p50UpperBoundMs: 2, p95UpperBoundMs: 12 });
    expect(summary.swapChains[1]).toMatchObject({ samples: 1, meanMs: 80, longFrames: 1, relativeStutters: 0 });
  });
  it("finds 2ms to 10ms stutters using the previous same-chain baseline, without claiming a long frame", () => {
    const stats = new FrameTimesHistogram();
    stats.add(sample(1, 2)); stats.add(sample(2, 16, 2)); stats.add(sample(3, 10)); stats.add(sample(4, 20, 2));
    const summary = stats.summary();
    expect(summary.relativeStutters).toHaveLength(1);
    expect(summary.relativeStutters[0]).toMatchObject({ swapChainId: 1, msBetweenPresents: 10, baselineBeforeMs: 2, thresholdMs: 8, multipleOfBaseline: 5 });
    expect(summary.longestFrames).toHaveLength(0);
  });
  it("bounds global peaks and the 32-swapchain serialized summary well below the 64 KiB export cap", () => {
    const stats = new FrameTimesHistogram();
    for (let chain = 1; chain <= 32; chain++) {
      stats.add(sample(1, 2, chain));
      for (let i = 2; i <= 500; i++) stats.add(sample(i, i % 60 === 0 ? 10000 : 2, chain));
    }
    const summary = stats.summary();
    expect(summary.swapChains).toHaveLength(32); expect(summary.longestFrames).toHaveLength(16); expect(summary.relativeStutters).toHaveLength(16);
    expect(Buffer.byteLength(JSON.stringify(summary, null, 2))).toBeLessThan(55 * 1024);
  });
});

describe("optional PresentMon collector lifecycle and privacy", () => {
  it("verifies the sidecar before spawn, uses only intended flags, and persists successful numeric evidence", async () => {
    const f = await fixture(); await Promise.all([f.collector.start(), f.collector.start()]);
    expect(f.spawnMock).toHaveBeenCalledTimes(1);
    const call = f.spawnMock.mock.calls[0] as unknown as [string, string[], object];
    expect(call[1]).toEqual(["--process_id", "4321", "--output_stdout", "--no_console_stats", "--no_track_input", "--session_name", expect.stringMatching(/^ROTK-[a-f0-9]{16}-/), "--terminate_on_proc_exit", "--timed", "28800", "--terminate_after_timed", "--v1_metrics", "--qpc_time"]);
    expect(call[2]).toMatchObject({ windowsHide: true, shell: false });
    f.process.child.stdout.write(HEADER + row(100) + row(200, 10)); f.process.finish(); await f.collector.stop();
    const summary = await f.summary();
    expect(summary).toMatchObject({ status: "complete", reason: null, counts: { accepted: 2 }, retention: { writtenSamples: 2 } });
    expect(summary.relativeStutters).toHaveLength(1);
    const output = await readFile(join(f.directory, "frame-times.jsonl"), "utf8");
    expect(output).not.toMatch(/SECRET|private/); expect(output.trim().split("\n")).toHaveLength(2);
    expect(await readdir(f.directory)).toEqual(expect.arrayContaining(["frame-times.jsonl", "frame-times-summary.json"]));
    expect((await readdir(f.directory)).some(name => name.endsWith(".tmp"))).toBe(false);
  });

  it.each(["corrupt", "missing", "invalid-pid"])("records %s as unavailable without ever spawning", async mode => {
    const f = await fixture();
    if (mode === "corrupt") await writeFile(f.executable, "tampered");
    if (mode === "missing") await rm(f.executable);
    const collector = mode === "invalid-pid" ? new DiagnosticFrameTimes({ ...f.options, pid: -1 }, { spawn: f.spawnMock as unknown as typeof spawn }) : f.collector;
    await collector.start(); await collector.stop();
    expect(f.spawnMock).not.toHaveBeenCalled();
    expect(await f.summary()).toMatchObject({ status: "unavailable", reason: mode === "corrupt" ? "integrity-check-failed" : mode === "missing" ? "helper-missing" : "invalid-pid" });
  });

  it("turns split StartTrace access-denied output into a category without storing arbitrary stderr", async () => {
    const f = await fixture(); await f.collector.start();
    f.process.child.stderr.write("C:\\Users\\SECRET: Start"); f.process.child.stderr.write("Trace() failed: 5 (Access is denied)\n");
    f.process.finish(1); await f.collector.stop();
    const text = await readFile(join(f.directory, "frame-times-summary.json"), "utf8");
    expect(JSON.parse(text)).toMatchObject({ status: "unavailable", reason: "permission-denied", counts: { accepted: 0 } });
    expect(text).not.toMatch(/SECRET|C:\\Users|StartTrace/);
  });

  it("keeps no-present-events distinct from a successful frame capture", async () => {
    const f = await fixture(); await f.collector.start(); f.process.finish(0); await f.collector.stop();
    expect(await f.summary()).toMatchObject({ status: "unavailable", reason: "no-present-events" });
  });

  it("marks official ETW loss and overflow warnings as partial even with exit 0, preserving numeric counts only", async () => {
    const f = await fixture(); await f.collector.start();
    f.process.child.stdout.write(HEADER + row(1));
    f.process.child.stderr.write("PRIVATE_PATH warning: 3 ETW buffers were ");
    f.process.child.stderr.write("lost.\nwarning: 9 ETW events were lost.\nwarning: 12 overflowed present events detected.\n");
    f.process.finish(0); await f.collector.stop();
    const summary = await f.summary();
    expect(summary).toMatchObject({ status: "partial", reason: "trace-loss-detected", maxDurationSeconds: 28800,
      traceLoss: { detected: true, etwBuffersLost: 3, etwEventsLost: 9, overflowedPresents: 12 } });
    expect(JSON.stringify(summary)).not.toContain("PRIVATE_PATH");
  });

  it("does not confuse dropped presentation frames or zero loss with lost ETW events", async () => {
    const f = await fixture(); await f.collector.start();
    f.process.child.stdout.write(HEADER + row(1).replace(",DXGI,1,0,0,", ",DXGI,1,0,1,"));
    f.process.child.stderr.write("warning: 0 ETW events were lost.\nDropped frames: 1\n");
    f.process.finish(0); await f.collector.stop();
    expect(await f.summary()).toMatchObject({ status: "complete", reason: null, traceLoss: { detected: false } });
  });

  it("handles a spawn error as metadata rather than rejecting start or stop", async () => {
    const f = await fixture(); await f.collector.start();
    f.process.child.emit("error", new Error("PRIVATE spawn path")); f.process.finish(-1); await f.collector.stop();
    expect(await f.summary()).toMatchObject({ status: "unavailable", reason: "helper-failed" });
  });

  it("rotates two bounded JSONL files while statistics retain all accepted frames", async () => {
    const f = await fixture();
    const collector = new DiagnosticFrameTimes(f.options, { spawn: f.spawnMock as unknown as typeof spawn, now: () => UTC, maxFileBytes: 1024 });
    await collector.start(); f.process.child.stdout.write(HEADER + Array.from({ length: 100 }, (_, i) => row(i + 100)).join(""));
    f.process.finish(); await collector.stop();
    let retained = 0;
    for (const name of ["frame-times.jsonl", "frame-times.jsonl.1"]) {
      expect((await stat(join(f.directory, name))).size).toBeLessThanOrEqual(1024);
      const lines = (await readFile(join(f.directory, name), "utf8")).trim().split("\n");
      for (const line of lines) expect(JSON.parse(line)).toMatchObject({ pid: 4321 });
      retained += lines.length;
    }
    const summary = await f.summary();
    expect(summary.counts.accepted).toBe(100); expect(summary.retention.writtenSamples).toBe(100);
    expect(summary.retention.rotations).toBeGreaterThan(1); expect(retained).toBeLessThan(100);
  });

  it("stops only its random ETW session and is idempotent, without killing the game or helper when graceful stop works", async () => {
    const f = await fixture(), stopper = childFixture();
    const spawnMock = vi.fn((_executable: string, args: string[]) => {
      if (args.includes("--terminate_existing_session")) {
        setImmediate(() => { f.process.finish(); stopper.finish(); }); return stopper.child;
      }
      return f.process.child;
    });
    const collector = new DiagnosticFrameTimes(f.options, { spawn: spawnMock as unknown as typeof spawn, stopTimeoutMs: 100 });
    await collector.start(); f.process.child.stdout.write(HEADER + row(1)); await Promise.all([collector.stop(), collector.stop()]);
    expect(spawnMock).toHaveBeenCalledTimes(2);
    const args = spawnMock.mock.calls[0][1];
    const name = args[args.indexOf("--session_name") + 1];
    expect(spawnMock.mock.calls[1][1]).toEqual(["--session_name", name, "--terminate_existing_session"]);
    expect(f.process.child.kill).not.toHaveBeenCalled(); expect(stopper.child.kill).not.toHaveBeenCalled();
    expect(await f.summary()).toMatchObject({ status: "complete", counts: { accepted: 1 } });
  });

  it("uses a bounded fallback that signals only its owned helper", async () => {
    const f = await fixture(), stopper = childFixture();
    const spawnMock = vi.fn((_executable: string, args: string[]) => {
      if (args.includes("--terminate_existing_session")) { setImmediate(() => stopper.finish()); return stopper.child; }
      return f.process.child;
    });
    const collector = new DiagnosticFrameTimes(f.options, { spawn: spawnMock as unknown as typeof spawn, stopTimeoutMs: 10 });
    await collector.start(); f.process.child.stdout.write(HEADER + row(1)); await collector.stop();
    expect(f.process.child.kill).toHaveBeenCalledTimes(1);
    expect(await f.summary()).toMatchObject({ status: "partial", reason: "forced-stop" });
    expect(spawnMock.mock.calls.every(([, args]) => !args.includes("taskkill"))).toBe(true);
  });

  it("does not start a helper when stopped during asynchronous verification", async () => {
    const f = await fixture();
    const start = f.collector.start(); await f.collector.stop(); await start;
    expect(f.spawnMock).not.toHaveBeenCalled(); expect(await f.summary()).toMatchObject({ reason: "stopped-before-start" });
  });

  it("does not replace prior evidence when another collector reuses the directory", async () => {
    const f = await fixture(); await mkdir(f.directory); await writeFile(join(f.directory, "frame-times-summary.json"), "EXISTING_EVIDENCE");
    await f.collector.start(); await f.collector.stop(); expect(f.spawnMock).not.toHaveBeenCalled();
    expect(await readFile(join(f.directory, "frame-times-summary.json"), "utf8")).toBe("EXISTING_EVIDENCE");
  });
});
