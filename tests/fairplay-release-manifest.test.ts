import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { appendFile, copyFile, link, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);
const { createPackage } = require("@electron/asar");
const { flipFuses, FuseVersion, FuseV1Options } = require("@electron/fuses");
const { createReleaseManifest, verifyPackagedFuses } = require("../scripts/fairplay-release-manifest.cjs");
let folder: string;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
beforeAll(async () => { folder = await mkdtemp(join(tmpdir(), "rotk-release-manifest-")); });
afterAll(async () => { if (folder) await rm(folder, { recursive: true, force: true }); });

describe("final release manifest", () => {
  it("rejects invented game provenance and unsupported schema content", async () => {
    const basic = { packageDir: "unused", label: "release candidate", gameVersion: "1.0.326.439939", output: "unused.json" };
    await expect(createReleaseManifest({ ...basic, gameSha256: "a".repeat(64) })).rejects.toThrow("provenance");
    await expect(createReleaseManifest({ ...basic, gamePath: "game.exe", gameSha256: "a".repeat(64) })).rejects.toThrow("exactly one");
    await expect(createReleaseManifest({ ...basic, gamePath: "game.exe", label: "a".repeat(81) })).rejects.toThrow("3..80");
  });
  it("hashes actual final package files, verifies real fuse bits and refuses agent drift", async () => {
    const packageDir = join(folder, "package"), source = join(folder, "asar-source");
    const pinDirectory = join(source, "dist-electron", "electron", "services");
    await mkdir(pinDirectory, { recursive: true });
    const agentDir = join(packageDir, "resources", "fairplay"); await mkdir(agentDir, { recursive: true });
    await writeFile(join(source, "package.json"), JSON.stringify({ name: "rotk-launcher", version: "1.4.5" }));
    await writeFile(join(pinDirectory, "fairplay-release.js"), `export const FAIRPLAY_VERSION = "0.2.0"; export const FAIRPLAY_SHA256 = "${digest("agent fixture")}";`);
    await createPackage(source, join(packageDir, "resources", "app.asar"));
    await writeFile(join(agentDir, "FairPlay.exe"), "agent fixture");
    await writeFile(join(agentDir, "FairPlay.exe.sha256"), `${digest("agent fixture")}  FairPlay.exe\n`);
    const executable = join(packageDir, "ROTK Launcher.exe");
    // Copy and read the installed trusted Electron template; never execute it.
    await copyFile(join(dirname(require.resolve("electron/package.json")), "dist", "electron.exe"), executable);
    await expect(verifyPackagedFuses(executable)).rejects.toThrow("not hardened");
    await flipFuses(executable, { version: FuseVersion.V1, [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false, [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true, [FuseV1Options.OnlyLoadAppFromAsar]: true });
    await expect(verifyPackagedFuses(executable)).resolves.toBeDefined();
    const game = join(folder, "H1Z1.exe"); await writeFile(game, "game fixture");
    const options = { packageDir, gamePath: game, gameVersion: "1.0.326.439939", label: "test candidate", output: join(folder, "release.json") };
    const first = await createReleaseManifest(options);
    expect(Object.keys(first.manifest).sort()).toEqual(["schemaVersion", "label", "gameVersion", "launcherVersion", "agentVersion", "hashes"].sort());
    expect(first.manifest.hashes.gameSha256).toBe(digest("game fixture"));
    expect(Object.keys(first.manifest.hashes).sort()).toEqual(["gameSha256", "launcherSha256", "launcherAsarSha256", "agentSha256"].sort());
    expect(await readFile(options.output, "utf8")).not.toContain(folder);
    await expect(createReleaseManifest({ ...options, output: join(packageDir, "manifest.json") })).rejects.toThrow("outside the packaged");
    const linkedOutput = join(folder, "linked-output.json");
    await link(executable, linkedOutput);
    await expect(createReleaseManifest({ ...options, output: linkedOutput })).rejects.toThrow("never symbolic or hard links");
    await unlink(linkedOutput);
    await appendFile(executable, "post-signing-byte-change");
    const second = await createReleaseManifest(options);
    expect(second.manifest.hashes.launcherSha256).not.toBe(first.manifest.hashes.launcherSha256);
    expect(second.manifest.hashes.launcherAsarSha256).toBe(first.manifest.hashes.launcherAsarSha256);
    await writeFile(join(agentDir, "FairPlay.exe"), "unexpected post-stage bytes");
    await expect(createReleaseManifest(options)).rejects.toThrow("compiled pin");
  }, 60_000);
});
