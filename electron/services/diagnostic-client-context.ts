import { createHash } from 'node:crypto';
import { lstat, open, opendir, realpath, type FileHandle } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

/** Capture once after asset synchronization and before creating the game process. */
export interface DiagnosticClientContextOptions {
  installationRoot?: string;
  assetSyncEnabled?: boolean;
  assetPackVersion?: string;
  /** The caller supplies AssetSyncService.readState(); never discover userData. */
  assetState?: unknown;
}

const MAX_READ_BYTES = 2 * 1024 * 1024;
const MAX_VIDEO_BYTES = 64 * 1024;
const MAX_FILES = 96;
const MAX_LEDGER_FILES = 256;
const SHA256 = /^[a-f0-9]{64}$/i;
const VERSION = /^v?\d{1,4}(?:\.\d{1,4}){0,3}(?:[-+][a-z0-9.]{1,32})?$/i;
const ASSET_NAME = /^(?:(?:assets|ui|data|loginzone|practicezone|z1|z2)_x64_[0-9]{1,3}|weapons(?:_sfx)?_bank_pc9|locale_rotk)$/i;
const PACK_PATH = /^Resources\/Assets\/(?:assets|ui|data|LoginZone|PracticeZone|Z1|Z2)_x64_[0-9]{1,3}\.pack2$/i;
const AUDIO_PATH = /^Resources\/Audio\/pc9\/Weapons(?:_SFX)?\.bnk_pc$/i;
const LOCALE_PATH = /^Locale\/[a-z]{2}_[a-z]{2}_data\.(?:dat|dir)$/i;
const HUD_NAMES = ['HudKillFeedWindow.gfx', 'HudKillFeedWindow.swf', 'UIRoot.gfx', 'UIRoot.swf'];
const LOOSE_HUD_FILES = [
  ...HUD_NAMES.flatMap((name) => [name, `UI/${name}`, `UI/Resource/${name}`]),
  'UI/ScriptsBase.bin',
];
const HUD_PATHS = new Set(LOOSE_HUD_FILES.map((name) => name.toLowerCase()));
const VIDEO_FIELDS: Record<string, readonly string[]> = {
  Display: ['FullscreenRefresh', 'FullscreenWindowedAllowTearing', 'FullscreenWidth', 'FullscreenHeight', 'WindowedWidth', 'WindowedHeight', 'Mode', 'FullscreenMode', 'RenderQuality'],
  Rendering: ['EffectsQuality', 'OverallQuality', 'TextureQuality', 'ShadowQuality', 'FloraQuality', 'RenderDistance', 'UseDepthOfField', 'Gamma', 'MaximumFPS', 'UseLod0a', 'Smoothing', 'SmoothingMaxFramerate', 'SmoothingMinFramerate', 'SpeedTreeLOD', 'MaxLocalShadows', 'LightingQuality', 'FogShadowsEnable', 'ModelQuality', 'ParticleLOD', 'AO', 'InteriorLighting', 'VerticalFOV', 'VSync', 'MotionBlur', 'RenderQuality', 'GpuPhysics'],
};
type Issue = { source: string; reason: string };
type AssetFile = { path: string; declaredBytes: number; declaredSha256: string };
type AssetRecord = { name: string; version: string | null; archiveSha256: string | null; files: AssetFile[] };

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function version(value: unknown): string | null { return typeof value === 'string' && VERSION.test(value) ? value : null; }
function digest(bytes: Buffer | string): string { return createHash('sha256').update(bytes).digest('hex'); }
function allowedPath(value: unknown): value is string {
  return typeof value === 'string' && (PACK_PATH.test(value) || AUDIO_PATH.test(value) || LOCALE_PATH.test(value) || HUD_PATHS.has(value.toLowerCase()));
}
function failure(error: unknown): string {
  const code = (error as NodeJS.ErrnoException)?.code;
  return code === 'ENOENT' ? 'missing' : code === 'EACCES' || code === 'EPERM' ? 'unavailable' : 'unsafe_or_changed_source';
}
function beneath(file: string, root: string): boolean {
  const path = relative(root, file);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function ledger(value: unknown, issues: Issue[]) {
  const input = object(value);
  if (!input) return { status: 'unavailable', assets: [] as AssetRecord[] };
  if (input.schemaVersion !== 1 || !Array.isArray(input.assets)) return { status: 'invalid', assets: [] as AssetRecord[] };
  const assets: AssetRecord[] = [];
  let inspected = 0, omitted = 0;
  for (const raw of input.assets.slice(0, 64)) {
    const asset = object(raw);
    if (!asset || typeof asset.name !== 'string' || !ASSET_NAME.test(asset.name) || !Array.isArray(asset.installedFiles)) { omitted++; continue; }
    const files: AssetFile[] = [];
    for (const item of asset.installedFiles) {
      if (++inspected > MAX_LEDGER_FILES) break;
      const file = object(item);
      if (!file || !allowedPath(file.path) || typeof file.sha256 !== 'string' || !SHA256.test(file.sha256) || typeof file.size !== 'number' || !Number.isSafeInteger(file.size) || file.size < 0) { omitted++; continue; }
      files.push({ path: file.path, declaredBytes: file.size, declaredSha256: file.sha256.toLowerCase() });
    }
    assets.push({ name: asset.name, version: version(asset.version), archiveSha256: typeof asset.sha256 === 'string' && SHA256.test(asset.sha256) ? asset.sha256.toLowerCase() : null, files });
  }
  if (omitted) issues.push({ source: 'asset-ledger', reason: 'non_diagnostic_or_invalid_entries_omitted' });
  const limited = input.assets.length > 64 || inspected > MAX_LEDGER_FILES;
  if (limited) issues.push({ source: 'asset-ledger', reason: 'entry_limit' });
  const projected = { schemaVersion: 1, packVersion: version(input.packVersion),
    syncedAt: typeof input.syncedAt === 'string' && input.syncedAt.length <= 32 && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(input.syncedAt) && Number.isFinite(Date.parse(input.syncedAt)) ? input.syncedAt : null, assets };
  return { status: 'available', ...projected, limited, metadataSha256: digest(JSON.stringify(projected)),
    hashScope: 'sanitized-ledger-metadata', declaredHashesReverified: false };
}

function videoSettings(text: string): Record<string, Record<string, string | number>> {
  const values: Record<string, Map<string, string | number>> = {};
  let section: string | null = null;
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const heading = /^\s*\[([^\]]+)\]\s*(?:[;#].*)?$/.exec(line);
    if (heading) { section = Object.keys(VIDEO_FIELDS).find((key) => key.toLowerCase() === heading[1]!.toLowerCase()) ?? null; continue; }
    if (!section) continue;
    const match = /^\s*([^=;#]+?)\s*=\s*([^;#]*?)(?:\s*[;#].*)?$/.exec(line);
    if (!match) continue;
    const key = VIDEO_FIELDS[section]!.find((candidate) => candidate.toLowerCase() === match[1]!.toLowerCase());
    if (!key) continue;
    const raw = match[2]!.trim();
    let selected: string | number | null = null;
    if (key === 'Mode' || key === 'FullscreenMode') {
      selected = ['Windowed', 'Fullscreen', 'FullscreenWindowed', 'Borderless'].find((mode) => mode.toLowerCase() === raw.toLowerCase()) ?? null;
    } else if (/^-?\d+(?:\.\d+)?$/.test(raw) && Number.isFinite(Number(raw)) && Math.abs(Number(raw)) <= 1_000_000) selected = Number(raw);
    if (selected !== null) (values[section] ??= new Map()).set(key, selected);
  }
  const ordered: Record<string, Record<string, string | number>> = {};
  for (const [sectionName, fields] of Object.entries(VIDEO_FIELDS)) {
    const found = values[sectionName];
    if (!found?.size) continue;
    ordered[sectionName] = Object.fromEntries(fields.filter((key) => found.has(key)).map((key) => [key, found.get(key)!]));
  }
  return ordered;
}

/** No network, directory recursion, pack extraction, or bulk content hashing. */
export async function collectDiagnosticClientContext(options: DiagnosticClientContextOptions): Promise<Record<string, unknown>> {
  const issues: Issue[] = [], capturedAt = new Date().toISOString();
  const assetLedger = ledger(options.assetState, issues);
  const files: Record<string, unknown>[] = [];
  const assets = { syncEnabled: typeof options.assetSyncEnabled === 'boolean' ? options.assetSyncEnabled : null,
    requestedPackVersion: version(options.assetPackVersion), ledger: assetLedger, files,
    interpretation: 'Sync preference and cached ledger do not establish stock/custom contents. Large file hashes are declared only; compare observed metadata and launch attestation separately.' };
  const result: Record<string, unknown> = { schemaVersion: 1, capturedAt, assets, video: { status: 'unavailable' }, readBytes: 0,
    limits: { maxReadBytes: MAX_READ_BYTES, maxFiles: MAX_FILES, maxLedgerFiles: MAX_LEDGER_FILES }, issues };
  if (!options.installationRoot || !isAbsolute(options.installationRoot)) { issues.push({ source: 'installation', reason: 'missing_or_invalid_root' }); return result; }
  const root = resolve(options.installationRoot);
  let canonicalRoot: string;
  try {
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('unsafe_root');
    canonicalRoot = await realpath(root);
  } catch (error) { issues.push({ source: 'installation', reason: failure(error) }); return result; }
  let readBytes = 0;
  async function safeMetadata(path: string) {
    let target = root;
    for (const part of path.split('/')) {
      target = join(target, part);
      if ((await lstat(target)).isSymbolicLink()) throw new Error('linked_source');
    }
    if (!beneath(await realpath(target), canonicalRoot)) throw new Error('outside_root');
    return { target, info: await lstat(target) };
  }
  async function readSmall(path: string, limit: number): Promise<Buffer> {
    const { target, info } = await safeMetadata(path);
    if (!info.isFile() || info.size > limit || readBytes + info.size > MAX_READ_BYTES) throw new Error('read_budget');
    let handle: FileHandle | undefined;
    try {
      handle = await open(target, 'r');
      const opened = await handle.stat();
      if (opened.size !== info.size || opened.ino !== info.ino || opened.mtimeMs !== info.mtimeMs) throw new Error('changed_source');
      const buffer = Buffer.alloc(info.size);
      let offset = 0;
      while (offset < buffer.length) {
        const read = await handle.read(buffer, offset, buffer.length - offset, offset);
        if (!read.bytesRead) throw new Error('changed_source');
        offset += read.bytesRead; readBytes += read.bytesRead;
      }
      const after = await handle.stat();
      if (after.size !== info.size || after.mtimeMs !== info.mtimeMs) throw new Error('changed_source');
      return buffer;
    } finally { await handle?.close(); }
  }
  try {
    const bytes = await readSmall('UserOptions.ini', MAX_VIDEO_BYTES);
    const text = bytes[0] === 0xff && bytes[1] === 0xfe ? bytes.subarray(2).toString('utf16le') : bytes.toString('utf8');
    const settings = videoSettings(text);
    result.video = { status: 'available', settings, settingsSha256: digest(JSON.stringify(settings)), hashScope: 'whitelisted-video-settings' };
  } catch (error) {
    issues.push({ source: 'UserOptions.ini', reason: error instanceof Error && error.message === 'read_budget' ? 'size_limit' : failure(error) });
  }
  const paths = new Map<string, string>();
  const add = (path: string) => { if (paths.size < MAX_FILES && allowedPath(path)) paths.set(path.toLowerCase(), path); };
  for (const asset of assetLedger.assets) for (const file of asset.files) add(file.path);
  try {
    const { target, info } = await safeMetadata('Resources/Assets');
    if (!info.isDirectory()) throw new Error('not_directory');
    let inspected = 0;
    for await (const entry of await opendir(target)) {
      if (++inspected > 256) { issues.push({ source: 'Resources/Assets', reason: 'directory_entry_limit' }); break; }
      if (entry.isFile() || entry.isSymbolicLink()) add(`Resources/Assets/${entry.name}`);
    }
  } catch (error) { issues.push({ source: 'Resources/Assets', reason: failure(error) }); }
  for (const path of LOOSE_HUD_FILES) add(path);
  add('Resources/Audio/pc9/Weapons.bnk_pc'); add('Resources/Audio/pc9/Weapons_SFX.bnk_pc');
  if (paths.size === MAX_FILES) issues.push({ source: 'asset-files', reason: 'file_limit' });
  for (const path of paths.values()) {
    try {
      const { info } = await safeMetadata(path);
      if (!info.isFile()) throw new Error('not_file');
      const file: Record<string, unknown> = { path, bytes: info.size, modifiedAt: info.mtime.toISOString(), contentHashStatus: 'not_read' };
      if (HUD_PATHS.has(path.toLowerCase())) {
        if (info.size <= MAX_READ_BYTES - readBytes) {
          file.sha256 = digest(await readSmall(path, MAX_READ_BYTES)); file.contentHashStatus = 'measured';
        } else file.contentHashStatus = 'size_or_total_read_limit';
      }
      files.push(file);
    } catch (error) {
      const reason = failure(error);
      // Loose HUD overrides are optional; absence is expected for packed clients.
      if (reason !== 'missing' || !HUD_PATHS.has(path.toLowerCase())) files.push({ path, status: reason });
    }
  }
  result.readBytes = readBytes;
  return result;
}
