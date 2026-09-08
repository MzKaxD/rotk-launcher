import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiagnosticObserver, type NativeDiagnosticEvent } from '../electron/services/diagnostic-observer.js';

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));

class NativeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new PassThrough();
  commands: string[] = [];
  kill = vi.fn(() => { this.emit('close', null, 'SIGTERM'); return true; });
  constructor() { super(); this.stdin.setEncoding('utf8'); this.stdin.on('data', (chunk: string) => this.commands.push(chunk)); }
  event(event: NativeDiagnosticEvent): void { this.stdout.write(`${JSON.stringify(event)}\n`); }
}

const roots: string[] = [];
const children: NativeChild[] = [];
beforeEach(() => { mocks.spawn.mockReset(); mocks.spawn.mockImplementation(() => { const child = new NativeChild(); children.push(child); return child; }); });
afterEach(async () => {
  for (const child of children.splice(0)) { child.emit('close', 0); child.stdout.destroy(); child.stderr.destroy(); child.stdin.destroy(); }
  vi.useRealTimers();
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(resolve(join(tmpdir(), 'rotk-observer-test-')))) throw new Error('Unsafe test cleanup');
    await rm(root, { recursive: true, force: true });
  }
});

async function fixture(onEvent = vi.fn<(event: NativeDiagnosticEvent) => void>()) {
  const directory = await mkdtemp(join(tmpdir(), 'rotk-observer-test-')); roots.push(directory);
  const executable = join(directory, 'ROTK.Diagnostics.exe');
  const binary = Buffer.from('observer test helper bytes');
  await writeFile(executable, binary);
  await writeFile(`${executable}.sha256`, `${createHash('sha256').update(binary).digest('hex')}  ROTK.Diagnostics.exe\n`);
  const observer = new DiagnosticObserver({ executable, directory, pid: 4242, onEvent });
  return { observer, directory, executable, onEvent, child: () => children.at(-1)! };
}

describe('native observer lifecycle and protocol', () => {
  it('validates integrity and launches only the hidden helper with the exact game PID', async () => {
    const f = await fixture();
    await f.observer.start();
    expect(mocks.spawn).toHaveBeenCalledWith(f.executable, ['--watch', '--pid', '4242', '--output', f.directory],
      { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    expect(f.observer.isAttached()).toBe(false);
    f.child().event({ event: 'attached', killOnExit: false, pid: 4242 });
    expect(f.observer.isAttached()).toBe(true);
    f.child().emit('close', 0);
    expect(f.observer.isAttached()).toBe(false);
  });

  it('rejects a mismatched helper before executing it and leaves native capture unavailable', async () => {
    const f = await fixture();
    await writeFile(f.executable, 'tampered');
    await expect(f.observer.start()).resolves.toBeUndefined();
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(f.onEvent).toHaveBeenCalledWith({ event: 'attach-failed', reason: 'helper-missing-or-invalid' });
  });

  it('a missing helper and a throwing status callback cannot escape into launch', async () => {
    const f = await fixture(vi.fn(() => { throw new Error('UI observer failed'); }));
    await rm(f.executable);
    await expect(f.observer.start()).resolves.toBeUndefined();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('parses fragmented JSONL and forwards managed/fatal exceptions without treating them as a snapshot', async () => {
    const f = await fixture(); await f.observer.start();
    f.child().stdout.write('not-json\n{"event":"att');
    f.child().stdout.write('ached","pid":4242}\n{"ignored":true}\n');
    expect(f.observer.isAttached()).toBe(true);
    const capture = f.observer.snapshot('standard');
    let complete = false; void capture.then(() => { complete = true; });
    f.child().event({ event: 'exception', firstChance: true, code: '0xE0424242' });
    f.child().event({ event: 'exception', firstChance: false, code: '0xC0000005' });
    f.child().event({ event: 'dump-written', kind: 'fatal', path: 'crash.dmp' });
    await Promise.resolve();
    expect(complete).toBe(false);
    expect(f.child().commands).toEqual(['snapshot\n']);
    f.child().event({ event: 'dump-written', kind: 'snapshot', path: 'snapshot.dmp', full: false });
    await expect(capture).resolves.toBeUndefined();
    expect(f.onEvent.mock.calls.map(([event]) => event.event)).toEqual(['attached', 'exception', 'exception', 'dump-written', 'dump-written']);
    expect(f.child().kill).not.toHaveBeenCalled();
  });

  it('isolates throwing callbacks while still completing a requested dump', async () => {
    const f = await fixture(vi.fn(() => { throw new Error('callback failure'); })); await f.observer.start();
    expect(() => f.child().event({ event: 'attached', killOnExit: false })).not.toThrow();
    const capture = f.observer.snapshot('full');
    expect(f.child().commands).toEqual(['full\n']);
    expect(() => f.child().event({ event: 'dump-written', kind: 'snapshot', full: true })).not.toThrow();
    await expect(capture).resolves.toBeUndefined();
  });

  it('prevents overlapping captures and rejects a pending capture when the helper exits', async () => {
    const f = await fixture(); await f.observer.start(); f.child().event({ event: 'attached', killOnExit: false });
    const capture = f.observer.snapshot('standard');
    const result = capture.catch(error => error);
    await expect(f.observer.snapshot('full')).rejects.toThrow(/already running/);
    f.child().emit('close', 3);
    expect(await result).toBeInstanceOf(Error);
    expect(f.child().kill).not.toHaveBeenCalled();
  });

  it('standalone full capture uses --snapshot --full without watch mode', async () => {
    const f = await fixture();
    const capture = f.observer.captureOnce('full');
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce());
    expect(mocks.spawn.mock.calls[0]?.[1]).toEqual(['--snapshot', '--pid', '4242', '--output', f.directory, '--full']);
    f.child().event({ event: 'dump-written', kind: 'snapshot', full: true });
    await expect(capture).resolves.toBeUndefined();
    f.child().emit('close', 0);
    await f.observer.stop();
    expect(f.child().kill).not.toHaveBeenCalled();
  });

  it('spawn errors become attach-failed and never attempt to kill a game PID', async () => {
    const f = await fixture(); await f.observer.start();
    expect(() => f.child().emit('error', new Error('EACCES'))).not.toThrow();
    expect(f.onEvent).toHaveBeenCalledWith({ event: 'attach-failed', reason: 'helper-start-failed' });
    expect(f.child().kill).not.toHaveBeenCalled();
  });

  it('stopping during async integrity reads does not spawn a late helper or leave a pending capture', async () => {
    const f = await fixture();
    const capture = f.observer.captureOnce('standard');
    const result = capture.then(() => 'resolved', () => 'rejected');
    await f.observer.stop();
    await expect(Promise.race([result, new Promise(resolve => setTimeout(() => resolve('still-pending'), 250))])).resolves.toBe('rejected');
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('stop first requests detachment and may kill only the helper after its grace period', async () => {
    const f = await fixture(); await f.observer.start(); f.child().event({ event: 'attached', killOnExit: false });
    vi.useFakeTimers();
    const stopping = f.observer.stop();
    expect(f.child().commands).toEqual(['stop\n']);
    expect(f.child().kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_100);
    await stopping;
    expect(f.child().kill).toHaveBeenCalledOnce();
    expect(f.child().kill).toHaveBeenCalledWith();
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });

  it('never forcibly kills a watch helper before it confirms Windows kill-on-exit was disabled', async () => {
    const f = await fixture(); await f.observer.start();
    vi.useFakeTimers();
    const stopping = f.observer.stop();
    await vi.advanceTimersByTimeAsync(5_100);
    await stopping;
    expect(f.child().commands).toEqual(['stop\n']);
    expect(f.child().kill).not.toHaveBeenCalled();
    f.child().emit('close', 0);
  });

  it('also bounds a spontaneous fatal dump when no manual snapshot promise exists', async () => {
    const f = await fixture(); await f.observer.start(); f.child().event({ event: 'attached', killOnExit: false });
    vi.useFakeTimers();
    f.child().event({ event: 'dump-started', kind: 'fatal', full: false });
    await vi.advanceTimersByTimeAsync(69_999);
    expect(f.child().kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.child().kill).toHaveBeenCalledOnce();
    expect(f.onEvent).toHaveBeenCalledWith({ event: 'attach-failed', reason: 'capture-timeout' });
  });

  it.each([['standard', 75_000], ['full', 205_000]] as const)('%s capture watchdog stops a helper that never completes', async (mode, budget) => {
    const f = await fixture(); await f.observer.start(); f.child().event({ event: 'attached', killOnExit: false });
    vi.useFakeTimers();
    const capture = f.observer.snapshot(mode).catch(error => error);
    await vi.advanceTimersByTimeAsync(budget - 1);
    expect(f.child().kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_101);
    expect(await capture).toBeInstanceOf(Error);
    expect(f.child().kill).toHaveBeenCalledOnce();
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });
});
