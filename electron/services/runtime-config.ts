export interface RuntimeConfig {
  environment: "development" | "production";
  label: string;
  gatewayOrigin: string;
  /** Public HTTPS origin used only to obtain short-lived, scoped voice grants. */
  voiceGrantOrigin: string;
  loginHost: string;
  loginPorts: number[];
  websiteOrigin: string;
  launchTicketUrl: string;
  /** Phase A of integrity attestation: issues the signed single-use challenge. */
  attestationChallengeUrl: string;
}

/**
 * Public GAME 2 bootstrap used until the signed HTTPS runtime manifest is
 * published. Switching infrastructure later changes this bounded contract,
 * never arbitrary renderer-provided launch arguments.
 */
export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  environment: "production",
  label: "ROTK GAME 2",
  gatewayOrigin: "http://162.19.94.95",
  voiceGrantOrigin: "https://vps-c717eb9e.vps.ovh.net",
  loginHost: "162.19.94.95",
  loginPorts: [20042, 20043, 20044, 20045],
  websiteOrigin: "https://rotk.app",
  launchTicketUrl: "https://europe-west1-rotk-project.cloudfunctions.net/createLaunchTicket",
  attestationChallengeUrl:
    "https://europe-west1-rotk-project.cloudfunctions.net/beginLauncherAttestation",
};

export function serverList(runtime: RuntimeConfig): string {
  return runtime.loginPorts.map((port) => `${runtime.loginHost}:${port}`).join(";");
}
