import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FAIRPLAY_TERMS_VERSION, isCurrentTermsAcceptance } from "../shared/fairplay-terms.js";
import { FairPlayTermsStore } from "../electron/services/fairplay-terms-store.js";

const directories: string[] = [];
const origin = "https://rotk.app", key = "b".repeat(32);
async function fixture() { const path = await mkdtemp(join(tmpdir(), "rotk-terms-")); directories.push(path); return { path, store: new FairPlayTermsStore(path) }; }
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe("explicit, account-scoped Anti-Cheat conditions", () => {
  it("starts without an agreement and persists only an explicit current acceptance", async () => {
    const { path, store } = await fixture();
    expect(await store.get(origin, key)).toBeNull();
    for (const invalid of [undefined, true, "", "2026-09-07.1"]) await expect(store.accept(origin, key, invalid)).rejects.toThrow("current");
    expect(await store.get(origin, key)).toBeNull();
    const receipt = await store.accept(origin, key, FAIRPLAY_TERMS_VERSION);
    expect(isCurrentTermsAcceptance(receipt)).toBe(true);
    expect(await new FairPlayTermsStore(path).get(origin, key)).toEqual(receipt);
    const saved = await readFile(join(path, "anti-cheat-terms.v1.json"), "utf8");
    expect(saved).not.toContain(key);
    expect(saved).not.toContain(origin);
    expect(saved.length).toBeLessThan(4096);
  });
  it("does not transfer permission to another account, service or changed document", async () => {
    const { path, store } = await fixture();
    await store.accept(origin, key, FAIRPLAY_TERMS_VERSION);
    expect(await store.get(origin, "c".repeat(32))).toBeNull();
    expect(await store.get("https://test.rotk.app", key)).toBeNull();
    const file = join(path, "anti-cheat-terms.v1.json");
    const original = JSON.parse(await readFile(file, "utf8"));
    for (const change of [{ version: "2026-09-07.1" }, { documentSha256: "0".repeat(64) }, { acceptedAt: "never" }, { acceptedAt: "2026-02-30T00:00:00.000Z" }]) {
      await writeFile(file, JSON.stringify({ ...original, ...change }));
      expect(await store.get(origin, key)).toBeNull();
    }
  });
  it("never upgrades legacy optional flags or corrupt state into acceptance", async () => {
    const { path, store } = await fixture();
    for (const content of ["broken", JSON.stringify({ processInventory: true, gameScreenshot: true }), " ".repeat(4097)]) {
      await writeFile(join(path, "anti-cheat-terms.v1.json"), content);
      expect(await store.get(origin, key)).toBeNull();
    }
    await expect(store.accept("https://untrusted.example", key, FAIRPLAY_TERMS_VERSION)).rejects.toThrow("account");
  });
});
