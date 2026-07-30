import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, copyFile, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join } from "node:path";

export const VIVOX_STOCK_V4_SHA256 =
  "d6915a466a905ae55f7e20019e01228c92cc86ce793a9fc050b49258a210c7b1";
export const VIVOX_STOCK_V5_SHA256 =
  "33a7f704eda23dda9ccbd9eba1fda2f0589211e9c61ec9d1f9c797f2dcbf65f9";

async function sha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

/**
 * Installs only ROTK's open-source compatibility layer. The official Vivox 5
 * SDK must already exist in the supported H1Z1 client.
 */
export async function deployVivoxCompatibility(
  root: string,
  bundledProxyPath: string,
): Promise<void> {
  await access(bundledProxyPath, fsConstants.R_OK);
  const proxy = await stat(bundledProxyPath);
  if (!proxy.isFile() || proxy.size < 16_384 || proxy.size > 2 * 1024 * 1024) {
    throw new Error("Le proxy vocal ROTK embarqué est invalide.");
  }

  const activePath = join(root, "vivoxsdk_x64.dll");
  const backupPath = join(root, "vivoxsdk_x64.original.dll");
  const v5Path = join(root, "vivoxsdk_x64_v5.dll");
  const active = await stat(activePath).catch(() => null);
  if (!active?.isFile()) throw new Error("Le SDK Vivox historique est introuvable.");
  if (await sha256(v5Path).catch(() => "") !== VIVOX_STOCK_V5_SHA256) {
    throw new Error("La version Vivox 5 attendue est absente du client H1Z1.");
  }

  const backup = await stat(backupPath).catch(() => null);
  if (backup === null) {
    if (await sha256(activePath) !== VIVOX_STOCK_V4_SHA256) {
      throw new Error("Le SDK Vivox actif est inconnu; vérifie les fichiers H1Z1.");
    }
    await copyFile(activePath, backupPath, fsConstants.COPYFILE_EXCL);
  } else if (!backup.isFile() || await sha256(backupPath) !== VIVOX_STOCK_V4_SHA256) {
    throw new Error("La sauvegarde du SDK Vivox historique est invalide.");
  }

  const proxyHash = await sha256(bundledProxyPath);
  await copyFile(bundledProxyPath, activePath);
  if (await sha256(activePath) !== proxyHash) {
    throw new Error("Le proxy vocal ROTK n'a pas été copié correctement.");
  }
}

export const vivoxClientInternals = { sha256 };
