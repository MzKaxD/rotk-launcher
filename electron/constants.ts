import { join } from "node:path";
import { app } from "electron";

export const APP_NAME = "ROTK Launcher";
export const WEBSITE_ORIGIN = "https://rotk.app";
export const WEBSITE_UPDATES_PATH = "/updates";
export const FORBIDDEN_INSTALL_SEGMENTS = new Set([
  "steam",
  "steamlibrary",
  "steamapps",
  "common",
]);

export const CRITICAL_CLIENT_FILES = [
  "H1Z1.exe",
  "ClientConfig.ini",
  "steam_api64.dll",
] as const;

export const ROTK_INSTALL_DIRECTORY_NAME = "ROTK-H1Z1";
export const INSTALL_MARKER_NAME = ".rotk-installation.json";

export function resolveBundledShimPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "patches", "steam_api64.dll")
    : join(app.getAppPath(), "resources", "patches", "steam_api64.dll");
}
