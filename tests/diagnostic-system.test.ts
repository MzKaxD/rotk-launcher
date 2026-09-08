import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collectDiagnosticSystemInfo, collectGameWindowsEvents } from '../electron/services/diagnostic-system.js';

const mocks = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: mocks.execFile }));
vi.mock('node:os', async importOriginal => ({ ...await importOriginal<typeof import('node:os')>(), platform: () => 'win32' }));
beforeEach(() => { mocks.execFile.mockReset(); });

describe('bounded Windows diagnostics', () => {
  it('rejects invalid PID/time inputs without invoking PowerShell', async () => {
    for (const [pid, start, end] of [[0, '2026-09-08', '2026-09-09'], [NaN, '2026-09-08', '2026-09-09'],
      [123, '2026-09-09', '2026-09-08'], [123, "';Remove-Item C:\\*", '2026-09-09']] as const) {
      expect(await collectGameWindowsEvents(pid, start, end)).toMatchObject({ status: 'unavailable', events: [] });
    }
    expect(mocks.execFile).not.toHaveBeenCalled();
  });
  it('preserves structured event information and bounds a noninteractive query', async () => {
    const events = [{ eventId: 1000, data: { AppName: 'H1Z1.exe', ExceptionCode: 'c0000005', ModuleVersion: '5.0.0.0' } }];
    mocks.execFile.mockImplementation((_file, _args, _options, callback) => callback(null, '\uFEFF' + JSON.stringify(events)));
    expect(await collectGameWindowsEvents(4242, '2026-09-08T10:00:00Z', '2026-09-08T10:15:00Z')).toEqual({ status: 'queried', events });
    const [, args, options] = mocks.execFile.mock.calls[0];
    expect(options).toMatchObject({ windowsHide: true, timeout: 12000, maxBuffer: 512 * 1024 });
    expect(args).toContain('-NonInteractive');
    const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
    expect(script).toContain("'(?i)H1Z1\\.exe'");
    expect(script).toContain('$gameProcessId = [uint32]4242');
    expect(script).not.toContain('Remove-Item');
  });
  it('preserves basic hardware information when WMI is unavailable', async () => {
    mocks.execFile.mockImplementation((_file, _args, _options, callback) => callback(new Error('access denied'), ''));
    expect(await collectDiagnosticSystemInfo()).toMatchObject({ windowsQueryStatus: 'unavailable', memory: { totalBytes: expect.any(Number) }, cpu: { logicalProcessors: expect.any(Number) } });
    expect(await collectGameWindowsEvents(4242, '2026-09-08T10:00:00Z', '2026-09-08T10:15:00Z')).toEqual({ status: 'unavailable', events: [], issue: 'Windows Application log could not be read' });
  });
});
