const { BrowserWindow, WebContentsView, ipcMain, shell, nativeTheme } = require('electron');
const path = require('node:path');
const { readFile } = require('node:fs/promises');
const { isExternalUrl, contentSecurityPolicy } = require('./security.cjs');

const READER_URL = 'brief://app/reader';
let readerWindow, articleView;
let lastUrl = '', error = '';

function sendState() {
  if (!readerWindow || readerWindow.isDestroyed() || !articleView || articleView.webContents.isDestroyed()) return;
  const page = articleView.webContents;
  readerWindow.webContents.send('brief:reader-state', {
    url: isExternalUrl(page.getURL()) ? page.getURL() : lastUrl,
    title: page.getTitle(), loading: page.isLoading(), error,
    canBack: page.navigationHistory.canGoBack(), canForward: page.navigationHistory.canGoForward()
  });
}

function installReader() {
  ipcMain.handle('brief:reader-command', async (event, command) => {
    if (event.sender !== readerWindow?.webContents || event.senderFrame !== event.sender.mainFrame ||
        event.senderFrame?.url !== READER_URL) throw new Error('拒绝非阅读工具栏请求');
    if (!['back', 'forward', 'reload', 'external'].includes(command)) throw new Error('无效的阅读命令');
    const page = articleView.webContents;
    if (command === 'back' && page.navigationHistory.canGoBack()) page.navigationHistory.goBack();
    if (command === 'forward' && page.navigationHistory.canGoForward()) page.navigationHistory.goForward();
    if (command === 'reload') page.reload();
    if (command === 'external') {
      const url = isExternalUrl(page.getURL()) ? page.getURL() : lastUrl;
      if (isExternalUrl(url)) await shell.openExternal(url);
    }
    return true;
  });
}

async function readerResponse() {
  const html = await readFile(path.join(__dirname, 'reader.html'), 'utf8');
  return new Response(html, { headers: {
    'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': contentSecurityPolicy(html)
  } });
}

async function openArticle(url, parent) {
  if (!isExternalUrl(url) || !parent || parent.isDestroyed()) return;
  lastUrl = url;
  error = '';
  if (!readerWindow || readerWindow.isDestroyed()) {
    readerWindow = new BrowserWindow({ parent, title: '原文阅读 · 每日热搜早报',
      width: 1120, height: 850, minWidth: 700, minHeight: 500, show: false, autoHideMenuBar: true,
      icon: path.join(__dirname, 'assets/icon.png'),
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#121729' : '#eef1f5',
      webPreferences: { preload: path.join(__dirname, 'reader-preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true }
    });
    // 远程原文独立渲染，不加载 preload，不开放应用桥接。
    articleView = new WebContentsView({ webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
    readerWindow.contentView.addChildView(articleView);
    const resize = () => {
      const [width, height] = readerWindow.getContentSize();
      articleView.setBounds({ x: 0, y: 52, width, height: Math.max(0, height - 52) });
    };
    resize();
    readerWindow.on('resize', resize);
    readerWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    readerWindow.webContents.on('will-navigate', (event) => event.preventDefault());
    const page = articleView.webContents;
    const navigate = (target) => {
      if (!isExternalUrl(target)) return;
      lastUrl = target;
      page.loadURL(target).catch(() => {}); // 加载失败由 did-fail-load 显示，可用工具栏重试。
    };
    page.setWindowOpenHandler(({ url: target }) => { navigate(target); return { action: 'deny' }; });
    const guard = (event, target) => { if (!isExternalUrl(target)) event.preventDefault(); };
    page.on('will-navigate', guard);
    page.on('will-redirect', guard);
    page.on('will-attach-webview', (event) => event.preventDefault());
    page.on('did-start-loading', () => { error = ''; sendState(); });
    for (const name of ['did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated']) page.on(name, sendState);
    page.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
      if (code === -3 || !isMainFrame) return;
      error = '网页未能加载，可刷新或在浏览器中打开';
      sendState();
    });
    readerWindow.webContents.on('did-finish-load', sendState);
    readerWindow.on('closed', () => {
      if (articleView && !articleView.webContents.isDestroyed()) articleView.webContents.close();
      articleView = null; readerWindow = null;
    });
    await readerWindow.loadURL(READER_URL);
  }
  if (!readerWindow || !articleView || url !== lastUrl) return;
  if (readerWindow.isMinimized()) readerWindow.restore();
  readerWindow.show(); readerWindow.focus();
  articleView.webContents.loadURL(url).catch(() => {});
}

function closeReader() { if (readerWindow && !readerWindow.isDestroyed()) readerWindow.close(); }

module.exports = { installReader, readerResponse, openArticle, closeReader };
