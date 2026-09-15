import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { buildPatchedPack, catalog, CODE_STRINGS_HASH, enableVoiceSlider, patchCodeStrings, patchSettingsXml, readSettings, SETTINGS_HASH } from '../prepare-voice-volume-assets.mjs';
import { COPY, DESCRIPTION_HASH, LABEL_HASH, parseLocale, patchLocale } from '../voice-volume-locale.mjs';
import { updateVoiceManifests } from '../prepare-voice-volume-release.mjs';

const fixture = Buffer.from([
  '<OptionElements><Section id="Audio">',
  '    <Option id="a.master_volume" getter="GetMasterVolume" setter="SetMasterVolume"/>',
  '    <Option id="a.header.audiovoice" type="header"/>',
  '    <Option id="vchat.enable" type="checkbox"/>',
  '    <!--Disabled',
  '        <Option id="vchat.receive_volume" getter="GetReceiveVolume" setter="SetReceiveVolume"/>',
  '        <Option id="unrelated.hidden"/>',
  '    -->',
  '</Section></OptionElements>', '',
].join('\r\n'));

test('receive slider is active, ahead of voice toggle, and uses the native receive callbacks', () => {
  const text = enableVoiceSlider(fixture).toString();
  const active = text.replace(/<!--[\s\S]*?-->/g, '');
  assert.equal((active.match(/id="vchat.receive_volume"/g) ?? []).length, 1);
  assert(active.indexOf('vchat.receive_volume') < active.indexOf('vchat.enable'));
  const row = active.match(/<Option id="vchat.receive_volume"[^>]*>/)[0];
  assert.match(row, /getter="GetVoiceReceiveVolume" setter="SetVoiceReceiveVolume"/);
  assert.match(row, /values="range=0\|100~snap=1"/);
  assert.match(row, /target="PC" isEnabled="true"/);
  assert.match(row, /name="UI.ROTK.VoiceReceiveVolume"/);
  assert(!active.includes('unrelated.hidden'));
  assert.match(active, /getter="GetMasterVolume" setter="SetMasterVolume"/);
});

test('unknown retail XML and duplicate/absent controls fail before patching', () => {
  assert.throws(() => patchSettingsXml(fixture), /unsupported settings XML/);
  assert.throws(() => enableVoiceSlider(enableVoiceSlider(fixture)), /already active/);
  assert.throws(() => enableVoiceSlider(Buffer.from(fixture.toString().replace('vchat.enable', 'missing'))), /anchor/);
});

test('code string names resolve to the two new locale IDs without replacing existing mappings', () => {
  const source = Buffer.from('#MESSAGE_NAME^*STRING_ID^\r\nOther^42^\r\n');
  const out = patchCodeStrings(source).toString();
  assert(out.includes('Other^42^\r\n'));
  assert(out.includes('UI.ROTK.VoiceReceiveVolume^9105201^\r\n'));
  assert(out.includes('UI.ROTK.VoiceReceiveVolumeDesc^9105202^\r\n'));
  assert.throws(() => patchCodeStrings(Buffer.from(out)), /already in use/);
});

function localeFixture() {
  const row = Buffer.from('100\tucdt\tExisting é\ncontinued');
  const dat = Buffer.concat([Buffer.from([239,187,191]), row, Buffer.from('\r\n')]);
  const md5 = createHash('md5').update(dat).digest('hex').toUpperCase();
  const dir = Buffer.from(`## Count:\t1\r\n## MD5Checksum: ${md5}\r\n## TextLength:\t32\r\n100\t3\t${row.length}\td\r\n`);
  return {dat, dir, row};
}

test('English label and help text resolve; multiline UTF-8 rows survive with valid offsets and checksum', () => {
  const f = localeFixture();
  const out = patchLocale(f.dat, f.dir, 'en_us');
  const rows = new Map(parseLocale(out.dat, out.dir).rows.map(row => [row.hash, row.bytes]));
  assert(rows.get(100).equals(f.row));
  assert.equal(rows.get(LABEL_HASH).toString(), `${LABEL_HASH}\tucdt\tPlayer Voice Volume`);
  assert.equal(rows.get(DESCRIPTION_HASH).toString(), `${DESCRIPTION_HASH}\tucdt\t${COPY.en_us[1]}`);
  assert.equal(rows.size, 3);
  assert.throws(() => patchLocale(out.dat, out.dir, 'en_us'), /already exist/);
});

test('French uses translated copy and other client locales receive the English fallback', () => {
  const f = localeFixture();
  for (const [locale, expected] of [['fr_fr', COPY.fr_fr[0]], ['de_de', COPY.en_us[0]]]) {
    const out = patchLocale(f.dat, f.dir, locale);
    assert(out.dat.toString().includes(expected));
    assert.equal(parseLocale(out.dat, out.dir).rows.length, 3);
  }
});

test('damaged locale data and stale directory spans are rejected', () => {
  const f = localeFixture();
  assert.throws(() => patchLocale(Buffer.from('broken'), f.dir, 'en_us'), /checksum/);
  assert.throws(() => patchLocale(f.dat, Buffer.from(f.dir.toString().replace('100\t3\t', '100\t4\t')), 'en_us'), /span/);
  assert.throws(() => catalog(Buffer.alloc(64)), /header/);
});

function manifests() {
  const meta = {size: 10, sha256: '1'.repeat(64)};
  const feed = {manifestVersion: 1, packVersion: '1.10.5', assets: ['data_x64_0', 'locale_rotk', 'existing'].map(name => ({name, version: '1.10.5', ...meta, url: `https://example.test/${name}.zip`, type: 'zip', installPath: 'Existing'}))};
  const payloads = {schemaVersion: 1, kind: 'asset-payloads', packVersion: '1.10.5', files: [
    {asset: 'data_x64_0', path: 'Resources/Assets/data_x64_0.pack2', ...meta},
    ...['en_us', 'fr_fr'].flatMap(locale => ['dat', 'dir'].map(ext => ({asset: 'locale_rotk', path: `Locale/${locale}_data.${ext}`, ...meta}))),
    {asset: 'existing', path: 'Existing/preserved.bin', ...meta},
  ]};
  const files = payloads.files.filter(row => row.asset !== 'existing').map(row => ({...row, size: 20, sha256: '2'.repeat(64)}));
  return {feed, payloads, files, archives: {data_x64_0: {size: 99, sha256: '3'.repeat(64)}, locale_rotk: {size: 77, sha256: '4'.repeat(64)}}};
}

test('release updates both payloads together and preserves other assets and their installed files', () => {
  const f = manifests();
  const out = updateVoiceManifests(f.feed, f.payloads, '1.10.6', f.archives, f.files);
  assert.equal(out.feed.packVersion, out.payloads.packVersion);
  assert.deepEqual(out.feed.assets[2], f.feed.assets[2]);
  assert.deepEqual(out.payloads.files.at(-1), f.payloads.files.at(-1));
  assert.equal(out.payloads.files.length, f.payloads.files.length);
  assert(out.feed.assets.slice(0, 2).every(row => row.url.endsWith('.payload')));
  assert.equal(out.feed.assets[0].installPath, 'Resources/Assets');
  assert.equal(out.feed.assets[1].installPath, 'Locale');
  for (const asset of out.feed.assets.slice(0, 2)) {
    assert.equal(asset.size, f.archives[asset.name].size);
    assert.equal(asset.sha256, f.archives[asset.name].sha256);
  }
  assert.equal(f.feed.packVersion, '1.10.5');
});

test('release refuses rollback, missing translations, and duplicate ownership', () => {
  const f = manifests();
  assert.throws(() => updateVoiceManifests(f.feed, f.payloads, '1.10.5', f.archives, f.files), /increase/);
  assert.throws(() => updateVoiceManifests(f.feed, f.payloads, '1.10.6', f.archives, f.files.slice(1)), /lost or gained/);
  f.payloads.files.push({...f.payloads.files[0]});
  assert.throws(() => updateVoiceManifests(f.feed, f.payloads, '1.10.6', f.archives, f.files), /duplicate payload/);
});

test('installed BR1315: rebuilt table is readable and all 502 unrelated entries are preserved', {skip: !process.env.ROTK_VOICE_TEST_CLIENT}, () => {
  const input = fs.readFileSync(path.join(process.env.ROTK_VOICE_TEST_CLIENT, 'Resources/Assets/data_x64_0.pack2'));
  const out = buildPatchedPack(input);
  assert.equal(out.unchangedEntries, 502);
  const {entries} = catalog(out.bytes);
  assert.match(readSettings(out.bytes, entries.get(SETTINGS_HASH)).toString(), /GetVoiceReceiveVolume/);
  assert.match(readSettings(out.bytes, entries.get(CODE_STRINGS_HASH)).toString(), /VoiceReceiveVolume\^9105201\^/);
});
