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
const publisherIndexes = ['https://openai.com/news/', 'https://arxiv.org/list/cs.LG/recent',
    'https://github.com/pytorch/pytorch/releases', 'https://github.com/huggingface/transformers/releases',
    'https://github.com/vllm-project/vllm/releases','https://www.anthropic.com/news','https://www.anthropic.com/research',
    'https://www.anthropic.com/engineering','https://platform.claude.com/docs/en/release-notes/overview',
    'https://arxiv.org/list/math/new','https://arxiv.org/list/physics/new','https://arxiv.org/list/cs.DS/new'];
async function referenceIndexes(indexes) {
  return Promise.all(indexes.map(async index => {
    try {
      const html = await getText(index);
      const origin = new URL(index).origin;
      if (origin === 'https://arxiv.org') {
        const entries = [...new Set([...html.matchAll(/\/abs\/(\d{4}\.\d{4,5})/g)].map(m => m[1]))];
        if (entries.length) return {index, records:entries.slice(0,15).map(id => ({url:origin+'/abs/'+id, label:'arXiv:'+id}))};
      }
      if (origin === 'https://platform.claude.com') {
        const dates = [...new Set([...html.matchAll(/\bid="([a-z]+-\d{1,2}-20\d{2})"/g)].map(m => m[1]))];
        if (dates.length) return {index, records:dates.slice(0,15).map(date => ({url:index+'#'+date,label:date}))};
      }
      const links = [...html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
      const seen = new Set(), records = [];
      for (const [, href, body] of links) {
        const url = new URL(href, index);
        const article = origin === 'https://www.anthropic.com' ? /<h[23]\b/i.test(body) || /^\/(research|engineering|news)\/[\w-]+$/.test(url.pathname) && clean(body,140).length > 25
          : /\/abs\/\d|\/index\/|\/releases\/tag\//.test(url.pathname);
        if (url.origin !== origin || !article || seen.has(url.pathname)) continue;
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
  const window = await load(path.join(dir, 'window.json'));
  const capturedAt = Date.now();
  if (window && (capturedAt < window.startedAt || capturedAt >= window.endsAt)) throw new Error('当前时间在七天验收窗口之外');
  // 例如上午启动，最后一个自然日的凌晨仍属于第七个观测日。
  const dayStart = window ? window.startedAt + Math.floor((capturedAt - window.startedAt) / 86400000) * 86400000 : capturedAt;
  const day = fmtDate(new Date(dayStart)), folder = path.join(dir, day);
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
  const at = capturedAt;
  if (!record.top) {
    record.top = top;
    record.sampledAt = at;
  } else if (window && record.sampledAt < window.startedAt && !record.windowHomepage) {
    record.windowHomepage = {at, top};
  }
  const indexFile = path.join(folder, 'indexes.json');
  const indexes = await load(indexFile, []);
  const missing = publisherIndexes.filter(url => !indexes.some(i => i.index === url && !i.error));
  if (missing.length) {
    const fresh = await referenceIndexes(missing);
    await save(indexFile, [...indexes.filter(i => !missing.includes(i.index)), ...fresh]);
  }
  record.runs.push({at, snapshotAt:snapshot.generatedAtMs, itemCount:snapshot.items.length,
    warnings:Object.fromEntries(snapshot.sources.filter(s=>s.warning).map(s=>[s.id,s.warning])),
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
  console.log(day, '轮次', record.runs.length, '首页抽样', (record.windowHomepage?.top ?? record.top).length, '源错误', record.runs.at(-1).errors);
}
async function report(firstDay) {
  const state = await load(path.join(dir, 'window.json'), {});
  const initial = state.startedAt ? fmtDate(new Date(state.startedAt)) : '';
  const final = state.endsAt ? fmtDate(new Date(state.endsAt - 86400000)) : '9999-12-31';
  const names = (await readdir(dir)).filter(n=>/^\d{4}-\d{2}-\d{2}$/.test(n) &&
    n >= initial && n >= firstDay && n <= final).sort();
  const days = [], delays = new Map();
  let valid = 0, reviewed = 0, total = 0, covered = 0;
  for (const name of names) {
    const folder = path.join(dir, name), data = await load(path.join(folder, 'observed.json'));
    if (!data) continue;
    const refs = await load(path.join(folder,'reference.json'), []);
    const baselineHomepage = data.sampledAt < state.startedAt;
    const top = baselineHomepage ? (data.windowHomepage?.top ?? []) : data.top;
    const reviews = await load(path.join(folder,baselineHomepage ? 'window-review.json' : 'review.json'), []);
    const misses = refs.filter(ref => !data.events[comparable(ref.url)]);
    const judgments = top.map(it => reviews.find(r => comparable(r.url) === comparable(it.url))).filter(Boolean);
    valid += judgments.filter(r=>r.valid === true).length;
    reviewed += judgments.length; total += refs.length; covered += refs.length - misses.length;
    for (const [key,item] of Object.entries(data.events)) {
      if (Number.isFinite(item.latency) && item.latency >= 0 && item.event >= state.startedAt && item.seen < state.endsAt)
        delays.set(key, Math.min(item.latency, delays.get(key) ?? Infinity));
    }
    const rounds = data.runs.filter(r => r.at >= (state.startedAt || 0) && r.at < (state.endsAt || Infinity));
    days.push({day:name, rounds:rounds.length, baselineRounds:data.runs.length-rounds.length,
      slots:top.length, sampledAt:baselineHomepage ? (data.windowHomepage?.at ?? null) : data.sampledAt,
      baselineSlots:baselineHomepage ? data.top.length : 0, reviewed:judgments.length,
      duplicates:judgments.filter(r=>r.duplicate).length, stale:judgments.filter(r=>r.stale).map(r=>r.url),
      references:refs.length, misses});
  }
  const values = [...delays.values()].sort((a,b)=>a-b);
  const middle = Math.floor(values.length / 2);
  const median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  const p90 = values[Math.ceil(values.length * 0.9) - 1];
  const rounded = value => Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
  return {days, valid, reviewed, references:total, covered, delaySample:values.length, medianMinutes:rounded(median), p90Minutes:rounded(p90)};
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
