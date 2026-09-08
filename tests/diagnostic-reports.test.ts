import { createHash } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as yauzl from 'yauzl';
import { afterEach, describe, expect, it } from 'vitest';
import { DiagnosticReportService } from '../electron/services/diagnostic-reports.js';
import { redactDiagnosticText, sanitizeDiagnosticValue } from '../electron/services/diagnostic-redaction.js';

const roots: string[] = [];
afterEach(async () => { for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'rotk-diagnostic-test-')); roots.push(root);
  const installationRoot = join(root, 'game'), logsRoot = join(root, 'logs'), directory = join(root, 'reports');
  await mkdir(installationRoot);
  await mkdir(join(logsRoot, 'install1', 'local'), { recursive: true });
  await mkdir(join(logsRoot, 'install1', 'failure'), { recursive: true });
  const service = new DiagnosticReportService({ directory, knownSecrets: () => ['privateCredential123'] });
  const context = { launcherVersion: '2.0.7', serverLabel: 'LIVE SERVER', serverId: 'live', playerName: 'TestPlayer', installationRoot, logsRoot, installId: 'install1' };
  return { root, installationRoot, logsRoot, directory, service, context };
}
function unzip(path: string): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) { reject(error); return; }
      const files = new Map<string, Buffer>();
      zip.on('error', reject); zip.on('end', () => resolve(files));
      zip.on('entry', (entry: yauzl.Entry) => {
        zip.openReadStream(entry, (readError, stream) => {
          if (readError || !stream) { reject(readError); return; }
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(chunk)); stream.on('error', reject);
          stream.on('end', () => { files.set(entry.fileName, Buffer.concat(chunks)); zip.readEntry(); });
        });
      });
      zip.readEntry();
    });
  });
}
function logsText(files: Map<string, Buffer>): string {
  return [...files].filter(([name]) => /client-(?:local|failure|native)/.test(name)).map(([, bytes]) => bytes.toString()).join('\n');
}

describe('diagnostic report collection and export', () => {
  it('exports real valid ZIPs, only newly appended logs, redacted text and verified SHA-256 hashes', async () => {
    const f = await fixture(), path = join(f.installationRoot, 'game.log');
    await writeFile(path, 'PREVIOUS SESSION PRIVATE\n');
    const { id } = await f.service.beginSession(f.context);
    await appendFile(path, 'CURRENT TestPlayer characterId=0x12345678 Bearer privateCredential123 sessionid=h1g_abcdef password=not-public\n');
    await f.service.updateSession(id, { playerName: 'RenamedPlayer', systemInfo: { commandLine: 'secret args', environment: { PASS: 'secret' }, cpu: 'CPU model' } });
    await f.service.finalizeSession(id, { exitCode: -1073741819 });
    await f.service.exportReport(id, join(f.root, 'report.zip'), { includeDumps: false, description: 'crash at spawn privateCredential123' });
    const files = await unzip(join(f.root, 'report.zip')), text = [...files.values()].map((b) => b.toString()).join('\n');
    expect(logsText(files)).toContain('CURRENT TestPlayer characterId=0x12345678');
    expect(text).not.toContain('PREVIOUS SESSION PRIVATE');
    expect(text).not.toContain('privateCredential123'); expect(text).not.toContain('h1g_abcdef'); expect(text).not.toContain('not-public');
    expect(text).not.toContain('secret args'); expect(text).not.toContain(f.installationRoot);
    const report = JSON.parse(files.get('report.json')!.toString());
    expect(report.summary).toMatchObject({ kind: 'crash', exitCodeHex: '0xC0000005', playerName: 'RenamedPlayer' });
    expect(report.exit.unsignedCode).toBe(3221225477);
    const manifest = JSON.parse(files.get('manifest.json')!.toString());
    expect(manifest.files).toHaveLength(files.size - 1);
    for (const entry of manifest.files) { expect(createHash('sha256').update(files.get(entry.name)!).digest('hex')).toBe(entry.sha256); expect(files.get(entry.name)!.length).toBe(entry.bytes); }
    expect(await readFile(path, 'utf8')).toContain('PREVIOUS SESSION PRIVATE');
  });
  it('keeps full dumps out by default and streams exact binary bytes only on explicit inclusion', async () => {
    const f = await fixture(), { id, directory } = await f.service.beginSession(f.context);
    const dump = Buffer.from('MDMP\x00privateCredential123\x00\xff', 'latin1');
    await writeFile(join(directory, 'snapshot-full.dmp'), dump);
    await f.service.finalizeSession(id, { exitCode: 0 });
    expect((await f.service.getReport(id)).summary).toMatchObject({ dumpCount: 1, hasFullDump: true, kind: 'exit' });
    await f.service.exportReport(id, join(f.root, 'text.zip'), { includeDumps: false, description: '' });
    const textFiles = await unzip(join(f.root, 'text.zip'));
    expect([...textFiles.keys()].some((name) => name.endsWith('.dmp'))).toBe(false);
    expect(JSON.parse(textFiles.get('manifest.json')!.toString()).omissions[0].reason).toBe('binary_dump_not_selected');
    await f.service.exportReport(id, join(f.root, 'full.zip'), { includeDumps: true, description: '' });
    const fullFiles = await unzip(join(f.root, 'full.zip'));
    expect(fullFiles.get('dumps/snapshot-full.dmp')).toEqual(dump);
    expect(JSON.parse(fullFiles.get('manifest.json')!.toString()).containsUnredactedProcessMemory).toBe(true);
  });
  it('does not call null, signal, ordinary nonzero exits or manual snapshots crashes', async () => {
    const f = await fixture();
    for (const result of [{ exitCode: null }, { exitCode: null, signal: 'SIGTERM' }, { exitCode: 1 }]) {
      const { id } = await f.service.beginSession(f.context); await f.service.finalizeSession(id, result);
      expect((await f.service.collectSession(id)).kind).toBe('exit');
    }
    const { id } = await f.service.beginSession(f.context); await f.service.finalizeSession(id, { exitCode: null });
    await f.service.updateSession(id, { kind: 'manual' });
    expect((await f.service.collectSession(id)).kind).toBe('manual');
  });
  it('records native fatal exceptions despite an unavailable process exit code, and preserves recording during collection', async () => {
    const f = await fixture(), { id, directory } = await f.service.beginSession(f.context);
    await writeFile(join(directory, 'native-events.jsonl'), JSON.stringify({ event: 'exception', firstChance: true, code: '0xC0000005' }) + '\n');
    expect(await f.service.collectSession(id)).toMatchObject({ status: 'recording', kind: 'manual' });
    await appendFile(join(directory, 'native-events.jsonl'), JSON.stringify({ event: 'exception', firstChance: false, code: '0xC0000005', address: '0x140001234' }) + '\n');
    await f.service.finalizeSession(id, { exitCode: null });
    expect((await f.service.collectSession(id)).kind).toBe('crash');
  });
  it('marks recovered recording interrupted rather than claiming a native crash', async () => {
    const f = await fixture(), { id } = await f.service.beginSession(f.context);
    const restarted = new DiagnosticReportService({ directory: f.directory }); await restarted.initialize();
    expect((await restarted.getReport(id)).summary).toMatchObject({ kind: 'interrupted', status: 'partial', exitCodeHex: null });
    expect((await restarted.getReport(id)).summary.warnings.join(' ')).toContain('does not establish');
  });
  it('uses the actual observed exit timestamp, and distinguishes failed launches', async () => {
    const f = await fixture(), { id } = await f.service.beginSession(f.context);
    const began = (await f.service.getReport(id)).summary.startedAt;
    const endedAt = new Date(Date.parse(began) + 1234).toISOString();
    await f.service.finalizeSession(id, { exitCode: null, error: new Error('Failed to spawn privateCredential123'), endedAt });
    const record = await f.service.getReport(id);
    expect(record.summary).toMatchObject({ kind: 'launch-error', durationMs: 1234, endedAt });
    expect(record.exit?.error).not.toContain('privateCredential123');
  });
  it('handles renamed and copy-truncated rotations without including the prior session', async () => {
    const f = await fixture(), local = join(f.logsRoot, 'install1', 'local'), path = join(local, 'Client.log');
    await writeFile(path, 'PREVIOUS SESSION\n');
    const { id } = await f.service.beginSession(f.context);
    await rename(path, `${path}.1`); await writeFile(path, 'CURRENT SESSION after rotation\n');
    await f.service.finalizeSession(id, { exitCode: 0 });
    await f.service.exportReport(id, join(f.root, 'rotation.zip'), { includeDumps: false, description: '' });
    const files = await unzip(join(f.root, 'rotation.zip'));
    expect(logsText(files)).toContain('CURRENT SESSION after rotation'); expect(logsText(files)).not.toContain('PREVIOUS SESSION');
    expect(JSON.parse(files.get('manifest.json')!.toString()).issues.some((item: { reason: string }) => item.reason.includes('rotated'))).toBe(true);
  });
  it('collects variable game log component names and Debug.txt while excluding arbitrary structured files', async () => {
    const f = await fixture(), local = join(f.logsRoot, 'install1', 'local'), { id } = await f.service.beginSession(f.context);
    await writeFile(join(local, 'RendererDX11.log'), 'RENDERER_DIAGNOSTIC');
    await writeFile(join(local, 'Debug.txt'), 'DEBUG_DIAGNOSTIC');
    await writeFile(join(local, 'unrelated.json'), 'ARBITRARY_JSON_PRIVATE');
    await f.service.finalizeSession(id, { exitCode: 0 });
    await f.service.exportReport(id, join(f.root, 'components.zip'), { includeDumps: false, description: '' });
    const files = await unzip(join(f.root, 'components.zip'));
    expect(logsText(files)).toContain('RENDERER_DIAGNOSTIC'); expect(logsText(files)).toContain('DEBUG_DIAGNOSTIC');
    expect(logsText(files)).not.toContain('ARBITRARY_JSON_PRIVATE');
  });
  it('reports missing and linked sources, enforces text caps and keeps credential files untouched', async () => {
    const f = await fixture(), local = join(f.logsRoot, 'install1', 'local');
    const original = join(local, 'Client.log'); await writeFile(original, 'old');
    const { id } = await f.service.beginSession(f.context); await rm(original);
    await writeFile(join(local, 'Game.log'), 'x'.repeat(3 * 1024 * 1024) + '\nTAIL_MARKER');
    await writeFile(join(local, 'player-key.json'), 'PRIVATE KEY FILE');
    const outside = join(f.root, 'outside'); await mkdir(outside); await writeFile(join(outside, 'Client.log'), 'LINK_ESCAPE_SECRET');
    await symlink(outside, join(local, 'escape'), 'junction');
    await f.service.finalizeSession(id, { exitCode: 0 });
    await f.service.exportReport(id, join(f.root, 'bounded.zip'), { includeDumps: false, description: '' });
    const files = await unzip(join(f.root, 'bounded.zip')), text = [...files.values()].map((b) => b.toString()).join('\n');
    expect(text).toContain('TAIL_MARKER'); expect(text).not.toContain('LINK_ESCAPE_SECRET'); expect(text).not.toContain('PRIVATE KEY FILE');
    const manifest = JSON.parse(files.get('manifest.json')!.toString());
    expect(manifest.issues.some((issue: { reason: string }) => issue.reason.includes('truncated'))).toBe(true);
    expect(manifest.issues.some((issue: { reason: string }) => issue.reason.includes('missing'))).toBe(true);
    for (const [name, bytes] of files) if (/client-/.test(name)) expect(bytes.length).toBeLessThanOrEqual(2 * 1024 * 1024);
  });
  it('rejects traversal, overwrites and internal/junction export targets', async () => {
    const f = await fixture(), { id } = await f.service.beginSession(f.context);
    expect(() => f.service.getDirectory('../escape')).toThrow();
    await expect(f.service.exportReport(id, join(f.directory, 'inside.zip'), { includeDumps: false, description: '' })).rejects.toThrow('internal');
    const destination = join(f.root, 'existing.zip'); await writeFile(destination, 'KEEP');
    await expect(f.service.exportReport(id, destination, { includeDumps: false, description: '' })).rejects.toThrow('already exists');
    expect(await readFile(destination, 'utf8')).toBe('KEEP');
    const linked = join(f.root, 'linked-reports'); await symlink(f.directory, linked, 'junction');
    await expect(f.service.exportReport(id, join(linked, 'escape.zip'), { includeDumps: false, description: '' })).rejects.toThrow('internal');
    expect((await readdir(f.root)).some((name) => name.endsWith('.zip.tmp'))).toBe(false);
  });
  it('serializes concurrent updates/events and retains ten completed reports without deleting active sessions', async () => {
    const f = await fixture(), active = await f.service.beginSession(f.context);
    await Promise.all(Array.from({ length: 20 }, (_, index) => f.service.appendEvent(active.id, 'test-event', { index })));
    expect((await readFile(join(active.directory, 'events.jsonl'), 'utf8')).trim().split('\n')).toHaveLength(21);
    for (let index = 0; index < 12; index++) {
      const { id } = await f.service.beginSession(f.context); await f.service.finalizeSession(id, { exitCode: 0 }); await f.service.collectSession(id);
    }
    const reports = await f.service.listReports();
    expect(reports.filter((r) => r.status !== 'recording')).toHaveLength(10);
    expect(reports.find((r) => r.id === active.id)?.status).toBe('recording');
  });
});

describe('diagnostic redaction', () => {
  it('redacts known, encoded and generic credentials, local identities and addresses while retaining game identity', () => {
    const text = 'TestPlayer characterId=0x123456789 password=secret Bearer abc.def h1g%255Fencodedtoken sessionid=h1l_ticket mail@test.invalid 192.168.0.1:1234\nC:\\Users\\PrivateUser\\Game\\client.log\ncommandLine=anything-secret';
    const clean = redactDiagnosticText(text);
    for (const value of ['password=secret', 'abc.def', 'encodedtoken', 'h1l_ticket', 'mail@test.invalid', '192.168.0.1', 'PrivateUser', 'anything-secret']) expect(clean).not.toContain(value);
    expect(clean).toContain('TestPlayer characterId=0x123456789');
    expect(sanitizeDiagnosticValue({ cpu: 'model', environment: { SECRET: 'value' }, password: 'value', steamId: '76561190000000000' })).toEqual({ cpu: 'model', steamId: '76561190000000000' });
    expect(redactDiagnosticText('[14:22:03.445] timestamp 2001:db8::1')).toBe('[14:22:03.445] timestamp [IP]');
  });
});
