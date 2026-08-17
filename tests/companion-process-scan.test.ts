import { describe, expect, it } from "vitest";
import {
  classifyProcess,
  classifyProcesses,
  companionProcessScanInternals,
  listWindowsProcesses,
  parseTasklistCsv,
  scanCompanionProcesses,
  toCompanionObservation,
  toCompanionScanSummary,
} from "../electron/services/companion-process-scan.js";

describe("companion process observation", () => {
  it("parses verbose tasklist CSV including quoted memory fields", () => {
    const stdout = [
      '"Cheat Engine.exe","4321","Console","1","12,345 K","Running","PC\\player","0:00:01","Cheat Engine 7.5"',
      '"H1Z1.exe","1001","Console","1","800,000 K","Running","PC\\player","0:01:00","H1Z1"',
    ].join("\r\n");
    expect(parseTasklistCsv(stdout)).toEqual([
      { name: "Cheat Engine.exe", pid: 4321, title: "Cheat Engine 7.5" },
      { name: "H1Z1.exe", pid: 1001, title: "H1Z1" },
    ]);
  });

  it("parses name-only tasklist CSV when window titles are unavailable", () => {
    const stdout = [
      '"Cheat Engine.exe","4321","Console","1","12,345 K"',
      '"H1Z1.exe","1001","Console","1","800,000 K"',
    ].join("\r\n");
    expect(parseTasklistCsv(stdout)).toEqual([
      { name: "Cheat Engine.exe", pid: 4321, title: "" },
      { name: "H1Z1.exe", pid: 1001, title: "" },
    ]);
  });

  it("flags cheat, injector and debugger tools without flagging the game or overlays", () => {
    const flags = classifyProcesses([
      { name: "H1Z1.exe", pid: 1, title: "H1Z1" },
      { name: "Discord.exe", pid: 2, title: "Discord Overlay" },
      { name: "cheatengine-x86_64.exe", pid: 3, title: "" },
      { name: "xenos64.exe", pid: 4, title: "" },
      { name: "x64dbg.exe", pid: 5, title: "x64dbg" },
      { name: "notepad.exe", pid: 6, title: "H1Z1 ESP overlay" },
      { name: "Code.exe", pid: 7, title: "rotk-launcher" },
    ]);
    expect(flags.map((flag) => [flag.name, flag.category, flag.matchedOn])).toEqual([
      ["cheatengine-x86_64.exe", "cheat", "name"],
      ["xenos64.exe", "injector", "name"],
      ["x64dbg.exe", "debugger", "name"],
      ["notepad.exe", "cheat", "title"],
    ]);
  });

  it("does not treat the ROTK launcher or Visual Studio as cheats", () => {
    expect(classifyProcess({ name: "ROTK Launcher.exe", pid: 8, title: "" })).toBeNull();
    expect(classifyProcess({ name: "devenv.exe", pid: 9, title: "rotk-launcher - Microsoft Visual Studio" })).toBeNull();
  });

  it("sends only flag names and categories to the account service", () => {
    const observation = toCompanionObservation({
      status: "ok",
      scannedAt: "2026-08-16T12:00:00.000Z",
      processCount: 120,
      flags: [{
        name: "Cheat Engine.exe",
        pid: 4321,
        title: "Cheat Engine 7.5",
        category: "cheat",
        matchedOn: "name",
        pattern: "cheatengine",
      }],
      error: null,
    });
    expect(observation).toEqual({
      schemaVersion: 1,
      status: "ok",
      scannedAt: "2026-08-16T12:00:00.000Z",
      flagCount: 1,
      flags: [{ name: "cheat engine", category: "cheat", matchedOn: "name" }],
    });
    expect(JSON.stringify(observation)).not.toContain("4321");
    expect(JSON.stringify(observation)).not.toContain("PC\\");
  });

  it("keeps detector patterns off the Dev Tools summary", () => {
    const summary = toCompanionScanSummary({
      status: "ok",
      scannedAt: "2026-08-16T12:00:00.000Z",
      processCount: 2,
      flags: [{
        name: "cheatengine-x86_64.exe",
        pid: 4321,
        title: "Cheat Engine 7.5",
        category: "cheat",
        matchedOn: "name",
        pattern: "cheatengine",
      }],
      error: null,
    });
    expect(summary.flags[0]).toEqual({
      name: "cheatengine-x86_64.exe",
      pid: 4321,
      title: "Cheat Engine 7.5",
      category: "cheat",
      matchedOn: "name",
    });
    expect(summary.flags[0]).not.toHaveProperty("pattern");
  });

  it("classifies an injected process list without calling tasklist", async () => {
    const result = await scanCompanionProcesses(async () => [
      { name: "H1Z1.exe", pid: 1, title: "H1Z1" },
      { name: "cheatengine-x86_64.exe", pid: 3, title: "" },
    ]);
    expect(result.status).toBe("ok");
    expect(result.processCount).toBe(2);
    expect(result.flags).toHaveLength(1);
    expect(result.flags[0]?.name).toBe("cheatengine-x86_64.exe");
  });

  it("maps a killed tasklist to a timeout message", () => {
    const error = Object.assign(new Error("Command failed: tasklist.exe /FO CSV /V /NH"), {
      killed: true,
      signal: "SIGTERM",
    });
    expect(companionProcessScanInternals.scanErrorMessage(error)).toBe("Process scan timed out.");
  });

  it("lists local processes by name on Windows", async () => {
    if (process.platform !== "win32") return;
    const processes = await listWindowsProcesses(false);
    expect(processes.length).toBeGreaterThan(0);
    expect(processes.every((entry) => entry.pid > 0 && entry.name.length > 0)).toBe(true);
  });
});
