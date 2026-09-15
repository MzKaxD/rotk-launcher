/** Add two ROTK strings without changing any existing localization row. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// lookup2("Global.Text.9105201") and lookup2("Global.Text.9105202").
export const LABEL_HASH = 2681712013;
export const DESCRIPTION_HASH = 2320668710;
export const COPY = Object.freeze({
  en_us: ['Player Voice Volume', 'Adjust the volume of other players. 0 mutes their voices; 100 is maximum. Your microphone and game sounds are unchanged.'],
  fr_fr: ['Volume des voix des joueurs', 'Règle le volume des autres joueurs. 0 coupe leurs voix ; 100 est le maximum. Votre micro et les sons du jeu restent inchangés.'],
});
const md5 = bytes => createHash('md5').update(bytes).digest('hex').toUpperCase();

export function parseLocale(dat, dir) {
  assert(dat.length < 32 * 1024 ** 2 && dir.length < 16 * 1024 ** 2, 'locale exceeds limits');
  const lines = dir.toString('utf8').split('\r\n');
  const header = lines.filter(line => line.startsWith('##'));
  const value = key => header.find(line => new RegExp(`^##\\s*${key}:`).test(line))?.split(':').slice(1).join(':').trim();
  const index = lines.filter(line => line && !line.startsWith('##'));
  assert.equal(value('MD5Checksum')?.toUpperCase(), md5(dat), 'locale checksum mismatch');
  assert.equal(Number(value('Count')), index.length, 'locale row count mismatch');
  const bom = dat.subarray(0, 3).equals(Buffer.from([239, 187, 191]));
  let cursor = bom ? 3 : 0;
  let previous = -1;
  const rows = index.map(line => {
    const match = /^(\d+)\t(\d+)\t(\d+)\td$/.exec(line);
    assert(match, 'invalid locale index row');
    const [hash, offset, length] = match.slice(1).map(Number);
    assert(Number.isSafeInteger(hash) && hash <= 0xffffffff && hash > previous, 'unsorted or duplicate locale hash');
    assert(Number.isSafeInteger(offset) && Number.isSafeInteger(length) && offset === cursor && length > 0 && length <= dat.length - offset, 'invalid locale span');
    const bytes = dat.subarray(offset, offset + length);
    assert(bytes.toString('utf8').startsWith(`${hash}\t`) && /^\d+\t[a-z]{4}\t/.test(bytes.toString('utf8')), 'locale row does not match index');
    const end = offset + length;
    const terminator = dat.subarray(end, end + 2).toString() === '\r\n' ? Buffer.from('\r\n') : Buffer.from('\n');
    assert(dat.subarray(end, end + terminator.length).equals(terminator), 'locale row terminator missing');
    cursor = end + terminator.length;
    previous = hash;
    return { hash, bytes, terminator };
  });
  assert.equal(cursor, dat.length, 'unindexed locale bytes');
  return { header, rows, bom };
}

export function patchLocale(dat, dir, locale) {
  const before = parseLocale(dat, dir);
  const texts = COPY[locale] ?? COPY.en_us;
  const added = [LABEL_HASH, DESCRIPTION_HASH].map((hash, i) => ({ hash, bytes: Buffer.from(`${hash}\tucdt\t${texts[i]}`), terminator: Buffer.from('\r\n') }));
  assert(added.every(next => before.rows.every(old => old.hash !== next.hash)), 'voice string IDs already exist');
  const rows = [...before.rows, ...added].sort((a, b) => a.hash - b.hash);
  const chunks = before.bom ? [Buffer.from([239, 187, 191])] : [];
  let offset = before.bom ? 3 : 0;
  const index = rows.map(row => {
    const line = `${row.hash}\t${offset}\t${row.bytes.length}\td`;
    chunks.push(row.bytes, row.terminator);
    offset += row.bytes.length + row.terminator.length;
    return line;
  });
  const outputDat = Buffer.concat(chunks);
  const header = before.header.map(line => {
    if (/^##\s*Count:/.test(line)) return `## Count:\t${rows.length}`;
    if (/^##\s*MD5Checksum:/.test(line)) return `## MD5Checksum: ${md5(outputDat)}`;
    if (/^##\s*TextLength:/.test(line)) return `## TextLength:\t${Math.max(Number(line.split(':')[1].trim()), ...texts.map(text => Buffer.byteLength(text)))}`;
    return line;
  });
  const outputDir = Buffer.from([...header, ...index, ''].join('\r\n'));
  const verified = parseLocale(outputDat, outputDir);
  const after = new Map(verified.rows.map(row => [row.hash, row.bytes]));
  for (const row of before.rows) assert(after.get(row.hash)?.equals(row.bytes), 'existing localization changed');
  return { dat: outputDat, dir: outputDir, unchangedRows: before.rows.length };
}
