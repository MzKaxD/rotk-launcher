import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { FAIRPLAY_TERMS, FAIRPLAY_TERMS_VERSION, isCurrentTermsAcceptance, type FairPlayTermsAcceptance } from "../../shared/fairplay-terms.js";
import { isValidPlayerKey, normalizePlayerKey } from "../../shared/player-key.js";

const termsDigest = createHash("sha256").update(JSON.stringify(FAIRPLAY_TERMS)).digest("hex");
interface StoredAcceptance extends FairPlayTermsAcceptance { subject: string; documentSha256: string }

/** One bounded receipt, scoped to the actual account key and service origin.
 * No automatic migration of legacy optional permissions into this agreement. */
export class FairPlayTermsStore {
  private readonly path: string;
  constructor(directory: string) { this.path = join(directory, "anti-cheat-terms.v1.json"); }

  private subject(origin: string, playerKey: string): string {
    if (!["https://rotk.app", "https://test.rotk.app"].includes(origin) || !isValidPlayerKey(playerKey)) throw new Error("Invalid anti-cheat agreement account.");
    return createHash("sha256").update(`ROTK Anti-Cheat agreement\0${origin}\0${normalizePlayerKey(playerKey)}`).digest("hex");
  }

  async get(origin: string, playerKey: string): Promise<FairPlayTermsAcceptance | null> {
    const subject = this.subject(origin, playerKey);
    try {
      const info = await stat(this.path);
      if (!info.isFile() || info.size > 4096) return null;
      const receipt: StoredAcceptance = JSON.parse(await readFile(this.path, "utf8"));
      if (!isCurrentTermsAcceptance(receipt) || receipt.subject !== subject || receipt.documentSha256 !== termsDigest) return null;
      return { version: receipt.version, acceptedAt: receipt.acceptedAt };
    } catch { return null; }
  }

  async accept(origin: string, playerKey: string, version: unknown): Promise<FairPlayTermsAcceptance> {
    if (version !== FAIRPLAY_TERMS_VERSION) throw new Error("Review the current ROTK Anti-Cheat conditions before playing.");
    const receipt: StoredAcceptance = { subject: this.subject(origin, playerKey), documentSha256: termsDigest,
      version: FAIRPLAY_TERMS_VERSION, acceptedAt: new Date().toISOString() };
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(receipt), { encoding: "utf8", flag: "wx" });
      await rename(temporary, this.path);
    } finally { await rm(temporary, { force: true }); }
    return { version: receipt.version, acceptedAt: receipt.acceptedAt };
  }
}
