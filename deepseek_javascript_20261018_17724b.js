const { app, BrowserWindow, Menu, ipcMain, dialog, shell, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const USER_DATA = app.getPath('userData');
const BACKUP_DIR = path.join(app.getPath('documents'), 'RepairShopPro-Backups');
const LOG_DIR = path.join(USER_DATA, 'logs');
const CONFIG_FILE = path.join(USER_DATA, 'config.json');

[USER_DATA, BACKUP_DIR, LOG_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

function writeLog(level, msg) {
  const line = `[${new Date().toISOString()}] [${level}] ${msg}\n`;
  try {
    fs.appendFileSync(
      path.join(LOG_DIR, `app-${new Date().toISOString().slice(0,10)}.log`),
      line
    );
  } catch(e){}
  console.log(line.trim());
}

process.on('uncaughtException', err => {
  writeLog('FATAL', err.stack || String(err));
  try { dialog.showErrorBox('خطای غیرمنتظره', String(err.message || err)); } catch(e){}
});

function readConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch(e){}
  return { autoBackup: true, autoBackupIntervalHours: 6, backupDir: BACKUP_DIR, firstRun: true };
}
function writeConfig(cfg) {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8'); } catch(e){}
}
let config = readConfig();

let mainWindow = null, tray = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    title: 'RepairShop Pro — مدیریت تعمیرگاه',
    backgroundColor: '#0b1220', show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: 'persist:repairshop'
    }
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'برنامه',
      submenu: [
        { label: 'پشتیبان‌گیری فوری', accelerator: 'CmdOrCtrl+B', click: () => triggerBackup('manual') },
        { label: 'بازکردن پوشه پشتیبان', click: () => shell.openPath(config.backupDir) },
        { label: 'بازکردن پوشه لاگ', click: () => shell.openPath(LOG_DIR) },
        { type: 'separator' },
        { label: 'خروج', accelerator: 'CmdOrCtrl+Q', click: () => { app.isQuitting = true; app.quit(); } }
      ]
    },
    {
      label: 'نمایش',
      submenu: [
        { label: 'بزرگ‌نمایی', role: 'zoomIn' },
        { label: 'کوچک‌نمایی', role: 'zoomOut' },
        { label: 'تمام‌صفحه', role: 'togglefullscreen' },
        { label: 'ابزار توسعه', role: 'toggleDevTools' }
      ]
    },
    {
      label: 'راهنما',
      submenu: [
        {
          label: 'درباره برنامه',
          click: () => dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'درباره',
            message: 'RepairShop Pro v23.0.0',
            detail: 'مدیریت هوشمند تعمیرگاه\nپوشه پشتیبان: ' + config.backupDir
          })
        }
      ]
    }
  ]));

  const htmlPath = path.join(__dirname, 'app', 'RepairShopPro_v22.html');
  if (!fs.existsSync(htmlPath)) {
    dialog.showErrorBox('فایل برنامه پیدا نشد', 'فایل app/RepairShopPro_v22.html موجود نیست.');
    app.quit();
    return;
  }
  mainWindow.loadFile(htmlPath);

  mainWindow.webContents.on('did-finish-load', () => {
    const patchPath = path.join(__dirname, 'app', 'RepairShopPro_v23_patch.js');
    if (fs.existsSync(patchPath)) {
      const code = fs.readFileSync(patchPath, 'utf8');
      mainWindow.webContents.executeJavaScript(code)
        .then(() => writeLog('INFO', 'patch v23 applied'))
        .catch(e => writeLog('ERROR', 'patch fail: ' + e.message));
    }
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('close', e => {
    if (!app.isQuitting && config.closeToTray !== false) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function createTray() {
  try {
    tray = new Tray(nativeImage.createEmpty());
    tray.setToolTip('RepairShop Pro');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'نمایش', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } else createWindow(); } },
      { label: 'پشتیبان', click: () => triggerBackup('manual') },
      { type: 'separator' },
      { label: 'خروج', click: () => { app.isQuitting = true; app.quit(); } }
    ]));
  } catch(e) {
    writeLog('ERROR', 'tray: ' + e.message);
  }
}

function triggerBackup(reason) {
  if (!mainWindow) return;
  mainWindow.webContents.executeJavaScript(
    `(function(){ try { return typeof db !== 'undefined' ? JSON.stringify({...db, backupMeta:{app:'RepairShop Pro Desktop', version:23, reason:'${reason}', createdAt:new Date().toISOString()}}) : null; } catch(e){ return null; } })()`
  ).then(data => {
    if (!data) return writeLog('WARN', 'backup skipped: no data');
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fp = path.join(config.backupDir, `RepairShopPro-${reason}-${ts}.json`);
    try {
      fs.writeFileSync(fp, data, 'utf8');
      writeLog('INFO', 'backup: ' + fp);
    } catch(e) {
      writeLog('ERROR', 'backup fail: ' + e.message);
    }
  }).catch(e => writeLog('ERROR', 'backup exec: ' + e.message));
}

ipcMain.handle('backup-now', () => { triggerBackup('manual'); return true; });
ipcMain.handle('open-backup-dir', () => shell.openPath(config.backupDir));
ipcMain.handle('get-backup-dir', () => config.backupDir);
ipcMain.handle('app-info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  userData: USER_DATA,
  backupDir: config.backupDir
}));

app.whenReady().then(() => {
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (config.closeToTray === false) app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
  else if (mainWindow) mainWindow.show();
});

app.on('before-quit', () => { app.isQuitting = true; });