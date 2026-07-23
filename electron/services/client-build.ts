export interface SupportedClientBuild {
  id: string;
  fileVersion: string;
  executableSize: number;
  executableSha256: string;
}

/** Exact Steam client build currently supported by the ROTK protocol and patch set. */
export const SUPPORTED_CLIENT_BUILDS: readonly SupportedClientBuild[] = [
  {
    id: "h1z1-1.0.326.439939",
    fileVersion: "1.0.326.439939",
    executableSize: 82_158_616,
    executableSha256: "5f5a4922b0671e4ed8fd415e753be096ef7a17e360ae80e025f11544c8db9261",
  },
] as const;

export function identifyClientBuild(executableSize: number, executableSha256: string): SupportedClientBuild {
  const match = SUPPORTED_CLIENT_BUILDS.find(
    (build) =>
      build.executableSize === executableSize &&
      build.executableSha256 === executableSha256.toLocaleLowerCase("en-US"),
  );
  if (!match) {
    throw new Error(
      "Cette version de H1Z1 n’est pas encore prise en charge par ROTK. Vérifie les fichiers du jeu dans Steam puis réessaie.",
    );
  }
  return match;
}
