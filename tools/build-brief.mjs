#!/usr/bin/env node
/* 服务端定时抓取：产出 data/latest.json 供页面直读（raw.githubusercontent 的 CORS 是全开的）。
   用法：node tools/build-brief.mjs [--dry] [--only id,id] [--gap 1500] [--out data] */

import translation from '../web/translation.js';
import { readFile, writeFile, rename, mkdir, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVER_SOURCES, finalize, SNAPSHOT_SCHEMA } from './sources-server.mjs';
import { sleep, fmtDate, enableRequestCache } from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt;
}
const DRY = process.argv.includes('--dry');
const GAP = Number(arg('gap', 1200));
const OUT_DIR = path.resolve(ROOT, arg('out', 'data'));
const ONLY = (arg('only', '') || '').split(',').filter(Boolean);

const ARCHIVE_KEEP_DAYS = 14;

async function main() {
  if (!Number.isFinite(GAP) || GAP < 0) throw new Error('--gap 必须是非负数字');
  const unknown = ONLY.filter((id) => !SERVER_SOURCES.some((s) => s.id === id));
  if (unknown.length) throw new Error('未知数据源：' + unknown.join(', '));
  if (ONLY.length && !DRY && OUT_DIR === path.join(ROOT, 'data')) {
    throw new Error('--only 请配合 --dry 或独立 --out 目录，避免用部分数据覆盖完整快照');
  }
  if (!DRY) await enableRequestCache(path.join(OUT_DIR, '.http-cache'));
  const now = Date.now();
  const historyFile = path.join(OUT_DIR, 'observations.json');
  const previous = new Map();
  const cutoff = now - 90 * 86400000;
  for (const filename of [historyFile, path.join(OUT_DIR, 'latest.json')]) {
    try {
      const file = JSON.parse(await readFile(filename, 'utf8'));
      if (file.schema !== SNAPSHOT_SCHEMA || !Array.isArray(file.items)) continue;
      for (const row of file.items) {
        const lastSeenAt = row.lastSeenAt || file.generatedAtMs;
        if (lastSeenAt >= cutoff) previous.set(row.id, {...previous.get(row.id), ...row, lastSeenAt});
      }
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
  }
  const sources = ONLY.length ? SERVER_SOURCES.filter((s) => ONLY.includes(s.id)) : SERVER_SOURCES;
  const srcMeta = [];
  const items = [];

  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    const meta = {
      id: src.id, name: src.name, short: src.short, icon: src.icon, color: src.color,
      fallbackCat: src.fallbackCat, dayList: !!src.dayList, defaultOn: true,
      category: src.category || '',
      ok: false, count: 0, error: ''
    };
    try {
      const warnings = [];
      const raws = await src.run({papers: items, previous, warnings});
      if (warnings.length) meta.warning = warnings.join('；');
      const done = finalize(src, raws, { now: Date.now(), previous });
      if (!done.length && !src.allowEmpty) {
        if (!raws.length) throw new Error('接口返回 0 条');
        const outside = raws.every(r => r?.title && r.ts && src.maxAgeH &&
          Math.max(r.ts, r.updatedAt || 0, r.attentionAt || 0) < now - src.maxAgeH * 3600e3);
        if (!outside) throw new Error('上游条目均无法归一化，请检查标题与日期字段');
      }
      items.push(...done);
      meta.ok = true;
      meta.count = done.length;
      console.log('  ok   ' + pad(src.id) + ' ' + done.length + ' 条');
    } catch (e) {
      /* undici 的连接层错误都挂在 e.cause 上，只报 message 会只剩「fetch failed」这种无信息量文本 */
      const cause = e && e.cause ? (e.cause.code || e.cause.message || '') : '';
      const base = String((e && e.message) || e);
      meta.error = (cause && cause !== base ? base + '（' + cause + '）' : base).slice(0, 160);
      console.log('  FAIL ' + pad(src.id) + ' ' + meta.error);
    }
    srcMeta.push(meta);
    if (i < sources.length - 1) await sleep(GAP);
  }

  if (!DRY) {
    const known = new Map();
    for (const old of previous.values()) {
      for (const key of ['title','summary']) {
        if (old[key] && old[key + 'Zh']) known.set(old[key], old[key + 'Zh']);
      }
    }
    try { await translation.translate(items, {known}); }
    catch (error) { console.warn('中文翻译暂缺，保留原文：' + error.message); }
  }

  // 已核验的论文状态随原文展示，修订通知在当天的候选中另有对应展示。
  const status = new Map();
  for (const row of [...previous.values(), ...items]) {
    if (row.sourceId !== 'crossref') continue;
    const old = status.get(row.eventKey);
    if (!old || row.ts >= old.ts) status.set(row.eventKey, row);
  }
  for (const row of items) {
    const notice = status.get(row.eventKey);
    if (notice) {
      row.academicStatus = notice.eventKind;
      row.recordUrl = notice.recordUrl;
    }
    previous.set(row.id, {...row, lastSeenAt: Date.now()});
  }
  const payload = {
    schema: SNAPSHOT_SCHEMA,
    app: 'search-engine-brief',
    generatedAt: new Date(now).toISOString(),
    generatedAtMs: now,
    date: fmtDate(new Date(now)),
    sources: srcMeta,
    items: items
  };

  const body = JSON.stringify(payload);
  const hash = createHash('sha256').update(body).digest('hex').slice(0, 16);
  const manifest = {
    schema: SNAPSHOT_SCHEMA,
    hash,
    generatedAt: payload.generatedAt,
    generatedAtMs: now,
    itemCount: items.length,
    okCount: srcMeta.filter((s) => s.ok).length,
    sources: srcMeta.map((s) => ({ id: s.id, ok: s.ok, count: s.count, error: s.error, ...(s.warning ? {warning:s.warning} : {}) }))
  };

  const live = items.filter((it) => it.ts && now - it.ts <= 48 * 3600e3).length;
  console.log('\n合计 ' + items.length + ' 条（其中 48h 内 ' + live + ' 条），' +
    manifest.okCount + '/' + srcMeta.length + ' 个源正常，hash ' + hash);

  if (DRY) {
    console.log('--dry：未写入文件');
    console.log(JSON.stringify(items.slice(0, 2), null, 2));
    if (!items.length && srcMeta.some((s) => !s.ok)) process.exitCode = 1;
    return;
  }

  if (!items.length && srcMeta.some((s) => !s.ok)) throw new Error('所有源均无可用条目，保留现有快照');
  await mkdir(path.join(OUT_DIR, 'archive'), { recursive: true });
  const history = [...previous.values()].map(({id, sourceId, eventKey, firstSeenAt, eventSeenAt, ts,
    eventKind, lastSeenAt, doi, title, url, publishedAt, recordUrl}) => ({
    id, sourceId, eventKey, firstSeenAt, eventSeenAt, ts, eventKind, lastSeenAt,
    ...(sourceId === 'arxiv' ? {doi, title, url, publishedAt} : {}),
    ...(['crossref','research-verification'].includes(sourceId) ? {recordUrl} : {})
  }));
  await writeAtomic(historyFile, JSON.stringify({schema: SNAPSHOT_SCHEMA, items: history}));
  await writeAtomic(path.join(OUT_DIR, 'latest.json'), body);
  // file:// 页面无法 fetch 同目录 JSON，用同一份已序列化数据提供本地离线入口。
  await writeAtomic(path.join(OUT_DIR, 'file-snapshot.js'), 'window.readLocalBrief(' + body.replace(/</g, '\\u003c') + ');\n');
  await writeAtomic(path.join(OUT_DIR, 'archive', payload.date + '.json'), body);
  await writeAtomic(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 1));
  await pruneArchive();
  console.log('已写入 ' + path.relative(ROOT, OUT_DIR) + '/latest.json 与 archive/' + payload.date + '.json');
}

/* 每个文件独立原子替换，manifest 最后写入；跨文件不是事务，读取方可用 hash 校验。 */
async function writeAtomic(file, data) {
  const tmp = file + '.tmp';
  await writeFile(tmp, data, 'utf8');
  await rename(tmp, file);
}

async function pruneArchive() {
  const dir = path.join(OUT_DIR, 'archive');
  let names = [];
  try { names = await readdir(dir); } catch (e) { return; }
  const cutoff = Date.now() - ARCHIVE_KEEP_DAYS * 86400000;
  for (const n of names) {
    const m = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(n);
    if (!m) continue;
    if (Date.parse(m[1] + 'T23:59:59Z') >= cutoff) continue;
    const file = path.join(dir, n);
    // 旧数据集作为迁移前的对照，继续对本版的滚动快照执行原有保留期。
    if (JSON.parse(await readFile(file, 'utf8')).schema === SNAPSHOT_SCHEMA) await rm(file, { force: true });
  }
}

function pad(id) {
  const s = String(id);
  return s + ' '.repeat(Math.max(0, 10 - s.length));
}

main().catch(function (e) {
  console.error('生成失败：', e && e.stack ? e.stack : e);
  process.exitCode = 1;
});
