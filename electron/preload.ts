import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_CHANNELS,
  type LauncherSnapshot,
  type RotkLauncherApi,
} from "../shared/contracts.js";

const api: RotkLauncherApi = {
  getSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.getSnapshot),
  setLocale: (locale) => ipcRenderer.invoke(IPC_CHANNELS.setLocale, locale),
  setLaunchProfile: (serverId, role) => ipcRenderer.invoke(IPC_CHANNELS.setLaunchProfile, serverId, role),
  setPlayerKey: (profile, playerKey) => ipcRenderer.invoke(IPC_CHANNELS.setPlayerKey, profile, playerKey),
  clearPlayerKey: (profile) => ipcRenderer.invoke(IPC_CHANNELS.clearPlayerKey, profile),
  copyPlayerKey: (profile) => ipcRenderer.invoke(IPC_CHANNELS.copyPlayerKey, profile),
  detectSource: () => ipcRenderer.invoke(IPC_CHANNELS.detectSource),
  selectSource: () => ipcRenderer.invoke(IPC_CHANNELS.selectSource),
  selectDestination: () => ipcRenderer.invoke(IPC_CHANNELS.selectDestination),
  install: () => ipcRenderer.invoke(IPC_CHANNELS.install),
  cancelInstall: () => ipcRenderer.invoke(IPC_CHANNELS.cancelInstall),
  play: () => ipcRenderer.invoke(IPC_CHANNELS.play),
  openWebsite: (path, serverId) => ipcRenderer.invoke(IPC_CHANNELS.openWebsite, path, serverId),
  checkLauncherUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.checkLauncherUpdate),
  downloadLauncherUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.downloadLauncherUpdate),
  installLauncherUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.installLauncherUpdate),
  verifyAssets: () => ipcRenderer.invoke(IPC_CHANNELS.verifyAssets),
  restoreVanillaAssets: () => ipcRenderer.invoke(IPC_CHANNELS.restoreVanillaAssets),
  setAssetSyncEnabled: (enabled) => ipcRenderer.invoke(IPC_CHANNELS.setAssetSyncEnabled, enabled),
  copyDevDiagnostics: () => ipcRenderer.invoke(IPC_CHANNELS.copyDevDiagnostics),
  exportDevDiagnostics: () => ipcRenderer.invoke(IPC_CHANNELS.exportDevDiagnostics),
  openUserDataFolder: () => ipcRenderer.invoke(IPC_CHANNELS.openUserDataFolder),
  openLogsFolder: () => ipcRenderer.invoke(IPC_CHANNELS.openLogsFolder),
  openGameLogsFolder: () => ipcRenderer.invoke(IPC_CHANNELS.openGameLogsFolder),
  openSessionsFolder: () => ipcRenderer.invoke(IPC_CHANNELS.openSessionsFolder),
  captureSessionDossier: () => ipcRenderer.invoke(IPC_CHANNELS.captureSessionDossier),
  clearDevLogs: () => ipcRenderer.invoke(IPC_CHANNELS.clearDevLogs),
  openChromiumDevTools: () => ipcRenderer.invoke(IPC_CHANNELS.openChromiumDevTools),
  reloadRenderer: () => ipcRenderer.invoke(IPC_CHANNELS.reloadRenderer),
  revalidateInstall: () => ipcRenderer.invoke(IPC_CHANNELS.revalidateInstall),
  scanCompanionProcesses: () => ipcRenderer.invoke(IPC_CHANNELS.scanCompanionProcesses),
  banOperatorIp: (ip, reason) => ipcRenderer.invoke(IPC_CHANNELS.banOperatorIp, ip, reason),
  minimizeWindow: () => ipcRenderer.invoke(IPC_CHANNELS.minimizeWindow),
  closeWindow: () => ipcRenderer.invoke(IPC_CHANNELS.closeWindow),
  onSnapshot: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, snapshot: LauncherSnapshot): void => {
      listener(snapshot);
    };
    ipcRenderer.on(IPC_CHANNELS.snapshotChanged, wrapped);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.snapshotChanged, wrapped);
  },
};

contextBridge.exposeInMainWorld("rotk", Object.freeze(api));
