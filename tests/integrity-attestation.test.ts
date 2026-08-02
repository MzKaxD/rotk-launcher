import { createHash, generateKeyPairSync, sign as signPayload } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { challengeSigningInput, computeAttestationEvidence, computeManifestRoot } from "../shared/attestation";
import {
  buildAttestationResult,
  integrityAttestationInternals,
  measureInstallation,
  requestAttestationChallenge,
} from "../electron/services/integrity-attestation";
import {
  isAttestationExcluded,
  mergeExpectedFiles,
  parseBaseManifest,
  readLauncherOverrides,
} from "../electron/services/base-manifest";

const LAUNCHER_VERSION = "1.4.0";
const CHALLENGE_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const PLAYER_KEY = "0123456789abcdef0123456789abcdef";
const ENDPOINT = "https://accounts.rotk.app/beginLauncherAttestation";

let workspace: string;
let installRoot: string;
let userData: string;

function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  return { privateKey, publicKeyRaw: spki.subarray(spki.length - 32).toString("base64url") };
}

function sha256(content: string) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

async function writeGameFile(relativePath: string, content: string) {
  const absolute = join(installRoot, ...relativePath.split("/"));
  await mkdir(join(absolute, ".."), { recursive: true });
  await writeFile(absolute, content, "utf8");
  return { path: relativePath, size: Buffer.byteLength(content), sha256: sha256(content) };
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "rotk-attest-"));
  installRoot = join(workspace, "game");
  userData = join(workspace, "userdata");
  await mkdir(installRoot, { recursive: true });
  await mkdir(userData, { recursive: true });
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("measureInstallation", () => {
  it("reports a clean installation with a root matching the expected manifest", async () => {
    const expected = [
      await writeGameFile("H1Z1.exe", "executable bytes"),
      await writeGameFile("Resources/Assets/assets_x64_0.pack2", "smoke and world assets"),
    ];
    const measurement = await measureInstallation({ installationRoot: installRoot, userDataDirectory: userData, expected });

    expect(measurement.deviations).toEqual([]);
    expect(measurement.fileCount).toBe(2);
    expect(measurement.root).toBe(computeManifestRoot(expected));
  });

  it("detects a deleted smoke asset — the exact cheat this defends against", async () => {
    const kept = await writeGameFile("H1Z1.exe", "executable bytes");
    const smoke = { path: "Resources/Assets/assets_smoke.pack2", size: 21, sha256: sha256("smoke effects file") };
    // The file is declared by the manifest but never written: the player removed it.
    const measurement = await measureInstallation({
      installationRoot: installRoot,
      userDataDirectory: userData,
      expected: [kept, smoke],
    });

    expect(measurement.deviations).toEqual([
      { path: "Resources/Assets/assets_smoke.pack2", kind: "missing", observedSha256: null },
    ]);
    expect(measurement.root).not.toBe(computeManifestRoot([kept, smoke]));
  });

  it("detects an altered file and reports the observed digest", async () => {
    const declared = await writeGameFile("Resources/Assets/assets_x64_0.pack2", "original contents");
    const tampered = { ...declared, sha256: sha256("what the manifest expected") };
    const measurement = await measureInstallation({
      installationRoot: installRoot,
      userDataDirectory: userData,
      expected: [tampered],
    });

    expect(measurement.deviations).toEqual([
      { path: "Resources/Assets/assets_x64_0.pack2", kind: "mismatch", observedSha256: declared.sha256 },
    ]);
  });

  it("reports files that no manifest declares", async () => {
    const declared = await writeGameFile("H1Z1.exe", "executable");
    await writeGameFile("Resources/Assets/injected.pack2", "added by the player");
    const measurement = await measureInstallation({
      installationRoot: installRoot,
      userDataDirectory: userData,
      expected: [declared],
      unexpectedPaths: ["Resources/Assets/injected.pack2"],
    });

    expect(measurement.deviations).toEqual([
      { path: "Resources/Assets/injected.pack2", kind: "unexpected", observedSha256: sha256("added by the player") },
    ]);
  });

  it("discovers undeclared content by walking the tree", async () => {
    const declared = await writeGameFile("H1Z1.exe", "executable");
    await writeGameFile("Resources/Assets/injected.pack2", "smuggled content");
    await writeGameFile("Resources/Assets/cheat.dll", "code");
    const measurement = await measureInstallation({
      installationRoot: installRoot,
      userDataDirectory: userData,
      expected: [declared],
      detectUnexpected: true,
    });

    expect(measurement.deviations.map((deviation) => deviation.path).sort()).toEqual([
      "Resources/Assets/cheat.dll",
      "Resources/Assets/injected.pack2",
    ]);
    expect(measurement.deviations.every((deviation) => deviation.kind === "unexpected")).toBe(true);
  });

  it("does not flag per-player settings, logs or uninteresting extensions", async () => {
    const declared = await writeGameFile("H1Z1.exe", "executable");
    // Legitimately present and legitimately undeclared.
    await writeGameFile("UserOptions.ini", "[Display]\nGamma=1");
    await writeGameFile("InputProfile_User.xml", "<Profile/>");
    await writeGameFile("Logs/ClientItemsInfo.log", "noise");
    await writeGameFile("BattlEye/BEClient_x64.dll", "battleye updates itself");
    await writeGameFile("readme.txt", "harmless");

    const measurement = await measureInstallation({
      installationRoot: installRoot,
      userDataDirectory: userData,
      expected: [declared],
      detectUnexpected: true,
    });
    expect(measurement.deviations).toEqual([]);
  });

  it("caches digests across runs and still produces the same root", async () => {
    const expected = [await writeGameFile("Resources/Assets/big.pack2", "expensive to hash")];
    const first = await measureInstallation({ installationRoot: installRoot, userDataDirectory: userData, expected });
    const cache = await integrityAttestationInternals.loadCache(userData);
    expect(cache.size).toBe(1);

    const second = await measureInstallation({ installationRoot: installRoot, userDataDirectory: userData, expected });
    expect(second.root).toBe(first.root);
    expect(second.deviations).toEqual([]);
  });

  it("does not let a stale cache entry mask a modified file", async () => {
    const declared = await writeGameFile("Resources/Assets/a.pack2", "original");
    await measureInstallation({ installationRoot: installRoot, userDataDirectory: userData, expected: [declared] });

    // Rewrite with different content and length: size alone invalidates the entry.
    await writeFile(join(installRoot, "Resources", "Assets", "a.pack2"), "tampered contents", "utf8");
    const measurement = await measureInstallation({
      installationRoot: installRoot,
      userDataDirectory: userData,
      expected: [declared],
    });
    expect(measurement.deviations[0]?.kind).toBe("mismatch");
  });

  it("reports progress while measuring", async () => {
    const expected = [await writeGameFile("H1Z1.exe", "bytes")];
    const phases: string[] = [];
    await measureInstallation({
      installationRoot: installRoot,
      userDataDirectory: userData,
      expected,
      onProgress: (progress) => phases.push(progress.phase),
    });
    expect(phases[0]).toBe("measuring");
    expect(phases.at(-1)).toBe("done");
  });
});

describe("challenge handling", () => {
  it("accepts a challenge signed by a trusted key", async () => {
    const { privateKey, publicKeyRaw } = keyPair();
    const challenge = {
      challengeId: CHALLENGE_ID,
      nonce: "dGVzdC1ub25jZS0xMjM0NTY3ODkw",
      policyVersion: "2026.08.01-1",
      packVersion: "1.1.0",
      baseBuildId: "1.0.326.439939",
      minLauncherVersion: "1.4.0",
      expiresAt: "2026-08-01T00:15:00.000Z",
      keyId: "test-key",
    };
    const signature = signPayload(
      null,
      Buffer.from(challengeSigningInput(challenge), "utf8"),
      privateKey,
    ).toString("base64url");
    const fetchImpl = (async () => new Response(
      JSON.stringify({ ok: true, ...challenge, signature }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;

    const parsed = await requestAttestationChallenge(PLAYER_KEY, ENDPOINT, LAUNCHER_VERSION, {
      fetchImpl,
      trustedKeys: { "test-key": publicKeyRaw },
    });
    expect(parsed.challengeId).toBe(CHALLENGE_ID);
    expect(parsed.nonce).toBe(challenge.nonce);
  });

  it("refuses a challenge signed by an untrusted key — a spoofed backend cannot steer measurement", async () => {
    const { privateKey } = keyPair();
    const challenge = {
      challengeId: CHALLENGE_ID,
      nonce: "dGVzdC1ub25jZS0xMjM0NTY3ODkw",
      policyVersion: "2026.08.01-1",
      packVersion: "1.1.0",
      baseBuildId: "1.0.326.439939",
      minLauncherVersion: "1.4.0",
      expiresAt: "2026-08-01T00:15:00.000Z",
      keyId: "test-key",
    };
    const signature = signPayload(
      null,
      Buffer.from(challengeSigningInput(challenge), "utf8"),
      privateKey,
    ).toString("base64url");
    const fetchImpl = (async () => new Response(
      JSON.stringify({ ok: true, ...challenge, signature }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;

    await expect(
      requestAttestationChallenge(PLAYER_KEY, ENDPOINT, LAUNCHER_VERSION, {
        fetchImpl,
        trustedKeys: { "test-key": keyPair().publicKeyRaw },
      }),
    ).rejects.toThrow(/not signed by a trusted key/);
    // No key shipped in the pinned table yet: the default path also fails closed.
    await expect(
      requestAttestationChallenge(PLAYER_KEY, ENDPOINT, LAUNCHER_VERSION, { fetchImpl }),
    ).rejects.toThrow(/not signed by a trusted key/);
  });

  it("rejects an unsigned or malformed challenge", async () => {
    const fetchImpl = (async () => new Response(
      JSON.stringify({ ok: true, challengeId: CHALLENGE_ID }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;
    await expect(
      requestAttestationChallenge(PLAYER_KEY, ENDPOINT, LAUNCHER_VERSION, { fetchImpl }),
    ).rejects.toThrow(/Invalid attestation challenge/);
  });

  it("maps service errors to actionable messages", async () => {
    const errorFetch = (code: string) => (async () => new Response(
      JSON.stringify({ ok: false, error: code }),
      { status: 401, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;
    await expect(
      requestAttestationChallenge(PLAYER_KEY, ENDPOINT, LAUNCHER_VERSION, { fetchImpl: errorFetch("invalid_credentials") }),
    ).rejects.toThrow(/launcher key was rejected/);
    await expect(
      requestAttestationChallenge(PLAYER_KEY, ENDPOINT, LAUNCHER_VERSION, { fetchImpl: errorFetch("policy_unavailable") }),
    ).rejects.toThrow(/no published integrity policy/);
  });

  it("refuses non-HTTPS endpoints", async () => {
    await expect(
      requestAttestationChallenge(PLAYER_KEY, "http://accounts.rotk.app/x", LAUNCHER_VERSION),
    ).rejects.toThrow(/Invalid ROTK attestation endpoint/);
  });
});

describe("buildAttestationResult", () => {
  it("binds the measurement to the challenge nonce", async () => {
    const expected = [await writeGameFile("H1Z1.exe", "bytes")];
    const measurement = await measureInstallation({ installationRoot: installRoot, userDataDirectory: userData, expected });
    const challenge = {
      challengeId: CHALLENGE_ID,
      nonce: "dGVzdC1ub25jZS0xMjM0NTY3ODkw",
      policyVersion: "2026.08.01-1",
      packVersion: "1.1.0",
      baseBuildId: "1.0.326.439939",
      minLauncherVersion: "1.4.0",
      expiresAt: "2026-08-01T00:15:00.000Z",
      keyId: "test-key",
      signature: "unused-here",
    };
    const result = buildAttestationResult(challenge, measurement, LAUNCHER_VERSION);

    expect(result.evidence).toBe(computeAttestationEvidence(challenge.nonce, measurement.root));
    expect(result.claim).toEqual({
      policyVersion: "2026.08.01-1",
      packVersion: "1.1.0",
      baseBuildId: "1.0.326.439939",
      launcherVersion: LAUNCHER_VERSION,
      fileCount: 1,
      totalBytes: measurement.totalBytes,
    });
    // A different nonce yields different evidence: replay is worthless.
    expect(buildAttestationResult({ ...challenge, nonce: "YW5vdGhlci1ub25jZS0xMjM0NQ" }, measurement, LAUNCHER_VERSION).evidence)
      .not.toBe(result.evidence);
  });
});

describe("expected-file merge", () => {
  it("layers assets over the base tree and drops per-player and launcher-rewritten files", () => {
    const base = [
      { path: "H1Z1.exe", size: 1, sha256: "a".repeat(64) },
      { path: "ClientConfig.ini", size: 2, sha256: "b".repeat(64) },
      { path: "Resources/Assets/a.pack2", size: 3, sha256: "c".repeat(64) },
    ];
    const assets = [{ path: "Resources/Assets/a.pack2", size: 4, sha256: "d".repeat(64) }];
    const merged = mergeExpectedFiles(base, assets);

    expect(merged.map((entry) => entry.path).sort()).toEqual(["H1Z1.exe", "Resources/Assets/a.pack2"]);
    // An asset legitimately replaces its base counterpart.
    expect(merged.find((entry) => entry.path === "Resources/Assets/a.pack2")?.sha256).toBe("d".repeat(64));
  });

  it("excludes every file that legitimately differs between honest players", () => {
    // These are written by the game per player; attesting them would reject
    // everyone who ever changed a graphics setting or a keybind.
    for (const path of [
      "UserOptions.ini",
      "InputProfile_User.xml",
      "ClientConfig.ini",
      "steam_persona_name.txt",
      ".rotk-installation.json",
      "ClientConfig.original.ini",
      "steam_api64.original.dll",
      "vivoxsdk_x64.original.dll",
      "BattlEye/BEClient_x64.cfg",
      "Logs/ClientItemsInfo.log",
      "logs/anything.txt",
    ]) {
      expect(isAttestationExcluded(path)).toBe(true);
    }
  });

  it("never excludes gameplay content or the shim it protects", () => {
    for (const path of [
      "H1Z1.exe",
      "steam_api64.dll",
      "Resources/Assets/assets_x64_0.pack2",
      "Resources/Assets/ui_x64_4.pack2",
      "vivoxsdk_x64.dll",
      "vivoxsdk_x64_v5.dll",
    ]) {
      expect(isAttestationExcluded(path)).toBe(false);
    }
  });

  it("matches case-insensitively, as Windows paths do", () => {
    expect(isAttestationExcluded("USEROPTIONS.INI")).toBe(true);
    expect(isAttestationExcluded("battleye/BEClient_x64.dll")).toBe(true);
  });

  it("expects the launcher artifact for a file it replaces, not the vanilla one", async () => {
    // steam_api64.dll is swapped for the ROTK shim and vivoxsdk_x64.dll for
    // the ROTK voice proxy: after exclusions those (plus the added Vivox 5
    // runtime below) are the only content differences between a vanilla and a
    // ROTK install, so they must be attested as overrides.
    const shim = "d".repeat(64);
    const base = [
      { path: "steam_api64.dll", size: 235_600, sha256: "a".repeat(64) },
      { path: "H1Z1.exe", size: 1, sha256: "b".repeat(64) },
    ];
    const merged = mergeExpectedFiles(base, [], [{ path: "steam_api64.dll", size: 221_696, sha256: shim }]);

    expect(merged.find((entry) => entry.path === "steam_api64.dll")?.sha256).toBe(shim);
    expect(merged).toHaveLength(2);
  });

  it("accepts an override for a file the launcher adds without a vanilla counterpart", async () => {
    // vivoxsdk_x64_v5.dll only exists on a ROTK install: the override both
    // declares it (so it is not reported as unexpected) and pins its hash.
    const runtime = "e".repeat(64);
    const base = [{ path: "H1Z1.exe", size: 1, sha256: "b".repeat(64) }];
    const merged = mergeExpectedFiles(base, [], [{ path: "vivoxsdk_x64_v5.dll", size: 5_248_968, sha256: runtime }]);

    expect(merged.find((entry) => entry.path === "vivoxsdk_x64_v5.dll")?.sha256).toBe(runtime);
    expect(merged).toHaveLength(2);
  });

  it("reads override hashes from the shipped sha256 sidecars", async () => {
    const dll = join(workspace, "steam_api64.dll");
    await writeFile(dll, "shim bytes", "utf8");
    await writeFile(`${dll}.sha256`, `${sha256("shim bytes")} *steam_api64.dll\n`, "utf8");

    const overrides = await readLauncherOverrides([{ installPath: "steam_api64.dll", bundledPath: dll }]);
    expect(overrides).toEqual([
      { path: "steam_api64.dll", size: Buffer.byteLength("shim bytes"), sha256: sha256("shim bytes") },
    ]);
  });

  it("yields no override when the sidecar is missing or malformed", async () => {
    const dll = join(workspace, "vivoxsdk_x64.dll");
    await writeFile(dll, "bytes", "utf8");
    // No sidecar: the file falls back to the vanilla hash and surfaces as a
    // deviation — visible and safe, never silently trusted.
    expect(await readLauncherOverrides([{ installPath: "vivoxsdk_x64.dll", bundledPath: dll }])).toEqual([]);

    await writeFile(`${dll}.sha256`, "not-a-digest\n", "utf8");
    expect(await readLauncherOverrides([{ installPath: "vivoxsdk_x64.dll", bundledPath: dll }])).toEqual([]);
  });
});

describe("parseBaseManifest", () => {
  it("rejects an unsigned manifest", () => {
    expect(() => parseBaseManifest({
      schemaVersion: 1,
      kind: "base-game",
      buildId: "1.0.326.439939",
      root: "a".repeat(64),
      issuedAt: "2026-08-01T00:00:00.000Z",
      keyId: "unknown-key",
      signature: "a".repeat(86),
      files: [{ path: "H1Z1.exe", size: 1, sha256: "b".repeat(64) }],
    })).toThrow(/signature non reconnue/);
  });

  it("rejects structural problems before looking at the signature", () => {
    expect(() => parseBaseManifest({ schemaVersion: 2 })).toThrow(/version non prise en charge/);
    expect(() => parseBaseManifest({ schemaVersion: 1, kind: "other" })).toThrow(/type inattendu/);
    expect(() => parseBaseManifest({
      schemaVersion: 1,
      kind: "base-game",
      buildId: "x",
      root: "a".repeat(64),
      issuedAt: "now",
      keyId: "k",
      signature: "s",
      files: [{ path: "../escape", size: 1, sha256: "b".repeat(64) }],
    })).toThrow(/chemin invalide/);
  });
});
