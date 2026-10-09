#!/usr/bin/env node
/* 源契约自检：逐个请求，断言「有数组、能取到标题、声明过的字段真的在」。
   60s 这类第三方接口会随意改字段名（例如知乎已不再返回 hot_value），这是浏览器之外唯一能发现回归的手段。
   用法：node tools/verify-sources.mjs [--server|--client] [--only id,id] [--report-only] [--gap 2100] */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVER_SOURCES, finalize } from './sources-server.mjs';
import { dig, fillDyn, parseTime, parseHot, clean, sleep } from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = path.join(ROOT, '每日热搜早报.html');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt;
}
const GAP = Number(arg('gap', 2100));
const REPORT_ONLY = process.argv.includes('--report-only');
const ONLY = (arg('only', '') || '').split(',').filter(Boolean);
const WANT_SERVER = process.argv.includes('--server');
const WANT_CLIENT = process.argv.includes('--client');
const BOTH = !WANT_SERVER && !WANT_CLIENT;

const TITLE_KEYS = ['title', 'name', 'word', 'query', 'keyword'];
const URL_KEYS = ['link', 'url', 'mobileUrl', 'share_url', 'href'];

/* 从页面里取出 SOURCES 字面量：这样检查的是真配置，不是影子副本 */
function readClientSources() {
  const src = readFileSync(HTML, 'utf8');
  const m = /var SOURCES = (\[[\s\S]*?\n\]);/.exec(src);
  if (!m) throw new Error('没在页面里找到 SOURCES 数组');
  const base = /apiBase:\s*'([^']+)'/.exec(src);
  return { sources: new Function('return ' + m[1])(), apiBase: base ? base[1] : 'https://60s.viki.moe' };
}

/* 与页面 extractItems 保持同一套取数组规则 */
function locateList(json, src) {
  if (!json) return { list: [], note: '无响应' };
  let d = json.data !== undefined ? json.data : json;
  if (src.pick) d = dig(d, src.pick);
  if (src.kind === 'news') {
    const arr = Array.isArray(d) ? d : (d && Array.isArray(d.news) ? d.news : []);
    return { list: arr, strings: true };
  }
  if (src.kind === 'newsItems') return { list: (d && Array.isArray(d.news)) ? d.news : [] };
  if (Array.isArray(d)) return { list: d };
  if (d && Array.isArray(d.list)) return { list: d.list };
  if (Array.isArray(json)) return { list: json };
  return { list: [], note: '取不到数组（检查 pick/kind）' };
}

function titleOf(raw, src, strings) {
  if (strings && typeof raw === 'string') return clean(raw, 200);
  if (typeof raw !== 'object' || !raw) return '';
  if (src.titleField && raw[src.titleField]) return String(raw[src.titleField]);
  for (const k of TITLE_KEYS) if (raw[k] && typeof raw[k] === 'string') return clean(raw[k], 200);
  return '';
}

async function checkOne(label, url, src) {
  const row = { id: label, ok: false, count: 0, note: '', sample: '' };
  const t0 = Date.now();
  let json, rate = '';
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000), cache: 'no-store' });
    const rem = res.headers.get('x-ratelimit-remaining');
    if (rem !== null) rate = ' 配额剩余 ' + rem;
    if (!res.ok) { row.note = 'HTTP ' + res.status + rate; return row; }
    json = JSON.parse(await res.text());
  } catch (e) {
    row.note = (e.name === 'TimeoutError' ? '请求超时' : e.message) + rate;
    return row;
  }
  if (json && typeof json.code === 'number' && json.code !== 200 && json.code !== 0) {
    row.note = '接口 code ' + json.code + rate;
    return row;
  }
  const found = locateList(json, src);
  const list = found.list;
  row.count = list.length;
  if (!list.length) { row.note = (found.note || '空列表') + rate; return row; }

  const badTitle = list.filter((r) => !titleOf(r, src, found.strings)).length;
  if (badTitle) { row.note = badTitle + '/' + list.length + ' 条取不到标题（检查 titleField）' + rate; return row; }

  const probe = (k) => list.slice(0, 8).some((r) => r && typeof r === 'object' && r[k] !== undefined && r[k] !== '' && r[k] !== 0);
  const misses = [];
  if (src.hotField && src.hotField !== 'none' && !probe(src.hotField)) misses.push('热度字段 ' + src.hotField + ' 缺失');
  if (src.timeField && src.timeField !== 'none') {
    const ts = list.slice(0, 8).map((r) => parseTime(r && r[src.timeField])).filter(Boolean);
    if (!ts.length) misses.push('时间字段 ' + src.timeField + ' 解析不出');
  }
  const first = list[0];
  const hasUrl = found.strings ? !!src.searchUrl || !!(first && first.link) : URL_KEYS.some((k) => first && first[k]) || !!src.searchUrl;
  if (!hasUrl) misses.push('无链接且未配 searchUrl');

  row.sample = clean(titleOf(first, src, found.strings), 44);
  row.ok = !misses.length;
  row.note = (misses.join('；') || '通过') + rate;
  row.ms = Date.now() - t0;
  return row;
}

async function main() {
  const results = [];
  let failures = 0;

  if (BOTH || WANT_SERVER) {
    console.log('\n=== 服务端源（Actions 快照）===');
    for (let i = 0; i < SERVER_SOURCES.length; i++) {
      const src = SERVER_SOURCES[i];
      if (ONLY.length && !ONLY.includes(src.id)) continue;
      let row = { id: src.id, ok: false, count: 0, note: '', sample: '' };
      try {
        const raws = await src.run();
        const done = finalize(src, raws, {});
        row.count = done.length;
        row.ok = done.length > 0;
        row.sample = done.length ? done[0].title.slice(0, 44) : '';
        row.note = done.length ? '通过' : '0 条';
        const noTs = done.filter((x) => !x.ts).length;
        if (noTs === done.length && done.length) row.note = '通过（全部无发布时间）';
        else if (noTs) row.note = '通过（' + noTs + ' 条无时间）';
      } catch (e) {
        const cause = e && e.cause ? (e.cause.code || e.cause.message || '') : '';
        const base = String(e.message || e);
        row.note = (cause && cause !== base ? base + '（' + cause + '）' : base).slice(0, 90);
      }
      print(row);
      results.push(row);
      if (!row.ok) failures++;
      if (i < SERVER_SOURCES.length - 1) await sleep(600);
    }
  }

  if (BOTH || WANT_CLIENT) {
    console.log('\n=== 浏览器直连源（页面 SOURCES）===');
    const { sources, apiBase } = readClientSources();
    for (let i = 0; i < sources.length; i++) {
      const src = sources[i];
      if (ONLY.length && !ONLY.includes(src.id)) continue;
      const p = Array.isArray(src.path) ? src.path[0] : src.path;
      const url = /^https?:/i.test(p) ? fillDyn(p) : apiBase.replace(/\/+$/, '') + fillDyn(p);
      const row = await checkOne(src.id, url, src);
      print(row);
      results.push(row);
      if (!row.ok) failures++;
      if (i < sources.length - 1) await sleep(GAP);
    }
  }

  const okN = results.filter((r) => r.ok).length;
  console.log('\n通过 ' + okN + '/' + results.length + (failures ? '，失败 ' + failures + ' 个' : '，全部通过'));
  if (failures && !REPORT_ONLY) process.exitCode = 1;
}

function print(row) {
  const flag = row.ok ? '  ok ' : ' FAIL ';
  console.log(flag + row.id.padEnd(11) + String(row.count).padStart(3) + ' 条  ' +
    row.note + (row.sample ? '  ▸ ' + row.sample : ''));
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
