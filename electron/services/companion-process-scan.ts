/**
 * User-mode observation of processes running alongside H1Z1.
 *
 * This is not kernel anti-cheat and a determined player can hide from it.
 * The launcher reports what it sees; the account service decides what a
 * flag means. Absence of flags is not proof of a clean machine.
 */

import { execFile } from "node:child_process";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import type { CompanionScanSummary } from "../../shared/contracts.js";

const execFileAsync = promisify(execFile);
const VERBOSE_SCAN_TIMEOUT_MS = 25_000;
const NAME_SCAN_TIMEOUT_MS = 8_000;
const SCAN_MAX_BUFFER = 16 * 1024 * 1024;
const MAX_FLAGS = 20;

export type CompanionFlagCategory = "cheat" | "injector" | "debugger";
export type CompanionMatchField = "name" | "title";
export type CompanionScanStatus = "ok" | "unavailable" | "idle";

export interface ObservedProcess {
  name: string;
  pid: number;
  title: string;
}

export interface CompanionFlag {
  name: string;
  pid: number;
  title: string;
  category: CompanionFlagCategory;
  matchedOn: CompanionMatchField;
  pattern: string;
}

export interface CompanionObservation {
  schemaVersion: 1;
  status: Exclude<CompanionScanStatus, "idle">;
  scannedAt: string;
  flagCount: number;
  flags: Array<{
    name: string;
    category: CompanionFlagCategory;
    matchedOn: CompanionMatchField;
  }>;
}

export interface CompanionScanResult {
  status: CompanionScanStatus;
  scannedAt: string | null;
  processCount: number;
  flags: CompanionFlag[];
  error: string | null;
}

const ALLOWED_PROCESS_NAMES = new Set([
  "h1z1",
  "h1z1_be",
  "rotk launcher",
  "electron",
  "steam",
  "steamservice",
  "steamwebhelper",
  "gameoverlayui",
  "discord",
  "discordptb",
  "discordcanary",
  "obs64",
  "obs32",
  "obs",
  "textinputhost",
  "applicationframehost",
  "searchhost",
  "shellexperiencehost",
  "explorer",
  "dwm",
  "cursor",
  "code",
  "devenv",
  "nvidia share",
  "nvcontainer",
  "nvdisplay.container",
  "amdow",
  "amdrsserv",
  "rtss",
  "msi afterburner",
]);

const NAME_RULES: Array<{ category: CompanionFlagCategory; pattern: string; test: RegExp }> = [
  { category: "cheat", pattern: "cheatengine", test: /cheat\s*engine|cheatengine|^ce-?x64$|^ce-?x86$/ },
  { category: "cheat", pattern: "wemod", test: /^wemod/ },
  { category: "cheat", pattern: "artmoney", test: /artmoney/ },
  { category: "cheat", pattern: "trainer", test: /trainer/ },
  { category: "cheat", pattern: "speedhack", test: /speedhack/ },
  { category: "injector", pattern: "xenos", test: /^xenos/ },
  { category: "injector", pattern: "extremeinjector", test: /extremeinjector/ },
  { category: "injector", pattern: "dllinjector", test: /dll.?inject/ },
  { category: "injector", pattern: "injector", test: /injector/ },
  { category: "debugger", pattern: "x64dbg", test: /x64dbg|x32dbg/ },
  { category: "debugger", pattern: "ollydbg", test: /ollydbg/ },
  { category: "debugger", pattern: "windbg", test: /^windbg/ },
  { category: "debugger", pattern: "ida", test: /^ida(64|32)?$/ },
  { category: "debugger", pattern: "dnspy", test: /dnspy/ },
  { category: "debugger", pattern: "reclass", test: /reclass/ },
];

const TITLE_RULES: Array<{ category: CompanionFlagCategory; pattern: string; test: RegExp }> = [
  { category: "cheat", pattern: "cheat engine", test: /cheat\s*engine/ },
  { category: "cheat", pattern: "aimbot", test: /\baimbot\b/ },
  { category: "cheat", pattern: "wallhack", test: /\bwall\s*hacks?\b|\besp overlay\b/ },
  { category: "cheat", pattern: "hack for", test: /\bhacks?\s+for\b/ },
  { category: "debugger", pattern: "x64dbg", test: /\bx64dbg\b|\bx32dbg\b/ },
];

function normalizeName(value: string): string {
  return basename(value).replace(/\.exe$/i, "").trim().toLocaleLowerCase("en-US");
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      fields.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  fields.push(current);
  return fields;
}

export function parseTasklistCsv(stdout: string): ObservedProcess[] {
  const processes: ObservedProcess[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const fields = parseCsvLine(line);
    if (fields.length < 2) continue;
    const name = fields[0]?.trim() ?? "";
    const pid = Number.parseInt(fields[1] ?? "", 10);
    const title = fields.length >= 9 ? (fields[8] ?? "").trim() : "";
    if (!name || !Number.isInteger(pid) || pid <= 0) continue;
    processes.push({
      name,
      pid,
      title: title === "N/A" ? "" : title,
    });
  }
  return processes;
}

export function classifyProcess(process: ObservedProcess): CompanionFlag | null {
  const name = normalizeName(process.name);
  if (!name || ALLOWED_PROCESS_NAMES.has(name)) return null;
  for (const rule of NAME_RULES) {
    if (rule.test.test(name)) {
      return {
        name: process.name,
        pid: process.pid,
        title: process.title,
        category: rule.category,
        matchedOn: "name",
        pattern: rule.pattern,
      };
    }
  }
  const title = process.title.trim().toLocaleLowerCase("en-US");
  if (!title) return null;
  for (const rule of TITLE_RULES) {
    if (rule.test.test(title)) {
      return {
        name: process.name,
        pid: process.pid,
        title: process.title,
        category: rule.category,
        matchedOn: "title",
        pattern: rule.pattern,
      };
    }
  }
  return null;
}

export function classifyProcesses(processes: readonly ObservedProcess[]): CompanionFlag[] {
  const flags: CompanionFlag[] = [];
  const seen = new Set<string>();
  for (const process of processes) {
    const flag = classifyProcess(process);
    if (!flag) continue;
    const key = `${flag.pid}:${flag.pattern}`;
    if (seen.has(key)) continue;
    seen.add(key);
    flags.push(flag);
    if (flags.length >= MAX_FLAGS) break;
  }
  return flags;
}

export function toCompanionObservation(
  result: CompanionScanResult,
  scannedAt = new Date(),
): CompanionObservation {
  if (result.status !== "ok") {
    return {
      schemaVersion: 1,
      status: "unavailable",
      scannedAt: scannedAt.toISOString(),
      flagCount: 0,
      flags: [],
    };
  }
  return {
    schemaVersion: 1,
    status: "ok",
    scannedAt: result.scannedAt ?? scannedAt.toISOString(),
    flagCount: result.flags.length,
    flags: result.flags.map((flag) => ({
      name: normalizeName(flag.name),
      category: flag.category,
      matchedOn: flag.matchedOn,
    })),
  };
}

export function emptyCompanionScan(status: CompanionScanStatus = "idle"): CompanionScanResult {
  return {
    status,
    scannedAt: null,
    processCount: 0,
    flags: [],
    error: null,
  };
}

export function toCompanionScanSummary(result: CompanionScanResult): CompanionScanSummary {
  return {
    status: result.status,
    scannedAt: result.scannedAt,
    processCount: result.processCount,
    flags: result.flags.map(({ name, pid, title, category, matchedOn }) => ({
      name,
      pid,
      title,
      category,
      matchedOn,
    })),
    error: result.error,
  };
}

export async function scanCompanionProcesses(
  listProcesses: () => Promise<ObservedProcess[]> = listWindowsProcesses,
): Promise<CompanionScanResult> {
  try {
    const processes = await listProcesses();
    return {
      status: "ok",
      scannedAt: new Date().toISOString(),
      processCount: processes.length,
      flags: classifyProcesses(processes),
      error: null,
    };
  } catch (error) {
    return {
      status: "unavailable",
      scannedAt: new Date().toISOString(),
      processCount: 0,
      flags: [],
      error: scanErrorMessage(error),
    };
  }
}

function scanErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Process scan failed.";
  const execError = error as NodeJS.ErrnoException & { killed?: boolean; signal?: NodeJS.Signals | number | null };
  if (execError.killed || execError.signal === "SIGTERM") return "Process scan timed out.";
  if (execError.code === "ENOENT") return "tasklist.exe was not found.";
  return "Process scan failed.";
}

function tasklistPath(): string {
  return join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tasklist.exe");
}

async function runTasklist(verbose: boolean): Promise<string> {
  const { stdout } = await execFileAsync(
    tasklistPath(),
    verbose ? ["/FO", "CSV", "/V", "/NH"] : ["/FO", "CSV", "/NH"],
    {
      timeout: verbose ? VERBOSE_SCAN_TIMEOUT_MS : NAME_SCAN_TIMEOUT_MS,
      maxBuffer: SCAN_MAX_BUFFER,
      windowsHide: true,
      encoding: "utf8",
    },
  );
  return stdout;
}

export async function listWindowsProcesses(verbose = false): Promise<ObservedProcess[]> {
  if (!verbose) return parseTasklistCsv(await runTasklist(false));
  try {
    return parseTasklistCsv(await runTasklist(true));
  } catch {
    return parseTasklistCsv(await runTasklist(false));
  }
}

export const companionProcessScanInternals = {
  parseCsvLine,
  normalizeName,
  ALLOWED_PROCESS_NAMES,
  scanErrorMessage,
};
