const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('reader', Object.freeze({
  command: (command) => ipcRenderer.invoke('brief:reader-command', command),
  onState: (callback) => {
    ipcRenderer.on('brief:reader-state', (_event, state) => callback(state));
  }
}));
