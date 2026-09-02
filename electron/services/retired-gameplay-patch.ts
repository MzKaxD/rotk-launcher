import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, unlink } from "node:fs/promises";
import { join } from "node:path";

export const RETIRED_GAMEPLAY_PATCH_FILE_NAME = "dinput8.dll";
export const RETIRED_GAMEPLAY_PATCH_SHA256 =
  "307603aaebdebf52fa55ad0a7337abd785e5190d1bf71e07520240fed51fbd7a";
export const RETIRED_GAMEPLAY_PATCH_BYTES = 24_064;

const UNKNOWN_DINPUT_ERROR =
  "Un dinput8.dll inconnu est présent dans le client ROTK. Supprime-le ou réimporte un client propre.";
const REMOVE_DINPUT_ERROR =
  "Le patch gameplay retiré n’a pas pu être supprimé. Ferme H1Z1 puis réessaie.";

interface RetiredGameplayPatchPolicy {
  sha256: string;
  bytes: number;
}

const DEFAULT_POLICY: RetiredGameplayPatchPolicy = {
  sha256: RETIRED_GAMEPLAY_PATCH_SHA256,
  bytes: RETIRED_GAMEPLAY_PATCH_BYTES,
};

async function sha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

async function readEntry(filePath: string) {
  try {
    return await lstat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function removeRetiredGameplayPatchWithPolicy(
  root: string,
  policy: RetiredGameplayPatchPolicy,
): Promise<"absent" | "removed"> {
  const activePath = join(root, RETIRED_GAMEPLAY_PATCH_FILE_NAME);
  let entry;
  try {
    entry = await readEntry(activePath);
  } catch (error) {
    throw new Error(UNKNOWN_DINPUT_ERROR, { cause: error });
  }
  if (!entry) return "absent";

  // The supported stock client has no local dinput8.dll. Only remove the exact
  // ROTK 1.4.3 binary: links, directories and unknown/custom DLLs stay intact
  // and block launch so the launcher never destroys an unrelated file.
  let activeHash = "";
  if (entry.isFile() && !entry.isSymbolicLink() && entry.size === policy.bytes) {
    try {
      activeHash = await sha256(activePath);
    } catch (error) {
      throw new Error(UNKNOWN_DINPUT_ERROR, { cause: error });
    }
  }
  if (
    entry.isSymbolicLink()
    || !entry.isFile()
    || entry.size !== policy.bytes
    || activeHash !== policy.sha256
  ) {
    throw new Error(UNKNOWN_DINPUT_ERROR);
  }

  try {
    await unlink(activePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "absent";
    throw new Error(REMOVE_DINPUT_ERROR, { cause: error });
  }

  if (await readEntry(activePath)) {
    throw new Error(REMOVE_DINPUT_ERROR);
  }
  return "removed";
}

/**
 * Retires the crash-prone 1.4.3 DirectInput proxy before any attestation or
 * process spawn. This migration intentionally carries only the old binary's
 * digest and never bundles, repairs or loads a gameplay DLL.
 */
export async function removeRetiredGameplayPatch(
  root: string,
): Promise<"absent" | "removed"> {
  return removeRetiredGameplayPatchWithPolicy(root, DEFAULT_POLICY);
}

export const retiredGameplayPatchInternals = {
  removeRetiredGameplayPatchWithPolicy,
  sha256,
};
