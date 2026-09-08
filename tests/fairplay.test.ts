import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
const mocks = vi.hoisted(() => ({ spawn: vi.fn(), hash: "" }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("../electron/services/fairplay-release.js", () => ({ FAIRPLAY_VERSION: "0.2.0", get FAIRPLAY_SHA256() { return mocks.hash; } }));
import { assertFairPlayReleasePolicy, beginFairPlaySession, fairPlayOrigin, measureFairPlayComponents,
  parseFairPlayBootstrap, parseFairPlayHashes, startFairPlay, verifyFairPlayBinary, withFairPlayAvailability, type FairPlayBootstrap } from "../electron/services/fairplay.js";

const hashes = { gameSha256: "a".repeat(64), launcherSha256: "b".repeat(64), launcherAsarSha256: "c".repeat(64), agentSha256: "d".repeat(64) };
const session: FairPlayBootstrap = { sessionId: "c89d3104-f74d-48ec-b8d0-598983f70da6", token: "A".repeat(43),
  expiresAt: "2026-09-09T12:00:00.000Z", heartbeatIntervalSeconds: 15, protocolVersion: 2,
  integrityPolicy: { revision: 1, releaseId: "e89d3104-f74d-48ec-b8d0-598983f70da6", challenge: "N".repeat(43), expected: hashes, enforcement: "enforce" } };
const consent = { processInventory: false, gameScreenshot: false };
const folders: string[] = [];
afterEach(async () => { vi.clearAllMocks(); await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function artifact() {
  const directory = await mkdtemp(join(tmpdir(), "rotk-fairplay-test-")); folders.push(directory);
  const path = join(directory, "FairPlay.exe");
  const bytes = Buffer.from("Non-executable test fixture for integrity checking");
  mocks.hash = createHash("sha256").update(bytes).digest("hex");
  await writeFile(path, bytes); return path;
}
function fakeProcess(mode: "ready" | "wrong-pid" | "crash") {
  const child = Object.assign(new EventEmitter(), { exitCode: null as number | null,
    stdout: new PassThrough(), stdin: new Writable(), kill: vi.fn(), received: "" });
  child.kill.mockImplementation(() => { child.exitCode = 1; queueMicrotask(() => child.emit("exit", 1)); return true; });
  child.stdin = new Writable({ write(chunk, _encoding, done) { child.received += String(chunk); done(); }, final(done) {
    done(); queueMicrotask(() => {
      if (mode === "crash") { child.exitCode = 7; child.emit("exit", 7); }
      else child.stdout.write(JSON.stringify({ type: "ready", pid: mode === "ready" ? 42 : 99, version: "0.2.0" }) + "\n");
    });
  } });
  mocks.spawn.mockReturnValue(child); return child;
}
describe("FairPlay release and transport boundaries", () => {
  it("allows only exact ROTK TLS origins", () => {
    expect(fairPlayOrigin("https://rotk.app")).toBe("https://rotk.app");
    expect(fairPlayOrigin("https://test.rotk.app/")).toBe("https://test.rotk.app");
    for (const bad of ["http://rotk.app", "https://rotk.app.evil.test", "https://rotk.app@evil.test", "https://rotk.app:444", "https://rotk.app/a", "https://rotk.app/?token=x"]) expect(() => fairPlayOrigin(bad)).toThrow();
  });
  it("checks the exact staged artifact and rejects a modified one", async () => {
    const path = await artifact(); await verifyFairPlayBinary(path, mocks.hash);
    await writeFile(path, "Changed agent"); await expect(verifyFairPlayBinary(path, mocks.hash)).rejects.toThrow("integrity");
    await expect(verifyFairPlayBinary(path, "UNSTAGED")).rejects.toThrow("no verified");
  });
  it("rejects malformed credentials before spawning", () => {
    expect(parseFairPlayBootstrap(session)).toEqual(session);
    for (const change of [{ token: "secret" }, { protocolVersion: 1 }, { integrityPolicy: undefined }, { sessionId: "../player" }, { heartbeatIntervalSeconds: 0 }, { expiresAt: "never" }]) expect(() => parseFairPlayBootstrap({ ...session, ...change })).toThrow();
  });
  it("accepts only complete immutable release tuples and rejects component mixing", () => {
    expect(parseFairPlayHashes(hashes)).toEqual(hashes);
    for (const bad of [{ ...hashes, agentSha256: "bad" }, { ...hashes, extra: "x" }, { gameSha256: hashes.gameSha256 }]) expect(() => parseFairPlayHashes(bad)).toThrow();
    expect(() => assertFairPlayReleasePolicy(hashes, session.integrityPolicy)).not.toThrow();
    for (const key of Object.keys(hashes)) expect(() => assertFairPlayReleasePolicy({ ...hashes, [key]: "f".repeat(64) }, session.integrityPolicy)).toThrow("approved ROTK release");
    for (const policy of [{ ...session.integrityPolicy, revision: -1 }, { ...session.integrityPolicy, challenge: "bad" },
      { ...session.integrityPolicy, expected: null }, { ...session.integrityPolicy, launcherSha256: hashes.launcherSha256 }]) {
      expect(() => parseFairPlayBootstrap({ ...session, integrityPolicy: policy })).toThrow();
    }
    expect(parseFairPlayBootstrap({ ...session, integrityPolicy: { revision: 0, releaseId: null, challenge: "N".repeat(43), expected: null, enforcement: "observe" } }).integrityPolicy.expected).toBeNull();
  });
  it("measures actual installed components and never substitutes development placeholders", async () => {
    const agent = await artifact(); const directory = agent.slice(0, -"FairPlay.exe".length);
    await mkdir(join(directory, "resources"));
    const launcher = join(directory, "ROTK Launcher.exe"), game = join(directory, "H1Z1.exe"), asar = join(directory, "resources", "app.asar");
    await writeFile(launcher, "launcher bytes"); await writeFile(game, "game bytes"); await writeFile(asar, "archive bytes");
    const input = { packaged: true, launcherExecutable: launcher, gameExecutable: game, agentExecutable: agent };
    const first = await measureFairPlayComponents(input);
    expect(first.agentSha256).toBe(mocks.hash);
    expect(first.launcherAsarSha256).toBe(createHash("sha256").update("archive bytes").digest("hex"));
    await writeFile(asar, "modified archive bytes");
    expect((await measureFairPlayComponents(input)).launcherAsarSha256).not.toBe(first.launcherAsarSha256);
    await expect(measureFairPlayComponents({ ...input, packaged: false })).rejects.toThrow("unavailable in development");
    await rm(asar); await expect(measureFairPlayComponents(input)).rejects.toThrow();
  });
  it("bootstraps before PID binding with a short ticket and explicit consent flags", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(session), { status: 201 }));
    await expect(beginFairPlaySession("https://rotk.app", "T".repeat(43), consent, hashes, fetcher)).resolves.toEqual(session);
    const [url, options] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://rotk.app/api/fairplay/sessions");
    expect(options.redirect).toBe("error");
    expect(JSON.parse(options.body)).toEqual({ protocolVersion: 2, ticket: "T".repeat(43), agentVersion: "0.2.0", hashes, launcherPid: process.pid, consent });
    expect(JSON.parse(options.body)).not.toHaveProperty("gamePid");
  });
  it("does not silently launch when bootstrap is refused or unavailable", async () => {
    await expect(beginFairPlaySession("https://rotk.app", "T".repeat(43), consent, hashes, vi.fn().mockResolvedValue(new Response("{}", { status: 403 })))).rejects.toThrow("403");
    await expect(beginFairPlaySession("https://rotk.app", "T".repeat(43), consent, hashes, vi.fn().mockRejectedValue(new Error("private detail")))).rejects.toThrow("could not reach");
  });
  it("cancels oversized bootstrap streams before accepting credentials", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(8_193)); }, cancel });
    await expect(beginFairPlaySession("https://rotk.app", "T".repeat(43), consent, hashes,
      vi.fn().mockResolvedValue(new Response(stream)))).rejects.toThrow("Invalid ROTK Anti-Cheat");
    expect(cancel).toHaveBeenCalledOnce();
  });
});
describe("FairPlay game supervision", () => {
  it("keeps observation launches playable when the bootstrap service fails", async () => {
    const unavailable = vi.fn();
    const launch = () => beginFairPlaySession("https://rotk.app", "T".repeat(43), consent, hashes,
      vi.fn().mockRejectedValue(new Error("offline")));
    await expect(withFairPlayAvailability("observe", launch, unavailable)).resolves.toBeNull();
    expect(unavailable).toHaveBeenCalledOnce();
    await expect(withFairPlayAvailability("enforce", launch, unavailable)).rejects.toThrow("could not reach");
  });
  it("does not close an observation game when the agent crashes after readiness", async () => {
    const executablePath = await artifact(); const child = fakeProcess("ready"); const onUnexpectedExit = vi.fn(), onUnavailable = vi.fn();
    const observation = { ...session, integrityPolicy: { ...session.integrityPolicy, enforcement: "observe" as const } };
    await startFairPlay({ executablePath, apiBaseUrl: "https://rotk.app", bootstrap: observation,
      gamePid: 42, expectedGameSha256: "b".repeat(64), consent, onUnexpectedExit, onUnavailable });
    child.stdout.write(JSON.stringify({ type: "coverage_gap", errorCode: "network_unavailable" }) + "\n");
    child.exitCode = 7; child.emit("exit", 7);
    expect(onUnexpectedExit).not.toHaveBeenCalled();
    expect(onUnavailable).toHaveBeenCalledWith("service_unavailable");
    expect(onUnavailable).toHaveBeenCalledWith("agent_exited");
  });
  it("keeps a game playable when its initially enforced session is downgraded", async () => {
    const executablePath = await artifact(); const child = fakeProcess("ready"); const onUnexpectedExit = vi.fn();
    await startFairPlay({ executablePath, apiBaseUrl: "https://rotk.app", bootstrap: session,
      gamePid: 42, expectedGameSha256: "b".repeat(64), consent, onUnexpectedExit });
    child.stdout.write('{"type":"policy","enforcement":"observe"}\n');
    child.stdout.write('{"type":"policy","enforcement":"enforce"}\n');
    child.exitCode = 7; child.emit("exit", 7); expect(onUnexpectedExit).not.toHaveBeenCalled();
  });
  it("allows observation startup to continue after the agent fails before readiness", async () => {
    const executablePath = await artifact(); fakeProcess("crash"); const unavailable = vi.fn();
    const observation = { ...session, integrityPolicy: { ...session.integrityPolicy, enforcement: "observe" as const } };
    await expect(withFairPlayAvailability("observe", () => startFairPlay({ executablePath, apiBaseUrl: "https://rotk.app", bootstrap: observation,
      gamePid: 42, expectedGameSha256: "b".repeat(64), consent, onUnexpectedExit: vi.fn() }), unavailable)).resolves.toBeNull();
    expect(unavailable).toHaveBeenCalledOnce();
  });
  it("sends scoped credentials through stdin, then stops only the supervised agent", async () => {
    const executablePath = await artifact(); const child = fakeProcess("ready"); const onUnexpectedExit = vi.fn();
    const handle = await startFairPlay({ executablePath, apiBaseUrl: "https://rotk.app", bootstrap: session,
      gamePid: 42, expectedGameSha256: "b".repeat(64), consent, onUnexpectedExit });
    const [path, args, options] = mocks.spawn.mock.calls[0]!;
    expect(path).toBe(executablePath); expect(args).toEqual(["--stdio"]); expect(options.shell).toBe(false);
    expect(JSON.stringify([args, options])).not.toContain(session.token);
    expect(JSON.parse(child.received)).toMatchObject({ token: session.token, gamePid: 42, launcherPid: process.pid,
      integrityPolicy: session.integrityPolicy, allowProcessInventory: false, allowGameScreenshot: false });
    handle.stop(); await Promise.resolve(); expect(child.kill).toHaveBeenCalledOnce(); expect(onUnexpectedExit).not.toHaveBeenCalled();
  });
  it("calls the game supervisor when a ready agent exits unexpectedly", async () => {
    const executablePath = await artifact(); const child = fakeProcess("ready"); const onUnexpectedExit = vi.fn();
    await startFairPlay({ executablePath, apiBaseUrl: "https://rotk.app", bootstrap: session,
      gamePid: 42, expectedGameSha256: "b".repeat(64), consent, onUnexpectedExit });
    child.exitCode = 0; child.emit("exit", 0); expect(onUnexpectedExit).toHaveBeenCalledOnce();
  });
  it("fails startup when the agent exits before readiness", async () => {
    const executablePath = await artifact(); fakeProcess("crash");
    await expect(startFairPlay({ executablePath, apiBaseUrl: "https://rotk.app", bootstrap: session,
      gamePid: 42, expectedGameSha256: "b".repeat(64), consent, onUnexpectedExit: vi.fn() })).rejects.toThrow("could not initialize");
  });
});
