import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiagnosticController } from '../electron/services/diagnostic-controller.js';
import type { NativeObserverOptions } from '../electron/services/diagnostic-observer.js';

type ObserverMock = {
  options: NativeObserverOptions;
  attached: boolean;
  start: ReturnType<typeof vi.fn<() => Promise<void>>>;
  stop: ReturnType<typeof vi.fn<() => Promise<void>>>;
  drain: ReturnType<typeof vi.fn<() => Promise<void>>>;
  snapshot: ReturnType<typeof vi.fn<(mode: 'standard' | 'full') => Promise<void>>>;
  captureOnce: ReturnType<typeof vi.fn<(mode: 'standard' | 'full') => Promise<void>>>;
  isAttached(): boolean;
};
const mocks = vi.hoisted(() => ({
  observers: [] as ObserverMock[],
  collectSystem: vi.fn<() => Promise<Record<string, unknown>>>(),
  windowsEvents: vi.fn<() => Promise<unknown[]>>(),
}));
vi.mock('../electron/services/diagnostic-system.js', () => ({ collectDiagnosticSystemInfo: mocks.collectSystem, collectGameWindowsEvents: mocks.windowsEvents }));
vi.mock('../electron/services/diagnostic-observer.js', () => ({
  DiagnosticObserver: class implements ObserverMock {
    attached = false;
    start = vi.fn(async () => undefined);
    stop = vi.fn(async () => undefined);
    drain = vi.fn(async () => undefined);
    snapshot = vi.fn(async (_mode: 'standard' | 'full') => undefined);
    captureOnce = vi.fn(async (_mode: 'standard' | 'full') => undefined);
    constructor(readonly options: NativeObserverOptions) { mocks.observers.push(this); }
    isAttached(): boolean { return this.attached; }
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const roots: string[] = [];
beforeEach(() => {
  mocks.observers.length = 0;
  mocks.collectSystem.mockReset().mockResolvedValue({ os: 'Windows fixture', memoryBytes: 8 * 1024 ** 3 });
  mocks.windowsEvents.mockReset().mockResolvedValue([]);
});
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(resolve(join(tmpdir(), 'rotk-controller-test-')))) throw new Error('Unsafe test cleanup');
    await rm(root, { recursive: true, force: true });
  }
});

async function fixture(enabled = true) {
  const root = await mkdtemp(join(tmpdir(), 'rotk-controller-test-')); roots.push(root);
  const onChange = vi.fn();
  const controller = new DiagnosticController({ directory: join(root, 'reports'), helperPath: join(root, 'helper.exe'),
    knownSecrets: () => ['known-player-secret'], onChange });
  await controller.initialize(enabled);
  const context = { launcherVersion: '2.0.7', serverLabel: 'TEST ONLY', serverId: 'fixture' };
  return { root, controller, context, onChange };
}

describe('diagnostic controller and persisted session lifecycle', () => {
  it('preserves the Windows startup crash code when launch also reports a generic startup failure', async () => {
    const f = await fixture(), launch = await f.controller.beginLaunch(f.context);
    launch.hooks.onSpawned(4242);
    const exited = launch.hooks.onExit(-1073741819, null);
    await f.controller.launchFailed(launch.id, new Error('H1Z1 closed during initialization'));
    await exited;
    const report = await f.controller.reports.getReport(launch.id);
    expect(report.summary).toMatchObject({ kind: 'crash', exitCodeHex: '0xC0000005' });
    expect(report.summary.captureStatus).not.toBe('pending');
    expect(report.exit?.code).toBe(-1073741819);
    expect(report.exit?.error).toBeNull();
    expect(mocks.observers[0]?.stop).toHaveBeenCalledOnce();
    expect((await f.controller.state()).recordingId).toBeNull();
  });

  it('keeps the onExit promise pending until asynchronous evidence collection is complete', async () => {
    const system = deferred<Record<string, unknown>>();
    mocks.collectSystem.mockReturnValue(system.promise);
    const f = await fixture(), launch = await f.controller.beginLaunch(f.context);
    launch.hooks.onSpawned(4242);
    let completed = false;
    const exited = launch.hooks.onExit(0, null).then(() => { completed = true; });
    await vi.waitFor(() => expect(mocks.observers[0]?.drain).toHaveBeenCalledOnce());
    expect(completed).toBe(false);
    expect((await f.controller.state()).recordingId).toBe(launch.id);
    expect((await f.controller.reports.getReport(launch.id)).summary.status).toBe('collecting');
    system.resolve({ os: 'Windows delayed evidence' });
    await exited;
    expect(completed).toBe(true);
    expect((await f.controller.reports.getReport(launch.id)).context.systemInfo).toEqual({ os: 'Windows delayed evidence' });
    expect((await f.controller.state()).recordingId).toBeNull();
  });

  it('disabled native capture still creates useful game exit evidence without an observer', async () => {
    const f = await fixture(false), launch = await f.controller.beginLaunch(f.context);
    launch.hooks.onSpawned(4242);
    launch.hooks.onOutput('stderr', 'Client failed sessionid=known-player-secret');
    await launch.hooks.onExit(-1073741571, null);
    expect(mocks.observers).toHaveLength(0);
    const report = await f.controller.reports.getReport(launch.id);
    expect(report.summary.exitCodeHex).toBe('0xC00000FD');
    const events = await readFile(join(f.controller.reports.getDirectory(launch.id), 'events.jsonl'), 'utf8');
    expect(events).toContain('game_stderr');
    expect(events).not.toContain('known-player-secret');
  });

  it('an unavailable native helper adds a warning but never prevents the game lifecycle', async () => {
    const f = await fixture(), launch = await f.controller.beginLaunch(f.context);
    expect(() => launch.hooks.onSpawned(4242)).not.toThrow();
    mocks.observers[0]!.options.onEvent({ event: 'attach-failed', reason: 'helper-missing-or-invalid' });
    await vi.waitFor(async () => expect((await f.controller.reports.getReport(launch.id)).summary.captureStatus).toBe('unavailable'));
    await launch.hooks.onExit(0, null);
    const report = await f.controller.reports.getReport(launch.id);
    expect(report.summary.kind).toBe('exit');
    expect(report.summary.warnings.join(' ')).toMatch(/unavailable/);
    expect((await f.controller.state()).recordingId).toBeNull();
  });

  it('rejects overlapping manual capture/export and keeps busy until the snapshot completes', async () => {
    const f = await fixture(), launch = await f.controller.beginLaunch(f.context);
    launch.hooks.onSpawned(4242);
    const observer = mocks.observers[0]!; observer.attached = true;
    const snapshot = deferred<void>(); observer.snapshot.mockReturnValue(snapshot.promise);
    const capture = f.controller.capture({ mode: 'full', description: 'freeze in Combat Training' }, f.context);
    await vi.waitFor(() => expect(observer.snapshot).toHaveBeenCalledWith('full'));
    expect((await f.controller.state()).busy).toBe(true);
    await expect(f.controller.capture({ mode: 'standard', description: '' }, f.context)).rejects.toThrow(/already running/);
    await expect(f.controller.exportReport(launch.id, join(f.root, 'busy.zip'), { includeDumps: true, description: '' })).rejects.toThrow(/already running/);
    expect(observer.stop).not.toHaveBeenCalled();
    snapshot.resolve();
    const report = await capture;
    expect(report.id).toBe(launch.id);
    expect((await f.controller.state()).busy).toBe(false);
    expect((await f.controller.reports.getReport(launch.id)).context.notes).toBe('freeze in Combat Training');
    await launch.hooks.onExit(0, null);
  });

  it('manual capture failures preserve logs and a clear warning instead of failing the game session', async () => {
    const f = await fixture(), launch = await f.controller.beginLaunch(f.context);
    launch.hooks.onSpawned(4242);
    const observer = mocks.observers[0]!; observer.attached = true;
    observer.snapshot.mockRejectedValue(new Error('Disk full'));
    const captured = await f.controller.capture({ mode: 'standard', description: 'hung game' }, f.context);
    expect(captured.warnings.join(' ')).toMatch(/memory capture did not complete/);
    expect((await f.controller.state()).busy).toBe(false);
    await launch.hooks.onExit(0, null);
  });

  it('uses a standalone snapshot only for the known active game PID when attachment is unavailable', async () => {
    const f = await fixture(), launch = await f.controller.beginLaunch(f.context);
    launch.hooks.onSpawned(4242);
    await f.controller.capture({ mode: 'standard', description: 'freeze' }, f.context);
    expect(mocks.observers).toHaveLength(2);
    expect(mocks.observers[1]?.options.pid).toBe(4242);
    expect(mocks.observers[1]?.captureOnce).toHaveBeenCalledWith('standard');
    expect(mocks.observers[1]?.stop).toHaveBeenCalledOnce();
    expect(mocks.observers[0]?.stop).not.toHaveBeenCalled();
    await launch.hooks.onExit(0, null);
  });

  it('export waits for in-flight finalization before packaging the preserved crash outcome', async () => {
    const windows = deferred<unknown[]>(); mocks.windowsEvents.mockReturnValue(windows.promise);
    const f = await fixture(), launch = await f.controller.beginLaunch(f.context);
    launch.hooks.onSpawned(4242);
    const exited = launch.hooks.onExit(-1073741819, null);
    await vi.waitFor(() => expect(mocks.windowsEvents).toHaveBeenCalledOnce());
    const exportSpy = vi.spyOn(f.controller.reports, 'exportReport').mockResolvedValue(undefined);
    const exporting = f.controller.exportReport(launch.id, join(f.root, 'crash.zip'), { includeDumps: false, description: 'startup' });
    await Promise.resolve();
    expect(exportSpy).not.toHaveBeenCalled();
    expect((await f.controller.state()).busy).toBe(true);
    windows.resolve([{ provider: 'Application Error', id: 1000 }]);
    await Promise.all([exited, exporting]);
    expect(exportSpy).toHaveBeenCalledOnce();
    expect((await f.controller.reports.getReport(launch.id)).summary.exitCodeHex).toBe('0xC0000005');
    expect((await f.controller.state()).busy).toBe(false);
  });

  it('a capture requested during finalization uses the finished session without starting a late debugger', async () => {
    const windows = deferred<unknown[]>(); mocks.windowsEvents.mockReturnValue(windows.promise);
    const f = await fixture(), launch = await f.controller.beginLaunch(f.context);
    launch.hooks.onSpawned(4242);
    const exited = launch.hooks.onExit(-1073741571, null);
    await vi.waitFor(() => expect(mocks.windowsEvents).toHaveBeenCalledOnce());
    const capture = f.controller.capture({ mode: 'full', description: 'startup overflow' }, f.context);
    await Promise.resolve();
    expect(mocks.observers[0]?.snapshot).not.toHaveBeenCalled();
    expect(mocks.observers).toHaveLength(1);
    windows.resolve([]);
    const [, captured] = await Promise.all([exited, capture]);
    expect(captured.id).toBe(launch.id);
    expect(captured.exitCodeHex).toBe('0xC00000FD');
    expect((await f.controller.state()).busy).toBe(false);
  });

  it('deduplicates concurrent exit/failure finalization and recovers after collection errors', async () => {
    const f = await fixture(), launch = await f.controller.beginLaunch(f.context);
    launch.hooks.onSpawned(4242);
    vi.spyOn(f.controller.reports, 'collectSession').mockRejectedValueOnce(new Error('Disk unavailable'));
    await Promise.all([launch.hooks.onExit(-1073741819, null), launch.hooks.onExit(0, null), f.controller.launchFailed(launch.id, new Error('startup'))]);
    const state = await f.controller.state();
    expect(state.recordingId).toBeNull();
    expect(state.error).toMatch(/incomplete/);
    expect(mocks.observers[0]?.stop).toHaveBeenCalledOnce();
    expect((await f.controller.reports.getReport(launch.id)).summary.exitCodeHex).toBe('0xC0000005');
    const next = await f.controller.beginLaunch(f.context);
    await next.hooks.onExit(0, null);
  });

  it('a report without a running game is explicitly manual and never tries native memory capture', async () => {
    const f = await fixture();
    const report = await f.controller.capture({ mode: 'full', description: 'crashed before launcher opened' }, f.context);
    expect(report.kind).toBe('manual');
    expect(report.dumpCount).toBe(0);
    expect(report.warnings.join(' ')).toMatch(/No game was running/);
    expect(mocks.observers).toHaveLength(0);
    expect((await f.controller.state()).busy).toBe(false);
  });
  it('does not strand the controller when initial session metadata cannot be persisted', async () => {
    const f = await fixture();
    vi.spyOn(f.controller.reports, 'updateSession').mockRejectedValueOnce(new Error('Disk unavailable'));
    await expect(f.controller.beginLaunch(f.context)).rejects.toThrow('Disk unavailable');
    expect((await f.controller.state()).recordingId).toBeNull();
    const next = await f.controller.beginLaunch(f.context);
    await next.hooks.onExit(0, null);
    expect((await f.controller.state()).recordingId).toBeNull();
  });
});
