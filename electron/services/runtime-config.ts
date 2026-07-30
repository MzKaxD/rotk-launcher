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
}

/**
 * Public OVH bootstrap used until the signed HTTPS runtime manifest is
 * published. Switching infrastructure later changes this bounded contract,
 * never arbitrary renderer-provided launch arguments.
 */
export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  environment: "production",
  label: "ROTK Europe",
  gatewayOrigin: "http://51.255.160.224",
  voiceGrantOrigin: "https://vps-c717eb9e.vps.ovh.net",
  loginHost: "51.255.160.224",
  loginPorts: [20042, 20043, 20044, 20045],
  websiteOrigin: "https://rotk.app",
  launchTicketUrl: "https://europe-west1-rotk-project.cloudfunctions.net/createLaunchTicket",
};

export function serverList(runtime: RuntimeConfig): string {
  return runtime.loginPorts.map((port) => `${runtime.loginHost}:${port}`).join(";");
}
