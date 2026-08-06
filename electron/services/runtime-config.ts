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
  // The Gateway moved off :80 so Nginx can own it for the website. Nothing in
  // the client requires 80 — it only ever learns this URL from here, and the
  // port travels with it into every derived value below.
  gatewayOrigin: "http://162.19.94.95:8080",
  voiceGrantOrigin: "https://vps-c717eb9e.vps.ovh.net",
  loginHost: "162.19.94.95",
  loginPorts: [20042, 20043, 20044, 20045],
  websiteOrigin: "https://rotk.app",
  launchTicketUrl: "https://rotk.app/api/launcher/ticket",
  attestationChallengeUrl: "https://rotk.app/api/launcher/attestation/challenge",
};

export function serverList(runtime: RuntimeConfig): string {
  return runtime.loginPorts.map((port) => `${runtime.loginHost}:${port}`).join(";");
}
