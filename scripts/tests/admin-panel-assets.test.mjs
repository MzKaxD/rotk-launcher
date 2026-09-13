import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import zlib from "node:zlib";
import {
  SOURCE_PACK_SHA256, hashFile, insertStaffGate, patchUiRoot, prepareRelease,
  updateManifests, writePatchedPack,
} from "../prepare-admin-panel-assets.mjs";

test("synthetic instructions preserve close and gate open on the existing staff binding", () => {
  // Synthetic instruction padding, not a shipped or decompiled client method.
  const code = Buffer.alloc(116, 0x02);
  Buffer.from("101d0000", "hex").copy(code, 0x52);
  code[115] = 0x47;
  const patched = insertStaffGate(code);
  const i24 = (offset) => patched.readIntLE(offset, 3);
  assert.equal(patched.length, 127);
  assert.equal(0x56 + i24(0x53), 126, "closing jumps over the new guard to returnvoid");
  assert.equal(patched.subarray(0x56, 0x5d).toString("hex"), "60b50746df3500");
  assert.equal(patched[0x5d], 0x12, "iffalse uses the native staff predicate");
  for (const staff of [false, true]) {
    const next = staff ? 0x61 : 0x61 + i24(0x5e);
    assert.equal(next, staff ? 97 : 126, "only staff reaches the original opening code");
  }
  const restored = Buffer.concat([patched.subarray(0, 0x56), patched.subarray(0x61)]);
  restored[0x53] -= 11;
  assert(restored.equals(code), "all surrounding instructions remain unchanged");
  assert.throws(() => insertStaffGate(Buffer.alloc(115)), /length/);
  assert.throws(() => insertStaffGate(Buffer.alloc(116)), /branch/);
  assert.throws(() => patchUiRoot(Buffer.from("unknown or already patched asset")), /unsupported/);
});

function fixturePack(compressed) {
  const ui = Buffer.from("Synthetic UI content, no proprietary bytes.");
  const other = Buffer.from("Other asset must remain byte exact.");
  const prefix = Buffer.alloc(8);
  prefix.set([0xa1, 0xb2, 0xc3, 0xd4]); prefix.writeUInt32BE(ui.length, 4);
  const stored = compressed ? Buffer.concat([prefix, zlib.deflateSync(ui)]) : ui;
  const header = Buffer.alloc(48, 0x35);
  header.set([0x50, 0x41, 0x4b, 1]); header.writeUInt32LE(2, 4);
  const mapOffset = 48 + other.length + stored.length;
  header.writeBigUInt64LE(BigInt(mapOffset + 64), 8);
  header.writeBigUInt64LE(BigInt(mapOffset), 16);
  const map = Buffer.alloc(64);
  for (const [at, name, offset, data, flags] of [
    [0, 1n, 48, other, 16],
    [32, 0xef872dad597e632fn, 48 + other.length, stored, compressed ? 1 : 16],
  ]) {
    map.writeBigUInt64LE(name, at);
    map.writeBigUInt64LE(BigInt(offset), at + 8);
    map.writeBigUInt64LE(BigInt(data.length), at + 16);
    map.writeUInt32LE(flags, at + 24);
    map.writeUInt32LE(zlib.crc32(data), at + 28);
  }
  return { bytes: Buffer.concat([header, other, stored, map]), mapOffset, ui };
}

for (const compressed of [false, true]) {
  test(`copy/append/readback preserves every other byte (compressed=${compressed})`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "rotk-admin-assets-"));
    try {
      const { bytes, mapOffset, ui } = fixturePack(compressed);
      const source = path.join(directory, "source.pack2"), output = path.join(directory, "patched.pack2");
      await writeFile(source, bytes);
      const before = await hashFile(source);
      const patchedUi = Buffer.concat([ui, Buffer.from(" Staff-only synthetic patch.")]);
      const report = await writePatchedPack(source, output, (input) => {
        assert(input.equals(ui)); return patchedUi;
      });
      assert.equal(report.unchangedEntries, 1);
      assert.equal(await hashFile(source), before);
      const result = await readFile(output);
      assert(result.subarray(32, mapOffset).equals(bytes.subarray(32, mapOffset)));
      const newMapOffset = Number(result.readBigUInt64LE(16));
      assert(result.subarray(newMapOffset, newMapOffset + 32).equals(bytes.subarray(mapOffset, mapOffset + 32)));
      const newEntry = result.subarray(newMapOffset + 32);
      const offset = Number(newEntry.readBigUInt64LE(8)), size = Number(newEntry.readBigUInt64LE(16));
      const stored = result.subarray(offset, offset + size);
      assert.equal(zlib.crc32(stored), newEntry.readUInt32LE(28));
      assert((compressed ? zlib.inflateSync(stored.subarray(8)) : stored).equals(patchedUi));
      assert.equal(result.readBigUInt64LE(8), BigInt(result.length));
      const outputHash = await hashFile(output);
      await assert.rejects(writePatchedPack(source, source, () => patchedUi), /source must/);
      await assert.rejects(writePatchedPack(source, output, () => patchedUi), /EEXIST/);
      assert.equal(await hashFile(output), outputHash, "refused overwrite preserves the existing output");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
}

test("malformed map and unsupported source leave no output", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "rotk-admin-assets-"));
  try {
    const { bytes, mapOffset } = fixturePack(false);
    const source = path.join(directory, "source.pack2"), output = path.join(directory, "output.pack2");
    for (const mutate of [
      (b) => b.writeBigUInt64LE(0xffffffffffffffffn, 16),
      (b) => b.writeUInt32LE(20_001, 4),
      (b) => b.writeBigUInt64LE(0n, mapOffset + 40),
      (b) => b.writeBigUInt64LE(1n, mapOffset + 32),
      (b) => b.writeUInt32LE(1, mapOffset + 56),
    ]) {
      const bad = Buffer.from(bytes); mutate(bad); await writeFile(source, bad);
      await assert.rejects(writePatchedPack(source, output, (ui) => ui));
      await assert.rejects(readFile(output), /ENOENT/);
    }
    await writeFile(source, bytes);
    await assert.rejects(prepareRelease({ source, output: path.join(directory, "new"), version: "1.6.1" }), /unsupported source pack/);
    await assert.rejects(readFile(output), /ENOENT/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("empty unrelated entries in the published pack remain valid and unchanged", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "rotk-admin-assets-"));
  try {
    const { bytes, mapOffset } = fixturePack(false);
    bytes.writeBigUInt64LE(0n, mapOffset + 16);
    const source = path.join(directory, "source.pack2"), output = path.join(directory, "output.pack2");
    await writeFile(source, bytes);
    await writePatchedPack(source, output, (ui) => Buffer.concat([ui, Buffer.from("patch")]));
    const result = await readFile(output);
    const newMapOffset = Number(result.readBigUInt64LE(16));
    assert(result.subarray(newMapOffset, newMapOffset + 32).equals(bytes.subarray(mapOffset, mapOffset + 32)));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

function manifests() {
  return {
    feed: { manifestVersion: 1, packVersion: "1.6.0", assets: [
      { name: "assets_x64_0", version: "1.4.0", installPath: "Resources/Assets", type: "zip", sha256: "1".repeat(64), size: 100, url: "https://github.com/h1z1rotk/assets/releases/download/assets-v1.4.0/assets_x64_0.zip" },
      { name: "other", version: "1.2.0", installPath: "Resources/Assets", type: "zip", sha256: "2".repeat(64), size: 200, url: "https://github.com/h1z1rotk/assets/releases/download/assets-v1.2.0/other.zip" },
    ] },
    payloads: { schemaVersion: 1, kind: "asset-payloads", packVersion: "1.6.0", files: [
      { asset: "assets_x64_0", path: "Resources/Assets/assets_x64_0.pack2", size: 1000, sha256: SOURCE_PACK_SHA256 },
      { asset: "other", path: "Resources/Assets/other.pack2", size: 2000, sha256: "3".repeat(64) },
    ] },
  };
}
const archive = { size: 800, sha256: "4".repeat(64) }, pack = { size: 1200, sha256: "5".repeat(64) };
test("incremental publication preserves other packs and updates archive/payload hashes together", () => {
  const { feed, payloads } = manifests();
  const before = JSON.stringify({ feed, payloads });
  const result = updateManifests(feed, payloads, "1.6.1", archive, pack);
  assert.equal(JSON.stringify({ feed, payloads }), before, "input manifests remain unchanged");
  assert.equal(result.feed.assets.length, 2); assert.equal(result.payloads.files.length, 2);
  assert.deepEqual(result.feed.assets[1], feed.assets[1]);
  assert.deepEqual(result.payloads.files[1], payloads.files[1]);
  assert.equal(result.feed.assets[0].sha256, archive.sha256);
  assert.equal(result.payloads.files[0].sha256, pack.sha256);
  assert.equal(result.feed.assets[0].url, "https://github.com/h1z1rotk/assets/releases/download/assets-v1.6.1/assets_x64_0.zip");
  assert.equal(result.feed.assets[0].version, "1.6.1");
  assert.equal(result.feed.packVersion, result.payloads.packVersion);
});
test("publication refuses mismatched/duplicate manifests, stale versions and size violations", () => {
  for (const version of ["1.6.0", "1.5.99", "../bad", "1.6.1-rc1"]) {
    const { feed, payloads } = manifests();
    assert.throws(() => updateManifests(feed, payloads, version, archive, pack));
  }
  for (const mutate of [
    ({ payloads }) => { payloads.packVersion = "1.5.0"; },
    ({ payloads }) => { payloads.files[0].sha256 = "9".repeat(64); },
    ({ feed }) => { feed.assets.push(feed.assets[0]); },
    ({ payloads }) => { payloads.files.push(payloads.files[0]); },
    ({ feed }) => { feed.assets[0].installPath = "elsewhere"; },
  ]) {
    const value = manifests(); mutate(value);
    assert.throws(() => updateManifests(value.feed, value.payloads, "1.6.1", archive, pack));
  }
  const { feed, payloads } = manifests();
  assert.throws(() => updateManifests(feed, payloads, "1.6.1", { ...archive, size: 2 * 1024 ** 3 }, pack));
  assert.throws(() => updateManifests(feed, payloads, "1.6.1", archive, { ...pack, size: 3 * 1024 ** 3 + 1 }));
});
