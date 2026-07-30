import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, copyFile, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join } from "node:path";

export const VIVOX_STOCK_V4_SHA256 =
  "d6915a466a905ae55f7e20019e01228c92cc86ce793a9fc050b49258a210c7b1";
export const VIVOX_STOCK_V5_SHA256 =
  "33a7f704eda23dda9ccbd9eba1fda2f0589211e9c61ec9d1f9c797acc624ea44";

async function sha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

/**
 * Installs ROTK's open-source compatibility layer and, when absent, a
 * separately provisioned official Vivox 5 runtime.
 */
export async function deployVivoxCompatibility(
  root: string,
  bundledProxyPath: string,
  bundledRuntimePath: string,
): Promise<void> {
  await access(bundledProxyPath, fsConstants.R_OK);
  const proxy = await stat(bundledProxyPath);
  if (!proxy.isFile() || proxy.size < 16_384 || proxy.size > 2 * 1024 * 1024) {
    throw new Error("Le proxy vocal ROTK embarqué est invalide.");
  }

  const activePath = join(root, "vivoxsdk_x64.dll");
  const backupPath = join(root, "vivoxsdk_x64.original.dll");
  const legacyBackupPath = join(root, "vivoxsdk_x64_original.dll");
  const v5Path = join(root, "vivoxsdk_x64_v5.dll");
  const active = await stat(activePath).catch(() => null);
  if (!active?.isFile()) throw new Error("Le SDK Vivox historique est introuvable.");
  const existingV5 = await stat(v5Path).catch(() => null);
  if (existingV5 === null) {
    await access(bundledRuntimePath, fsConstants.R_OK);
    const runtime = await stat(bundledRuntimePath);
    if (
      !runtime.isFile() ||
      await sha256(bundledRuntimePath) !== VIVOX_STOCK_V5_SHA256
    ) {
      throw new Error("Le runtime Vivox 5 embarqué est invalide.");
    }
    await copyFile(bundledRuntimePath, v5Path, fsConstants.COPYFILE_EXCL);
  }
  if (await sha256(v5Path).catch(() => "") !== VIVOX_STOCK_V5_SHA256) {
    throw new Error("La version Vivox 5 attendue est absente du client H1Z1.");
  }

  let backup = await stat(backupPath).catch(() => null);
  if (backup === null) {
    const legacyBackupHash = await sha256(legacyBackupPath).catch(() => "");
    if (legacyBackupHash === VIVOX_STOCK_V4_SHA256) {
      await copyFile(legacyBackupPath, backupPath, fsConstants.COPYFILE_EXCL);
      backup = await stat(backupPath);
    } else {
      if (await sha256(activePath) !== VIVOX_STOCK_V4_SHA256) {
        throw new Error("Le SDK Vivox actif est inconnu; vérifie les fichiers H1Z1.");
      }
      await copyFile(activePath, backupPath, fsConstants.COPYFILE_EXCL);
      backup = await stat(backupPath);
    }
  }
  if (!backup.isFile() || await sha256(backupPath) !== VIVOX_STOCK_V4_SHA256) {
    throw new Error("La sauvegarde du SDK Vivox historique est invalide.");
  }

  const proxyHash = await sha256(bundledProxyPath);
  await copyFile(bundledProxyPath, activePath);
  if (await sha256(activePath) !== proxyHash) {
    throw new Error("Le proxy vocal ROTK n'a pas été copié correctement.");
  }
}

export const vivoxClientInternals = { sha256 };
