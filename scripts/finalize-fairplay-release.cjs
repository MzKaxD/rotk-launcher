const { join } = require("node:path");
const { createReleaseManifest } = require("./fairplay-release-manifest.cjs");

/** Runs after all packaging, fuse edits and signing, including --dir builds. */
module.exports = async (context) => {
  const gamePath = process.env.ROTK_FAIRPLAY_GAME_EXE;
  const gameSha256 = process.env.ROTK_FAIRPLAY_GAME_SHA256;
  const gameHashSource = process.env.ROTK_FAIRPLAY_GAME_HASH_SOURCE;
  const gameVersion = process.env.ROTK_FAIRPLAY_GAME_VERSION;
  if ((!gamePath && !gameSha256) || !gameVersion) {
    throw new Error("FairPlay release manifest requires ROTK_FAIRPLAY_GAME_VERSION and ROTK_FAIRPLAY_GAME_EXE (or verified ROTK_FAIRPLAY_GAME_SHA256 plus ROTK_FAIRPLAY_GAME_HASH_SOURCE). The completed package is not an approved release until its manifest is generated.");
  }
  const { output } = await createReleaseManifest({ packageDir: join(context.outDir, "win-unpacked"),
    gamePath, gameSha256, gameHashSource, gameVersion,
    label: process.env.ROTK_FAIRPLAY_RELEASE_LABEL || "local-package-candidate",
    output: process.env.ROTK_FAIRPLAY_RELEASE_MANIFEST || join(context.outDir, "FairPlay-release-candidate.json") });
  console.log(`Final FairPlay component hashes verified; draft import: ${output}`);
  // These local manifests are deliberately not added to auto-publish artifacts.
  return [];
};
