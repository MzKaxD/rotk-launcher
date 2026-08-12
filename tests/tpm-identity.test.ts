import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { collectTpmProof, parseTpmSignOutput } from "../electron/services/tpm-identity";

/**
 * Server-side verification of a level-1 TPM proof: parse the EccPublicBlob
 * (BCRYPT_ECCKEY_BLOB: magic|cbKey|X|Y), rebuild the P-256 key, and verify the
 * IEEE-P1363 signature over the nonce. Mirrors what the web-api will do.
 */
function verifyTpmProof(publicKeyB64: string, signatureB64: string, nonce: string): boolean {
  try {
    const pub = Buffer.from(publicKeyB64, "base64");
    const sig = Buffer.from(signatureB64, "base64");
    const cbKey = pub.readUInt32LE(4);
    if (pub.length < 8 + 2 * cbKey) return false;
    const x = pub.subarray(8, 8 + cbKey);
    const y = pub.subarray(8 + cbKey, 8 + 2 * cbKey);
    const b64u = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const key = createPublicKey({
      key: { kty: "EC", crv: "P-256", x: b64u(x), y: b64u(y) },
      format: "jwk",
    });
    return cryptoVerify("sha256", Buffer.from(nonce, "utf8"), { key, dsaEncoding: "ieee-p1363" }, sig);
  } catch {
    return false;
  }
}

describe("parseTpmSignOutput", () => {
  it("splits the pub|sig line", () => {
    expect(parseTpmSignOutput("AAAA|BBBB\r\n")).toEqual({ publicKey: "AAAA", signature: "BBBB" });
    expect(parseTpmSignOutput("noise")).toBeNull();
    expect(parseTpmSignOutput("|only-sig")).toBeNull();
  });
});

describe("collectTpmProof (real TPM, win32 only)", () => {
  it("signs a nonce with a TPM-backed key the server can verify, and the key persists", async () => {
    if (process.platform !== "win32") return; // no TPM-backed provider off Windows
    const proof = await collectTpmProof("rotk-nonce-alpha");
    if (proof === null) return; // machine has no usable TPM; feature is a no-op there
    expect(proof.algo).toBe("ecdsa-p256-sha256");
    expect(verifyTpmProof(proof.publicKey, proof.signature, "rotk-nonce-alpha")).toBe(true);
    // A different nonce must not verify against this signature.
    expect(verifyTpmProof(proof.publicKey, proof.signature, "rotk-nonce-beta")).toBe(false);
    // The persisted key is stable: a second proof carries the same public key.
    const again = await collectTpmProof("rotk-nonce-beta");
    expect(again?.publicKey).toBe(proof.publicKey);
    expect(verifyTpmProof(again!.publicKey, again!.signature, "rotk-nonce-beta")).toBe(true);
  });

  it("returns null off Windows", async () => {
    if (process.platform === "win32") return;
    expect(await collectTpmProof("x")).toBeNull();
  });
});
