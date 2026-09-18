/**
 * TPM-backed machine proof (Windows, level 1).
 *
 * The launcher holds a persisted signing key inside the TPM (via the Windows
 * "Microsoft Platform Crypto Provider" — no admin needed) and signs the
 * attestation challenge nonce with it. The server stores the public key as the
 * machine's stable identity and verifies the signature; a re-launch reuses the
 * same key, so it is a "same machine" proof that survives across sessions and
 * cannot be copied (the private key is non-exportable and never leaves the TPM).
 *
 * This is NOT the unspoofable Endorsement-Key anchor: a recompiled launcher
 * could sign with a software key and claim it is TPM-backed. It raises the cost
 * of ban evasion (a normal user cannot move or regenerate it) and is a stable
 * correlation signal; the EK anchor (credential activation, elevated
 * enrolment) is a separate, later step.
 *
 * Best-effort: no TPM, no provider, or any failure yields null, and the launch
 * proceeds with no TPM proof. The server decides (behind its own flag) whether
 * a missing proof is acceptable — the launcher never self-exempts.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { windowsSystemToolPath } from "./windows-tools.js";

const execFileAsync = promisify(execFile);

/** The persisted key name in the platform provider; stable across launches. */
const KEY_NAME = "rotk-hwid-tpm-v1";

/**
 * Signs the message passed base64-encoded in ROTK_TPM_MESSAGE_B64 (never on
 * the command line, so it cannot be seen or injected; base64 because the
 * binding message carries NUL separators and Node refuses NUL bytes in a
 * child's environment) and prints {pub, sig} as base64. .NET Framework 4.x
 * compatible so it runs under the stock Windows PowerShell 5.1.
 */
const SIGN_SCRIPT = `
$ErrorActionPreference = "Stop"
$encoded = $env:ROTK_TPM_MESSAGE_B64
if ([string]::IsNullOrEmpty($encoded)) { throw "no message" }
$data = [Convert]::FromBase64String($encoded)
$provider = [System.Security.Cryptography.CngProvider]::new("Microsoft Platform Crypto Provider")
if ([System.Security.Cryptography.CngKey]::Exists("${KEY_NAME}", $provider)) {
  $key = [System.Security.Cryptography.CngKey]::Open("${KEY_NAME}", $provider)
} else {
  $p = [System.Security.Cryptography.CngKeyCreationParameters]::new()
  $p.Provider = $provider
  $p.ExportPolicy = [System.Security.Cryptography.CngExportPolicies]::None
  $p.KeyUsage = [System.Security.Cryptography.CngKeyUsages]::Signing
  $key = [System.Security.Cryptography.CngKey]::Create([System.Security.Cryptography.CngAlgorithm]::ECDsaP256, "${KEY_NAME}", $p)
}
$ecdsa = [System.Security.Cryptography.ECDsaCng]::new($key)
$sig = $ecdsa.SignData($data, [System.Security.Cryptography.HashAlgorithmName]::SHA256)
$pub = $key.Export([System.Security.Cryptography.CngKeyBlobFormat]::EccPublicBlob)
Write-Output ([Convert]::ToBase64String($pub) + "|" + [Convert]::ToBase64String($sig))
`;

/** The proof carried with the ticket: the P-256 public key and the signature. */
export interface TpmProof {
  /** EccPublicBlob (BCRYPT_ECCKEY_BLOB), base64. The server derives x/y from it. */
  readonly publicKey: string;
  /** IEEE-P1363 (r||s) signature over the UTF-8 nonce, base64. */
  readonly signature: string;
  /** The curve/hash, so the server verifies with the right parameters. */
  readonly algo: "ecdsa-p256-sha256";
}

/** Parse the "pub|sig" line the script prints. Exported for tests. */
export function parseTpmSignOutput(stdout: string): { publicKey: string; signature: string } | null {
  const line = stdout.split(/\r?\n/).map((l) => l.trim()).find((l) => l.includes("|"));
  if (line === undefined) return null;
  const [publicKey, signature] = line.split("|");
  if (!publicKey || !signature) return null;
  return { publicKey, signature };
}

/**
 * Produce a TPM proof over `nonce`, or null when no TPM-backed key can be used.
 * Never throws.
 */
export async function collectTpmProof(nonce: string): Promise<TpmProof | null> {
  if (process.platform !== "win32" || typeof nonce !== "string" || nonce === "") return null;
  try {
    // Absolute path: a `powershell.exe` earlier on the user's PATH must not get
    // to answer with a software key and call it the TPM.
    const { stdout } = await execFileAsync(
      windowsSystemToolPath("powershell"),
      ["-NoProfile", "-NonInteractive", "-Command", SIGN_SCRIPT],
      { windowsHide: true, timeout: 12_000, env: { ...process.env, ROTK_TPM_MESSAGE_B64: Buffer.from(nonce, "utf8").toString("base64") } },
    );
    const parsed = parseTpmSignOutput(stdout);
    if (parsed === null) return null;
    return { publicKey: parsed.publicKey, signature: parsed.signature, algo: "ecdsa-p256-sha256" };
  } catch {
    return null;
  }
}
