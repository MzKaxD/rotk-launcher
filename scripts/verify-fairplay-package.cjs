const { readFile, readdir } = require("node:fs/promises");
const { join } = require("node:path");
const { createHash } = require("node:crypto");
const { extractFile } = require("@electron/asar");

/** FairPlay must be signed before staging; a packager must not change its hash. */
module.exports = async ({ appOutDir }) => {
  const resources = join(appOutDir, "resources");
  const manifest = extractFile(join(resources, "app.asar"), join("dist-electron", "electron", "services", "fairplay-release.js")).toString("utf8");
  const expected = manifest.match(/FAIRPLAY_SHA256 = "([a-f0-9]{64})"/)?.[1];
  const directory = join(resources, "fairplay");
  const allowed = ["FairPlay.exe", "FairPlay.exe.sha256", "JSON-LICENSE.txt", "PRIVACY.fr.md"];
  const files = await readdir(directory);
  if (files.length !== allowed.length || files.some((name) => !allowed.includes(name))) throw new Error("Unexpected FairPlay distribution contents.");
  const binary = await readFile(join(directory, "FairPlay.exe"));
  if (!expected || createHash("sha256").update(binary).digest("hex") !== expected) throw new Error("Packaged FairPlay does not match the compiled launcher digest.");
  const sidecar = (await readFile(join(directory, "FairPlay.exe.sha256"), "utf8")).trim().split(/\s+/)[0];
  if (sidecar !== expected) throw new Error("Packaged FairPlay checksum is inconsistent.");
  console.log("Packaged FairPlay verified: exact compiled digest, notices present, no native source or debug symbols.");
};
