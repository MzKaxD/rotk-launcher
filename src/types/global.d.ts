import type { RotkLauncherApi } from "../../shared/contracts";

declare global {
  interface Window {
    rotk: RotkLauncherApi;
  }
}

export {};
