import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { DiagnosticReportService } from '../electron/services/diagnostic-reports.js';
import { uploadDiagnostic } from '../electron/services/diagnostic-upload.js';
import { DiagnosticController } from '../electron/services/diagnostic-controller.js';

vi.mock('../electron/services/diagnostic-system.js', () => ({ collectDiagnosticSystemInfo: async () => ({}), collectGameWindowsEvents: async () => [] }));
const roots: string[] = [];
afterEach(async () => { for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'rotk-upload-')); roots.push(root);
  const directory = join(root, 'reports');
  const reports = new DiagnosticReportService({ directory, knownSecrets: () => ['a'.repeat(32)] });
  const session = await reports.beginSession({ launcherVersion: '2.0.8', serverLabel: 'Test', diagnosticCredentialHash: 'private-digest' });
  await reports.appendEvent(session.id, 'exception', { code: '0xC0000005', playerKey: 'a'.repeat(32) });
  await reports.finalizeSession(session.id, { exitCode: -1073741819 });
  await reports.collectSession(session.id);
  return { root, directory, reports, session };
}
it('prepares frozen redacted files without archive or private session data and detects tampering on resume', async () => {
  const { reports, session } = await fixture();
  const first = await reports.prepareUpload(session.id);
  expect(first.manifest.files.length).toBeGreaterThan(1);
  expect(first.manifest.files.some(f => f.name === 'session.json' || f.name.endsWith('.zip'))).toBe(false);
  for (let i = 0; i < first.paths.length; i++) {
    const data = await readFile(first.paths[i]);
    expect(data.toString()).not.toContain('a'.repeat(32));
    expect(data.toString()).not.toContain('private-digest');
    expect(createHash('sha256').update(data).digest('hex')).toBe(first.manifest.files[i].sha256);
  }
  expect(await reports.prepareUpload(session.id)).toEqual(first);
  await writeFile(first.paths[0], 'tampered'); await expect(reports.prepareUpload(session.id)).rejects.toThrow('changed');
});
it('sends only to pinned origins, resumes acknowledged files and validates completion', async () => {
  const { reports, session } = await fixture(), prepared = await reports.prepareUpload(session.id), remoteId = randomUUID();
  const received: number[] = [];
  const transport: NonNullable<Parameters<typeof uploadDiagnostic>[3]> = async (url, method, token, body, bytes) => {
    expect(url.origin).toBe('https://rotk.app');
    if (url.pathname.endsWith('/reports')) return { id: remoteId, token: 'b'.repeat(64), received: [0], complete: false };
    expect(token).toBe('b'.repeat(64));
    if (method === 'PUT') {
      const index = Number(url.pathname.split('/').at(-1)); received.push(index);
      const chunks = []; if (typeof body !== 'string') for await (const chunk of body) chunks.push(chunk);
      expect(Buffer.concat(chunks).length).toBe(bytes); return { received: index };
    }
    return { id: remoteId, complete: true };
  };
  await expect(uploadDiagnostic(prepared, 'https://rotk.app', 'a'.repeat(32), transport)).resolves.toBe(remoteId);
  expect(received).not.toContain(0);
  await expect(uploadDiagnostic(prepared, 'https://evil.invalid', 'a'.repeat(32), transport)).rejects.toThrow('destination');
  await expect(uploadDiagnostic(prepared, 'https://rotk.app', 'a'.repeat(32), async () => ({ id: '../../evil' }))).rejects.toThrow('receipt');
});
it('old Debug recordings have no upload consent and are never sent automatically', async () => {
  const { directory, reports, session } = await fixture();
  await reports.updateSession(session.id, { debugSessionEnabled: true });
  const upload = vi.fn(async () => randomUUID());
  const controller = new DiagnosticController({ directory, helperPath: 'unavailable.exe', knownSecrets: () => [], onChange: () => {}, uploadSession: upload });
  await controller.initialize(false, true);
  expect(upload).not.toHaveBeenCalled();
});
it('new opted-in sessions upload on exit and preserve a remote receipt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rotk-upload-controller-')); roots.push(root);
  const remoteId = randomUUID(), upload = vi.fn(async () => remoteId);
  const controller = new DiagnosticController({ directory: join(root, 'reports'), helperPath: 'unavailable.exe', knownSecrets: () => [], onChange: () => {}, uploadSession: upload });
  await controller.initialize(false, true);
  const launch = await controller.beginLaunch({ launcherVersion: '2.0.8', serverLabel: 'Test' });
  await launch.hooks.onExit(0, null);
  expect(upload).toHaveBeenCalledOnce(); expect(controller.debugState().fileName).toBe(remoteId);
});
