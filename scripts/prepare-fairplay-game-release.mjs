import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { computeManifestRoot, manifestSigningInput, verifyAttestationSignature } from "../dist-electron/shared/attestation.js";
const BASE_MANIFEST_URL = "https://raw.githubusercontent.com/h1z1rotk/assets/main/base-manifest.v1.json";

// No unsigned local override is permitted in the public release workflow.
const response = await fetch(BASE_MANIFEST_URL, { redirect: "error", signal: AbortSignal.timeout(20_000) });
if (!response.ok) throw new Error(`Base manifest unavailable: HTTP ${response.status}`);
const chunks = []; let length = 0;
for await (const chunk of response.body) {
  length += chunk.length;
  if (length > 32 * 1024 * 1024) throw new Error("Base manifest exceeds its size limit");
  chunks.push(chunk);
}
const manifest = JSON.parse(Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, ""));
if (!manifest || manifest.kind !== "base-game" || manifest.schemaVersion !== 1 || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 200_000
  || !verifyAttestationSignature(manifestSigningInput({ kind: "base-game", schemaVersion: 1, version: manifest.buildId, root: manifest.root, issuedAt: manifest.issuedAt, expiresAt: null }), manifest.signature, manifest.keyId)) {
  throw new Error("The game release manifest has no valid trusted signature");
}
if (computeManifestRoot(manifest.files) !== manifest.root) throw new Error("Base files do not match their signed root");
const game = manifest.files.find(file => file.path.toLowerCase() === "h1z1.exe");
if (!game || !/^[0-9a-f]{64}$/.test(game.sha256) || !/^[A-Za-z0-9._-]{1,40}$/.test(manifest.buildId)) throw new Error("Missing signed game identity");
const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const values = {
  ROTK_FAIRPLAY_GAME_SHA256: game.sha256,
  ROTK_FAIRPLAY_GAME_VERSION: manifest.buildId,
  ROTK_FAIRPLAY_GAME_HASH_SOURCE: `Ed25519-verified-base-manifest:${manifest.root}`,
  ROTK_FAIRPLAY_RELEASE_LABEL: `ROTK-Launcher-${version}`,
  ROTK_FAIRPLAY_RELEASE_MANIFEST: "release/FairPlay-release.json",
};
await mkdir("release", { recursive: true });
await writeFile("release/fairplay-game-verification.json", JSON.stringify({ values, keyId: manifest.keyId, baseRoot: manifest.root }, null, 2) + "\n");
if (process.env.GITHUB_ENV) await appendFile(process.env.GITHUB_ENV, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(""));
console.log(JSON.stringify({ verified: true, buildId: manifest.buildId, gameSha256: game.sha256, baseRoot: manifest.root }));
