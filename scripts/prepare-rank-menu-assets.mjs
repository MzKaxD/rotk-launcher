/** Package the reviewed BR1315 rank/menu candidate. Offline; no installation writes. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import yazl from "yazl";
import yauzl from "yauzl";

export const SOURCE_PACK_SHA256 = "b72dcc5245e654e498cadf5493761d63a93fea14904d3da32fda1545ae3d07f3";
export const CANDIDATE = Object.freeze({
  "assets_x64_0.pack2": { size: 2479583592, sha256: "16ffa81000fde4e9b3c39b536630831132a1fe3bc47d24e560e29ca52d080aa8" },
  "ui_x64_0.pack2": { size: 48635677, sha256: "6b49db5f80c24a2eed253c34c29db0a8131fc3a4935a8150f7532f801f8c28d7" },
  "ui_x64_2.pack2": { size: 48664842, sha256: "98890f61762f39d6e860eb5928498573ac22cf1c36eb6c99fe5fe9f6e35518b3" },
});
const groups = {
  assets_x64_0: ["assets_x64_0.pack2"],
  rank_menu_ui: ["ui_x64_0.pack2", "ui_x64_2.pack2"],
};
const installPath = "Resources/Assets";
const mainTarget = `${installPath}/assets_x64_0.pack2`;
const hash = () => createHash("sha256");
export async function metadata(file) {
  const digest = hash();
  let size = 0;
  for await (const chunk of fs.createReadStream(file)) { size += chunk.length; digest.update(chunk); }
  return { size, sha256: digest.digest("hex") };
}
const pathKey = value => {
  assert.equal(typeof value, "string", "invalid manifest path");
  const normalized = value.replaceAll("\\", "/");
  assert(normalized.length > 0 && !/[:\x00-\x1f]/.test(normalized)
    && normalized.split("/").every(part => part && part !== "." && part !== ".."), "unsafe manifest path");
  return normalized.toLowerCase();
};
const nameKey = value => {
  assert.equal(typeof value, "string", "invalid asset name");
  assert.match(value, /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
  return value.toLowerCase();
};
function validMetadata(row, limit = 3 * 1024 ** 3) {
  assert(row && Number.isSafeInteger(row.size) && row.size > 0 && row.size <= limit, "invalid file size");
  assert.match(row.sha256, /^[a-f0-9]{64}$/, "invalid file SHA-256");
}
function versionParts(value) {
  assert.match(value, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, "expected X.Y.Z version");
  return value.split(".").map(BigInt);
}

/** Preserve the full catalog, refuse replacing a newer/conflicting UI release. */
export function updateManifests(feed, payloads, version, archives, packs) {
  assert.equal(feed.manifestVersion, 1);
  assert.equal(payloads.schemaVersion, 1);
  assert.equal(payloads.kind, "asset-payloads");
  assert.equal(feed.packVersion, payloads.packVersion, "base manifests disagree");
  const old = versionParts(feed.packVersion), next = versionParts(version);
  assert(next.map((v, i) => v - old[i]).find(v => v !== 0n) > 0n, "release version must increase");
  assert(Array.isArray(feed.assets) && feed.assets.length > 0 && feed.assets.length < 64);
  assert(Array.isArray(payloads.files) && payloads.files.length > 0 && payloads.files.length < 20_000);
  const assets = new Map();
  for (const asset of feed.assets) {
    const key = nameKey(asset.name);
    assert(!assets.has(key), "duplicate asset");
    assert(asset.type === "zip" || asset.type === "file", "invalid asset type");
    pathKey(asset.installPath);
    validMetadata(asset, 2 * 1024 ** 3 - 1);
    assets.set(key, asset);
  }
  const paths = new Set(), owned = new Set();
  for (const row of payloads.files) {
    validMetadata(row);
    const key = pathKey(row.path), owner = nameKey(row.asset), asset = assets.get(owner);
    assert(!paths.has(key), "duplicate payload path");
    assert(asset, "unknown payload owner");
    const root = pathKey(asset.installPath);
    assert(asset.type === "zip" ? key.startsWith(root + "/") : key === root, "payload outside asset install path");
    paths.add(key); owned.add(owner);
  }
  assert([...assets.keys()].every(key => owned.has(key)), "asset missing payload metadata");
  assert(!assets.has("rank_menu_ui") && !assets.has("ui_x64_0") && !assets.has("ui_x64_2"),
    "base catalog already owns a UI update; reconcile that release first");
  for (const name of groups.rank_menu_ui) assert(!paths.has(pathKey(`${installPath}/${name}`)),
    "base catalog already owns a UI pack; reconcile that release first");
  const main = assets.get("assets_x64_0");
  assert(main?.type === "zip" && pathKey(main.installPath) === pathKey(installPath), "unsupported main pack entry");
  const sourceRows = payloads.files.filter(row => nameKey(row.asset) === "assets_x64_0");
  assert(sourceRows.length === 1 && pathKey(sourceRows[0].path) === pathKey(mainTarget), "unsupported main pack ownership");
  assert.equal(sourceRows[0].sha256, SOURCE_PACK_SHA256, "main pack changed; reconcile that release first");
  assert.equal(sourceRows[0].size, 2479085469, "unexpected source pack size");
  for (const name of Object.keys(CANDIDATE)) validMetadata(packs[name]);
  const changed = Object.entries(groups).map(([name]) => {
    validMetadata(archives[name], 2 * 1024 ** 3 - 1);
    return { ...(name === "assets_x64_0" ? main : {}), name, version, type: "zip", installPath,
      // Both remain feed-driven: never expose half a three-pack update through
      // the launcher's automatic <pack>.zip discovery in releases/latest.
      url: `https://github.com/h1z1rotk/assets/releases/download/assets-v${version}/${name}.payload`,
      ...archives[name] };
  });
  const files = payloads.files.filter(row => nameKey(row.asset) !== "assets_x64_0");
  for (const [asset, names] of Object.entries(groups)) for (const name of names) {
    files.push({ asset, path: `${installPath}/${name}`, ...packs[name] });
  }
  assert(files.length <= 20_000, "launcher payload count exceeded");
  assert(files.reduce((sum, row) => sum + row.size, 0) <= 8 * 1024 ** 3, "launcher payload limit exceeded");
  return {
    feed: { ...feed, packVersion: version, assets: feed.assets.map(asset => nameKey(asset.name) === "assets_x64_0" ? changed[0] : asset).concat(changed[1]) },
    payloads: { ...payloads, packVersion: version, files },
  };
}

export async function writeArchive(directory, names, output) {
  const zip = new yazl.ZipFile();
  for (const name of names) {
    assert(Object.hasOwn(CANDIDATE, name), "unsupported archive entry");
    zip.addFile(path.join(directory, name), name, { mtime: new Date("2020-01-01T00:00:00Z"), mode: 0o100644, compressionLevel: 6 });
  }
  const completed = pipeline(zip.outputStream, fs.createWriteStream(output, { flags: "wx" }));
  zip.end({ forceZip64Format: false });
  await completed;
}

/** Stream every decompressed byte back; detects input changes during packaging. */
export async function verifyArchive(file, expected) {
  const zip = await new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true }, (error, value) => error ? reject(error) : resolve(value)));
  return new Promise((resolve, reject) => {
    const found = new Set();
    const fail = error => { zip.close(); reject(error); };
    zip.on("error", fail);
    zip.on("end", () => {
      try { assert.equal(found.size, Object.keys(expected).length, "missing archive entry"); resolve(); }
      catch (error) { fail(error); }
    });
    zip.on("entry", entry => {
      (async () => {
        assert(Object.hasOwn(expected, entry.fileName) && !found.has(entry.fileName), "unexpected archive entry");
        found.add(entry.fileName);
        const want = expected[entry.fileName];
        assert.equal(entry.uncompressedSize, want.size, "archive size mismatch");
        const stream = await new Promise((res, rej) => zip.openReadStream(entry, (error, value) => error ? rej(error) : res(value)));
        const digest = hash(); let size = 0;
        for await (const chunk of stream) { size += chunk.length; assert(size <= want.size); digest.update(chunk); }
        assert.equal(size, want.size);
        assert.equal(digest.digest("hex"), want.sha256, "archive payload SHA-256 mismatch");
        zip.readEntry();
      })().catch(fail);
    });
    zip.readEntry();
  });
}

export async function prepareRelease({ directory, feedPath, payloadPath, output, version }) {
  const packs = {};
  for (const [name, expected] of Object.entries(CANDIDATE)) {
    const file = path.join(directory, name);
    assert.equal(fs.statSync(file).size, expected.size, `unsupported candidate size: ${name}`);
    packs[name] = await metadata(file);
    assert.deepEqual(packs[name], expected, `unsupported candidate: ${name}`);
  }
  const json = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  const feed = json(feedPath), payloads = json(payloadPath);
  const placeholder = { size: 1, sha256: "0".repeat(64) };
  updateManifests(feed, payloads, version, { assets_x64_0: placeholder, rank_menu_ui: placeholder }, packs);
  fs.mkdirSync(output); // Exclusive; never overwrite a client or another staging run.
  const archives = {};
  for (const [asset, names] of Object.entries(groups)) {
    const archive = path.join(output, `${asset}.payload`);
    await writeArchive(directory, names, `${archive}.partial`);
    await verifyArchive(`${archive}.partial`, Object.fromEntries(names.map(name => [name, packs[name]])));
    fs.renameSync(`${archive}.partial`, archive);
    archives[asset] = await metadata(archive);
  }
  const next = updateManifests(feed, payloads, version, archives, packs);
  const report = { packVersion: version, packs, archives, verifiedArchivePayloads: true, published: false };
  for (const [name, data] of [["feed.json", next.feed], ["asset-payloads.v1.json", next.payloads], ["verification.json", report]]) {
    fs.writeFileSync(path.join(output, name), JSON.stringify(data, null, 2) + "\n", { flag: "wx" });
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory, feedPath, payloadPath, output, version, ...extra] = process.argv.slice(2);
  if (![directory, feedPath, payloadPath, output, version].every(Boolean) || extra.length) {
    console.error("Usage: node scripts/prepare-rank-menu-assets.mjs <reviewed-packs-directory> <current-feed.json> <current-payloads.json> <new-output-directory> <X.Y.Z>");
    process.exitCode = 2;
  } else {
    prepareRelease({ directory, feedPath, payloadPath, output, version }).then(report => console.log(JSON.stringify(report, null, 2)))
      .catch(error => { console.error(error.message); process.exitCode = 1; });
  }
}
