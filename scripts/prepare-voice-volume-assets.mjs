/** Enable BR1315's receive-volume slider. Offline recipe; no installation writes. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const SETTINGS_HASH = 0x33a5a0e1357a4992n;
export const CODE_STRINGS_HASH = 0x59f2f513444e8527n;
export const SOURCE_XML_SHA256 = 'b71346ce53c2cbab9b02fe891f5933e7a2e39e2bce5a74fab71fa48b215130ce';
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const MAX_PACK = 128 * 1024 ** 2;
const MAX_XML = 256 * 1024;

export function patchSettingsXml(source) {
  assert.equal(digest(source), SOURCE_XML_SHA256, 'unsupported settings XML; review before patching');
  return enableVoiceSlider(source);
}

export function enableVoiceSlider(source) {
  const original = source.toString('utf8');
  const active = original.replace(/<!--[\s\S]*?-->/g, '');
  assert(!active.includes('id="vchat.receive_volume"'), 'receive-volume slider is already active');
  const disabled = /        <Option id="vchat\.receive_volume"[^\r\n]*\/>(\r?\n)/g;
  assert.equal([...original.matchAll(disabled)].length, 1, 'expected one disabled receive-volume option');
  const withoutOld = original.replace(disabled, '');
  const anchor = /^(    <Option id="vchat\.enable" )/m;
  assert.equal([...withoutOld.matchAll(/^(    <Option id="vchat\.enable" )/gm)].length, 1, 'expected one voice chat anchor');
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  const slider = '    <Option id="vchat.receive_volume" type="slider" name="UI.ROTK.VoiceReceiveVolume" getter="GetVoiceReceiveVolume" setter="SetVoiceReceiveVolume" values="range=0|100~snap=1" default="50" tooltip="UI.ROTK.VoiceReceiveVolumeDesc" target="PC" isEnabled="true"/>';
  return Buffer.from(withoutOld.replace(anchor, `${slider}${newline}$1`));
}

export function patchCodeStrings(source) {
  const text = source.toString('utf8');
  assert(text.startsWith('#MESSAGE_NAME^*STRING_ID^\r\n'), 'unsupported code string table');
  assert(!/UI\.ROTK\.VoiceReceiveVolume|\^(9105201|9105202)\^/.test(text), 'voice locale IDs already in use');
  const lines = text.trimEnd().split('\r\n');
  const header = lines.shift();
  lines.push('UI.ROTK.VoiceReceiveVolume^9105201^', 'UI.ROTK.VoiceReceiveVolumeDesc^9105202^');
  lines.sort();
  return Buffer.from([header, ...lines, ''].join('\r\n'));
}

export function catalog(data) {
  assert(data.length >= 48 && data.length <= MAX_PACK, 'unsupported pack size');
  assert.equal(data.subarray(0, 4).toString('hex'), '50414b01', 'invalid pack header');
  const count = data.readUInt32LE(4);
  const offset = Number(data.readBigUInt64LE(16));
  assert.equal(data.readBigUInt64LE(8), BigInt(data.length), 'invalid pack length');
  assert(Number.isSafeInteger(offset) && offset >= 48 && offset + count * 32 === data.length, 'invalid catalog bounds');
  const entries = new Map();
  let previous = -1n;
  for (let at = offset; at < data.length; at += 32) {
    const key = data.readBigUInt64LE(at);
    const start = Number(data.readBigUInt64LE(at + 8));
    const size = Number(data.readBigUInt64LE(at + 16));
    const flags = data.readUInt32LE(at + 24);
    assert(key > previous, 'duplicate or unsorted key');
    assert(Number.isSafeInteger(start) && Number.isSafeInteger(size) && start >= 48 && size >= 0 && start <= offset && size <= offset - start, 'invalid asset bounds');
    assert([0, 1, 16, 17].includes(flags), 'unsupported storage flags');
    entries.set(key, { at, start, size, flags, crc: data.readUInt32LE(at + 28) });
    previous = key;
  }
  return { offset, entries };
}

export function readSettings(data, entry) {
  assert(entry, 'settings entry missing');
  const stored = data.subarray(entry.start, entry.start + entry.size);
  assert.equal(zlib.crc32(stored), entry.crc, 'settings CRC mismatch');
  if (entry.flags === 0 || entry.flags === 16) {
    assert(stored.length <= MAX_XML, 'settings XML exceeds limit');
    return stored;
  }
  assert(stored.length >= 8 && stored.subarray(0, 4).toString('hex') === 'a1b2c3d4', 'invalid compression header');
  const raw = zlib.inflateSync(stored.subarray(8), { maxOutputLength: MAX_XML });
  assert.equal(raw.length, stored.readUInt32BE(4), 'invalid XML length');
  return raw;
}

export function buildPatchedPack(original) {
  const { offset, entries } = catalog(original);
  const entry = entries.get(SETTINGS_HASH);
  const source = readSettings(original, entry);
  const xml = patchSettingsXml(source);
  const replacements = new Map([
    [SETTINGS_HASH, xml],
    [CODE_STRINGS_HASH, patchCodeStrings(readSettings(original, entries.get(CODE_STRINGS_HASH)))],
  ]);
  const map = Buffer.from(original.subarray(offset));
  let nextOffset = offset;
  for (const [key, payload] of replacements) {
    const target = entries.get(key);
    const at = target.at - offset;
    map.writeBigUInt64LE(BigInt(nextOffset), at + 8);
    map.writeBigUInt64LE(BigInt(payload.length), at + 16);
    map.writeUInt32LE(target.flags & 16, at + 24);
    map.writeUInt32LE(zlib.crc32(payload), at + 28);
    nextOffset += payload.length;
  }
  const header = Buffer.from(original.subarray(0, 32));
  header.writeBigUInt64LE(BigInt(nextOffset), 16);
  header.writeBigUInt64LE(BigInt(nextOffset + map.length), 8);
  const bytes = Buffer.concat([header, original.subarray(32, offset), ...replacements.values(), map]);
  const verified = catalog(bytes);
  for (const [key, payload] of replacements) assert(readSettings(bytes, verified.entries.get(key)).equals(payload), 'settings readback failed');
  for (const [key, old] of entries) {
    if (replacements.has(key)) continue;
    const next = verified.entries.get(key);
    assert(bytes.subarray(next.start, next.start + next.size).equals(original.subarray(old.start, old.start + old.size)), 'unrelated asset changed');
    assert.equal(next.flags, old.flags);
    assert.equal(next.crc, old.crc);
  }
  return { bytes, unchangedEntries: entries.size - replacements.size, sourceXmlSha256: digest(source), xmlSha256: digest(xml) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const [source, output] = process.argv.slice(2);
  assert(source && output, 'Usage: node scripts/prepare-voice-volume-assets.mjs <source-data.pack2> <new-output.pack2>');
  assert(fs.statSync(source).size <= MAX_PACK, 'unsupported pack size');
  const { bytes, ...report } = buildPatchedPack(fs.readFileSync(source));
  fs.writeFileSync(output, bytes, { flag: 'wx' });
  console.log(JSON.stringify({ ...report, size: bytes.length, sha256: digest(bytes) }, null, 2));
}
