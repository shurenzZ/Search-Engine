import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isAppUrl, isExternalUrl, validateExport, contentSecurityPolicy } = require('../desktop/security.cjs');

test('应用内锚点跳转保留原生功能，其他页面不能调用桥接', () => {
  assert.equal(isAppUrl('brief://app/'), true);
  assert.equal(isAppUrl('brief://app/#main'), true);
  for (const url of [undefined, 'brief://app.evil/', 'brief://app/desktop/main.cjs', 'https://app/', 'brief://app/?remote=1']) assert.equal(isAppUrl(url), false);
});

test('桌面端只在系统浏览器打开普通 HTTP(S) 链接', () => {
  for (const url of ['https://bo3.gg/matches', 'https://example.com/a?q=中文', 'http://localhost:3000']) assert.equal(isExternalUrl(url), true);
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'ms-settings:privacy', 'https://user:pass@example.com', 'invalid']) assert.equal(isExternalUrl(url), false);
});

test('桌面导出拒绝路径、可执行文件和超大载荷', () => {
  assert.deepEqual(validateExport({ filename: '每日早报.json', text: '{}' }), { filename: '每日早报.json', text: '{}' });
  for (const filename of ['../secret.txt', 'C:\\file.txt', 'x.exe', 'bad\u0000.txt', 'a'.repeat(170) + '.txt']) {
    assert.throws(() => validateExport({ filename, text: '' }));
  }
  assert.throws(() => validateExport({ filename: 'x.txt', text: 'a'.repeat(25 * 1024 * 1024 + 1) }));
  assert.throws(() => validateExport({ filename: 'x.json', text: {} }));
});

test('桌面 CSP 精确授权共用页面的脚本，禁止额外脚本与嵌入页面', () => {
  const html = readFileSync(new URL('../每日热搜早报.html', import.meta.url), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const hash = createHash('sha256').update(script).digest('base64');
  const csp = contentSecurityPolicy(html);
  assert.ok(csp.includes(`script-src 'sha256-${hash}'`));
  assert.ok(csp.includes("frame-src 'none'"));
  assert.ok(!csp.includes('unsafe-eval'));
  assert.throws(() => contentSecurityPolicy('<html></html>'));
});

test('原文工具栏脚本使用独立 CSP 授权，远程网页不需要 iframe 嵌入', () => {
  const html = readFileSync(new URL('../desktop/reader.html', import.meta.url), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const hash = createHash('sha256').update(script).digest('base64');
  assert.ok(contentSecurityPolicy(html).includes(`script-src 'sha256-${hash}'`));
  assert.ok(!html.includes('<iframe'));
});
