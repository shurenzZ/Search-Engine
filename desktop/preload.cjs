const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', Object.freeze({
  platform: process.platform,
  setTheme: (theme) => ipcRenderer.invoke('brief:set-theme', theme),
  saveFile: (value) => ipcRenderer.invoke('brief:save-file', value),
  copyText: (text) => ipcRenderer.invoke('brief:copy-text', text)
}));
