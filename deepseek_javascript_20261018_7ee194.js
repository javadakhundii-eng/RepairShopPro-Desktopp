const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('repairshop', {
  isDesktop: true,
  version: '23.0.0',
  backupNow: () => ipcRenderer.invoke('backup-now'),
  openBackupDir: () => ipcRenderer.invoke('open-backup-dir'),
  getBackupDir: () => ipcRenderer.invoke('get-backup-dir'),
  appInfo: () => ipcRenderer.invoke('app-info')
});