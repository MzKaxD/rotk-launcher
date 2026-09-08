import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as yauzl from 'yauzl';
import * as fsPromises from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiagnosticReportService } from '../electron/services/diagnostic-reports';
import { redactDiagnosticText, sanitizeDiagnosticValue } from '../electron/services/diagnostic-redaction';

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original, link: vi.fn(original.link) };
});

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'rotk-diagnostic-privacy-')); roots.push(root);
  const installationRoot = join(root, 'game'), logsRoot = join(root, 'logs'), directory = join(root, 'reports');
  await mkdir(installationRoot); await mkdir(join(logsRoot, 'install1', 'local'), { recursive: true });
  const service = new DiagnosticReportService({ directory });
  const context = { launcherVersion: '2.0.7', serverLabel: 'GAME 2', installationRoot, logsRoot, installId: 'install1' };
  return { root, installationRoot, logsRoot, directory, service, context };
}
async function zipText(path: string): Promise<string> {
  return new Promise((resolve, reject) => yauzl.open(path, { lazyEntries: true }, (error, zip) => {
    if (error || !zip) { reject(error); return; }
    const parts: string[] = [];
    zip.on('error', reject); zip.on('end', () => resolve(parts.join('\n')));
    zip.on('entry', (entry: yauzl.Entry) => zip.openReadStream(entry, (readError, stream) => {
      if (readError || !stream) { reject(readError); return; }
      const chunks: Buffer[] = []; stream.on('data', (chunk: Buffer) => chunks.push(chunk)); stream.on('error', reject);
      stream.on('end', () => { parts.push(Buffer.concat(chunks).toString()); zip.readEntry(); });
    }));
    zip.readEntry();
  }));
}

describe('diagnostic evidence belongs to the recorded session', () => {
  it('does not import later runs when re-exporting a completed crash, while retaining refreshed metadata', async () => {
    const f = await fixture(), log = join(f.installationRoot, 'game.log');
    await writeFile(log, 'PREVIOUS_RUN\n');
    const { id } = await f.service.beginSession(f.context);
    await appendFile(log, 'THIS_CRASH_ONLY\n');
    await f.service.finalizeSession(id, { exitCode: -1073741819 });
    await f.service.collectSession(id);
    await appendFile(log, 'NEXT_RUN_PRIVATE\n');
    await f.service.updateSession(id, { lateMetadata: 'WINDOWS_EVENT_REFRESH' });
    const zip = join(f.root, 'old-crash.zip');
    await f.service.exportReport(id, zip, { includeDumps: false, description: '' });
    const text = await zipText(zip);
    expect(text).toContain('THIS_CRASH_ONLY'); expect(text).toContain('WINDOWS_EVENT_REFRESH');
    expect(text).not.toContain('NEXT_RUN_PRIVATE'); expect(text).not.toContain('PREVIOUS_RUN');
  });

  it('bounds the first collection to the observed exit even when collection is delayed', async () => {
    const f = await fixture(), log = join(f.installationRoot, 'game.log');
    const { id } = await f.service.beginSession(f.context);
    await writeFile(log, 'BEFORE_EXIT\n');
    await f.service.finalizeSession(id, { exitCode: 1 });
    await appendFile(log, 'AFTER_EXIT_PRIVATE\n');
    const zip = join(f.root, 'delayed.zip');
    await f.service.exportReport(id, zip, { includeDumps: false, description: '' });
    const text = await zipText(zip);
    expect(text).toContain('BEFORE_EXIT'); expect(text).not.toContain('AFTER_EXIT_PRIVATE');
  });

  it('preserves an earlier capture when the source is overwritten after the exit boundary', async () => {
    const f = await fixture(), log = join(f.installationRoot, 'game.log');
    const { id } = await f.service.beginSession(f.context);
    await writeFile(log, 'VALID_ACTIVE_CAPTURE\n'); await f.service.collectSession(id);
    await f.service.finalizeSession(id, { exitCode: 1 });
    await writeFile(log, 'DIFFERENT_SESSION_PRIVATE_WITH_LONGER_DATA\n');
    const zip = join(f.root, 'rewritten.zip');
    await f.service.exportReport(id, zip, { includeDumps: false, description: '' });
    const text = await zipText(zip);
    expect(text).toContain('VALID_ACTIVE_CAPTURE'); expect(text).not.toContain('DIFFERENT_SESSION_PRIVATE');
    expect((await f.service.getReport(id)).issues.some(issue => /boundary|changed|rewritten/.test(issue.reason))).toBe(true);
  });

  it('omits shared logs after an interrupted launcher restart without a trustworthy exit boundary', async () => {
    const f = await fixture(), log = join(f.installationRoot, 'game.log');
    const { id, directory } = await f.service.beginSession(f.context);
    await writeFile(log, 'UNBOUNDED_SHARED_PRIVATE\n');
    await writeFile(join(directory, 'native-events.jsonl'), JSON.stringify({ event: 'attached', pid: 1234 }) + '\n');
    const restarted = new DiagnosticReportService({ directory: f.directory });
    const zip = join(f.root, 'recovered.zip');
    await restarted.exportReport(id, zip, { includeDumps: false, description: '' });
    const text = await zipText(zip);
    expect(text).not.toContain('UNBOUNDED_SHARED_PRIVATE'); expect(text).toContain('attached');
    expect((await restarted.getReport(id)).issues.some(issue => /boundary/.test(issue.reason))).toBe(true);
  });

  it('collects actual native launcher log names and excludes logs inside credential directories', async () => {
    const f = await fixture(), local = join(f.logsRoot, 'install1', 'local');
    const { id } = await f.service.beginSession(f.context);
    await writeFile(join(f.installationRoot, 'rotk-vivox-v5-compat.log'), 'VIVOX_CURRENT_DIAGNOSTIC');
    await writeFile(join(f.installationRoot, 'steam_api64.log'), 'STEAM_CURRENT_DIAGNOSTIC');
    await mkdir(join(local, 'credentials'));
    await writeFile(join(local, 'credentials', 'debug.log'), 'OPAQUE_PRIVATE_CREDENTIAL');
    await f.service.finalizeSession(id, { exitCode: 0 });
    const zip = join(f.root, 'native-logs.zip'); await f.service.exportReport(id, zip, { includeDumps: false, description: '' });
    const text = await zipText(zip);
    expect(text).toContain('VIVOX_CURRENT_DIAGNOSTIC'); expect(text).toContain('STEAM_CURRENT_DIAGNOSTIC');
    expect(text).not.toContain('OPAQUE_PRIVATE_CREDENTIAL');
  });

  it('sanitizes complete structured JSON, notes and native module versions through the actual ZIP export', async () => {
    const f = await fixture(), local = join(f.logsRoot, 'install1', 'local');
    const { id, directory } = await f.service.beginSession({ ...f.context, notes: 'At C:\\Users\\PrivatePerson\\game.log' });
    await writeFile(join(local, 'last-session-diagnostics.json'), JSON.stringify({
      context: { environment: { ANY_VARIABLE: 'PRIVATE_ENV_VALUE' }, clientSecret: 'PRIVATE_JSON_SECRET' },
      error: { code: '0xC0000005' }, ModuleVersion: '5.0.0.0',
    }, null, 2));
    await writeFile(join(directory, 'native-events.jsonl'), JSON.stringify({ event: 'module', name: 'vivoxsdk_x64.dll', version: '5.0.0.0' }) + '\n');
    await f.service.finalizeSession(id, { exitCode: 0 });
    const zip = join(f.root, 'structured.zip');
    await f.service.exportReport(id, zip, { includeDumps: false, description: 'Path C:\\Users\\PrivatePerson\\game.log token=public-comment password="PRIVATE NOTE WITH SPACES"' });
    const text = await zipText(zip);
    for (const secret of ['PRIVATE_ENV_VALUE', 'PRIVATE_JSON_SECRET', 'PrivatePerson', 'PRIVATE NOTE WITH SPACES']) expect(text).not.toContain(secret);
    expect(text).toContain('5.0.0.0'); expect(text).toContain('0xC0000005'); expect(text).toContain('vivoxsdk_x64.dll');
  });

  it('exports valid ZIPs on filesystems without hard links while preserving an existing destination', async () => {
    const f = await fixture(), { id } = await f.service.beginSession(f.context);
    await f.service.finalizeSession(id, { exitCode: 0 });
    vi.mocked(fsPromises.link).mockRejectedValueOnce(Object.assign(new Error('hard links unsupported'), { code: 'EOPNOTSUPP' }));
    const zip = join(f.root, 'portable.zip');
    await f.service.exportReport(id, zip, { includeDumps: false, description: 'PORTABLE_ZIP' });
    expect(await zipText(zip)).toContain('PORTABLE_ZIP');
    const original = await readFile(zip);
    await expect(f.service.exportReport(id, zip, { includeDumps: false, description: 'REPLACEMENT' })).rejects.toThrow('already exists');
    expect(await readFile(zip)).toEqual(original);
    const raced = join(f.root, 'claimed-during-export.zip');
    vi.mocked(fsPromises.link).mockImplementationOnce(async (_source, target) => {
      await writeFile(target, 'KEEP_OTHER_WRITER');
      throw Object.assign(new Error('existing destination'), { code: 'EEXIST' });
    });
    await expect(f.service.exportReport(id, raced, { includeDumps: false, description: '' })).rejects.toThrow('existing destination');
    expect(await readFile(raced, 'utf8')).toBe('KEEP_OTHER_WRITER');
  });

  it('preserves an observed crash classification and cutoff if the launcher stops before collection', async () => {
    const f = await fixture(), log = join(f.installationRoot, 'game.log');
    const { id } = await f.service.beginSession(f.context);
    await writeFile(log, 'CONFIRMED_CRASH_SESSION\n');
    await f.service.finalizeSession(id, { exitCode: -1073741819 });
    await appendFile(log, 'LATER_SESSION_PRIVATE\n');
    const restarted = new DiagnosticReportService({ directory: f.directory });
    const zip = join(f.root, 'recovered-crash.zip');
    await restarted.exportReport(id, zip, { includeDumps: false, description: '' });
    expect((await restarted.getReport(id)).summary.kind).toBe('crash');
    expect(await zipText(zip)).toContain('CONFIRMED_CRASH_SESSION');
    expect(await zipText(zip)).not.toContain('LATER_SESSION_PRIVATE');
  });
});

describe('diagnostic privacy without losing crash evidence', () => {
  it('preserves explicit software versions while redacting actual IP addresses', () => {
    expect(sanitizeDiagnosticValue({ ModuleVersion: '5.0.0.0', DriverVersion: '31.0.15.4633', ipAddress: '192.168.1.4' }))
      .toEqual({ ModuleVersion: '5.0.0.0', DriverVersion: '31.0.15.4633' });
    const text = redactDiagnosticText('{"event":"module","version":"1.2.3.4","remote":"192.168.1.4"}');
    expect(text).toContain('"version":"1.2.3.4"'); expect(text).not.toContain('192.168.1.4');
  });

  it('keeps module basenames, offsets and fault context when removing local paths', () => {
    const text = redactDiagnosticText('fault=C:\\Users\\PrivatePlayer\\Game\\vivoxsdk_x64.dll+0x1234 exception=0xC0000005 thread=42');
    expect(text).not.toContain('PrivatePlayer'); expect(text).toContain('vivoxsdk_x64.dll+0x1234');
    expect(text).toContain('exception=0xC0000005'); expect(text).toContain('thread=42');
  });

  it('redacts credential markup, Basic authorization and complete cookie values in generic text logs', () => {
    const input = '<password>PRIVATE_PASSWORD</password>\nclientSecret=PRIVATE_SECRET\nAuthorization: Basic PRIVATE_BASIC\nCookie: first=PRIVATE_COOKIE_A; second=PRIVATE_COOKIE_B\n"cookie": "first=PRIVATE_COOKIE_A; second=PRIVATE_COOKIE_B"\n';
    const clean = redactDiagnosticText(input);
    for (const secret of ['PRIVATE_PASSWORD', 'PRIVATE_SECRET', 'PRIVATE_BASIC', 'PRIVATE_COOKIE_A', 'PRIVATE_COOKIE_B']) expect(clean).not.toContain(secret);
  });
});
