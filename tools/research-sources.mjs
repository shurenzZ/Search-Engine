import { clean, getText, parseFeed, parseTime } from './lib.mjs';

export const CLAUDE_NOTES = 'https://platform.claude.com/docs/en/release-notes/overview';
const anthropic = 'https://www.anthropic.com';

function requireRecords(rows, name) {
  if (!rows.length) throw new Error(name + ' 未解析到带原文和发布日期的条目');
  return rows.sort((a, b) => b.ts - a.ts);
}

// 只读公开目录的文章卡片，日期、标题和链接必须来自同一行。
export function anthropicDirectory(html, section) {
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1] || '';
  const cards = main.split(/<[^<>]+\bdata-listing-row="[^"]+"[^>]*>/i).slice(1);
  const rows = [];
  for (const card of cards) {
    const heading = /<h3\b[^>]*>([\s\S]*?)<\/h3>/i.exec(card);
    if (!heading) continue;
    const link = /<a\b[^>]*\bhref="([^"]+)"/i.exec(heading[1]) ||
      /<a\b[^>]*\bhref="([^"]+)"[^>]*>(?:\s*<span\b[^>]*>)*\s*$/i.exec(card.slice(0, heading.index));
    const date = /<time\b[^>]*>([^<]+)<\/time>/i.exec(card);
    if (!link || !date) continue;
    const url = new URL(link[1], anthropic);
    if (url.protocol !== 'https:' || !['www.anthropic.com','claude.com','www.claude.com'].includes(url.hostname)) continue;
    const ts = parseTime(date[1] + ' 00:00:00 GMT');
    if (ts) rows.push({title:clean(heading[1],200), summary:clean(/<p\b[^>]*>([^<]{30,})<\/p>/i.exec(card)?.[1] || '',600),
      url:url.href, ts, tags:['Anthropic',section], publisher:'Anthropic'});
  }
  return requireRecords(rows, section);
}

export function claudeNotes(markdown) {
  const headings = [...markdown.matchAll(/^### ([A-Z][a-z]+ \d{1,2}, 20\d\d)\s*$/gm)];
  const rows = headings.flatMap((m, i) => {
    const date = m[1], ts = parseTime(date + ' 00:00:00 GMT');
    const body = markdown.slice(m.index + m[0].length, headings[i+1]?.index ?? markdown.length)
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/^[*+-] /gm, '').replace(/[`*]/g, '').trim();
    if (!body || !ts) return [];
    const anchor = date.toLowerCase().replace(/,/g, '').replace(/ /g, '-');
    return [{title:'Claude API · ' + clean(body.split('\n')[0], 132), summary:clean(body,600), ts,
      updatedAt:ts, updateType:'重要更新', url:CLAUDE_NOTES + '#' + anchor, publisher:'Anthropic', tags:['Claude API','开发者更新']}];
  });
  return requireRecords(rows, 'Claude 平台更新日志');
}

async function fetchAnthropic({warnings = []} = {}) {
  const sections = [['news','官方公告'], ['research','研究'], ['engineering','工程']];
  const requests = sections.map(async ([path, label]) => anthropicDirectory(await getText(anthropic + '/' + path), label));
  requests.push(getText(CLAUDE_NOTES + '.md').then(claudeNotes));
  const results = await Promise.allSettled(requests);
  const labels = [...sections.map(s => s[1]), 'Claude API'];
  const rows = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') rows.push(...r.value);
    else warnings.push(labels[i] + '：' + r.reason.message);
  });
  if (!rows.length) throw new Error(warnings.join('；'));
  const articles = new Map();
  for (const row of rows) {
    const prior = articles.get(row.url);
    if (prior) prior.tags = [...new Set([...prior.tags, ...row.tags])];
    else articles.set(row.url, row);
  }
  return [...articles.values()].sort((a,b) => b.ts-a.ts);
}

export function metaBlog(html) {
  const rows = [];
  // 标题链接之后紧跟该卡片的日期；禁止跨过其他链接寻找日期。
  const card = /<a\b[^>]*\bhref="(https:\/\/ai\.meta\.com\/blog\/[\w-]+\/)"[^>]*>([^<>]+)<\/a>((?:\s*<\/?div\b[^>]*>){1,6})\s*([A-Z][a-z]+ \d{1,2}, 20\d\d)<\/div>/g;
  for (const m of html.matchAll(card)) {
    const ts = parseTime(m[4] + ' 00:00:00 GMT');
    if (ts) rows.push({title:clean(m[2],200), url:m[1], ts, tags:['官方','AI 研究']});
  }
  return requireRecords(rows, 'Meta AI');
}

// RSS 的 pubDate 是 arXiv 的公告日。只收新稿，排除交叉收录及修订，然后在一级小类间轮流取稿。
export function preprintAnnouncements(xml, label) {
  if (!/<rss\b/.test(xml) || !/<title>[^<]*updates on arXiv\.org<\/title>/i.test(xml)) throw new Error('arXiv 公告结构异常');
  const groups = new Map();
  for (const block of xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/g) || []) {
    if (!/<arxiv:announce_type>new<\/arxiv:announce_type>/.test(block)) continue;
    const row = parseFeed(block)[0];
    if (!row?.ts || !/^https:\/\/arxiv\.org\/abs\/\d{4}\.\d{4,5}$/.test(row.url)) throw new Error('arXiv 新稿缺少有效日期或链接');
    const subject = /<category>([^<]+)<\/category>/.exec(block)?.[1] || label;
    if (!groups.has(subject)) groups.set(subject, []);
    groups.get(subject).push({title:row.title, url:row.url + 'v1', summary:row.summary.replace(/^.*?Abstract:\s*/i,''),
      attentionAt:row.ts, updateType:'新稿公告', tags:[label,subject,'预印本']});
  }
  const result = [], lists = [...groups.values()];
  for (let rank = 0; lists.some(group => group.length > rank); rank++)
    for (const group of lists) if (group[rank]) result.push(group[rank]);
  return result;
}

function journalFeed(url, tag, accept) {
  return async () => {
    const rows = parseFeed(await getText(url)).filter(r => r.title && r.ts && accept.test(r.url));
    return requireRecords(rows.map(r => ({...r, url:r.url.replace(/^http:/,'https:'), tags:[tag]})), tag);
  };
}

export const RESEARCH_SOURCES = [
  {id:'anthropic', name:'Anthropic · 研究、工程、公告与 Claude API', short:'Anthropic', fallbackCat:'ai', max:28, maxAgeH:720, run:fetchAnthropic},
  {id:'ms-research', name:'Microsoft Research', short:'MS Research', fallbackCat:'ai', max:10, maxAgeH:336,
    run:journalFeed('https://www.microsoft.com/en-us/research/feed/', '机构研究', /^https:\/\/www\.microsoft\.com\/en-us\/research\/blog\//)},
  {id:'meta-ai', name:'Meta AI 官方博客', short:'Meta AI', fallbackCat:'ai', max:10, maxAgeH:720,
    run:async () => metaBlog(await getText('https://ai.meta.com/blog/'))},
  {id:'meta-ml', name:'Meta Engineering · 机器学习', short:'Meta 工程', fallbackCat:'ai', max:8, maxAgeH:720,
    run:journalFeed('https://engineering.fb.com/category/ml-applications/feed/', '机器学习工程', /^https:\/\/engineering\.fb\.com\/20/)},
  {id:'annals-math', name:'Annals of Mathematics · 新论文', short:'Annals', category:'math', max:8, maxAgeH:1440,
    run:journalFeed('https://annals.math.princeton.edu/feed', '数学论文', /^https:\/\/annals\.math\.princeton\.edu\/(?:articles\/|20\d\d\/)/)},
  {id:'prl', name:'Physical Review Letters · 新论文', short:'PRL', category:'physics', max:12, maxAgeH:168,
    run:journalFeed('https://feeds.aps.org/rss/recent/prl.xml', '物理论文', /^https?:\/\/(?:link|journals)\.aps\.org\//)}
].map(s => ({icon:'🔬', color:'#376674', fallbackCat:s.category || 'ai', ...s}));
