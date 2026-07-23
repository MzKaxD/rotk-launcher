import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { PlayerKeyStore, type PlayerKeyEncryption } from "../electron/services/player-key-store.js";

const temporaryDirectories: string[] = [];
const launcherKey = "0123456789abcdef0123456789abcdef";

const encryption: PlayerKeyEncryption = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from([...Buffer.from(value, "utf8")].map((byte) => byte ^ 0xa5)),
  decryptString: (value) => Buffer.from([...value].map((byte) => byte ^ 0xa5)).toString("utf8"),
};

async function temporaryPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "rotk-key-store-"));
  temporaryDirectories.push(directory);
  return join(directory, "player-key.v1.json");
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("PlayerKeyStore", () => {
  it("persists the website key only as encrypted data and restores it", async () => {
    const path = await temporaryPath();
    const store = new PlayerKeyStore(path, encryption);

    await store.save(launcherKey);
    const serialized = await readFile(path, "utf8");

    expect(serialized).not.toContain(launcherKey);
    await expect(new PlayerKeyStore(path, encryption).load()).resolves.toBe(launcherKey);
  });

  it("refuses plaintext fallback when secure storage is unavailable", async () => {
    const path = await temporaryPath();
    const unavailable = new PlayerKeyStore(path, {
      ...encryption,
      isEncryptionAvailable: () => false,
    });

    await expect(unavailable.save(launcherKey))
      .rejects.toThrow("Secure ROTK key storage is unavailable");
  });
});
