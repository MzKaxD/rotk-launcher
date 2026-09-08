import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import * as nodeFs from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { FAIRPLAY_SHA256, FAIRPLAY_VERSION } from "./fairplay-release.js";
import { isValidLaunchTicket } from "../../shared/launch-ticket.js";
import { isCurrentTermsAcceptance, type FairPlayTermsAcceptance } from "../../shared/fairplay-terms.js";

export interface FairPlayConsent { processInventory: boolean; gameScreenshot: boolean; terms?: FairPlayTermsAcceptance }
export interface FairPlayHashes {
  gameSha256: string; launcherSha256: string; launcherAsarSha256: string; agentSha256: string;
}
export interface FairPlayIntegrityPolicy {
  revision: number; releaseId: string | null; challenge: string;
  expected: FairPlayHashes | null; enforcement: "observe" | "enforce";
}
export interface FairPlayBootstrap {
  sessionId: string; token: string; expiresAt: string; heartbeatIntervalSeconds: number;
  protocolVersion: 2; integrityPolicy: FairPlayIntegrityPolicy;
  consentTerms?: FairPlayTermsAcceptance;
}
const HASH_KEYS = ["gameSha256", "launcherSha256", "launcherAsarSha256", "agentSha256"] as const;
const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Electron's patched fs may resolve an ASAR as a virtual directory. Hash the
// physical archive bytes with original-fs; ordinary Node is used by tests.
const rawFs: typeof nodeFs = process.versions.electron
  ? createRequire(import.meta.url)("original-fs") as typeof nodeFs : nodeFs;
export interface FairPlayHandle { stop(): void }
/** Observation failures are diagnostics; an explicit enforced policy still rejects them. */
export async function withFairPlayAvailability<T>(
  enforcement: "observe" | "enforce", operation: () => Promise<T>, onUnavailable: () => void,
): Promise<T | null> {
  try { return await operation(); }
  catch (error) { if (enforcement === "enforce") throw error; onUnavailable(); return null; }
}
export function fairPlayOrigin(value: string): string {
  const url = new URL(value);
  if (!["https://rotk.app", "https://test.rotk.app"].includes(url.origin)
    || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Invalid ROTK Anti-Cheat service origin.");
  }
  return url.origin;
}
export async function hashFairPlayFile(path: string, maximumBytes = 512 * 1024 * 1024): Promise<string> {
  const info = await rawFs.promises.stat(path);
  if (!info.isFile() || info.size <= 0 || info.size > maximumBytes) throw new Error("ROTK Anti-Cheat cannot measure this release component.");
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of rawFs.createReadStream(path, { signal: AbortSignal.timeout(30_000) })) {
    bytes += chunk.length;
    if (bytes > maximumBytes) throw new Error("ROTK Anti-Cheat component exceeds its measurement limit.");
    hash.update(chunk);
  }
  if (bytes !== info.size) throw new Error("ROTK Anti-Cheat component changed during measurement.");
  return hash.digest("hex");
}
export async function verifyFairPlayBinary(path: string, expectedHash = FAIRPLAY_SHA256): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error("This launcher release has no verified ROTK Anti-Cheat agent.");
  const info = await rawFs.promises.stat(path).catch(() => null);
  if (!info?.isFile() || info.size <= 0 || info.size > 32 * 1024 * 1024) {
    throw new Error("FairPlay.exe is missing. Repair or reinstall the ROTK launcher.");
  }
  if (await hashFairPlayFile(path) !== expectedHash) {
    throw new Error("FairPlay.exe failed its integrity check. Reinstall the ROTK launcher.");
  }
}
export function parseFairPlayHashes(value: unknown): FairPlayHashes {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid ROTK Anti-Cheat release hashes.");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== 4 || HASH_KEYS.some((key) => typeof row[key] !== "string" || !SHA256.test(row[key]))) {
    throw new Error("Invalid ROTK Anti-Cheat release hashes.");
  }
  return Object.fromEntries(HASH_KEYS.map((key) => [key, row[key]])) as unknown as FairPlayHashes;
}
export function parseFairPlayIntegrityPolicy(value: unknown): FairPlayIntegrityPolicy {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid ROTK Anti-Cheat integrity policy.");
  const p = value as Record<string, unknown>;
  if (Object.keys(p).length !== 5 || !Number.isSafeInteger(p.revision) || (p.revision as number) < 0 || (p.revision as number) > 2147483647
    || !(p.releaseId === null || (typeof p.releaseId === "string" && UUID.test(p.releaseId)))
    || typeof p.challenge !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(p.challenge)
    || !["observe", "enforce"].includes(String(p.enforcement))) throw new Error("Invalid ROTK Anti-Cheat integrity policy.");
  const expected = p.expected === null ? null : parseFairPlayHashes(p.expected);
  if ((expected === null) !== (p.releaseId === null) || (p.enforcement === "enforce" && expected === null)) {
    throw new Error("ROTK Anti-Cheat enforcement has no complete approved release.");
  }
  return { revision: p.revision as number, releaseId: p.releaseId as string | null, challenge: p.challenge,
    expected, enforcement: p.enforcement as "observe" | "enforce" };
}
export function assertFairPlayReleasePolicy(hashes: FairPlayHashes, policy: FairPlayIntegrityPolicy): void {
  if (policy.enforcement === "enforce" && (!policy.expected || HASH_KEYS.some((key) => hashes[key] !== policy.expected![key]))) {
    throw new Error("This combination of game, launcher and ROTK Anti-Cheat is not an approved ROTK release. Update or repair the launcher.");
  }
}
/** Derive archive path from the real launcher executable, never renderer input. */
export async function measureFairPlayComponents(input: {
  packaged: boolean; gameExecutable: string; launcherExecutable: string; agentExecutable: string;
}): Promise<FairPlayHashes> {
  if (!input.packaged) throw new Error("ROTK Anti-Cheat release integrity is unavailable in development. Use a packaged ROTK launcher; development hashes are never fabricated.");
  const [gameSha256, launcherSha256, launcherAsarSha256, agentSha256] = await Promise.all([
    hashFairPlayFile(input.gameExecutable), hashFairPlayFile(input.launcherExecutable),
    hashFairPlayFile(join(dirname(input.launcherExecutable), "resources", "app.asar"), 1024 * 1024 * 1024),
    hashFairPlayFile(input.agentExecutable, 32 * 1024 * 1024),
  ]);
  if (agentSha256 !== FAIRPLAY_SHA256) throw new Error("FairPlay.exe changed after its release integrity check.");
  return { gameSha256, launcherSha256, launcherAsarSha256, agentSha256 };
}
export function parseFairPlayBootstrap(value: unknown): FairPlayBootstrap {
  const v = value as Partial<FairPlayBootstrap> | null;
  if (!v || Array.isArray(v) || !UUID.test(v.sessionId ?? "") || v.protocolVersion !== 2
    || !/^[A-Za-z0-9_-]{43}$/.test(v.token ?? "")
    || typeof v.expiresAt !== "string" || !Number.isFinite(Date.parse(v.expiresAt))
    || !Number.isInteger(v.heartbeatIntervalSeconds) || v.heartbeatIntervalSeconds! < 5 || v.heartbeatIntervalSeconds! > 60) {
    throw new Error("The ROTK Anti-Cheat service sent an invalid session.");
  }
  if (v.consentTerms !== undefined && !isCurrentTermsAcceptance(v.consentTerms)) throw new Error("Invalid ROTK Anti-Cheat agreement receipt.");
  return { sessionId: v.sessionId!, token: v.token!, expiresAt: v.expiresAt,
    heartbeatIntervalSeconds: v.heartbeatIntervalSeconds!, protocolVersion: 2,
    integrityPolicy: parseFairPlayIntegrityPolicy(v.integrityPolicy),
    ...(v.consentTerms ? { consentTerms: v.consentTerms } : {}) };
}
async function readBoundedResponse(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Invalid ROTK Anti-Cheat service response.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 8_192) throw new Error("Invalid ROTK Anti-Cheat service response.");
      chunks.push(value);
    }
    return Buffer.concat(chunks, length).toString("utf8");
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
export async function beginFairPlaySession(
  origin: string, ticket: string, consent: FairPlayConsent, hashes: FairPlayHashes, fetchImpl: typeof fetch = fetch,
): Promise<FairPlayBootstrap> {
  const base = fairPlayOrigin(origin);
  if (!isValidLaunchTicket(ticket)) throw new Error("Invalid ROTK Anti-Cheat launch ticket.");
  const measured = parseFairPlayHashes(hashes);
  if (consent.terms !== undefined && (!isCurrentTermsAcceptance(consent.terms) || !consent.processInventory || !consent.gameScreenshot)) throw new Error("Invalid ROTK Anti-Cheat agreement.");
  let response: Response;
  try {
    response = await fetchImpl(`${base}/api/fairplay/sessions`, {
      method: "POST", redirect: "error", cache: "no-store",
      signal: AbortSignal.timeout(8_000),
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ protocolVersion: 2, ticket, agentVersion: FAIRPLAY_VERSION, hashes: measured, launcherPid: process.pid, consent }),
    });
  } catch { throw new Error("ROTK Anti-Cheat could not reach the ROTK service. Please try again."); }
  if (!response.ok) throw new Error(`ROTK Anti-Cheat could not start a protected session (HTTP ${response.status}).`);
  const text = await readBoundedResponse(response);
  let bootstrap: FairPlayBootstrap;
  try { bootstrap = parseFairPlayBootstrap(JSON.parse(text)); }
  catch { throw new Error("Invalid ROTK Anti-Cheat service response."); }
  assertFairPlayReleasePolicy(measured, bootstrap.integrityPolicy);
  if (bootstrap.consentTerms && (!consent.terms || bootstrap.consentTerms.version !== consent.terms.version
    || bootstrap.consentTerms.acceptedAt !== consent.terms.acceptedAt)) throw new Error("The ROTK Anti-Cheat agreement does not match this launch.");
  return bootstrap;
}

/** The durable account key never reaches the agent. Credentials use stdin only. */
export async function startFairPlay(input: {
  executablePath: string; apiBaseUrl: string; bootstrap: FairPlayBootstrap;
  gamePid: number; expectedGameSha256: string; consent: FairPlayConsent;
  onUnexpectedExit(): void;
  onUnavailable?(code: string): void;
}): Promise<FairPlayHandle> {
  const apiBaseUrl = fairPlayOrigin(input.apiBaseUrl);
  const bootstrap = parseFairPlayBootstrap(input.bootstrap);
  if (!Number.isInteger(input.gamePid) || input.gamePid <= 0 || !/^[a-f0-9]{64}$/.test(input.expectedGameSha256)) {
    throw new Error("ROTK Anti-Cheat cannot bind this game process.");
  }
  await verifyFairPlayBinary(input.executablePath);
  const child: ChildProcess = spawn(input.executablePath, ["--stdio"], {
    shell: false, windowsHide: true, detached: false, stdio: ["pipe", "pipe", "ignore"],
    // Do not inherit account credentials, Electron hooks, or unrelated tokens.
    env: Object.fromEntries(["SystemRoot", "WINDIR", "TEMP", "TMP"].flatMap((key) => process.env[key] ? [[key, process.env[key]!]] : [])),
  });
  let stopped = false;
  let ready = false;
  let enforcement = bootstrap.integrityPolicy.enforcement;
  const unexpectedExit = (): void => {
    input.onUnavailable?.("agent_exited");
    if (enforcement === "enforce") input.onUnexpectedExit();
  };
  const stop = (): void => { stopped = true; if (child.exitCode === null) child.kill(); };
  await new Promise<void>((resolve, reject) => {
    let pending = "";
    let settled = false;
    const fail = (): void => {
      if (settled) return;
      settled = true; clearTimeout(timer); stop();
      reject(new Error("ROTK Anti-Cheat could not initialize. The game was closed; please try again."));
    };
    const timer = setTimeout(fail, 20_000);
    child.once("error", fail);
    child.once("exit", () => {
      clearTimeout(timer);
      if (!settled) fail();
      else if (ready && !stopped) unexpectedExit();
    });
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      pending += chunk;
      if (pending.length > 16_384) { if (!ready) fail(); else { stop(); unexpectedExit(); } return; }
      let end: number;
      while ((end = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        try {
          const message = JSON.parse(line);
          if (message.type === "policy" && message.enforcement === "observe") enforcement = "observe";
          if (message.type === "coverage_gap") input.onUnavailable?.("service_unavailable");
          if (ready) continue;
          if (message.type === "ready" && message.pid === input.gamePid && message.version === FAIRPLAY_VERSION) {
            settled = true; ready = true; clearTimeout(timer); resolve();
          }
        } catch { fail(); }
      }
    });
    child.stdin?.on("error", () => { if (!ready) fail(); });
    child.stdin?.end(JSON.stringify({ apiBaseUrl,
      sessionId: bootstrap.sessionId, token: bootstrap.token,
      launcherPid: process.pid, integrityPolicy: bootstrap.integrityPolicy,
      gamePid: input.gamePid, expectedGameSha256: input.expectedGameSha256,
      allowProcessInventory: input.consent.processInventory,
      allowGameScreenshot: input.consent.gameScreenshot,
      // Both this launch and the authenticated server must acknowledge the same
      // receipt. An old server/session can never silently gain new permissions.
      ...(bootstrap.consentTerms && isCurrentTermsAcceptance(input.consent.terms)
        && bootstrap.consentTerms.version === input.consent.terms.version
        && bootstrap.consentTerms.acceptedAt === input.consent.terms.acceptedAt
        && input.consent.processInventory && input.consent.gameScreenshot
        ? { acceptedTermsVersion: bootstrap.consentTerms.version } : {}),
    }) + "\n");
  });
  return { stop };
}
