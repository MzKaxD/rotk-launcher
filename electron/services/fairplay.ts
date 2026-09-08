import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { FAIRPLAY_SHA256, FAIRPLAY_VERSION } from "./fairplay-release.js";
import { isValidLaunchTicket } from "../../shared/launch-ticket.js";

export interface FairPlayConsent { processInventory: boolean; gameScreenshot: boolean }
export interface FairPlayBootstrap {
  sessionId: string; token: string; expiresAt: string; heartbeatIntervalSeconds: number;
}
export interface FairPlayHandle { stop(): void }
export function fairPlayOrigin(value: string): string {
  const url = new URL(value);
  if (!["https://rotk.app", "https://test.rotk.app"].includes(url.origin)
    || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Invalid FairPlay service origin.");
  }
  return url.origin;
}
export async function hashFairPlayFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
export async function verifyFairPlayBinary(path: string, expectedHash = FAIRPLAY_SHA256): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error("This launcher release has no verified FairPlay agent.");
  const info = await stat(path).catch(() => null);
  if (!info?.isFile() || info.size <= 0 || info.size > 32 * 1024 * 1024) {
    throw new Error("FairPlay.exe is missing. Repair or reinstall the ROTK launcher.");
  }
  if (await hashFairPlayFile(path) !== expectedHash) {
    throw new Error("FairPlay.exe failed its integrity check. Reinstall the ROTK launcher.");
  }
}
export function parseFairPlayBootstrap(value: unknown): FairPlayBootstrap {
  const v = value as Partial<FairPlayBootstrap> | null;
  if (!v || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.sessionId ?? "")
    || !/^[A-Za-z0-9_-]{43,128}$/.test(v.token ?? "")
    || typeof v.expiresAt !== "string" || !Number.isFinite(Date.parse(v.expiresAt))
    || !Number.isInteger(v.heartbeatIntervalSeconds) || v.heartbeatIntervalSeconds! < 5 || v.heartbeatIntervalSeconds! > 60) {
    throw new Error("The FairPlay service sent an invalid session.");
  }
  return v as FairPlayBootstrap;
}
async function readBoundedResponse(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Invalid FairPlay service response.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 8_192) throw new Error("Invalid FairPlay service response.");
      chunks.push(value);
    }
    return Buffer.concat(chunks, length).toString("utf8");
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
export async function beginFairPlaySession(
  origin: string, ticket: string, consent: FairPlayConsent, fetchImpl: typeof fetch = fetch,
): Promise<FairPlayBootstrap> {
  const base = fairPlayOrigin(origin);
  if (!isValidLaunchTicket(ticket)) throw new Error("Invalid FairPlay launch ticket.");
  let response: Response;
  try {
    response = await fetchImpl(`${base}/api/fairplay/sessions`, {
      method: "POST", redirect: "error", cache: "no-store",
      signal: AbortSignal.timeout(8_000),
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ ticket, agentVersion: FAIRPLAY_VERSION, consent }),
    });
  } catch { throw new Error("FairPlay could not reach the ROTK service. Please try again."); }
  if (!response.ok) throw new Error(`FairPlay could not start a protected session (HTTP ${response.status}).`);
  const text = await readBoundedResponse(response);
  try { return parseFairPlayBootstrap(JSON.parse(text)); }
  catch { throw new Error("Invalid FairPlay service response."); }
}

/** The durable account key never reaches the agent. Credentials use stdin only. */
export async function startFairPlay(input: {
  executablePath: string; apiBaseUrl: string; bootstrap: FairPlayBootstrap;
  gamePid: number; expectedGameSha256: string; consent: FairPlayConsent;
  onUnexpectedExit(): void;
}): Promise<FairPlayHandle> {
  const apiBaseUrl = fairPlayOrigin(input.apiBaseUrl);
  if (!Number.isInteger(input.gamePid) || input.gamePid <= 0 || !/^[a-f0-9]{64}$/.test(input.expectedGameSha256)) {
    throw new Error("FairPlay cannot bind this game process.");
  }
  await verifyFairPlayBinary(input.executablePath);
  const child: ChildProcess = spawn(input.executablePath, ["--stdio"], {
    shell: false, windowsHide: true, detached: false, stdio: ["pipe", "pipe", "ignore"],
    // Do not inherit account credentials, Electron hooks, or unrelated tokens.
    env: Object.fromEntries(["SystemRoot", "WINDIR", "TEMP", "TMP"].flatMap((key) => process.env[key] ? [[key, process.env[key]!]] : [])),
  });
  let stopped = false;
  let ready = false;
  const stop = (): void => { stopped = true; if (child.exitCode === null) child.kill(); };
  await new Promise<void>((resolve, reject) => {
    let pending = "";
    let settled = false;
    const fail = (): void => {
      if (settled) return;
      settled = true; clearTimeout(timer); stop();
      reject(new Error("FairPlay could not initialize. The game was closed; please try again."));
    };
    const timer = setTimeout(fail, 20_000);
    child.once("error", fail);
    child.once("exit", () => {
      clearTimeout(timer);
      if (!settled) fail();
      else if (ready && !stopped) input.onUnexpectedExit();
    });
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      pending += chunk;
      if (pending.length > 16_384) { if (!ready) fail(); else { stop(); input.onUnexpectedExit(); } return; }
      let end: number;
      while ((end = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        if (ready) continue;
        try {
          const message = JSON.parse(line);
          if (message.type === "ready" && message.pid === input.gamePid && message.version === FAIRPLAY_VERSION) {
            settled = true; ready = true; clearTimeout(timer); resolve();
          }
        } catch { fail(); }
      }
    });
    child.stdin?.on("error", () => { if (!ready) fail(); });
    child.stdin?.end(JSON.stringify({ apiBaseUrl,
      sessionId: input.bootstrap.sessionId, token: input.bootstrap.token,
      gamePid: input.gamePid, expectedGameSha256: input.expectedGameSha256,
      allowProcessInventory: input.consent.processInventory,
      allowGameScreenshot: input.consent.gameScreenshot,
    }) + "\n");
  });
  return { stop };
}
