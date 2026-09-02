import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  RETIRED_GAMEPLAY_PATCH_BYTES,
  RETIRED_GAMEPLAY_PATCH_FILE_NAME,
  RETIRED_GAMEPLAY_PATCH_SHA256,
  removeRetiredGameplayPatch,
  retiredGameplayPatchInternals,
} from "../electron/services/retired-gameplay-patch.js";

const workspaces: string[] = [];
const digest = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "rotk-retired-gameplay-patch-"));
  workspaces.push(root);
  const retiredPatch = "released gameplay patch fixture";
  return {
    root,
    activePath: join(root, RETIRED_GAMEPLAY_PATCH_FILE_NAME),
    retiredPatch,
    policy: {
      sha256: digest(retiredPatch),
      bytes: Buffer.byteLength(retiredPatch),
    },
  };
}

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })));
});

describe("retired gameplay patch cleanup", () => {
  it("removes the exact retired DLL and is idempotent", async () => {
    const value = await fixture();
    await writeFile(value.activePath, value.retiredPatch);

    await expect(
      retiredGameplayPatchInternals.removeRetiredGameplayPatchWithPolicy(
        value.root,
        value.policy,
      ),
    ).resolves.toBe("removed");
    await expect(stat(value.activePath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      retiredGameplayPatchInternals.removeRetiredGameplayPatchWithPolicy(
        value.root,
        value.policy,
      ),
    ).resolves.toBe("absent");
  });

  it("leaves an unknown same-size dinput8.dll untouched and blocks", async () => {
    const value = await fixture();
    const unknown = "x".repeat(value.policy.bytes);
    await writeFile(value.activePath, unknown);

    await expect(
      retiredGameplayPatchInternals.removeRetiredGameplayPatchWithPolicy(
        value.root,
        value.policy,
      ),
    ).rejects.toThrow(/dinput8[.]dll inconnu/);
    await expect(readFile(value.activePath, "utf8")).resolves.toBe(unknown);
  });

  it("leaves a non-file dinput8.dll untouched and blocks", async () => {
    const value = await fixture();
    await mkdir(value.activePath);

    await expect(
      retiredGameplayPatchInternals.removeRetiredGameplayPatchWithPolicy(
        value.root,
        value.policy,
      ),
    ).rejects.toThrow(/dinput8[.]dll inconnu/);
    await expect(stat(value.activePath).then((entry) => entry.isDirectory()))
      .resolves.toBe(true);
  });

  it("pins the removed production artifact without bundling it", async () => {
    expect(RETIRED_GAMEPLAY_PATCH_SHA256).toBe(
      "307603aaebdebf52fa55ad0a7337abd785e5190d1bf71e07520240fed51fbd7a",
    );
    expect(RETIRED_GAMEPLAY_PATCH_BYTES).toBe(24_064);

    const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
    await expect(stat(join(repositoryRoot, "resources", "patches", "dinput8.dll")))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(removeRetiredGameplayPatch(join(repositoryRoot, "resources", "patches")))
      .resolves.toBe("absent");
  });
});
