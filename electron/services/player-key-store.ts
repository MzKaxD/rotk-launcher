import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { isValidPlayerKey, normalizePlayerKey } from "../../shared/player-key.js";

interface StoredPlayerKey {
  schemaVersion: 1;
  encryptedKey: string;
}

export interface PlayerKeyEncryption {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

function isStoredPlayerKey(value: unknown): value is StoredPlayerKey {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StoredPlayerKey>;
  return candidate.schemaVersion === 1
    && typeof candidate.encryptedKey === "string"
    && candidate.encryptedKey.length > 0
    && /^[A-Za-z0-9+/]+={0,2}$/.test(candidate.encryptedKey);
}

/** Stores the website-issued bearer encrypted by Electron safeStorage/Windows DPAPI. */
export class PlayerKeyStore {
  constructor(
    private readonly path: string,
    private readonly encryption: PlayerKeyEncryption,
  ) {}

  async load(): Promise<string | null> {
    try {
      if (!this.encryption.isEncryptionAvailable()) return null;
      const parsed: unknown = JSON.parse(await readFile(this.path, "utf8"));
      if (!isStoredPlayerKey(parsed)) throw new Error("Invalid encrypted player key record");
      const encrypted = Buffer.from(parsed.encryptedKey, "base64");
      const playerKey = this.encryption.decryptString(encrypted);
      if (!isValidPlayerKey(playerKey)) throw new Error("Invalid decrypted player key");
      return normalizePlayerKey(playerKey);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      // A key that cannot be decrypted for this Windows account is unusable.
      // Delete it instead of repeatedly failing or falling back to plaintext.
      await rm(this.path, { force: true });
      return null;
    }
  }

  async save(value: unknown): Promise<string> {
    if (!isValidPlayerKey(value)) throw new Error("Invalid ROTK player key");
    if (!this.encryption.isEncryptionAvailable()) {
      throw new Error("Secure ROTK key storage is unavailable on this Windows account");
    }
    const playerKey = normalizePlayerKey(value);
    const stored: StoredPlayerKey = {
      schemaVersion: 1,
      encryptedKey: this.encryption.encryptString(playerKey).toString("base64"),
    };
    await mkdir(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(stored, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, this.path);
    return playerKey;
  }
}
