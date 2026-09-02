import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  GAMEPLAY_PATCH_BYTES,
  GAMEPLAY_PATCH_FILE_NAME,
  GAMEPLAY_PATCH_SHA256,
  gameplayPatchInternals,
} from "../electron/services/gameplay-patch.js";

const workspaces: string[] = [];
const digest = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

async function fixture() {
  const workspace = await mkdtemp(join(tmpdir(), "rotk-gameplay-patch-"));
  workspaces.push(workspace);
  const root = join(workspace, "client");
  const bundled = join(workspace, "dinput8.dll");
  await mkdir(root);
  const h1z1 = "supported H1Z1";
  const patch = "official gameplay patch";
  await writeFile(join(root, "H1Z1.exe"), h1z1);
  await writeFile(bundled, patch);
  return {
    root,
    bundled,
    h1z1,
    patch,
    policy: {
      patchSha256: digest(patch),
      patchBytes: Buffer.byteLength(patch),
      h1z1Sha256: digest(h1z1),
      h1z1Bytes: Buffer.byteLength(h1z1),
    },
  };
}

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })));
});

describe("dedicated gameplay patch deployment", () => {
  it("installs idempotently and repairs a modified dinput8.dll", async () => {
    const value = await fixture();
    await gameplayPatchInternals.deployGameplayPatchWithPolicy(
      value.root,
      value.bundled,
      value.policy,
    );
    await gameplayPatchInternals.deployGameplayPatchWithPolicy(
      value.root,
      value.bundled,
      value.policy,
    );
    await writeFile(join(value.root, GAMEPLAY_PATCH_FILE_NAME), "tampered");
    await gameplayPatchInternals.deployGameplayPatchWithPolicy(
      value.root,
      value.bundled,
      value.policy,
    );
    await expect(readFile(
      join(value.root, GAMEPLAY_PATCH_FILE_NAME),
      "utf8",
    )).resolves.toBe(value.patch);
  });

  it("fails before mutation for an unsupported H1Z1 executable", async () => {
    const value = await fixture();
    const active = join(value.root, GAMEPLAY_PATCH_FILE_NAME);
    await writeFile(active, "keep me");
    await writeFile(join(value.root, "H1Z1.exe"), "unknown H1Z1");
    await expect(gameplayPatchInternals.deployGameplayPatchWithPolicy(
      value.root,
      value.bundled,
      value.policy,
    )).rejects.toThrow(/pas compatible/);
    await expect(readFile(active, "utf8")).resolves.toBe("keep me");
  });

  it("fails before mutation for a corrupt bundled patch", async () => {
    const value = await fixture();
    await writeFile(value.bundled, "corrupt");
    await expect(gameplayPatchInternals.deployGameplayPatchWithPolicy(
      value.root,
      value.bundled,
      value.policy,
    )).rejects.toThrow(/embarquée est invalide/);
    await expect(readFile(join(value.root, GAMEPLAY_PATCH_FILE_NAME)))
      .rejects.toThrow();
  });

  it("does not create or hide a synthetic dinput8 backup", async () => {
    const value = await fixture();
    const unexpectedBackup = join(value.root, "dinput8.original.dll");
    await writeFile(unexpectedBackup, "unknown executable");
    await gameplayPatchInternals.deployGameplayPatchWithPolicy(
      value.root,
      value.bundled,
      value.policy,
    );
    await expect(readFile(unexpectedBackup, "utf8"))
      .resolves.toBe("unknown executable");
  });

  it("pins the shipped artifact contract", async () => {
    const root = fileURLToPath(new URL("../", import.meta.url));
    const patchPath = join(root, "resources", "patches", "dinput8.dll");
    expect(await gameplayPatchInternals.sha256(patchPath))
      .toBe(GAMEPLAY_PATCH_SHA256);
    expect((await readFile(patchPath)).byteLength).toBe(GAMEPLAY_PATCH_BYTES);
  });
});
