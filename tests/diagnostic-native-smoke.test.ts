/** Opt-in bridge smoke: ROTK_DIAGNOSTICS_SMOKE=1 npx vitest run tests/diagnostic-native-smoke.test.ts
 * First run node --test native/diagnostics/tests/integration.mjs to build fixtures.
 * Only the dedicated test executable is spawned; no player game is inspected.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DiagnosticObserver, type NativeDiagnosticEvent } from '../electron/services/diagnostic-observer.js';

const enabled = process.platform === 'win32' && process.env.ROTK_DIAGNOSTICS_SMOKE === '1';
let nativeFixtureDirectory: string;
const roots: string[] = [];
const targets: ChildProcessWithoutNullStreams[] = [];
const observers: DiagnosticObserver[] = [];

describe.skipIf(!enabled)('real DiagnosticObserver to Windows native helper bridge', () => {
  beforeAll(async () => {
    const directory = resolve('native/diagnostics/dist');
    const entries = (await readdir(directory, { withFileTypes: true })).filter(entry => entry.isDirectory() && /^integration-\d+$/.test(entry.name));
    entries.sort((a, b) => b.name.localeCompare(a.name));
    for (const entry of entries) {
      const candidate = join(directory, entry.name);
      try { await readFile(join(candidate, 'ROTK.Diagnostics.Test.exe')); await readFile(join(candidate, 'ROTK.Diagnostics.Fixture.exe')); nativeFixtureDirectory = candidate; break; }
      catch { /* A failed earlier fixture build is not usable. */ }
    }
    if (!nativeFixtureDirectory) throw new Error('Run node --test native/diagnostics/tests/integration.mjs before this opt-in smoke.');
  });
  afterEach(async () => {
    for (const observer of observers.splice(0)) await observer.stop();
    for (const target of targets.splice(0)) if (target.exitCode === null && target.signalCode === null) {
      const closed = new Promise<void>(resolve => target.once('close', () => resolve()));
      target.kill(); await closed;
    }
    for (const root of roots.splice(0)) {
      if (!resolve(root).startsWith(resolve(join(tmpdir(), 'rotk-native-smoke-')))) throw new Error('Unsafe smoke cleanup');
      await rm(root, { recursive: true, force: true });
    }
  });

  async function fixture(throwCallback = false) {
    const root = await mkdtemp(join(tmpdir(), 'rotk-native-smoke-')); roots.push(root);
    const executable = join(root, 'ROTK.Diagnostics.Test.exe'), fixture = join(root, 'ROTK.Diagnostics.Fixture.exe');
    await copyFile(join(nativeFixtureDirectory, 'ROTK.Diagnostics.Test.exe'), executable);
    await copyFile(join(nativeFixtureDirectory, 'ROTK.Diagnostics.Fixture.exe'), fixture);
    const bytes = await readFile(executable);
    await writeFile(`${executable}.sha256`, `${createHash('sha256').update(bytes).digest('hex')}  ROTK.Diagnostics.Test.exe\n`);
    const directory = join(root, 'report'); await mkdir(directory);
    const target = spawn(fixture, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); targets.push(target);
    let output = '';
    target.stdout.setEncoding('utf8'); target.stdout.on('data', data => { output += data; });
    target.stderr.resume(); target.stdin.on('error', () => undefined);
    await vi.waitFor(() => expect(output).toContain('ready'), { timeout: 5_000 });
    if (!target.pid) throw new Error('Fixture did not start');
    const events: NativeDiagnosticEvent[] = [];
    const observer = new DiagnosticObserver({ executable, directory, pid: target.pid, onEvent: event => {
      events.push(event);
      if (throwCallback) throw new Error('Simulated callback failure');
    } }); observers.push(observer);
    await observer.start();
    await vi.waitFor(() => expect(events.some(event => event.event === 'attach-breakpoint')).toBe(true), { timeout: 10_000 });
    return { root, executable, directory, target, observer, events, output: () => output };
  }

  it('managed exceptions pass through, then an actual fatal exception yields a complete MDMP through the wrapper', async () => {
    const f = await fixture();
    f.target.stdin.write('handled\n');
    await vi.waitFor(() => expect(f.output()).toContain('handled:100'), { timeout: 5_000 });
    expect(f.events.filter(event => event.event === 'exception' && event.firstChance === true && event.code === '0xE0424242')).toHaveLength(3);
    expect(f.events.some(event => event.event === 'dump-written')).toBe(false);
    f.target.stdin.write('av\n');
    await vi.waitFor(() => expect(f.events.some(event => event.event === 'dump-written' && event.kind === 'fatal')).toBe(true), { timeout: 75_000 });
    const written = f.events.find(event => event.event === 'dump-written' && event.kind === 'fatal')!;
    const dump = await readFile(join(f.directory, String(written.path)));
    expect(dump.toString('ascii', 0, 4)).toBe('MDMP');
    expect(written.exceptionStream).toBe(true);
    await vi.waitFor(() => expect(f.events.find(event => event.event === 'exited')?.exitCodeHex).toBe('0xC0000005'), { timeout: 10_000 });
    await f.observer.drain();
    expect(f.observer.isAttached()).toBe(false);
  }, 90_000);

  it('manual snapshot and callback failures do not stop the fixture; explicit stop detaches it', async () => {
    const f = await fixture(true);
    const gameKill = vi.spyOn(f.target, 'kill');
    await f.observer.snapshot('standard');
    expect(f.events.some(event => event.event === 'dump-written' && event.kind === 'snapshot')).toBe(true);
    f.target.stdin.write('ping\n');
    await vi.waitFor(() => expect(f.output()).toContain('alive:debugger=1'), { timeout: 5_000 });
    await f.observer.stop();
    f.target.stdin.write('ping\n');
    await vi.waitFor(() => expect(f.output()).toContain('alive:debugger=0'), { timeout: 5_000 });
    expect(gameKill).not.toHaveBeenCalled();
  }, 90_000);

  it('a debug observer falls back to real counters behind an existing debugger and stops without affecting the target', async () => {
    const f = await fixture();
    const gameKill = vi.spyOn(f.target, 'kill');
    const directory = join(f.root, 'fallback'); await mkdir(directory);
    const events: NativeDiagnosticEvent[] = [];
    const sampler = new DiagnosticObserver({ executable: f.executable, directory, pid: f.target.pid!, debug: true,
      onEvent: event => { events.push(event); } }); observers.push(sampler);
    await sampler.start();
    await vi.waitFor(() => expect(events.some(event => event.event === 'performance-sample')).toBe(true), { timeout: 10_000 });
    expect(events.some(event => event.event === 'attach-failed')).toBe(true);
    expect(events.some(event => event.event === 'performance-status' && event.debuggerAttached === false
      && event.reason === 'debugger-attach-unavailable')).toBe(true);
    expect(events.some(event => event.event === 'attached')).toBe(false);
    expect(sampler.isAttached()).toBe(false);
    await expect(sampler.snapshot('standard')).rejects.toThrow(/unavailable/);
    await sampler.stop();
    const summary = JSON.parse(await readFile(join(directory, 'performance-summary.json'), 'utf8'));
    expect(summary.reason).toBe('stopped');
    expect(summary.sampleCount).toBeGreaterThan(0);
    expect(summary.validSamples.threads).toBe(0);
    f.target.stdin.write('ping\n');
    await vi.waitFor(() => expect(f.output()).toContain('alive:debugger=1'), { timeout: 5_000 });
    expect(f.observer.isAttached()).toBe(true);
    expect(gameKill).not.toHaveBeenCalled();
  }, 30_000);
});
