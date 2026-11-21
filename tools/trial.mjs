// 七天本地验收。每轮采集后调用真实页面的筛选与排序；人工评阅独立保存。
import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { browser } from './page-context.mjs';
import { fmtDate, getJson, getText, clean } from './lib.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = path.join(root, 'trial');
const run = promisify(execFile);
async function load(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}
async function save(file, value) {
  await writeFile(file + '.tmp', JSON.stringify(value, null, 1) + '\n');
  await rename(file + '.tmp', file);
}
function comparable(url) {
  return String(url || '').replace(/\/$/, '').replace(/(arxiv\.org\/abs\/[\d.]+)v\d+$/, '$1');
}

// 独立保留发布方的目录条目，方便每日复核所有候选之外的漏报。
async function referenceIndexes() {
  const indexes = ['https://openai.com/news/', 'https://arxiv.org/list/cs.LG/recent',
    'https://github.com/pytorch/pytorch/releases', 'https://github.com/huggingface/transformers/releases',
    'https://github.com/vllm-project/vllm/releases'];
  return Promise.all(indexes.map(async index => {
    try {
      const html = await getText(index);
      const origin = new URL(index).origin;
      if (origin === 'https://arxiv.org') {
        const entries = [...new Set([...html.matchAll(/\/abs\/(\d{4}\.\d{4,5})/g)].map(m => m[1]))];
        if (entries.length) return {index, records:entries.slice(0,15).map(id => ({url:origin+'/abs/'+id, label:'arXiv:'+id}))};
      }
      const links = [...html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
      const seen = new Set(), records = [];
      for (const [, href, body] of links) {
        const url = new URL(href, index);
        if (url.origin !== origin || !/\/abs\/\d|\/index\/|\/releases\/tag\//.test(url.pathname) || seen.has(url.pathname)) continue;
        seen.add(url.pathname);
        records.push({url:url.href, label:clean(body, 140)});
        if (records.length === 15) break;
      }
      return {index, records, ...(records.length ? {} : {error:'未解析到条目'})};
    } catch (error) { return {index, error:error.message}; }
  }));
}
async function sample() {
  const snapshot = await load(path.join(root, 'data/latest.json'));
  if (snapshot?.schema !== 2 || Date.now() - snapshot.generatedAtMs > 3600000) throw new Error('需要一小时内的新版快照');
  const day = fmtDate(new Date()), folder = path.join(dir, day);
  await mkdir(folder, {recursive:true});
  const ctx = browser();
  ctx.snapshot = snapshot;
  ctx.run('ingestSnapshot(snapshot)');
  const clients = ctx.run('liveSources().map(s => ({id:s.id, url:buildTargets(s)[0]}))');
  const errors = {};
  for (const source of clients) {
    try {
      ctx.raw = await getJson(source.url);
      ctx.sourceId = source.id;
      ctx.run('var src = sourceById(sourceId); state.buckets[sourceId] = extractItems(raw,src).filter(x => x.title || x.full_name).slice(0,settings.perSourceLimit).map((x,i) => normalizeItem(x,src,i));');
    } catch (e) { errors[source.id] = e.message; }
  }
  ctx.run('state.items = rebuildItems(state.buckets)');
  const top = ctx.run('topFlash(visibleItems(),10)').map(({title,url,eventKey,eventKind,sourceId,ts,summary,signal}) =>
    ({title,url,eventKey,eventKind,sourceId,ts,summary,signal}));
  const file = path.join(folder, 'observed.json');
  const record = await load(file, {day, runs:[], events:{}, top:null});
  const at = Date.now();
  if (!record.top) {
    record.top = top;
    record.sampledAt = at;
  }
  const indexFile = path.join(folder, 'indexes.json');
  const indexes = await load(indexFile, []);
  if (!indexes.length || indexes.some(i => i.error)) {
    const fresh = await referenceIndexes();
    await save(indexFile, fresh.map(i => indexes.find(old => old.index === i.index && !old.error) || i));
  }
  record.runs.push({at, snapshotAt:snapshot.generatedAtMs, itemCount:snapshot.items.length,
    errors:{...Object.fromEntries(snapshot.sources.filter(s=>!s.ok).map(s=>[s.id,s.error])), ...errors}});
  const priority = new Set(['openai','googleai','deepmind','release-pytorch','release-transformers','release-vllm']);
  for (const row of ctx.run('state.items')) {
    const key = comparable(row.url);
    if (!key) continue;
    const existing = record.events[key];
    const latency = priority.has(row.sourceId) && row.ts && row.eventKind === '首次发布' ? (row.eventSeenAt - row.ts) / 60000 : null;
    if (!existing || (latency !== null && existing.latency === null))
      record.events[key] = {title:row.title, source:row.sourceId, seen:row.eventSeenAt, event:row.ts, latency};
  }
  await save(file, record);
  console.log(day, '轮次', record.runs.length, '首页抽样', record.top.length, '源错误', record.runs.at(-1).errors);
}
async function report(firstDay) {
  const names = (await readdir(dir)).filter(n=>/^\d{4}-\d{2}-\d{2}$/.test(n) && n >= firstDay).sort().slice(0,7);
  const days = [], delays = new Map();
  let valid = 0, reviewed = 0, total = 0, covered = 0;
  const state = await load(path.join(dir, 'window.json'), {});
  for (const name of names) {
    const folder = path.join(dir, name), data = await load(path.join(folder, 'observed.json'));
    if (!data) continue;
    const refs = await load(path.join(folder,'reference.json'), []);
    const reviews = await load(path.join(folder,'review.json'), []);
    const misses = refs.filter(ref => !data.events[comparable(ref.url)]);
    const judgments = data.top.map(it => reviews.find(r => comparable(r.url) === comparable(it.url))).filter(Boolean);
    valid += judgments.filter(r=>r.valid === true).length;
    reviewed += judgments.length; total += refs.length; covered += refs.length - misses.length;
    for (const [key,item] of Object.entries(data.events)) {
      if (item.latency !== null && item.latency >= 0 && item.event >= state.startedAt) delays.set(key, item.latency);
    }
    days.push({day:name, rounds:data.runs.length, slots:data.top.length, reviewed:judgments.length,
      duplicates:judgments.filter(r=>r.duplicate).length, stale:judgments.filter(r=>r.stale).map(r=>r.url),
      references:refs.length, misses});
  }
  const values = [...delays.values()].sort((a,b)=>a-b);
  const percentile = p => values.length ? Math.round(10 * values[Math.ceil(p*values.length)-1])/10 : null;
  return {days, valid, reviewed, references:total, covered, delaySample:values.length, medianMinutes:percentile(.5), p90Minutes:percentile(.9)};
}
const mode = process.argv[2] || 'sample';
if (mode === 'sample') await sample();
else if (mode === 'report') console.log(JSON.stringify(await report(process.argv[3] || ''), null, 2));
else if (mode === 'watch') {
  await mkdir(dir,{recursive:true});
  const file = path.join(dir,'window.json');
  const window = await load(file, {startedAt:Date.now()});
  window.endsAt = window.startedAt + 7 * 86400000;
  await save(file, window);
  while (Date.now() < window.endsAt) {
    const start = Date.now();
    try {
      await run(process.execPath, ['tools/build-brief.mjs'], {cwd:root, timeout:480000});
      const observation = await run(process.execPath, ['tools/trial.mjs','sample'], {cwd:root, timeout:180000});
      console.log(observation.stdout.trim());
    } catch (e) { console.error(new Date().toISOString(), e.message); }
    await delay(Math.max(0, Math.min(window.endsAt, start + 1800000) - Date.now()));
  }
  console.log(JSON.stringify(await report(fmtDate(new Date(window.startedAt))),null,2));
} else throw new Error('用法：node tools/trial.mjs sample|watch|report');
