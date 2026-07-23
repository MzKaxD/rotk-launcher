import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  pathPolicyInternals,
  resolvePhysicalPath,
  validateInstallDestination,
} from "../electron/services/path-policy.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("installation path policy", () => {
  it.each([
    ["E:\\Steam\\H1Z1", "steam"],
    ["E:\\SteamLibrary\\steamapps\\common\\H1Z1", "steamlibrary"],
    ["E:\\Games\\STEAMAPPS\\common\\H1Z1", "steamapps"],
    ["E:\\Games\\Live\\CoMmOn\\H1Z1", "common"],
  ])("rejects the forbidden segment in %s", async (candidate, forbiddenSegment) => {
    await expect(validateInstallDestination(candidate)).rejects.toMatchObject({
      name: "PathPolicyError",
      message: expect.stringContaining(forbiddenSegment),
    });
  });

  it("does not reject harmless substrings", () => {
    expect(pathPolicyInternals.hasForbiddenSegment("E:\\Games\\mySteamLibraryBackup\\ROTK")).toBeNull();
    expect(pathPolicyInternals.hasForbiddenSegment("E:\\Games\\uncommon\\ROTK")).toBeNull();
    expect(pathPolicyInternals.hasForbiddenSegment("E:\\Games\\steamapps-old\\ROTK")).toBeNull();
    expect(pathPolicyInternals.hasForbiddenSegment("E:\\Games\\steam-old\\ROTK")).toBeNull();
  });

  it("compares nested Windows paths case-insensitively", () => {
    expect(pathPolicyInternals.isSameOrNested("E:\\ROTK\\client", "e:\\rotk")).toBe(true);
    expect(pathPolicyInternals.isSameOrNested("E:\\ROTK-old", "E:\\ROTK")).toBe(false);
  });

  it("resolves a missing child through the deepest physical ancestor", async () => {
    const root = await mkdtemp(join(tmpdir(), "vitest-path-policy-"));
    temporaryRoots.push(root);
    const physical = join(root, "physical");
    const junction = join(root, "junction");
    await mkdir(physical);
    await symlink(physical, junction, "junction");

    const resolved = await resolvePhysicalPath(join(junction, "future", "client"));
    expect(resolved).toBe(join(await realpath(physical), "future", "client"));
  });

  it("rejects a destination that is itself a junction", async () => {
    const root = await mkdtemp(join(tmpdir(), "vitest-path-policy-"));
    temporaryRoots.push(root);
    const physical = join(root, "physical");
    const junction = join(root, "destination");
    await mkdir(physical);
    await symlink(physical, junction, "junction");

    await expect(validateInstallDestination(junction)).rejects.toMatchObject({
      name: "PathPolicyError",
      message: expect.stringContaining("jonction"),
    });
  });

  it("rejects alternate data streams instead of treating them as local folders", async () => {
    await expect(validateInstallDestination("E:\\ROTK\\client:payload")).rejects.toMatchObject({
      name: "PathPolicyError",
    });
  });
});
