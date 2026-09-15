/** Rebuild the data and locale payloads from an exact, current asset manifest. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import yazl from 'yazl';
import { buildPatchedPack, digest } from './prepare-voice-volume-assets.mjs';
import { patchLocale } from './voice-volume-locale.mjs';
import { verifyArchive } from './prepare-staff-voice-assets.mjs';

const DATA_PATH = 'Resources/Assets/data_x64_0.pack2';
const CHANGED = ['data_x64_0', 'locale_rotk'];
const metadata = bytes => ({ size: bytes.length, sha256: digest(bytes) });
const json = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));

export function updateVoiceManifests(feed, payloads, version, archives, files) {
  assert.equal(feed.manifestVersion, 1);
  assert.equal(payloads.schemaVersion, 1);
  assert.equal(payloads.kind, 'asset-payloads');
  assert.equal(feed.packVersion, payloads.packVersion, 'source manifest versions disagree');
  const parts = value => { assert.match(value, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/); return value.split('.').map(BigInt); };
  const old = parts(feed.packVersion), next = parts(version);
  assert(next.map((v, i) => v - old[i]).find(v => v !== 0n) > 0n, 'release version must increase');
  assert(Array.isArray(feed.assets) && Array.isArray(payloads.files), 'invalid manifests');
  assert.equal(new Set(feed.assets.map(row => row.name.toLowerCase())).size, feed.assets.length, 'duplicate assets');
  assert.equal(new Set(payloads.files.map(row => row.path.replaceAll('\\', '/').toLowerCase())).size, payloads.files.length, 'duplicate payload paths');
  for (const asset of CHANGED) {
    assert.equal(feed.assets.filter(row => row.name === asset).length, 1, 'source asset missing');
    const original = payloads.files.filter(row => row.asset === asset);
    const rebuilt = files.filter(row => row.asset === asset);
    assert.deepEqual(rebuilt.map(row => row.path).sort(), original.map(row => row.path).sort(), 'changed asset lost or gained paths');
    const expected = asset === 'data_x64_0' ? [DATA_PATH] : original.map(row => row.path);
    assert(asset !== 'data_x64_0' || original.length === 1, 'unexpected data payload ownership');
    for (const name of expected) assert(asset === 'data_x64_0' ? name === DATA_PATH : /^Locale\/[a-z]{2}_[a-z]{2}_data\.(dat|dir)$/.test(name), 'unexpected payload path');
    assert(archives[asset] && archives[asset].size > 0 && archives[asset].size < 2 * 1024 ** 3, 'invalid archive size');
    assert.match(archives[asset].sha256, /^[a-f0-9]{64}$/);
  }
  for (const row of files) {
    assert(CHANGED.includes(row.asset) && Number.isSafeInteger(row.size) && row.size > 0 && row.size <= 128 * 1024 ** 2, 'invalid rebuilt payload');
    assert.match(row.sha256, /^[a-f0-9]{64}$/);
  }
  const byPath = new Map(files.map(row => [row.path, row]));
  return {
    feed: { ...feed, packVersion: version, assets: feed.assets.map(asset => CHANGED.includes(asset.name) ? {
      ...asset, version, type: 'zip', installPath: asset.name === 'locale_rotk' ? 'Locale' : 'Resources/Assets',
      url: `https://github.com/h1z1rotk/assets/releases/download/assets-v${version}/${asset.name}.payload`, ...archives[asset.name],
    } : asset) },
    payloads: { ...payloads, packVersion: version, files: payloads.files.map(row => byPath.get(row.path) ?? row) },
  };
}

export async function prepareVoiceRelease({ client, feedPath, payloadPath, output, version }) {
  const feed = json(feedPath), payloads = json(payloadPath);
  const sources = payloads.files.filter(row => CHANGED.includes(row.asset));
  const buffers = new Map();
  for (const row of sources) {
    assert(row.path === DATA_PATH || /^Locale\/[a-z]{2}_[a-z]{2}_data\.(dat|dir)$/.test(row.path), 'unexpected source path');
    assert(Number.isSafeInteger(row.size) && row.size > 0 && row.size <= 128 * 1024 ** 2, 'invalid source size');
    const file = path.join(client, row.path);
    assert.equal(fs.statSync(file).size, row.size, `source size differs from manifest: ${row.path}`);
    const bytes = fs.readFileSync(file);
    assert.equal(digest(bytes), row.sha256, `source hash differs from manifest: ${row.path}`);
    buffers.set(row.path, bytes);
  }
  assert(buffers.has(DATA_PATH), 'data source missing');
  const { bytes, ...packReport } = buildPatchedPack(buffers.get(DATA_PATH));
  buffers.set(DATA_PATH, bytes);
  const locales = sources.filter(row => row.path.endsWith('_data.dat')).map(row => path.basename(row.path).slice(0, -9));
  assert(locales.includes('en_us') && locales.includes('fr_fr'), 'English/French sources missing');
  const localeReport = {};
  for (const locale of locales) {
    const datPath = `Locale/${locale}_data.dat`, dirPath = `Locale/${locale}_data.dir`;
    assert(buffers.has(dirPath), 'locale index missing');
    const result = patchLocale(buffers.get(datPath), buffers.get(dirPath), locale);
    buffers.set(datPath, result.dat); buffers.set(dirPath, result.dir);
    localeReport[locale] = { unchangedRows: result.unchangedRows, addedRows: 2 };
  }
  assert.equal(sources.length, 1 + locales.length * 2, 'unexpected locale payloads');
  const files = sources.map(row => ({ ...row, ...metadata(buffers.get(row.path)) }));
  const placeholders = Object.fromEntries(CHANGED.map(name => [name, { size: 1, sha256: '0'.repeat(64) }]));
  updateVoiceManifests(feed, payloads, version, placeholders, files);
  fs.mkdirSync(output); // Exclusive: never overwrite an install or previous candidate.
  const archives = {};
  for (const asset of CHANGED) {
    const zip = new yazl.ZipFile();
    const expected = {};
    for (const row of files.filter(row => row.asset === asset)) {
      const name = path.basename(row.path);
      assert(!expected[name], 'duplicate archive path');
      expected[name] = metadata(buffers.get(row.path));
      zip.addBuffer(buffers.get(row.path), name, { mtime: new Date('2020-01-01T00:00:00Z'), mode: 0o100644, compressionLevel: 6 });
    }
    const archive = path.join(output, `${asset}.payload`);
    const complete = pipeline(zip.outputStream, fs.createWriteStream(`${archive}.partial`, { flags: 'wx' }));
    zip.end(); await complete;
    await verifyArchive(`${archive}.partial`, expected);
    fs.renameSync(`${archive}.partial`, archive);
    archives[asset] = metadata(fs.readFileSync(archive));
  }
  const next = updateVoiceManifests(feed, payloads, version, archives, files);
  const report = { packVersion: version, pack: { ...packReport, ...metadata(bytes) }, locales: localeReport, archives, verifiedArchivePayloads: true, published: false };
  for (const [name, value] of [['feed.json', next.feed], ['asset-payloads.v1.json', next.payloads], ['verification.json', report]]) {
    fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [client, feedPath, payloadPath, output, version, ...extra] = process.argv.slice(2);
  assert([client, feedPath, payloadPath, output, version].every(Boolean) && !extra.length, 'Usage: node scripts/prepare-voice-volume-release.mjs <client> <feed.json> <asset-payloads.v1.json> <new-output-directory> <X.Y.Z>');
  prepareVoiceRelease({client, feedPath, payloadPath, output, version}).then(report => console.log(JSON.stringify(report, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
