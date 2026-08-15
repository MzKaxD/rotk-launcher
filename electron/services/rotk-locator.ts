import { constants as fsConstants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { join, normalize } from "node:path";
import { RECOMMENDED_INSTALL_PARENT_NAME, ROTK_INSTALL_DIRECTORY_NAME } from "../constants.js";
import { classifyClientSource } from "./path-policy.js";
import { readInstallationMarker } from "./installer.js";

export interface RotkLocatorDependencies {
  directoryExists(path: string): Promise<boolean>;
  classify(path: string): Promise<{ root: string; kind: "direct" | "copy-required" }>;
  hasMarker(path: string): Promise<boolean>;
  systemDrive: string;
  availableDrives: readonly string[];
}

const DEFAULT_DEPENDENCIES: RotkLocatorDependencies = {
  directoryExists: async (path) => {
    try {
      await access(path, fsConstants.R_OK);
      return (await stat(path)).isDirectory();
    } catch {
      return false;
    }
  },
  classify: classifyClientSource,
  hasMarker: async (path) => (await readInstallationMarker(path)) !== null,
  systemDrive: process.env.SystemDrive ?? "C:",
  availableDrives: windowsDriveLetters(),
};

function windowsDriveLetters(): string[] {
  const letters: string[] = [];
  for (let code = 65; code <= 90; code += 1) {
    letters.push(`${String.fromCharCode(code)}:`);
  }
  return letters;
}

function driveRoot(drive: string): string {
  const trimmed = drive.replace(/[\\/]+$/, "");
  return trimmed.endsWith(":") ? `${trimmed}\\` : `${trimmed}\\`;
}

/**
 * Likely standalone ROTK client folders: <drive>\Games\ROTK then <drive>\ROTK.
 * The system drive is listed first so the documented default stays preferred.
 */
export function listIsolatedRotkCandidates(
  systemDrive: string,
  availableDrives: readonly string[],
): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];
  const add = (root: string): void => {
    const next = normalize(root);
    const key = next.toLocaleLowerCase("en-US");
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(next);
  };

  const folders = [
    [RECOMMENDED_INSTALL_PARENT_NAME, ROTK_INSTALL_DIRECTORY_NAME],
    [ROTK_INSTALL_DIRECTORY_NAME],
  ] as const;

  const drives = [
    systemDrive,
    ...availableDrives.filter((drive) => drive.replace(/\\/g, "").toLocaleLowerCase("en-US")
      !== systemDrive.replace(/\\/g, "").toLocaleLowerCase("en-US")),
  ];

  for (const drive of drives) {
    const root = driveRoot(drive);
    for (const parts of folders) add(join(root, ...parts));
  }
  return candidates;
}

/**
 * Find an already-isolated ROTK client (outside Steam). A folder with a
 * `.rotk-installation.json` marker wins over a bare H1Z1 tree.
 */
export async function locateIsolatedRotkClient(
  overrides: Partial<RotkLocatorDependencies> = {},
): Promise<string | null> {
  const deps: RotkLocatorDependencies = { ...DEFAULT_DEPENDENCIES, ...overrides };
  const candidates = listIsolatedRotkCandidates(deps.systemDrive, deps.availableDrives);
  let firstValid: string | null = null;

  for (const candidate of candidates) {
    if (!await deps.directoryExists(candidate)) continue;
    try {
      const classified = await deps.classify(candidate);
      if (classified.kind !== "direct") continue;
      if (await deps.hasMarker(classified.root)) return classified.root;
      firstValid ??= classified.root;
    } catch {
      continue;
    }
  }
  return firstValid;
}
