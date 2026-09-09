import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectDiagnosticClientContext } from '../electron/services/diagnostic-client-context.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(resolve(join(tmpdir(), 'rotk-client-context-test-')))) throw new Error('Unsafe test cleanup');
    await rm(root, { recursive: true, force: true });
  }
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'rotk-client-context-test-')); roots.push(root);
  const installationRoot = join(root, 'game'); await mkdir(installationRoot);
  return { root, installationRoot, write: async (path: string, data: string | Buffer) => {
    const target = join(installationRoot, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, data); return target;
  } };
}
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
type View = {
  assets: { syncEnabled: boolean | null; requestedPackVersion: string | null; ledger: {
    status: string; packVersion?: string; declaredHashesReverified?: boolean; metadataSha256?: string;
    assets: { name: string; files: { path: string; declaredSha256: string; declaredBytes: number }[] }[];
  }; files: { path: string; bytes?: number; sha256?: string; contentHashStatus?: string; status?: string }[] };
  video: { status: string; settings?: Record<string, Record<string, string | number>>; settingsSha256?: string };
  readBytes: number;
  issues: { source: string; reason: string }[];
};
function view(result: Record<string, unknown>): View { return result as unknown as View; }
const ledger = (files: Record<string, unknown>[], extra: Record<string, unknown> = {}) => ({
  schemaVersion: 1, packVersion: '1.5.1', syncedAt: '2026-09-08T16:00:00.000Z',
  assets: [{ name: 'assets_x64_0', version: '1.4.0', sha256: 'a'.repeat(64), installedFiles: files }], ...extra,
});

describe('bounded client context before process start', () => {
  it('captures only approved video settings and hashes their projection independently of private INI sections', async () => {
    const f = await fixture();
    const ini = '[Display]\nFullscreenWidth=1920\nFullscreenHeight=1080\nMode=Fullscreen\n[Rendering]\nMaximumFPS=500\nVSync=0\nSmoothing=0\nRenderDistance=1500.000000\nShadowQuality=1\nShadowQuality=3\nPassword=INI_PRIVATE_SECRET\n[Voice]\nDeviceId=PRIVATE_DEVICE\n[General]\nAccount=PRIVATE_ACCOUNT\n';
    const file = await f.write('UserOptions.ini', ini);
    const result = view(await collectDiagnosticClientContext({ installationRoot: f.installationRoot, assetSyncEnabled: true }));
    expect(result.video).toMatchObject({ status: 'available', settings: {
      Display: { FullscreenWidth: 1920, FullscreenHeight: 1080, Mode: 'Fullscreen' },
      Rendering: { MaximumFPS: 500, VSync: 0, Smoothing: 0, RenderDistance: 1500, ShadowQuality: 3 },
    } });
    expect(result.video.settingsSha256).toBe(hash(JSON.stringify(result.video.settings)));
    expect(JSON.stringify(result)).not.toMatch(/INI_PRIVATE_SECRET|PRIVATE_DEVICE|PRIVATE_ACCOUNT|Password/);
    expect(JSON.stringify(result)).not.toContain(f.installationRoot);
    expect(await readFile(file, 'utf8')).toBe(ini);
    await f.write('UserOptions.ini', ini.replaceAll('PRIVATE', 'DIFFERENT'));
    expect(view(await collectDiagnosticClientContext({ installationRoot: f.installationRoot })).video.settingsSha256).toBe(result.video.settingsSha256);
  });

  it('keeps disabled sync separate from a cached custom ledger and does not rehash packs', async () => {
    const f = await fixture(), path = 'Resources/Assets/assets_x64_0.pack2';
    await f.write(path, Buffer.alloc(3 * 1024 * 1024, 0x61));
    const result = view(await collectDiagnosticClientContext({ installationRoot: f.installationRoot, assetSyncEnabled: false,
      assetPackVersion: '1.5.2', assetState: ledger([{ path, size: 12, sha256: 'b'.repeat(64) }]) }));
    expect(result.assets).toMatchObject({ syncEnabled: false, requestedPackVersion: '1.5.2', ledger: {
      status: 'available', packVersion: '1.5.1', declaredHashesReverified: false,
      assets: [{ files: [{ path, declaredBytes: 12, declaredSha256: 'b'.repeat(64) }] }],
    } });
    expect(result.assets.files.find((file) => file.path === path)).toMatchObject({ bytes: 3 * 1024 * 1024, contentHashStatus: 'not_read' });
    expect(result.assets.files.find((file) => file.path === path)?.sha256).toBeUndefined();
    expect(result.readBytes).toBe(0);
    expect(result.assets.ledger.metadataSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('omits arbitrary metadata and path traversal while retaining known locale and UI pack identities', async () => {
    const f = await fixture(), good = 'Resources/Assets/ui_x64_0.pack2', locale = 'Locale/fr_fr_data.dat';
    await f.write(good, 'UI PACK'); await f.write(locale, 'LOCALE');
    const input = ledger([
      { path: good, size: 7, sha256: 'c'.repeat(64), url: 'https://secret.example/PRIVATE_URL' },
      { path: locale, size: 6, sha256: 'd'.repeat(64) },
      { path: '../PRIVATE_OUTSIDE', size: 1, sha256: 'e'.repeat(64) },
      { path: 'C:/Users/PRIVATE_PROFILE/config.json', size: 1, sha256: 'e'.repeat(64) },
      { path: 'player-key.json', size: 1, sha256: 'e'.repeat(64) },
    ], { token: 'PRIVATE_TOKEN', commandLine: 'PRIVATE_ARGUMENTS', packVersion: 'h1g_PRIVATE_CREDENTIAL' });
    input.assets[0]!.version = 'h1l_PRIVATE_TICKET';
    const result = view(await collectDiagnosticClientContext({ installationRoot: f.installationRoot, assetState: input }));
    const text = JSON.stringify(result);
    expect(text).not.toContain('PRIVATE_'); expect(text).not.toContain('player-key');
    expect(result.assets.ledger.assets[0]!.files.map((file) => file.path)).toEqual([good, locale]);
    expect(result.issues).toContainEqual({ source: 'asset-ledger', reason: 'non_diagnostic_or_invalid_entries_omitted' });
  });

  it('hashes small loose HUD overrides but enforces a two MiB total read budget', async () => {
    const f = await fixture(), small = Buffer.from('CONTROLLED HUD FIXTURE');
    await f.write('UI/HudKillFeedWindow.gfx', small);
    await f.write('UI/UIRoot.gfx', Buffer.alloc(2 * 1024 * 1024, 0x62));
    await f.write('UI/ScriptsBase.bin', 'SCRIPT FIXTURE');
    await f.write('Resources/Assets/ui_x64_0.pack2', 'PACK NEVER READ');
    const result = view(await collectDiagnosticClientContext({ installationRoot: f.installationRoot }));
    expect(result.assets.files.find((file) => file.path === 'UI/HudKillFeedWindow.gfx')).toMatchObject({ contentHashStatus: 'measured', sha256: hash(small) });
    expect(result.assets.files.find((file) => file.path === 'UI/UIRoot.gfx')).toMatchObject({ contentHashStatus: 'size_or_total_read_limit' });
    expect(result.assets.files.find((file) => file.path === 'Resources/Assets/ui_x64_0.pack2')).toMatchObject({ contentHashStatus: 'not_read' });
    expect(result.readBytes).toBe(small.length + Buffer.byteLength('SCRIPT FIXTURE'));
    expect(result.readBytes).toBeLessThanOrEqual(2 * 1024 * 1024);
  });

  it('supports UTF-16 INI settings and rejects strings in numeric fields and arbitrary display modes', async () => {
    const f = await fixture();
    await f.write('UserOptions.ini', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('[display]\nMode=PRIVATE_MODE\n[rendering]\nmaximumfps=500\nShadowQuality=PRIVATE_SECRET\nVSync=0\n', 'utf16le')]));
    const result = view(await collectDiagnosticClientContext({ installationRoot: f.installationRoot }));
    expect(result.video.settings).toEqual({ Rendering: { MaximumFPS: 500, VSync: 0 } });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_');
  });

  it('skips linked roots and linked subdirectories without reading outside the installation', async () => {
    const f = await fixture(), outside = join(f.root, 'outside'); await mkdir(outside);
    await writeFile(join(outside, 'UserOptions.ini'), '[Rendering]\nMaximumFPS=999\n');
    await writeFile(join(outside, 'HudKillFeedWindow.gfx'), 'OUTSIDE HUD CONTENT');
    const linkedRoot = join(f.root, 'linked-game');
    await symlink(outside, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
    const rejectedRoot = view(await collectDiagnosticClientContext({ installationRoot: linkedRoot }));
    expect(rejectedRoot.video.status).toBe('unavailable'); expect(rejectedRoot.readBytes).toBe(0);
    await symlink(outside, join(f.installationRoot, 'UI'), process.platform === 'win32' ? 'junction' : 'dir');
    const result = view(await collectDiagnosticClientContext({ installationRoot: f.installationRoot }));
    expect(result.assets.files.find((file) => file.path === 'UI/HudKillFeedWindow.gfx')).toMatchObject({ status: 'unsafe_or_changed_source' });
    expect(result.assets.files.every((file) => file.sha256 === undefined)).toBe(true);
    expect(result.readBytes).toBe(0); expect(JSON.stringify(result)).not.toContain(outside);
  });

  it('returns partial context for missing roots, malformed ledgers and oversized settings', async () => {
    const absent = view(await collectDiagnosticClientContext({ assetSyncEnabled: false, assetState: { schemaVersion: 99, privateData: 'SECRET' } }));
    expect(absent.assets).toMatchObject({ syncEnabled: false, ledger: { status: 'invalid' } });
    expect(absent.video.status).toBe('unavailable'); expect(absent.readBytes).toBe(0);
    const f = await fixture(); await f.write('UserOptions.ini', 'X'.repeat(64 * 1024 + 1));
    const result = view(await collectDiagnosticClientContext({ installationRoot: f.installationRoot }));
    expect(result.video.status).toBe('unavailable'); expect(result.readBytes).toBe(0);
    expect(result.issues).toContainEqual({ source: 'UserOptions.ini', reason: 'size_limit' });
  });

  it('bounds ledger records and on-disk metadata inventory independently of input size', async () => {
    const f = await fixture();
    const assets = Array.from({ length: 80 }, (_, index) => ({ name: `assets_x64_${index}`, version: '1.5.1', sha256: 'a'.repeat(64),
      installedFiles: Array.from({ length: 8 }, (_, fileIndex) => ({ path: `Resources/Assets/assets_x64_${index * 8 + fileIndex}.pack2`, size: 1, sha256: 'b'.repeat(64) })) }));
    const result = view(await collectDiagnosticClientContext({ installationRoot: f.installationRoot, assetState: ledger([], { assets }) }));
    expect(result.assets.ledger.assets.length).toBeLessThanOrEqual(64);
    expect(result.assets.ledger.assets.reduce((count, asset) => count + asset.files.length, 0)).toBeLessThanOrEqual(256);
    expect(result.assets.files.length).toBeLessThanOrEqual(96);
    expect(result.readBytes).toBe(0);
    expect(result.issues).toContainEqual({ source: 'asset-ledger', reason: 'entry_limit' });
    expect(result.issues).toContainEqual({ source: 'asset-files', reason: 'file_limit' });
  });
});
