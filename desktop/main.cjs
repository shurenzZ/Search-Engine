const { app, BrowserWindow, Menu, protocol, net, ipcMain, dialog, clipboard, nativeTheme } = require('electron');
const { readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { APP_URL, isAppUrl, isExternalUrl, validateExport, contentSecurityPolicy } = require('./security.cjs');
const { installReader, readerResponse, openArticle, closeReader } = require('./reader.cjs');

const root = path.join(__dirname, '..');
const snapshotUrl = 'https://raw.githubusercontent.com/shurenzZ/Search-Engine/main/data/latest.json';
let mainWindow;

protocol.registerSchemesAsPrivileged([{ scheme: 'brief', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true
} }]);

function trustedSender(event) {
  if (event.sender !== mainWindow?.webContents || !isAppUrl(event.senderFrame?.url) ||
      event.senderFrame !== event.sender.mainFrame) throw new Error('拒绝非应用页面请求');
}

function readArticle(url) {
  if (isExternalUrl(url)) openArticle(url, mainWindow).catch((error) => dialog.showErrorBox('无法打开原文', error.message));
}

async function snapshotResponse() {
  try {
    const response = await net.fetch(snapshotUrl, { cache: 'no-store', signal: AbortSignal.timeout(6500) });
    if (!response.ok) throw new Error('远程快照不可用');
    const text = await response.text();
    const payload = JSON.parse(text);
    if (payload.schema !== 1 || !Array.isArray(payload.items)) throw new Error('快照格式无效');
    return new Response(text, { headers: { 'Content-Type': 'application/json' } });
  } catch {
    // 断网时使用随应用分发的真实快照，保留原始时间并明确标记。
    const payload = JSON.parse(await readFile(path.join(root, 'data/latest.json'), 'utf8'));
    payload.desktopFallback = true;
    return Response.json(payload);
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    title: '每日热搜早报', width: 1440, height: 960, minWidth: 900, minHeight: 640,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#121729' : '#eef1f5', show: false,
    icon: path.join(__dirname, 'assets/icon.png'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(process.platform === 'win32' ? { titleBarOverlay: { color: nativeTheme.shouldUseDarkColors ? '#121729' : '#eef1f5', symbolColor: nativeTheme.shouldUseDarkColors ? '#b4bacb' : '#4c5570', height: 38 } } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true }
  });
  const win = mainWindow;
  win.webContents.setWindowOpenHandler(({ url }) => { readArticle(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (event, url) => { event.preventDefault(); readArticle(url); });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { closeReader(); if (mainWindow === win) mainWindow = null; });
  await win.loadURL(APP_URL);
  return win;
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();

const ready = singleInstance ? app.whenReady().then(async () => {
  installReader();
  const html = await readFile(path.join(root, '每日热搜早报.html'), 'utf8');
  protocol.handle('brief', async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'app' || request.method !== 'GET') return new Response('Not found', { status: 404 });
    if (url.pathname === '/') return new Response(html, { headers: {
      'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': contentSecurityPolicy(html)
    } });
    if (url.pathname === '/data/latest.json') return snapshotResponse();
    if (url.pathname === '/reader') return readerResponse();
    return new Response('Not found', { status: 404 });
  });

  ipcMain.handle('brief:copy-text', async (event, text) => {
    trustedSender(event);
    if (typeof text !== 'string' || text.length > 25 * 1024 * 1024) throw new Error('无效的剪贴板内容');
    await clipboard.writeText(text);
    return true;
  });
  ipcMain.handle('brief:set-theme', (event, theme) => {
    trustedSender(event);
    if (!['light', 'dark', 'system'].includes(theme)) throw new Error('无效的颜色模式');
    nativeTheme.themeSource = theme;
    return true;
  });
  nativeTheme.on('updated', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const dark = nativeTheme.shouldUseDarkColors;
    mainWindow.setBackgroundColor(dark ? '#121729' : '#eef1f5');
    if (process.platform === 'win32') mainWindow.setTitleBarOverlay({ color: dark ? '#121729' : '#eef1f5', symbolColor: dark ? '#b4bacb' : '#4c5570' });
  });
  ipcMain.handle('brief:save-file', async (event, value) => {
    trustedSender(event);
    const { filename, text } = validateExport(value);
    const owner = mainWindow;
    const ext = filename.toLowerCase().endsWith('.json') ? 'json' : 'txt';
    const result = await dialog.showSaveDialog(owner, {
      title: '保存早报', defaultPath: path.join(app.getPath('downloads'), filename),
      filters: [{ name: ext === 'json' ? 'JSON 数据' : '文本文件', extensions: [ext] }]
    });
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, text, 'utf8');
    return true;
  });

  const win = await createWindow();
  const ses = win.webContents.session;
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on('will-download', (event) => event.preventDefault());
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: '文件', submenu: [{ label: '刷新早报', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.webContents.executeJavaScript("document.getElementById('btnRefresh').click()") }, { type: 'separator' }, { role: process.platform === 'darwin' ? 'close' : 'quit' }] },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '视图', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }, ...(!app.isPackaged ? [{ role: 'toggleDevTools' }] : [])] },
    { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(process.platform === 'darwin' ? [{ role: 'front' }] : [])] }
  ]));
  return win;
}) : Promise.resolve(null);

ready.catch((error) => { dialog.showErrorBox('无法启动每日热搜早报', error.message); app.exit(1); });
app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } });
app.on('activate', () => { if (singleInstance && BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

module.exports = { ready };
