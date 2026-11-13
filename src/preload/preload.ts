import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { MenuCommand, StagePlayerApi } from '../shared/types';

// The only bridge between the UI and the operating system. Keep it small and explicit.
const api: StagePlayerApi = {
  platform: process.platform,
  onMenuCommand: (callback) => {
    ipcRenderer.on('menu-command', (_event, command: MenuCommand) => callback(command));
  },
  getStartupShow: () => ipcRenderer.invoke('get-startup-show'),
  openShowDialog: () => ipcRenderer.invoke('open-show-dialog'),
  openShowFile: (filePath) => ipcRenderer.invoke('open-show-file', filePath),
  saveShow: (state, filePath) => ipcRenderer.invoke('save-show', state, filePath),
  importAudioDialog: () => ipcRenderer.invoke('import-audio-dialog'),
  expandPaths: (paths) => ipcRenderer.invoke('expand-paths', paths),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  readAudioFile: (filePath) => ipcRenderer.invoke('read-audio-file', filePath),
  checkFiles: (paths) => ipcRenderer.invoke('check-files', paths),
  locateFile: (missingPath, otherMissing) => ipcRenderer.invoke('locate-file', missingPath, otherMissing),
  confirmDiscard: () => ipcRenderer.invoke('confirm-discard'),
  setDocumentState: (state) => ipcRenderer.send('set-document-state', state),
  updateMenuState: (state) => ipcRenderer.send('update-menu-state', state),
  writeRecovery: (data) => ipcRenderer.send('write-recovery', data),
  closeWindow: () => ipcRenderer.send('close-window'),
};

contextBridge.exposeInMainWorld('stagePlayer', api);
