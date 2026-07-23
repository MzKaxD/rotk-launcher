import { access, lstat, realpath, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, isAbsolute, join, normalize, parse, relative, resolve, sep } from "node:path";
import {
  CRITICAL_CLIENT_FILES,
  FORBIDDEN_INSTALL_SEGMENTS,
} from "../constants.js";
import type { ClientSourceKind } from "../../shared/contracts.js";

export class PathPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathPolicyError";
  }
}

function pathSegments(value: string): string[] {
  const root = parse(value).root;
  return value
    .slice(root.length)
    .split(/[\\/]+/)
    .filter(Boolean)
    .map((segment) => segment.toLocaleLowerCase("en-US"));
}

function hasForbiddenSegment(value: string): string | null {
  return pathSegments(value).find((segment) => FORBIDDEN_INSTALL_SEGMENTS.has(segment)) ?? null;
}

function comparable(value: string): string {
  return normalize(value).replace(/[\\/]+$/, "").toLocaleLowerCase("en-US");
}

function isSameOrNested(candidate: string, parent: string): boolean {
  const candidateValue = comparable(candidate);
  const parentValue = comparable(parent);
  return candidateValue === parentValue || candidateValue.startsWith(`${parentValue}${sep}`);
}

async function exists(value: string): Promise<boolean> {
  try {
    await access(value, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Resolve the deepest existing ancestor so a not-yet-created destination is still checked physically. */
export async function resolvePhysicalPath(input: string): Promise<string> {
  const logical = resolve(input);
  let cursor = logical;
  const missingSegments: string[] = [];

  while (!(await exists(cursor))) {
    const parent = dirname(cursor);
    if (parent === cursor) {
      throw new PathPolicyError("Impossible de résoudre le disque de destination.");
    }
    missingSegments.unshift(relative(parent, cursor));
    cursor = parent;
  }

  const physicalAncestor = await realpath(cursor);
  return normalize(join(physicalAncestor, ...missingSegments));
}

function validateAbsoluteLocalPath(value: string): void {
  if (!isAbsolute(value)) {
    throw new PathPolicyError("Le chemin doit être absolu.");
  }
  if (value.startsWith("\\\\") || value.startsWith("//") || value.startsWith("\\\\?\\")) {
    throw new PathPolicyError("Les chemins réseau et chemins de périphérique ne sont pas acceptés.");
  }
  // A drive-letter colon is part of the root; every later colon denotes a
  // Windows alternate data stream (for example `client:payload`).
  if (value.slice(parse(value).root.length).includes(":")) {
    throw new PathPolicyError("Le chemin contient un flux de fichier Windows non autorisé.");
  }
}

export async function validateClientSource(sourceInput: string): Promise<string> {
  validateAbsoluteLocalPath(sourceInput);
  const source = await resolvePhysicalPath(sourceInput);
  const sourceStat = await stat(source).catch(() => null);
  if (!sourceStat?.isDirectory()) {
    throw new PathPolicyError("Le dossier source H1Z1 est introuvable.");
  }

  for (const fileName of CRITICAL_CLIENT_FILES) {
    const filePath = join(source, fileName);
    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat?.isFile()) {
      throw new PathPolicyError(`Client H1Z1 incomplet : ${fileName} est introuvable.`);
    }
    await access(filePath, fsConstants.R_OK);
  }
  return source;
}

export async function classifyClientSource(
  sourceInput: string,
): Promise<{ root: string; kind: ClientSourceKind }> {
  const root = await validateClientSource(sourceInput);
  if (hasForbiddenSegment(root)) return { root, kind: "copy-required" };

  // A standalone client is allowed in place only when it also satisfies every
  // destination safety rule. Steam paths are deliberately handled by copying.
  await validateInstallDestination(root);
  return { root, kind: "direct" };
}

export async function validateInstallDestination(
  destinationInput: string,
  sourceInput?: string,
): Promise<string> {
  validateAbsoluteLocalPath(destinationInput);
  const logical = resolve(destinationInput);
  const logicalForbidden = hasForbiddenSegment(logical);
  if (logicalForbidden) {
    throw new PathPolicyError(
      `ROTK ne peut pas jouer depuis un dossier « ${logicalForbidden} ». Choisis un emplacement indépendant de Steam.`,
    );
  }

  const logicalStat = await lstat(logical).catch(() => null);
  if (logicalStat?.isSymbolicLink()) {
    throw new PathPolicyError("Une jonction ou un lien symbolique ne peut pas servir d’installation ROTK.");
  }

  const destination = await resolvePhysicalPath(logical);
  const physicalForbidden = hasForbiddenSegment(destination);
  if (physicalForbidden) {
    throw new PathPolicyError(
      `Cet emplacement renvoie physiquement vers « ${physicalForbidden} » et ne peut pas être utilisé.`,
    );
  }

  if (comparable(destination) === comparable(parse(destination).root)) {
    throw new PathPolicyError("La racine d’un disque ne peut pas servir directement d’installation ROTK.");
  }

  if (sourceInput) {
    const source = await resolvePhysicalPath(sourceInput);
    if (isSameOrNested(destination, source) || isSameOrNested(source, destination)) {
      throw new PathPolicyError("La source Steam et l’installation ROTK doivent être dans deux arbres distincts.");
    }
  }

  return destination;
}

export function assertSafeGeneratedStagingPath(staging: string, destination: string): void {
  const stagingParent = comparable(dirname(staging));
  const destinationParent = comparable(dirname(destination));
  if (stagingParent !== destinationParent || !parse(staging).base.startsWith(".rotk-staging-")) {
    throw new PathPolicyError("Le dossier temporaire de copie n’est pas sûr.");
  }
}

export const pathPolicyInternals = {
  hasForbiddenSegment,
  isSameOrNested,
  comparable,
};
