// 在真实 Electron 窗口中检查共用页面；使用临时用户目录，不改动个人设置。
const { app, session, clipboard, dialog, shell, nativeTheme } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { mkdtempSync } = require('node:fs');
const http = require('node:http');
const userDir = mkdtempSync(path.join(os.tmpdir(), 'daily-brief-smoke-'));
app.setPath('userData', userDir);
const openedUrls = [];
shell.openExternal = async (url) => { openedUrls.push(url); };
let targetFile;
let cancelSave = false;
let fixtureOrigin = '', fixtureServer;
dialog.showSaveDialog = async () => ({ canceled: cancelSave, filePath: targetFile });
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['https://*/*', 'http://*/*'] }, (details, done) => done({ cancel: !fixtureOrigin || !details.url.startsWith(fixtureOrigin + '/') }));
});
const { ready } = require('../desktop/main.cjs');

async function until(check, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  throw new Error('等待超时：' + label);
}

async function run() {
  const win = await ready;
  assert.ok(win, '应用窗口已创建');
  const wc = win.webContents;
  const evaluate = (fn, arg) => wc.executeJavaScript(`(${fn})(${JSON.stringify(arg) ?? ''})`, true).catch((error) => {
    throw new Error(fn.toString().slice(0, 140) + '\n' + error.message);
  });
  const painted = () => evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(document.getAnimations().filter((animation) => animation.effect.getTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {})));
    await new Promise(requestAnimationFrame);
  });
  const errors = [];
  wc.on('console-message', (details) => { if (details.level === 'error' && !/ERR_FAILED|Failed to fetch|Content Security Policy|Error invoking/.test(details.message)) errors.push(details.message); });
  await until(() => evaluate(() => document.querySelectorAll('#main .item:not(.skel-item)').length > 0), '离线快照显示');
  // 以真实快照建立缓存，关闭联网源，避免公共接口的串行重试拖住离线交互检查。
  await evaluate(() => {
    const cache = JSON.parse(localStorage.getItem('hot_daily_brief_v1'));
    const snapIds = new Set(cache.snapshot.sources.map((s) => s.id));
    document.querySelectorAll('#platformChips [data-fs]').forEach((button) => {
      const id = button.dataset.fs;
      if (id !== 'all' && !snapIds.has(id)) cache.settings.enabled[id] = false;
    });
    cache.settings.autoRefresh = false;
    cache.updatedAt = Date.now();
    localStorage.setItem('hot_daily_brief_v1', JSON.stringify(cache));
  });
  const loaded = new Promise((resolve) => wc.once('did-finish-load', resolve));
  wc.reload();
  await loaded;
  await until(() => evaluate(() => document.getElementById('sourceNote').textContent.includes('离线快照')), '离线缓存恢复');
  assert.equal(await evaluate(() => typeof window.require), 'undefined');
  assert.equal(await evaluate(() => typeof window.process), 'undefined');
  assert.equal(await evaluate(() => Object.keys(window.desktop).sort().join(',')), 'copyText,platform,saveFile,setTheme');
  assert.equal(await evaluate(() => document.querySelectorAll('#categoryChips [data-fc]').length), 12);
  assert.equal(await evaluate(() => document.body.classList.contains('desktop')), true);
  assert.ok(await evaluate(() => {
    const select = document.getElementById('sortSel');
    const style = getComputedStyle(select);
    const labelWidth = document.createElement('canvas').getContext('2d');
    labelWidth.font = style.font;
    return style.display === 'block' && style.appearance === 'none' &&
      select.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) >= labelWidth.measureText('信号优先').width;
  }), '排序文字完整显示，箭头不挤压中文标签');
  assert.match(await evaluate(() => document.getElementById('sourceNote').textContent), /离线快照/);
  await evaluate(() => document.querySelector('[data-theme-choice="dark"]').click());
  assert.equal(await evaluate(() => document.documentElement.dataset.theme), 'dark');
  await until(() => nativeTheme.themeSource === 'dark', '原生深色主题');
  await evaluate(() => document.querySelector('[data-theme-choice="light"]').click());
  assert.equal(await evaluate(() => document.documentElement.dataset.theme), 'light');
  await evaluate(() => document.querySelector('[data-theme-choice="system"]').click());
  await until(() => nativeTheme.themeSource === 'system', '原生系统主题');

  await evaluate(() => document.querySelector('[data-fc="game"]').click());
  assert.equal(await evaluate(() => document.querySelector('[data-fc="game"]').classList.contains('on')), true);
  await evaluate(() => document.querySelector('[data-fc="all"]').click());
  const firstTitle = await evaluate(() => document.querySelector('#main .item-title').textContent);
  await evaluate((q) => { const input = document.getElementById('q'); input.value = q; input.dispatchEvent(new Event('input')); }, firstTitle);
  await until(() => evaluate((q) => [...document.querySelectorAll('#main .item-title')].every((el) => el.textContent.includes(q)), firstTitle), '搜索结果');
  await evaluate(() => document.getElementById('qClear').click());
  await until(() => evaluate(() => document.getElementById('q').value === '' && document.querySelectorAll('#main .card').length > 1), '清除搜索');

  await evaluate(() => { document.getElementById('watchInput').value = 'OpenAI'; document.getElementById('btnWatchAdd').click(); });
  assert.match(await evaluate(() => document.getElementById('watchChips').textContent), /openai/i);
  await evaluate(() => document.querySelector('[data-view="platform"]').click());
  assert.ok(await evaluate(() => document.querySelector('#main [data-card^="src-"]')));
  assert.equal(await evaluate(() => document.querySelector('[data-view="platform"]').getAttribute('aria-pressed')), 'true');
  await evaluate(() => document.querySelector('[data-view="category"]').click());
  await evaluate(() => { const s = document.getElementById('sortSel'); s.value = 'time'; s.dispatchEvent(new Event('change')); });
  assert.equal(await evaluate(() => JSON.parse(localStorage.getItem('hot_daily_brief_v1')).settings.sortMode), 'time');

  await evaluate(() => document.getElementById('btnSettings').click());
  assert.equal(await evaluate(() => document.getElementById('mask').classList.contains('on')), true);
  await evaluate(() => { document.getElementById('setCache').value = '45'; document.getElementById('setAuto').checked = false; document.getElementById('btnSaveSet').click(); });
  assert.equal(await evaluate(() => JSON.parse(localStorage.getItem('hot_daily_brief_v1')).settings.cacheMinutes), 45);

  await evaluate(() => document.getElementById('btnCopyAll').click());
  await until(async () => (await clipboard.readText()).includes('每日热搜早报'), '系统剪贴板');
  targetFile = path.join(userDir, 'export.json');
  await evaluate(() => document.getElementById('btnJson').click());
  await until(async () => { try { return JSON.parse(await fs.readFile(targetFile, 'utf8')).items.length > 0; } catch { return false; } }, '原生 JSON 导出');
  const json = JSON.parse(await fs.readFile(targetFile, 'utf8'));
  assert.ok(json.items.every((it) => Array.isArray(it.facets) && typeof it.signal === 'number'));
  targetFile = path.join(userDir, 'export.txt');
  await evaluate(() => document.getElementById('btnTxt').click());
  await until(async () => { try { return (await fs.readFile(targetFile, 'utf8')).includes('每日热搜早报'); } catch { return false; } }, '原生 TXT 导出');
  assert.equal((await fs.readFile(targetFile, 'utf8')).charCodeAt(0), 0xfeff);
  cancelSave = true;
  await evaluate(() => document.getElementById('btnTxt').click());
  assert.equal(await evaluate(async () => { try { await window.desktop.saveFile({ filename: '../bad.txt', text: '' }); return false; } catch { return true; } }), true);
  assert.equal(await evaluate(async () => (await fetch('brief://app/desktop/main.cjs')).status), 404);
  let requests = 0;
  fixtureServer = http.createServer((request, response) => {
    requests++;
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>原文阅读测试</title><h1>' + (request.url === '/next' ? '第二页' : '完整原网页') + '</h1><a href="/next">下一页</a>');
  });
  await new Promise((resolve) => fixtureServer.listen(0, '127.0.0.1', resolve));
  fixtureOrigin = 'http://127.0.0.1:' + fixtureServer.address().port;
  await evaluate((url) => window.open(url), fixtureOrigin + '/article');
  const windows = require('electron').BrowserWindow;
  await until(() => windows.getAllWindows().some((w) => w !== win && w.webContents.getURL() === 'brief://app/reader'), '应用内阅读窗口');
  const reader = windows.getAllWindows().find((w) => w !== win);
  const remote = reader.contentView.children.find((view) => view.webContents && view.webContents !== reader.webContents).webContents;
  await until(() => remote.getURL() === fixtureOrigin + '/article' && !remote.isLoading(), '完整原网页加载');
  assert.equal(await remote.executeJavaScript('document.querySelector("h1").textContent'), '完整原网页');
  assert.equal(await remote.executeJavaScript('[typeof window.require, typeof window.desktop, typeof window.reader].join(",")'), 'undefined,undefined,undefined');
  assert.equal(openedUrls.length, 0, '原文默认不跳到系统浏览器');
  await remote.executeJavaScript('document.querySelector("a").click()', true);
  await until(() => remote.getURL() === fixtureOrigin + '/next' && !remote.isLoading(), '原文内链接导航');
  await reader.webContents.executeJavaScript('window.reader.command("back")');
  await until(() => remote.getURL() === fixtureOrigin + '/article' && !remote.isLoading(), '原文后退');
  await reader.webContents.executeJavaScript('window.reader.command("forward")');
  await until(() => remote.getURL() === fixtureOrigin + '/next' && !remote.isLoading(), '原文前进');
  const beforeReload = requests;
  await reader.webContents.executeJavaScript('window.reader.command("reload")');
  await until(() => requests > beforeReload && !remote.isLoading(), '原文刷新');
  await reader.webContents.executeJavaScript('window.reader.command("external")');
  assert.equal(openedUrls[0], fixtureOrigin + '/next');
  assert.equal(await reader.webContents.executeJavaScript('window.reader.command("bad").then(() => false, () => true)'), true);
  await evaluate(() => window.open('https://offline.example.test/article'));
  await until(() => reader.webContents.executeJavaScript('document.getElementById("status").textContent.includes("网页未能加载")'), '原文失败可恢复提示');
  reader.close();
  await until(() => remote.isDestroyed(), '关闭阅读窗口释放网页进程');
  await new Promise((resolve) => fixtureServer.close(resolve));
  fixtureServer = null;

  const reloaded = new Promise((resolve) => wc.once('did-finish-load', resolve));
  wc.reload();
  await reloaded;
  await until(() => evaluate(() => document.getElementById('watchChips')?.textContent.includes('openai')), '重启后保留关注词');
  assert.equal(await evaluate(() => JSON.parse(localStorage.getItem('hot_daily_brief_v1')).settings.cacheMinutes), 45);
  await evaluate(() => { const s = document.getElementById('sortSel'); s.value = 'signal'; s.dispatchEvent(new Event('change')); window.scrollTo(0, 0); document.activeElement.blur(); });
  const previewDir = path.resolve(process.env.BRIEF_SCREENSHOT_DIR || path.join('dist', 'preview'));
  await fs.mkdir(previewDir, { recursive: true });
  await evaluate(() => document.querySelector('[data-theme-choice="light"]').click());
  await until(() => evaluate(() => getComputedStyle(document.getElementById('toast')).opacity === '0'), '提示条关闭');
  assert.equal(await evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(238, 241, 245)');
  await painted();
  await fs.writeFile(path.join(previewDir, 'desktop.png'), (await wc.capturePage()).toPNG());
  await evaluate(() => document.querySelector('[data-theme-choice="dark"]').click());
  await until(() => nativeTheme.themeSource === 'dark', '深色预览');
  assert.equal(await evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(18, 23, 41)');
  await painted();
  await fs.writeFile(path.join(previewDir, 'dark.png'), (await wc.capturePage()).toPNG());
  const themeReloaded = new Promise((resolve) => wc.once('did-finish-load', resolve));
  wc.reload();
  await themeReloaded;
  assert.equal(await evaluate(() => document.documentElement.dataset.theme), 'dark');
  await evaluate(() => document.querySelector('[data-theme-choice="light"]').click());
  win.setSize(960, 800);
  await until(() => evaluate(() => window.innerWidth <= 960), '紧凑窗口');
  await painted();
  assert.equal(await evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await fs.writeFile(path.join(previewDir, 'compact.png'), (await wc.capturePage()).toPNG());
  assert.deepEqual(errors, []);
  console.log('桌面冒烟检查通过：原有功能与三种主题、应用内完整原文、导航/刷新、外部打开、加载失败提示、原文沙盒隔离与窗口资源释放。');
  console.log('预览：' + previewDir);
}

async function finish(code) {
  for (const win of require('electron').BrowserWindow.getAllWindows()) win.destroy();
  if (fixtureServer) fixtureServer.close();
  await fs.rm(userDir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  app.exit(code);
}
run().then(() => finish(0), (error) => { console.error(error); return finish(1); });
