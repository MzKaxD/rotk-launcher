/** Offline release preparation. No client asset, installation or network writes. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import yazl from "yazl";

export const SOURCE_PACK_SHA256 = "b72dcc5245e654e498cadf5493761d63a93fea14904d3da32fda1545ae3d07f3";
export const SOURCE_UI_SHA256 = "cdd8d6925a6bfac73bb08335c1f221dc97214d31eee2cbcd4845b3f8cde4a769";
const METHOD_SHA256 = "ae64d24cb3801f8c8650187d6fceef81f8998a46d65019df5723131dff07f677";
const UI_NAME_HASH = 0xef872dad597e632fn; // CRC-64/Jones of upper-case UIRoot.gfx.
const PACK_NAME = "assets_x64_0.pack2";
const ASSET_NAME = "assets_x64_0";
const INSTALL_PATH = "Resources/Assets";
const COMPRESSED_MAGIC = Buffer.from("a1b2c3d4", "hex");
const METHOD_HEADER = Buffer.from("932e0403040574", "hex");
const MAX_UI_BYTES = 2_000_000;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function hashFile(file) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

/** Operates on supplied instructions; the production caller pins the whole asset. */
export function insertStaffGate(code) {
  assert.equal(code.length, 116, "unsupported method length");
  assert.equal(code.subarray(0x52, 0x56).toString("hex"), "101d0000", "unexpected close branch");
  assert.equal(code.at(-1), 0x47, "missing returnvoid");
  const updated = Buffer.from(code);
  updated[0x53] += 11; // Closing an already-open panel still goes to returnvoid.
  // Existing pool: UIBindingOrganizedPlay (#949), IsModerator (#6879).
  // getlex; callproperty with no arguments; iffalse returnvoid.
  const guard = Buffer.from("60b50746df3500121d0000", "hex");
  return Buffer.concat([updated.subarray(0, 0x56), guard, updated.subarray(0x56)]);
}

export function patchUiRoot(source) {
  assert.equal(digest(source), SOURCE_UI_SHA256, "unsupported UIRoot.gfx; nothing was patched");
  assert.equal(source.subarray(0, 3).toString("ascii"), "CFX");
  const body = zlib.inflateSync(source.subarray(8), { maxOutputLength: MAX_UI_BYTES });
  assert.equal(body.length + 8, source.readUInt32LE(4));
  const candidates = [];
  for (let at = body.indexOf(METHOD_HEADER); at !== -1; at = body.indexOf(METHOD_HEADER, at + 1)) {
    if (digest(body.subarray(at + 7, at + 123)) === METHOD_SHA256) candidates.push(at);
  }
  assert.equal(candidates.length, 1, "expected exactly one supported Host Panel method");
  const at = candidates[0];
  assert.equal(body.readUInt16LE(at + 123), 0, "unexpected exception/trait table");
  let cursor = Math.ceil((5 + 4 * (body[0] >>> 3)) / 8) + 4;
  let lengthOffset;
  while (cursor + 2 <= body.length) {
    const tag = body.readUInt16LE(cursor);
    cursor += 2;
    const longLength = (tag & 63) === 63;
    const offset = cursor;
    const size = longLength ? body.readUInt32LE(cursor) : tag & 63;
    if (longLength) cursor += 4;
    assert(cursor + size <= body.length, "invalid GFX tag bounds");
    if (at >= cursor && at + 125 <= cursor + size) {
      assert.equal(tag >>> 6, 82, "method must be inside DoABC");
      assert(longLength, "DoABC must have a long length");
      lengthOffset = offset;
      break;
    }
    if ((tag >>> 6) === 0) break;
    cursor += size;
  }
  assert.notEqual(lengthOffset, undefined, "method is outside the GFX tag stream");
  const method = insertStaffGate(body.subarray(at + 7, at + 123));
  const updated = Buffer.concat([body.subarray(0, at + 6), Buffer.from([127]), method, body.subarray(at + 123)]);
  updated.writeUInt32LE(body.readUInt32LE(lengthOffset) + 11, lengthOffset);
  const header = Buffer.from(source.subarray(0, 8));
  header.writeUInt32LE(updated.length + 8, 4);
  return Buffer.concat([header, zlib.deflateSync(updated)]);
}

function readAt(fd, size, offset) {
  const bytes = Buffer.alloc(size);
  assert.equal(fs.readSync(fd, bytes, 0, size, offset), size, "truncated pack");
  return bytes;
}

function inspectPack(fd) {
  const size = fs.fstatSync(fd).size;
  assert(size >= 48 && size <= 3 * 1024 ** 3, "unsupported pack size");
  const header = readAt(fd, 32, 0);
  assert.equal(header.subarray(0, 4).toString("hex"), "50414b01", "not a pack2 container");
  const count = header.readUInt32LE(4);
  assert(count > 0 && count <= 20_000, "invalid asset count");
  const mapOffset = Number(header.readBigUInt64LE(16));
  assert(Number.isSafeInteger(mapOffset) && mapOffset >= 48 && mapOffset + count * 32 === size, "invalid pack map");
  assert.equal(header.readBigUInt64LE(8), BigInt(size), "invalid declared pack length");
  const map = readAt(fd, count * 32, mapOffset);
  const found = [];
  const names = new Set();
  for (let at = 0; at < map.length; at += 32) {
    const name = map.readBigUInt64LE(at);
    assert(!names.has(name), "duplicate asset name hash");
    names.add(name);
    const offset = Number(map.readBigUInt64LE(at + 8));
    const length = Number(map.readBigUInt64LE(at + 16));
    assert(Number.isSafeInteger(offset) && Number.isSafeInteger(length)
      && offset >= 48 && length >= 0 && offset + length <= mapOffset, "invalid asset bounds");
    if (name === UI_NAME_HASH) found.push({ at, offset, length, flags: map.readUInt32LE(at + 24) });
  }
  assert.equal(found.length, 1, "UIRoot.gfx missing or duplicated");
  const entry = found[0];
  assert(entry.length >= 8 && entry.length <= MAX_UI_BYTES, "UIRoot exceeds size bound");
  assert([0, 1, 16].includes(entry.flags), "unsupported UIRoot storage flags");
  const stored = readAt(fd, entry.length, entry.offset);
  const compressed = stored.subarray(0, 4).equals(COMPRESSED_MAGIC);
  assert.equal(compressed, entry.flags === 1, "inconsistent UIRoot compression flag");
  let ui = stored;
  if (compressed) {
    ui = zlib.inflateSync(stored.subarray(8), { maxOutputLength: MAX_UI_BYTES });
    assert.equal(ui.length, stored.readUInt32BE(4), "invalid inflated UIRoot length");
  }
  return { header, map, mapOffset, count, entry, ui, compressed };
}

/** The destination must not exist. Preserve the complete old data region. */
export async function writePatchedPack(sourcePath, outputPath, patch = patchUiRoot) {
  assert.notEqual(path.resolve(sourcePath).toLowerCase(), path.resolve(outputPath).toLowerCase(), "source must remain unchanged");
  const sourceFd = fs.openSync(sourcePath, "r");
  try {
    const original = inspectPack(sourceFd);
    const patched = patch(original.ui);
    assert(patched.length > 0 && patched.length <= MAX_UI_BYTES, "invalid patched UIRoot size");
    const length = Buffer.alloc(4);
    length.writeUInt32BE(patched.length);
    const payload = original.compressed
      ? Buffer.concat([COMPRESSED_MAGIC, length, zlib.deflateSync(patched)]) : patched;
    const sourceHash = await hashFile(sourcePath);
    fs.copyFileSync(sourcePath, outputPath, fs.constants.COPYFILE_EXCL);
    assert.equal(await hashFile(outputPath), sourceHash, "source changed while copying");
    const fd = fs.openSync(outputPath, "r+");
    try {
      const mapOffset = original.mapOffset + payload.length;
      const map = Buffer.from(original.map);
      map.writeBigUInt64LE(BigInt(original.mapOffset), original.entry.at + 8);
      map.writeBigUInt64LE(BigInt(payload.length), original.entry.at + 16);
      map.writeUInt32LE(zlib.crc32(payload), original.entry.at + 28);
      fs.writeSync(fd, payload, 0, payload.length, original.mapOffset);
      fs.writeSync(fd, map, 0, map.length, mapOffset);
      const header = Buffer.from(original.header);
      header.writeBigUInt64LE(BigInt(mapOffset), 16);
      header.writeBigUInt64LE(BigInt(mapOffset + map.length), 8);
      fs.writeSync(fd, header, 0, header.length, 0);
      fs.ftruncateSync(fd, mapOffset + map.length);
      fs.fsyncSync(fd);
      const verified = inspectPack(fd);
      assert(verified.ui.equals(patched), "patched UIRoot did not read back");
      assert.equal(verified.count, original.count);
      const restoredMap = Buffer.from(verified.map);
      original.map.copy(restoredMap, original.entry.at, original.entry.at, original.entry.at + 32);
      assert(restoredMap.equals(original.map), "another asset entry changed");
      // The first 32 bytes deliberately change; every remaining old data byte
      // (including the checksum area and unreferenced old UIRoot) must match.
      for (let offset = 32; offset < original.mapOffset; offset += 4 * 1024 ** 2) {
        const size = Math.min(4 * 1024 ** 2, original.mapOffset - offset);
        assert(readAt(fd, size, offset).equals(readAt(sourceFd, size, offset)), "another asset payload changed");
      }
    } finally { fs.closeSync(fd); }
    return { sourceSha256: sourceHash, uiSha256: digest(patched), unchangedEntries: original.count - 1 };
  } finally { fs.closeSync(sourceFd); }
}

export function updateManifests(feed, payloads, version, archive, pack) {
  assert.match(version, /^\d+\.\d+\.\d+$/, "expected X.Y.Z release version");
  assert.equal(feed.manifestVersion, 1);
  assert.equal(payloads.schemaVersion, 1);
  assert.equal(payloads.kind, "asset-payloads");
  assert.equal(feed.packVersion, payloads.packVersion, "base manifests disagree");
  const oldVersion = feed.packVersion.split(".").map(Number);
  assert(oldVersion.length === 3 && oldVersion.every(Number.isSafeInteger), "invalid base version");
  const newVersion = version.split(".").map(Number);
  assert(newVersion.every(Number.isSafeInteger), "invalid release version");
  const difference = newVersion.map((n, i) => n - oldVersion[i]).find((n) => n !== 0);
  assert(difference > 0, "release version must increase");
  assert(Array.isArray(feed.assets) && feed.assets.length <= 64);
  assert(Array.isArray(payloads.files) && payloads.files.length <= 20_000);
  assert.equal(new Set(feed.assets.map((a) => a.name.toLowerCase())).size, feed.assets.length, "duplicate feed asset");
  assert.equal(new Set(payloads.files.map((f) => f.path.toLowerCase())).size, payloads.files.length, "duplicate payload path");
  const assets = feed.assets.filter((a) => a.name === ASSET_NAME);
  const files = payloads.files.filter((f) => f.path === `${INSTALL_PATH}/${PACK_NAME}`);
  assert.equal(assets.length, 1, "base feed must own assets_x64_0");
  assert.equal(files.length, 1, "base payload manifest must own assets_x64_0.pack2");
  assert.equal(assets[0].type, "zip");
  assert.equal(assets[0].installPath, INSTALL_PATH);
  assert.equal(files[0].sha256, SOURCE_PACK_SHA256, "base payload is not the supported source pack");
  for (const row of [archive, pack]) {
    assert.match(row.sha256, /^[a-f0-9]{64}$/);
    assert(Number.isSafeInteger(row.size) && row.size > 0);
  }
  assert(archive.size < 2 * 1024 ** 3, "archive exceeds the GitHub release limit");
  assert(pack.size <= 3 * 1024 ** 3, "pack exceeds the launcher limit");
  const changed = { ...assets[0], version, ...archive,
    url: `https://github.com/h1z1rotk/assets/releases/download/assets-v${version}/${ASSET_NAME}.zip` };
  const changedFile = { ...files[0], ...pack };
  const nextFiles = payloads.files.map((f) => f === files[0] ? changedFile : f);
  assert(nextFiles.every((f) => Number.isSafeInteger(f.size) && f.size > 0), "invalid payload size");
  assert(nextFiles.reduce((sum, f) => sum + f.size, 0) <= 8 * 1024 ** 3, "payloads exceed the launcher limit");
  return {
    feed: { ...feed, packVersion: version, assets: feed.assets.map((a) => a === assets[0] ? changed : a) },
    payloads: { ...payloads, packVersion: version, files: nextFiles },
  };
}

export async function prepareRelease({ source, feedPath, payloadPath, output, version }) {
  assert.equal(await hashFile(source), SOURCE_PACK_SHA256, "unsupported source pack; nothing was patched");
  const feed = JSON.parse(fs.readFileSync(feedPath, "utf8"));
  const payloads = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
  // Refuse mismatched inputs before copying a multi-GB pack or creating output.
  updateManifests(feed, payloads, version, { size: 1, sha256: "0".repeat(64) }, { size: 1, sha256: "0".repeat(64) });
  fs.mkdirSync(output); // Exclusive: never patch an existing installation/staging tree.
  const packs = path.join(output, "packs");
  fs.mkdirSync(packs);
  const staged = path.join(packs, `${PACK_NAME}.partial`);
  const report = await writePatchedPack(source, staged);
  assert.equal(report.sourceSha256, SOURCE_PACK_SHA256, "source changed after validation");
  const packPath = path.join(packs, PACK_NAME);
  fs.renameSync(staged, packPath);
  const zip = new yazl.ZipFile();
  const zipPath = path.join(output, `${ASSET_NAME}.zip`);
  const zipPromise = pipeline(zip.outputStream, fs.createWriteStream(`${zipPath}.partial`, { flags: "wx" }));
  zip.addFile(packPath, PACK_NAME, { mtime: new Date("2020-01-01T00:00:00Z"), mode: 0o100644 });
  zip.end({ forceZip64Format: false });
  await zipPromise;
  fs.renameSync(`${zipPath}.partial`, zipPath);
  const archive = { size: fs.statSync(zipPath).size, sha256: await hashFile(zipPath) };
  const pack = { size: fs.statSync(packPath).size, sha256: await hashFile(packPath) };
  const next = updateManifests(feed, payloads, version, archive, pack);
  for (const [name, data] of [
    ["feed.json", next.feed], ["asset-payloads.v1.json", next.payloads],
    ["verification.json", { ...report, packVersion: version, archive, pack }],
  ]) fs.writeFileSync(path.join(output, name), `${JSON.stringify(data, null, 2)}\n`, { flag: "wx" });
  return { ...report, packVersion: version, archive, pack };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source, feedPath, payloadPath, output, version, ...extra] = process.argv.slice(2);
  if (![source, feedPath, payloadPath, output, version].every(Boolean) || extra.length) {
    console.error("Usage: node scripts/prepare-admin-panel-assets.mjs <source.pack2> <current-feed.json> <current-payloads.json> <new-output-directory> <X.Y.Z>");
    process.exitCode = 2;
  } else {
    prepareRelease({ source, feedPath, payloadPath, output, version }).then((report) => {
      console.log(JSON.stringify(report, null, 2));
      console.log("Prepared only. Coordinate server integrity policy, then publish the ZIP and both manifests together to h1z1rotk/assets.");
    }).catch((error) => { console.error(error.message); process.exitCode = 1; });
  }
}
