#!/usr/bin/env node
/**
 * Generates an Ed25519 release key pair for launcher attestation.
 *
 * The private seed signs manifests, policies and challenges; it belongs in GCP
 * Secret Manager (never a repo). The public key is printed for pasting into
 * TRUSTED_ATTESTATION_KEYS in shared/attestation.ts — it is not a secret and is
 * expected to live in the open-source launcher.
 *
 * Rotation: run again with a fresh --key-id, add the public key alongside the
 * old one, ship the launcher, then switch the signing secret. Remove the old
 * entry in a later release to revoke it.
 *
 * Usage: node scripts/generate-attestation-keypair.mjs --key-id rotk-attest-2026-08
 */

import { generateKeyPairSync } from "node:crypto";

const args = process.argv.slice(2);
const keyIdIndex = args.indexOf("--key-id");
const keyId = keyIdIndex >= 0 ? args[keyIdIndex + 1] : "";

if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(keyId ?? "")) {
  console.error("Usage: node scripts/generate-attestation-keypair.mjs --key-id <lowercase-id>");
  process.exit(2);
}

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" });
const spki = publicKey.export({ format: "der", type: "spki" });
// Raw 32-byte seed / public key are the last 32 bytes of the DER encodings.
const seedBase64Url = pkcs8.subarray(pkcs8.length - 32).toString("base64url");
const publicBase64Url = spki.subarray(spki.length - 32).toString("base64url");

console.log(`keyId: ${keyId}`);
console.log("");
console.log("--- PUBLIC KEY (commit this) ---");
console.log("In rotk-launcher/shared/attestation.ts, TRUSTED_ATTESTATION_KEYS:");
console.log(`  "${keyId}": "${publicBase64Url}",`);
console.log("");
console.log("--- PRIVATE SEED (never commit) ---");
console.log("Store in Secret Manager as ROTK_ATTEST_SIGNING_SEED:");
console.log(`  ${seedBase64Url}`);
console.log("");
console.log("  printf '%s' '<seed>' | gcloud secrets create ROTK_ATTEST_SIGNING_SEED \\");
console.log("    --project rotk-project --data-file=-");
console.log("");
console.log("Also record the keyId as ROTK_ATTEST_SIGNING_KEY_ID.");
