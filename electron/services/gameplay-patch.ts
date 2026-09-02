import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants, createReadStream } from "node:fs";
import { copyFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { SUPPORTED_CLIENT_BUILDS } from "./client-build.js";

export const GAMEPLAY_PATCH_SHA256 =
  "307603aaebdebf52fa55ad0a7337abd785e5190d1bf71e07520240fed51fbd7a";
export const GAMEPLAY_PATCH_BYTES = 24_064;
export const GAMEPLAY_PATCH_FILE_NAME = "dinput8.dll";

const GAMEPLAY_PATCH_CLIENT_BUILD_ID = "h1z1-1.0.326.439939";
const GAMEPLAY_PATCH_CLIENT_BUILD = SUPPORTED_CLIENT_BUILDS.find(
  (build) => build.id === GAMEPLAY_PATCH_CLIENT_BUILD_ID,
);
if (!GAMEPLAY_PATCH_CLIENT_BUILD) {
  throw new Error("The gameplay patch has no matching supported H1Z1 build");
}

interface GameplayPatchDeploymentPolicy {
  patchSha256: string;
  patchBytes: number;
  h1z1Sha256: string;
  h1z1Bytes: number;
}

const DEFAULT_POLICY: GameplayPatchDeploymentPolicy = {
  patchSha256: GAMEPLAY_PATCH_SHA256,
  patchBytes: GAMEPLAY_PATCH_BYTES,
  h1z1Sha256: GAMEPLAY_PATCH_CLIENT_BUILD.executableSha256,
  h1z1Bytes: GAMEPLAY_PATCH_CLIENT_BUILD.executableSize,
};

async function sha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

async function fileHash(filePath: string): Promise<string> {
  return sha256(filePath).catch(() => "");
}

async function atomicCopy(source: string, destination: string): Promise<void> {
  const temporary = `${destination}.rotk-${randomUUID()}.tmp`;
  try {
    await copyFile(source, temporary, fsConstants.COPYFILE_EXCL);
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function assertSupportedH1Z1(
  root: string,
  policy: GameplayPatchDeploymentPolicy,
): Promise<void> {
  const executablePath = join(root, "H1Z1.exe");
  const executable = await stat(executablePath).catch(() => null);
  if (
    !executable?.isFile() ||
    executable.size !== policy.h1z1Bytes ||
    await fileHash(executablePath) !== policy.h1z1Sha256
  ) {
    throw new Error(
      "Cette version de H1Z1 n’est pas compatible avec le patch de gameplay ROTK obligatoire. Vérifie les fichiers du jeu dans Steam puis réessaie.",
    );
  }
}

async function assertBundledPatch(
  bundledPatchPath: string,
  policy: GameplayPatchDeploymentPolicy,
): Promise<void> {
  const patch = await stat(bundledPatchPath).catch(() => null);
  if (
    !patch?.isFile() ||
    patch.size !== policy.patchBytes ||
    await fileHash(bundledPatchPath) !== policy.patchSha256
  ) {
    throw new Error("La DLL de gameplay ROTK embarquée est invalide.");
  }
}

async function deployGameplayPatchWithPolicy(
  root: string,
  bundledPatchPath: string,
  policy: GameplayPatchDeploymentPolicy,
): Promise<void> {
  // Validate both immutable inputs before touching the installation. The DLL
  // also checks the mapped PE and all hook signatures before any runtime write.
  await assertBundledPatch(bundledPatchPath, policy);
  await assertSupportedH1Z1(root, policy);

  const activePath = join(root, GAMEPLAY_PATCH_FILE_NAME);
  if (await fileHash(activePath) !== policy.patchSha256) {
    await atomicCopy(bundledPatchPath, activePath);
  }
  if (await fileHash(activePath) !== policy.patchSha256) {
    throw new Error(
      "Le patch de gameplay ROTK obligatoire n'a pas été copié correctement.",
    );
  }
}

/**
 * Repairs the dedicated gameplay DLL on every install, adoption and launch.
 * No dinput8 backup is created: the supported vanilla client has no local
 * dinput8.dll, and an unexpected dinput8.original.dll must remain attestable.
 */
export async function deployGameplayPatch(
  root: string,
  bundledPatchPath: string,
): Promise<void> {
  await deployGameplayPatchWithPolicy(root, bundledPatchPath, DEFAULT_POLICY);
}

export const gameplayPatchInternals = {
  deployGameplayPatchWithPolicy,
  sha256,
};
