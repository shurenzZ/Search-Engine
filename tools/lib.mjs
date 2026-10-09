/* 服务端抓取与契约自检共用的工具函数。
   页面里的 ES5 版本（每日热搜早报.html）保持同一套规则；改这里时同步改页面。 */

export const DAY = 86400000;
export const UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  Accept: 'application/json,text/html;q=0.9,*/*;q=0.8'
};

export function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function request(url, asText) {
  const res = await fetch(url, {
    headers: UA,
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
    cache: 'no-store'
  });
  if (!res.ok) {
    const e = new Error('HTTP ' + res.status);
    e.status = res.status;
    e.rateRemain = Number(res.headers.get('x-ratelimit-remaining'));
    e.rateReset = Number(res.headers.get('x-ratelimit-reset'));
    throw e;
  }
  if (asText) return res.text();
  const txt = await res.text();
  try { return JSON.parse(txt); }
  catch (e) { throw new Error('返回非 JSON：' + txt.slice(0, 60)); }
}

export const getJson = (url) => request(url, false);
export const getText = (url) => request(url, true);

/* 点分路径取值：'metals' / 'data.items' / 'a.0.b' */
export function dig(obj, dotted) {
  const parts = String(dotted || '').split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

/* 路径里的日期占位符：{yyyy-mm-dd}、{today-minus-7} */
export function fillDyn(p) {
  return String(p).replace(/\{today-minus-(\d+)\}/g, function (_, n) {
    return fmtDate(new Date(Date.now() - Number(n) * DAY));
  }).replace(/\{yyyy-mm-dd\}/g, fmtDate(new Date()));
}

export function fmtDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/* 只接受 2000 年之后、且不晚于未来 2 天的时间，避免把 '1604' 这类年份当成时间戳 */
function sane(ms) {
  if (!Number.isFinite(ms)) return 0;
  if (ms < 946684800000 || ms > Date.now() + 2 * DAY) return 0;
  return Math.round(ms);
}

export function parseTime(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number' || /^\d{9,13}$/.test(String(v).trim())) {
    let n = Number(v);
    if (n > 1e12) return sane(n);
    if (n > 1e8) return sane(n * 1000);
    return 0;
  }
  const s = String(v).trim();
  let t = Date.parse(s.replace(' ', 'T'));
  if (!Number.isFinite(t)) t = Date.parse(s);
  return Number.isFinite(t) ? sane(t) : 0;
}

/* 热度字符串归一：'947.5w' → 9475000，'9.55万' → 95500，'1.2亿' → 1.2e8，'1,234' → 1234 */
export function parseHot(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : 0;
  const s = String(v).trim().replace(/,/g, '');
  const m = /^([\d]+(?:\.\d+)?)\s*(亿|万|kw|w|k|m|million|billion)?/i.exec(s);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const u = (m[2] || '').toLowerCase();
  const mul = { '': 1, k: 1e3, w: 1e4, 万: 1e4, m: 1e6, million: 1e6, 亿: 1e8, billion: 1e9, kw: 1e7 }[u];
  return Math.round(n * (mul || 1));
}

export function fmtNum(n) {
  n = Number(n);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n >= 1e8) return trim(n / 1e8, '亿');
  if (n >= 1e4) return trim(n / 1e4, '万');
  return String(Math.round(n));
}
function trim(v, unit) {
  const s = v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
  return s.replace(/\.0$/, '') + unit;
}

const ENT_MAP = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·',
  mdash: '—', ndash: '–', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', hellip: '…'
};

export function decodeEnt(s) {
  return String(s == null ? '' : s).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, function (_, e) {
    const key = e.toLowerCase();
    if (key[0] === '#') {
      const code = key[1] === 'x' ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(Math.min(code, 0x10FFFF)) : '';
    }
    return ENT_MAP[key] !== undefined ? ENT_MAP[key] : '';
  });
}

export function stripHtml(s) {
  return String(s == null ? '' : s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[ \t\u00a0\u3000]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

export function clean(s, max) {
  const t = decodeEnt(stripHtml(s)).replace(/\s+/g, ' ').trim();
  if (!max) return t;
  return t.length > max ? t.slice(0, max) + '…' : t;
}

function blockOf(xml, name, from) {
  const re = new RegExp('<' + name + '[\\s>][\\s\\S]*?</' + name + '>', 'g');
  re.lastIndex = from;
  const m = re.exec(xml);
  return m ? { text: m[0], end: re.lastIndex } : null;
}

function fieldOf(block, name) {
  const m = new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i').exec(block);
  if (m) return decodeEnt(stripHtml(m[1]));
  const self = new RegExp('<' + name + '\\s[^>]*?/>', 'i').exec(block);
  return self ? '' : '';
}

function attrOfFirst(block, name, attr) {
  const m = new RegExp('<' + name + '\\s[^>]*?' + attr + '="([^"]+)"', 'i').exec(block);
  return m ? m[1] : '';
}

/* RSS 2.0 与 Atom 通吃：先找 item，再找 entry */
export function parseFeed(xml) {
  const s = String(xml || '');
  let blocks = s.match(/<item[\s>][\s\S]*?<\/item>/g);
  let atom = false;
  if (!blocks || !blocks.length) {
    blocks = s.match(/<entry[\s>][\s\S]*?<\/entry>/g);
    atom = true;
  }
  if (!blocks) return [];
  return blocks.map(function (b) {
    const title = clean(fieldOf(b, 'title'), 200);
    let url = atom ? attrOfFirst(b, 'link', 'href') : clean(fieldOf(b, 'link'), 400);
    if (!url) url = attrOfFirst(b, 'link', 'href');
    if (!url) { const m = /https?:\/\/[^\s<"']+/i.exec(b); url = m ? m[0] : ''; }
    const summary = clean(
      fieldOf(b, 'content:encoded') || fieldOf(b, 'description') ||
      fieldOf(b, 'summary') || fieldOf(b, 'content') || '', 600);
    const date = fieldOf(b, 'pubDate') || fieldOf(b, 'published') ||
      fieldOf(b, 'dc:date') || fieldOf(b, 'updated') || fieldOf(b, 'date');
    return { title: title, url: url, summary: summary, ts: parseTime(date) };
  }).filter(function (x) { return x.title; });
}

/* 32 位字符串指纹，用于生成稳定的条目 id */
export function hash8(s) {
  let h = 5381;
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export { blockOf };
