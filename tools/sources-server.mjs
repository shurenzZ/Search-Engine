import { verificationReports } from './research-verification.mjs';
import { CLAUDE_NOTES, preprintAnnouncements, RESEARCH_SOURCES } from './research-sources.mjs';
import { getJson, getText, parseFeed, parseTime, parseHot, clean, fmtNum, fmtDate, hash8, sleep } from './lib.mjs';

/* GitHub Trending 是 HTML 页，没有 API；按 article 切块解析，不受 REST 配额限制 */
export function parseTrending(html) {
  const parts = String(html || '').split(/<article class="Box-row">/).slice(1);
  const out = [];
  for (const b of parts) {
    const h2 = (/<h2 class="h3 lh-condensed">([\s\S]*?)<\/h2>/i.exec(b) || ['', ''])[1];
    const repo = (/<a[^>]*href="\/([^"?]+)"/i.exec(h2) || ['', ''])[1];
    if (!repo) continue;
    const desc = clean((/<p class="col-9[^"]*">([\s\S]*?)<\/p>/i.exec(b) || ['', ''])[1], 400);
    const lang = (/<span[^>]*itemprop="programmingLanguage"[^>]*>([^<]+)<\/span>/i.exec(b) || ['', ''])[1].trim();
    const today = parseHot((/([\d,]+)\s+stars today/i.exec(b) || ['', ''])[1]);
    const total = parseHot(clean((/<a[^>]*href="\/[^"]+\/stargazers"[^>]*>([\s\S]*?)<\/a>/i.exec(b) || ['', ''])[1]));
    const tags = [];
    if (lang) tags.push(lang);
    tags.push('GitHub 今日榜');
    out.push({
      title: repo,
      url: 'https://github.com/' + repo,
      summary: desc,
      ts: 0,
      hotRaw: today || total || 0,
      hotText: today ? '今日 +' + today + ' star' : (total ? fmtNum(total) + ' star' : ''),
      tags: tags
    });
  }
  return out;
}

/* 大赛按 BO3.gg Tier 1 分级，只保留最近 7 天已结束的比赛。 */
export function normalizeCs2Match(row, now = Date.now()) {
  if (!row || row.discipline_id !== 1 || row.status !== 'finished' || row.tournament?.tier_rank !== 1) return null;
  const ts = parseTime(row.start_date);
  const team1 = clean(row.team1?.name, 60), team2 = clean(row.team2?.name, 60);
  if (!ts || ts > now || now - ts > 7 * 86400000 || !team1 || !team2 || !/^[a-z0-9][a-z0-9-]*$/.test(row.slug)) return null;
  const hasScore = [row.team1_score, row.team2_score].every((score) => Number.isInteger(score) && score >= 0);
  const score = hasScore ? '大比分 ' + row.team1_score + ':' + row.team2_score : '比分暂缺';
  const date = new Date(ts + 8 * 3600e3);
  const time = fmtDate(new Date(ts)) + ' ' + String(date.getUTCHours()).padStart(2, '0') + ':' + String(date.getUTCMinutes()).padStart(2, '0');
  const bo = Number.isInteger(row.bo_type) && row.bo_type > 0 ? ' · BO' + row.bo_type : '';
  return {
    title: team1 + ' vs ' + team2 + ' · ' + time,
    summary: '已结束 · ' + score + '。赛事：' + (clean(row.tournament?.name, 120) || '赛事名称暂缺') + '（Tier 1）' +
      '。开赛：' + time + '（北京时间）' + bo + '。状态与比分以快照抓取时为准。',
    url: 'https://bo3.gg/matches/' + row.slug,
    ts, hotRaw: 0, hotText: '', tags: ['CS2', '大赛赛果', '已结束']
  };
}

async function cs2Matches() {
  const now = Date.now();
  const params = new URLSearchParams({
    scope: 'widget-matches', 'page[offset]': '0', 'page[limit]': '30', sort: '-start_date',
    'filter[matches.status][in]': 'finished', 'filter[matches.discipline_id][eq]': '1',
    'filter[matches.tier_rank][eq]': '1', with: 'teams,tournament'
  });
  const data = await getJson('https://api.bo3.gg/api/v1/matches?' + params);
  if (!Array.isArray(data?.results)) throw new Error('BO3.gg 赛事接口结构异常（缺少 results）');
  const seen = new Set();
  return data.results.map((row) => normalizeCs2Match(row, now)).filter((row) => {
    if (!row || seen.has(row.url)) return false;
    seen.add(row.url);
    return true;
  }).sort((a, b) => b.ts - a.ts);
}

async function aiPreprints() {
  const categories = ['cs.AI', 'cs.CL', 'cs.LG', 'cs.CV'];
  const rows = [], seen = new Set();
  // 轮流从四个分类取条目，包含修订版；重叠分类只占一个名额。
  for (const category of categories) {
    if (rows.length) await sleep(3100);
    const query = new URLSearchParams({search_query:'cat:' + category,
      sortBy:'lastUpdatedDate', sortOrder:'descending', max_results:'50'});
    const xml = await getText('https://export.arxiv.org/api/query?' + query);
    const records = parseFeed(xml).filter(x => /arxiv\.org\/abs\//i.test(x.url) && x.primaryCategory === category);
    if (!records.length) throw new Error(category + ' 未取得有效 Atom 条目');
    const initial = records.filter(x => /v1$/.test(x.url));
    const revised = records.filter(x => !/v1$/.test(x.url));
    const order = [];
    while (initial.length || revised.length) order.push(...initial.splice(0,3), ...revised.splice(0,1));
    rows.push(order);
  }
  const result = [];
  for (let i = 0; i < 50; i++) {
    for (const group of rows) {
      const x = group[i];
      if (!x || seen.has(x.url)) continue;
      seen.add(x.url);
      result.push({...x, updatedAt:/v(?:[2-9]|\d{2,})$/.test(x.url) ? x.updatedAt : 0, tags:['论文','预印本']});
    }
  }
  return result;
}

export const SERVER_SOURCES = [
  {
    id: 'hf', tier: 2, name: 'HuggingFace 每日论文', short: 'HF论文', icon: '📄', color: '#f59e0b',
    fallbackCat: 'ai', max: 24, maxAgeH: 96,
    async run() {
      const d = await getJson('https://huggingface.co/api/daily_papers?limit=30');
      const arr = Array.isArray(d) ? d : [];
      return arr.map(function (e) {
        const p = (e && e.paper) || {};
        if (!p.title) return null;
        const tags = ['论文'];
        if (p.githubRepo) tags.push('有代码');
        if (p.projectPage) tags.push('有项目页');
        return {
          title: clean(p.title, 200),
          url: 'https://arxiv.org/abs/' + encodeURIComponent(p.id),
          discoveryUrl: 'https://huggingface.co/papers/' + encodeURIComponent(p.id),
          summary: clean(p.summary, 600),
          ts: parseTime(p.publishedAt),
          attentionAt: parseTime(e.submittedOnDailyAt || p.submittedOnDailyAt),
          hotRaw: parseHot(p.upvotes),
          hotText: p.upvotes ? fmtNum(p.upvotes) + ' 赞' : '',
          tags: tags
        };
      }).filter(Boolean);
    }
  },
  {
    id: 'arxiv', name: 'arXiv 最新投稿', short: 'arXiv', icon: '🔬', color: '#b45309',
    fallbackCat: 'academic', max: 40, maxAgeH: 72,
    allowEmpty:true,
    async run({warnings = []} = {}) {
      try { return await aiPreprints(); }
      catch (error) {
        const feed = await getText('https://rss.arxiv.org/rss/cs.AI+cs.CL+cs.LG+cs.CV');
        const rows = preprintAnnouncements(feed, 'AI');
        warnings.push('Atom 接口暂不可用，已从官方 RSS 收录新稿：' + error.message);
        return rows;
      }
    }
  },
  {
    /* 官方 newsroom 节奏比新闻慢一个量级，窗口放宽到 14 天才有可用量 */
    id: 'openai', name: 'OpenAI 官方发布', short: 'OpenAI', icon: '🟢', color: '#10a37f',
    fallbackCat: 'ai', max: 12, maxAgeH: 336,
    async run() { return officialRss('https://openai.com/news/rss.xml', '官方'); }
  },
  {
    id: 'googleai', name: 'Google AI 博客', short: 'GoogleAI', icon: '🔵', color: '#4285f4',
    fallbackCat: 'ai', max: 12, maxAgeH: 336,
    async run() { return officialRss('https://blog.google/technology/ai/rss/', '官方'); }
  },
  {
    id: 'deepmind', name: 'DeepMind 博客', short: 'DeepMind', icon: '🟣', color: '#5f2fb4',
    fallbackCat: 'ai', max: 12, maxAgeH: 336,
    async run() { return officialRss('https://deepmind.google/blog/rss.xml', '官方'); }
  },
  ...RESEARCH_SOURCES,
  ...[
    ['arxiv-math','数学','math','math'],
    ['arxiv-physics','物理','physics','physics+quant-ph+cond-mat+gr-qc+astro-ph'],
    ['arxiv-cs','计算机科学','cs','cs.DS+cs.CC+cs.OS+cs.DC+cs.PL+cs.DB']
  ].map(([id, label, category, feed]) => ({
    id, name:'arXiv · ' + label, short:'arXiv ' + label, icon:'📄', color:'#8a483a',
    category, fallbackCat:category, max:12, maxAgeH:120, allowEmpty:true,
    async run() { return preprintAnnouncements(await getText('https://rss.arxiv.org/rss/' + feed), label); }
  })),
  {id:'jacm', name:'Journal of the ACM · 出版社论文记录', short:'JACM', icon:'📘', color:'#075985',
    category:'cs', fallbackCat:'cs', max:8, maxAgeH:1440,
    async run() {
      const filter = 'type:journal-article,until-pub-date:' + new Date().toISOString().slice(0,10);
      const query = new URLSearchParams({filter,sort:'published',order:'desc',rows:'12',select:'title,DOI,published-online,published'});
      const works = (await crossrefJson('https://api.crossref.org/journals/1557-735X/works?' + query)).message.items;
      const rows = works.flatMap(w => {
        const parts = (w['published-online'] || w.published)?.['date-parts']?.[0];
        if (parts?.length !== 3 || !w.title?.[0] || !/^10\.1145\//i.test(w.DOI)) return [];
        return [{title:w.title[0],url:'https://doi.org/' + w.DOI, doi:w.DOI, ts:Date.UTC(parts[0],parts[1]-1,parts[2]),
          updateType:'正式发表', publisher:'ACM', tags:['计算机科学','期刊论文']}];
      });
      if (!rows.length) throw new Error('JACM 未解析到日期完整的论文记录');
      return rows.sort((a,b) => b.ts-a.ts);
    }
  },
  ...['pytorch/pytorch', 'huggingface/transformers', 'vllm-project/vllm'].map(repo => ({
    id: 'release-' + repo.split('/')[1], name: repo + ' 正式版本', short: repo.split('/')[1],
    icon: '📦', color: '#334155', fallbackCat: 'tech', max: 8, maxAgeH: 48, allowEmpty: true,
    async run() {
      const rows = await getJson('https://api.github.com/repos/' + repo + '/releases?per_page=20');
      if (!Array.isArray(rows)) throw new Error('GitHub Releases 响应格式异常');
      return rows.filter(r => !r.draft && !r.prerelease && r.tag_name && r.html_url).map(r => ({
        title: repo + ' ' + r.tag_name, summary: clean(r.body, 600), ts: parseTime(r.published_at),
        url: r.html_url, eventKey: repo + '@' + r.tag_name, publisher: repo, tags: ['正式发布','开源']
      }));
    }
  })),
  { id: 'research-search', name: '机构原文检索', short: '机构原文', icon: '🔍', color: '#405b8a',
    fallbackCat: 'tech', max: 10, maxAgeH: 48, allowEmpty: true, run: searchOriginals },
  { id:'research-verification', name:'研究成果独立核验', short:'研究核验', icon:'🔎', color:'#486b70',
    fallbackCat:'academic', max:12, maxAgeH:336, allowEmpty:true, run:verificationReports },
  { id: 'crossref', name: 'Crossref 学术核验', short: 'Crossref', icon: '📑', color: '#486b70',
    fallbackCat: 'academic', tier: 2, max: 24, maxAgeH: 0, allowEmpty: true, run: verifyPapers },
  {
    id: 'cs2matches', tier: 2, name: 'CS2 大赛赛果 · BO3.gg', short: 'CS2赛果', icon: '🏆', color: '#e07814',
    category: 'game', fallbackCat: 'game', max: 30, maxAgeH: 168, allowEmpty: true,
    async run() { return cs2Matches(); }
  },
  {
    id: 'ghtrend', tier: 4, name: 'GitHub Trending', short: 'GH趋势', icon: '📈', color: '#24292e',
    fallbackCat: 'tech', max: 25, maxAgeH: 0, dayList: true,
    async run() { return parseTrending(await getText('https://github.com/trending?since=daily')); }
  }
];

const institutions = ['research.google', 'deepmind.google', 'openai.com', 'anthropic.com', 'ai.meta.com', 'microsoft.com'];
function institutionLink(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && institutions.includes(u.hostname.replace(/^www\./, '')) &&
      /\/(research|news|blog|index|publications|science)\//i.test(u.pathname) ? u : null;
  } catch { return null; }
}

async function searchOriginals() {
  const cutoff = Math.floor((Date.now() - 2 * 86400000) / 1000);
  let candidates;
  if (process.env.BRAVE_SEARCH_API_KEY) {
    const query = institutions.map(host => 'site:' + host).join(' OR ') + ' research';
    const response = await fetch('https://api.search.brave.com/res/v1/web/search?' + new URLSearchParams({q:query, freshness:'pd', count:'20'}), {
      headers: {'X-Subscription-Token':process.env.BRAVE_SEARCH_API_KEY}, signal:AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error('Brave Search HTTP ' + response.status);
    candidates = (await response.json()).web?.results || [];
  } else {
    // 免费的 HN Search 以 URL 为检索字段；所有命中均回到机构网页取标题和发布日期。
    const domains = await Promise.all(institutions.map(host => getJson('https://hn.algolia.com/api/v1/search_by_date?' +
      new URLSearchParams({tags:'story', query:host, restrictSearchableAttributes:'url', numericFilters:'created_at_i>' + cutoff, hitsPerPage:'5'}))));
    candidates = domains.flatMap(result => result.hits);
  }
  const urls = [...new Set(candidates.map(row => institutionLink(row?.url)?.href).filter(Boolean))].slice(0, 10);
  const results = await Promise.allSettled(urls.map(async url => {
    const res = await fetch(url, {signal:AbortSignal.timeout(12000), redirect:'error'});
    if (!res.ok) throw new Error('机构原文 HTTP ' + res.status);
    const html = await res.text();
    const title = clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1], 200);
    const tag = (html.match(/<meta\b[^>]*>/gi) || []).find(tag => /["']article:published_time["']/i.test(tag));
    const date = /content=["']([^"']+)/i.exec(tag || '')?.[1] || /"datePublished"\s*:\s*"([^"]+)"/i.exec(html)?.[1];
    return {title, url, ts:parseTime(date), publisher:new URL(url).hostname, tags:['机构原文']};
  }));
  if (urls.length && results.every(result => result.status === 'rejected')) throw new Error('机构原文均无法读取');
  return results.filter(r => r.status === 'fulfilled').map(r => r.value).filter(r => r.title);
}

let lastCrossrefRequest = 0;
async function crossrefJson(url) {
  await sleep(Math.max(0, 1200 - (Date.now() - lastCrossrefRequest)));
  lastCrossrefRequest = Date.now();
  try { return await getJson(url); }
  catch (error) {
    if (error.status !== 429 || error.retryAfter > 30) throw error;
    await sleep(Math.max(2000, error.retryAfter * 1000));
    lastCrossrefRequest = Date.now();
    return getJson(url);
  }
}

async function verifyPapers({ papers = [], previous = new Map() } = {}) {
  const tracked = new Map();
  for (const row of [...papers, ...previous.values()]) {
    if (row.sourceId === 'arxiv' && row.publishedAt && /^arxiv:[\w./-]+$/.test(row.eventKey)) tracked.set(row.eventKey, row);
  }
  const list = [...tracked.values()].sort((a,b) => a.eventKey.localeCompare(b.eventKey));
  const start = list.length ? Math.floor(Date.now() / 1800000) * 4 % list.length : 0;
  const selected = list.slice(start).concat(list.slice(0,start)).slice(0,4);
  const rows = [];
  for (const paper of selected) {
    const endpoint = 'https://api.crossref.org/works';
    const preprint = '10.48550/' + paper.eventKey.replace('arxiv:', 'arXiv.');
    let doi = paper.doi;
    if (!doi) {
      // 只接受出版社登记的明确关联。相似标题和同名作者不能证明是同一论文。
      const query = new URLSearchParams({filter:'relation.object:' + preprint, rows:'5'});
      const related = (await crossrefJson(endpoint + '?' + query)).message.items.find(work =>
        ['journal-article','proceedings-article'].includes(work.type) && (work.relation?.['has-preprint'] || [])
          .some(ref => String(ref.id).toLowerCase() === preprint.toLowerCase()));
      doi = related?.DOI;
    }
    if (!doi) continue;
    const work = (await crossrefJson(endpoint + '/' + encodeURIComponent(doi))).message;
    if (work?.DOI?.toLowerCase() !== doi.toLowerCase()) continue;
    const parts = work.published?.['date-parts']?.[0];
    const date = parts?.length === 3 ? Date.UTC(parts[0], parts[1]-1, parts[2]) : 0;
    const base = { eventKey:paper.eventKey, doi, title:paper.title, url:paper.url,
      ts:paper.publishedAt, recordUrl:'https://doi.org/' + doi, publisher:work.publisher || 'Crossref', tags:['论文','学术记录'] };
    if (date && date >= Math.floor(paper.publishedAt / 86400000) * 86400000) rows.push({...base, updatedAt:date, updateType:'正式发表'});
    const notices = (await crossrefJson(endpoint + '?' + new URLSearchParams({filter:'updates:' + doi, rows:'10'}))).message.items;
    for (const notice of notices) {
      const relation = (notice['update-to'] || []).find(link => link.DOI?.toLowerCase() === doi.toLowerCase());
      const kind = {retraction:'撤稿', correction:'更正', withdrawal:'撤稿'}[relation?.type];
      if (kind && relation.updated?.timestamp) rows.unshift({...base, updatedAt:relation.updated.timestamp,
        recordUrl:'https://doi.org/' + notice.DOI, updateType:kind});
    }
  }
  // 每个关联展示最新状态；已撤稿的原文不能被较晚的普通元数据更新重新提升。
  const order = {撤稿:0, 更正:1, 正式发表:2};
  return rows.sort((a,b) => order[a.updateType] - order[b.updateType] || b.updatedAt - a.updatedAt);
}

async function officialRss(url, kindTag) {
  const list = parseFeed(await getText(url));
  return list.map(function (x) {
    return Object.assign({}, x, {
      hotText: '',
      tags: x.ts ? [kindTag] : [kindTag, '时间未知']
    });
  });
}

/* 把源返回的原始条目补齐成快照 item：id 稳定、热度有展示串、按时间窗口过滤 */
export function finalize(src, raws, opts) {
  const now = (opts && opts.now) || Date.now();
  const seen = new Set();
  const items = [];
  for (const row of raws || []) {
    if (!row || !clean(row.title, 200)) continue;
    const url = canonicalUrl(row.url);
    const paper = /^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\/([\w./-]+?)(?:v\d+)?(?:\.pdf)?$/i.exec(url);
    const doi = String(row.doi || '').trim().toLowerCase();
    const eventKey = row.eventKey || (paper ? 'arxiv:' + paper[1] : doi ? 'doi:' + doi : url);
    const key = eventKey || clean(row.title, 200);
    if (seen.has(key)) continue;
    const publishedAt = parseTime(row.ts);
    const updatedAt = parseTime(row.updatedAt);
    const attentionAt = parseTime(row.attentionAt);
    const update = updatedAt > 0 && (row.updateType || (src.id === 'cs2matches' ? '比赛赛果' : updatedAt > publishedAt && src.id === 'arxiv'));
    const eventKind = row.updateType || (src.id === 'cs2matches' ? '比赛赛果' : update ? '论文修订' : attentionAt > publishedAt || src.dayList ? '近期受关注' : publishedAt ? '首次发布' : '发现');
    const ts = update ? updatedAt : ['近期受关注','新稿公告'].includes(eventKind) ? attentionAt : publishedAt;
    if (ts > now || (ts && src.maxAgeH && now - ts > src.maxAgeH * 3600e3)) continue;
    seen.add(key);
    const id = src.id + '-' + hash8(key);
    const prior = opts?.previous?.get(id);
    const firstSeenAt = prior?.firstSeenAt || now;
    const eventSeenAt = prior?.ts === ts && prior?.eventKind === eventKind ? prior.eventSeenAt || firstSeenAt : now;
    const hotRaw = parseHot(row.hotRaw);
    items.push({
      id, sourceId: src.id, rank: items.length + 1, title: clean(row.title, 200), url,
      summary: clean(row.summary, 600), hot: row.hotText || fmtNum(hotRaw), hotRaw,
      eventKey, doi, eventKind, publishedAt, updatedAt, attentionAt, firstSeenAt, eventSeenAt, ts,
      discoveryUrl: canonicalUrl(row.discoveryUrl), recordUrl: row.verification ? row.recordUrl : canonicalUrl(row.recordUrl),
      ...(row.verification ? {verification:row.verification, titleZh:clean(row.titleZh,200)} : {}),
      tier: row.tier || src.tier || 1, publisher: clean(row.publisher || (src.id === 'hf' ? 'arXiv 预印本' : '') || src.short || src.id, 100),
      tags: (Array.isArray(row.tags) ? row.tags : []).map(tag => clean(tag, 60)).filter(Boolean).slice(0, 4)
    });
    if (items.length >= (src.max || 20)) break;
  }
  return items;
}

function canonicalUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    }
    if (url.origin + url.pathname !== CLAUDE_NOTES || !/^#[a-z]+-\d{1,2}-20\d{2}$/.test(url.hash)) url.hash = '';
    return url.href.replace(/\/(?=$)/, '').replace(/^http:\/\/arxiv\.org\//, 'https://arxiv.org/');
  } catch { return ''; }
}

export const SNAPSHOT_SCHEMA = 2;
