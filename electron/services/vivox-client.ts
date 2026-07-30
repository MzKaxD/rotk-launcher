import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, stat } from "node:fs/promises";
import { join } from "node:path";

export const VIVOX_STOCK_V4_SHA256 =
  "d6915a466a905ae55f7e20019e01228c92cc86ce793a9fc050b49258a210c7b1";
export const VIVOX_STOCK_V5_SHA256 =
  "33a7f704eda23dda9ccbd9eba1fda2f0589211e9c61ec9d1f9c797acc624ea44";
export const VIVOX_PROXY_SHA256 =
  "8cd68ea6d42eb01971add31b942a47a60d89036a24b72e098a4a6af59895fba8";

interface VivoxDeploymentPolicy {
  stockV4Sha256: string;
  stockV5Sha256: string;
  proxySha256: string;
  proxyMinBytes: number;
  proxyMaxBytes: number;
}

const DEFAULT_POLICY: VivoxDeploymentPolicy = {
  stockV4Sha256: VIVOX_STOCK_V4_SHA256,
  stockV5Sha256: VIVOX_STOCK_V5_SHA256,
  proxySha256: VIVOX_PROXY_SHA256,
  proxyMinBytes: 16_384,
  proxyMaxBytes: 2 * 1024 * 1024,
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

async function assertBundledFiles(
  bundledProxyPath: string,
  bundledRuntimePath: string,
  policy: VivoxDeploymentPolicy,
): Promise<void> {
  const proxy = await stat(bundledProxyPath).catch(() => null);
  if (
    !proxy?.isFile() ||
    proxy.size < policy.proxyMinBytes ||
    proxy.size > policy.proxyMaxBytes ||
    await fileHash(bundledProxyPath) !== policy.proxySha256
  ) {
    throw new Error("Le proxy vocal ROTK embarqu\u00e9 est invalide.");
  }

  const runtime = await stat(bundledRuntimePath).catch(() => null);
  if (
    !runtime?.isFile() ||
    await fileHash(bundledRuntimePath) !== policy.stockV5Sha256
  ) {
    throw new Error("Le runtime Vivox 5 embarqu\u00e9 est invalide.");
  }
}

async function deployVivoxCompatibilityWithPolicy(
  root: string,
  bundledProxyPath: string,
  bundledRuntimePath: string,
  policy: VivoxDeploymentPolicy,
): Promise<void> {
  // Validate both bundled artifacts before modifying the game installation.
  await assertBundledFiles(bundledProxyPath, bundledRuntimePath, policy);

  const activePath = join(root, "vivoxsdk_x64.dll");
  const backupPath = join(root, "vivoxsdk_x64.original.dll");
  const legacyBackupPath = join(root, "vivoxsdk_x64_original.dll");
  const v5Path = join(root, "vivoxsdk_x64_v5.dll");

  const active = await stat(activePath).catch(() => null);
  if (!active?.isFile()) {
    throw new Error("Le SDK Vivox historique est introuvable.");
  }

  const activeHash = await fileHash(activePath);
  const backupHash = await fileHash(backupPath);

  if (backupHash !== policy.stockV4Sha256) {
    const legacyBackupHash = await fileHash(legacyBackupPath);
    if (legacyBackupHash === policy.stockV4Sha256) {
      await copyFile(legacyBackupPath, backupPath);
    } else if (activeHash === policy.stockV4Sha256) {
      await copyFile(activePath, backupPath);
    } else {
      throw new Error("La sauvegarde du SDK Vivox historique est invalide.");
    }
  }

  if (await fileHash(backupPath) !== policy.stockV4Sha256) {
    throw new Error("La sauvegarde du SDK Vivox historique est invalide.");
  }

  // Repair an absent, stale, or corrupt Vivox 5 runtime from the validated copy.
  if (await fileHash(v5Path) !== policy.stockV5Sha256) {
    await copyFile(bundledRuntimePath, v5Path);
  }
  if (await fileHash(v5Path) !== policy.stockV5Sha256) {
    throw new Error("La version Vivox 5 attendue est absente du client H1Z1.");
  }

  // Avoid rewriting the proxy on every launch, but always verify the final state.
  if (activeHash !== policy.proxySha256) {
    await copyFile(bundledProxyPath, activePath);
  }
  if (await fileHash(activePath) !== policy.proxySha256) {
    throw new Error("Le proxy vocal ROTK n'a pas \u00e9t\u00e9 copi\u00e9 correctement.");
  }
}

/**
 * Installs ROTK's open-source compatibility layer and repairs the separately
 * provisioned official Vivox 5 runtime when either client DLL is not current.
 */
export async function deployVivoxCompatibility(
  root: string,
  bundledProxyPath: string,
  bundledRuntimePath: string,
): Promise<void> {
  await deployVivoxCompatibilityWithPolicy(
    root,
    bundledProxyPath,
    bundledRuntimePath,
    DEFAULT_POLICY,
  );
}

export const vivoxClientInternals = {
  deployVivoxCompatibilityWithPolicy,
  sha256,
};
