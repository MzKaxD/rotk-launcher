const { createHash } = require("node:crypto");
const { createReadStream } = require("node:fs");
const { lstat, mkdir, readFile, realpath, stat, writeFile } = require("node:fs/promises");
const { dirname, join, resolve, relative, isAbsolute, sep } = require("node:path");
const { extractFile } = require("@electron/asar");
const { getCurrentFuseWire, FuseV1Options } = require("@electron/fuses");

const HASH = /^[a-f0-9]{64}$/;
const VERSION = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;
const REQUIRED_FUSES = {
  RunAsNode: 48, EnableNodeOptionsEnvironmentVariable: 48, EnableNodeCliInspectArguments: 48,
  EnableEmbeddedAsarIntegrityValidation: 49, OnlyLoadAppFromAsar: 49,
};
async function sha256(path, maximum = 1024 * 1024 * 1024) {
  const info = await stat(path);
  if (!info.isFile() || info.size <= 0 || info.size > maximum) throw new Error(`Invalid release component: ${path}`);
  const hash = createHash("sha256"); let bytes = 0;
  for await (const chunk of createReadStream(path, { signal: AbortSignal.timeout(60000) })) {
    bytes += chunk.length; if (bytes > maximum) throw new Error("Release component exceeds its size bound."); hash.update(chunk);
  }
  if (bytes !== info.size) throw new Error("Release component changed while hashing.");
  return hash.digest("hex");
}
async function verifyPackagedFuses(executable) {
  const wire = await getCurrentFuseWire(executable);
  for (const [name, state] of Object.entries(REQUIRED_FUSES)) {
    if (wire[FuseV1Options[name]] !== state) throw new Error(`Packaged Electron fuse ${name} is not hardened.`);
  }
  return REQUIRED_FUSES;
}
async function inspectPackage(packageDirectory) {
  const packageDir = await realpath(resolve(packageDirectory));
  const asarPath = join(packageDir, "resources", "app.asar");
  const packageJson = JSON.parse(extractFile(asarPath, "package.json").toString("utf8"));
  if (!VERSION.test(packageJson.version)) throw new Error("Packaged launcher version is missing.");
  const launcherPath = join(packageDir, "ROTK Launcher.exe");
  const agentPath = join(packageDir, "resources", "fairplay", "FairPlay.exe");
  const pin = extractFile(asarPath, join("dist-electron", "electron", "services", "fairplay-release.js")).toString("utf8");
  const expectedAgent = pin.match(/FAIRPLAY_SHA256\s*=\s*"([a-f0-9]{64})"/)?.[1];
  const agentVersion = pin.match(/FAIRPLAY_VERSION\s*=\s*"([^"]+)"/)?.[1];
  if (!expectedAgent || !VERSION.test(agentVersion ?? "")) throw new Error("Packaged FairPlay pin/version are missing.");
  await verifyPackagedFuses(launcherPath);
  const [launcherSha256, launcherAsarSha256, agentSha256] = await Promise.all([
    sha256(launcherPath), sha256(asarPath), sha256(agentPath, 32 * 1024 * 1024),
  ]);
  if (agentSha256 !== expectedAgent) throw new Error("The final packaged FairPlay differs from its compiled pin. Sign native first, stage it, then rebuild the launcher.");
  const sidecar = (await readFile(`${agentPath}.sha256`, "utf8")).trim().split(/\s+/)[0];
  if (sidecar !== agentSha256) throw new Error("Packaged FairPlay checksum sidecar differs.");
  return { packageDir, launcherVersion: packageJson.version, agentVersion,
    hashes: { launcherSha256, launcherAsarSha256, agentSha256 } };
}
async function createReleaseManifest(options) {
  if (typeof options.label !== "string" || options.label.trim().length < 3 || options.label.length > 80 || /[\x00-\x1f\x7f]/.test(options.label)) throw new Error("A release label of 3..80 characters is required.");
  if (typeof options.gameVersion !== "string" || !options.gameVersion.trim() || options.gameVersion.length > 40 || /[\x00-\x1f\x7f]/.test(options.gameVersion)) throw new Error("An explicit game version of at most 40 characters is required.");
  if (!!options.gamePath === !!options.gameSha256) throw new Error("Supply exactly one game executable or a verified base-game SHA-256.");
  if (options.gameSha256 && (!HASH.test(options.gameSha256) || typeof options.gameHashSource !== "string" || !options.gameHashSource.trim())) throw new Error("A supplied game hash requires explicit provenance (--game-hash-source).");
  const pkg = await inspectPackage(options.packageDir);
  const gameSha256 = options.gamePath ? await sha256(await realpath(resolve(options.gamePath)), 512 * 1024 * 1024) : options.gameSha256;
  const manifest = { schemaVersion: 1, label: options.label.trim(), gameVersion: options.gameVersion.trim(),
    launcherVersion: pkg.launcherVersion, agentVersion: pkg.agentVersion, hashes: { gameSha256, ...pkg.hashes } };
  if (!options.output) throw new Error("An output JSON path outside the packaged application is required.");
  const output = resolve(options.output);
  // An output inside app/resources would mutate the tuple it describes or be
  // distributed accidentally. Keep the importable document beside the build.
  await mkdir(dirname(output), { recursive: true });
  const physicalOutput = join(await realpath(dirname(output)), output.slice(dirname(output).length + 1));
  const inside = relative(pkg.packageDir, physicalOutput);
  if (!(inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside))) throw new Error("Write the release manifest outside the packaged application.");
  for (const target of [output, `${output}.provenance.json`]) {
    const previous = await lstat(target).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
    if (previous && (!previous.isFile() || previous.isSymbolicLink() || previous.nlink > 1)) {
      throw new Error("Release manifest outputs must be ordinary files, never symbolic or hard links.");
    }
  }
  await writeFile(output, JSON.stringify(manifest, null, 2) + "\n");
  // Provenance stays in a separate local receipt so the import document keeps
  // the backend's strict schema and never uploads developer filesystem paths.
  await writeFile(`${output}.provenance.json`, JSON.stringify({ generatedAt: new Date().toISOString(),
    gameSource: options.gamePath ? "measured-game-executable" : options.gameHashSource.trim(),
    artifactSource: "final-packaged-files", activation: "draft-import-only",
    signingNotice: "Any later signing, resource edit or packaging change requires regeneration of this manifest." }, null, 2) + "\n");
  return { manifest, output };
}
module.exports = { sha256, inspectPackage, verifyPackagedFuses, createReleaseManifest };
