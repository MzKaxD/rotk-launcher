import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_CHANNELS,
  type LauncherSnapshot,
  type RotkLauncherApi,
} from "../shared/contracts.js";

const api: RotkLauncherApi = {
  getSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.getSnapshot),
  setLocale: (locale) => ipcRenderer.invoke(IPC_CHANNELS.setLocale, locale),
  setPlayerKey: (playerKey) => ipcRenderer.invoke(IPC_CHANNELS.setPlayerKey, playerKey),
  copyPlayerKey: () => ipcRenderer.invoke(IPC_CHANNELS.copyPlayerKey),
  detectSource: () => ipcRenderer.invoke(IPC_CHANNELS.detectSource),
  selectSource: () => ipcRenderer.invoke(IPC_CHANNELS.selectSource),
  selectDestination: () => ipcRenderer.invoke(IPC_CHANNELS.selectDestination),
  install: () => ipcRenderer.invoke(IPC_CHANNELS.install),
  cancelInstall: () => ipcRenderer.invoke(IPC_CHANNELS.cancelInstall),
  play: () => ipcRenderer.invoke(IPC_CHANNELS.play),
  openWebsite: (path) => ipcRenderer.invoke(IPC_CHANNELS.openWebsite, path),
  checkLauncherUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.checkLauncherUpdate),
  downloadLauncherUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.downloadLauncherUpdate),
  installLauncherUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.installLauncherUpdate),
  verifyAssets: () => ipcRenderer.invoke(IPC_CHANNELS.verifyAssets),
  restoreVanillaAssets: () => ipcRenderer.invoke(IPC_CHANNELS.restoreVanillaAssets),
  setAssetSyncEnabled: (enabled) => ipcRenderer.invoke(IPC_CHANNELS.setAssetSyncEnabled, enabled),
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
