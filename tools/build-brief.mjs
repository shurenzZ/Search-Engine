#!/usr/bin/env node
/* 服务端定时抓取：产出 data/latest.json 供页面直读（raw.githubusercontent 的 CORS 是全开的）。
   用法：node tools/build-brief.mjs [--dry] [--only id,id] [--gap 1500] [--out data] */

import { writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVER_SOURCES, finalize, SNAPSHOT_SCHEMA } from './sources-server.mjs';
import { sleep, fmtDate } from './lib.mjs';

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
  const now = Date.now();
  const sources = ONLY.length ? SERVER_SOURCES.filter((s) => ONLY.includes(s.id)) : SERVER_SOURCES;
  const srcMeta = [];
  const items = [];

  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    const meta = {
      id: src.id, name: src.name, short: src.short, icon: src.icon, color: src.color,
      fallbackCat: src.fallbackCat, dayList: !!src.dayList, defaultOn: true,
      ok: false, count: 0, error: ''
    };
    try {
      const raws = await src.run();
      const done = finalize(src, raws, { now: now });
      if (!done.length) throw new Error('接口返回 0 条');
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
    hash: hash,
    generatedAt: payload.generatedAt,
    generatedAtMs: now,
    itemCount: items.length,
    okCount: srcMeta.filter((s) => s.ok).length,
    sources: srcMeta.map((s) => ({ id: s.id, ok: s.ok, count: s.count, error: s.error }))
  };

  const live = items.filter((it) => !it.ts || now - it.ts <= 48 * 3600e3).length;
  console.log('\n合计 ' + items.length + ' 条（其中 48h 内 ' + live + ' 条），' +
    manifest.okCount + '/' + srcMeta.length + ' 个源正常，hash ' + hash);

  if (DRY) {
    console.log('--dry：未写入文件');
    console.log(JSON.stringify(items.slice(0, 2), null, 2));
    return;
  }

  await mkdir(path.join(OUT_DIR, 'archive'), { recursive: true });
  await writeFile(path.join(OUT_DIR, 'latest.json'), body, 'utf8');
  await writeFile(path.join(OUT_DIR, 'archive', payload.date + '.json'), body, 'utf8');
  await writeFile(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 1), 'utf8');
  await pruneArchive();
  console.log('已写入 ' + path.relative(ROOT, OUT_DIR) + '/latest.json 与 archive/' + payload.date + '.json');
}

async function pruneArchive() {
  const dir = path.join(OUT_DIR, 'archive');
  let names = [];
  try { names = await readdir(dir); } catch (e) { return; }
  const cutoff = Date.now() - ARCHIVE_KEEP_DAYS * 86400000;
  for (const n of names) {
    const m = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(n);
    if (!m) continue;
    if (Date.parse(m[1] + 'T23:59:59Z') < cutoff) await rm(path.join(dir, n), { force: true });
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
