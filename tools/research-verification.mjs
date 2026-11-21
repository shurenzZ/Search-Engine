import { createHash } from 'node:crypto';
import { clean, decodeEnt, getJson, parseTime } from './lib.mjs';

// 登记核验者自己的发布目录。社区提交的 URL 只能在这些目录内发现报告。
const reviewers = [{
  name: 'Andrew Sutherland', family: 'Sutherland', directory: 'https://math.mit.edu/~drew/',
  reports: ['https://math.mit.edu/~drew/grh/']
}];
// 私人站点的声明没有统一的作者元数据，以审读过的原件及其指纹登记。
const originals = new Map([['https://alpo.ge/remark.pdf', {
  publisher: 'Levent Alpöge', titleZh: 'Levent Alpöge 与 Claude 提出黎曼猜想及狄利克雷 L 函数广义黎曼猜想的证明，独立核验有更新',
  sha256: '3fc97784b71ddd44ff8aa0a177e99622a1c61b13cfa843a0989ee4a7a0cfeb8d'
}]]);

function reportUrl(value, directory) {
  try {
    const u = new URL(value);
    u.hash = '';
    return u.href.startsWith(directory) && /^[\w-]+\/(?:index\.html)?$/.test(u.href.slice(directory.length)) ? u.href : '';
  } catch { return ''; }
}

async function readDocument(url, type) {
  const response = await fetch(url, {redirect:'error', signal:AbortSignal.timeout(15000)});
  if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes(type)) {
    throw new Error('文档类型或响应异常 ' + response.status);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 2e6) throw new Error('文档超过 2 MB');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const statusLabels = new Map([
  ...['pass','passed','match','accepts'].map(v => [v,'通过']),
  ...['running','pending'].map(v => [v,'进行中']),
  ...['declined','not applicable','skipped'].map(v => [v,'未执行或不适用']),
  ...['fail','failed','rejects','rejected','mismatch'].map(v => [v,'未通过'])
]);

export function parseVerification(html, reviewer) {
  const announced = /Announced at\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<\/a>\s+on\s+(\d{1,2} [a-z]+ \d{4})/i.exec(html);
  const stamp = /Page last updated\s+(\d{4}-\d\d-\d\d) (\d\d:\d\d) UTC/i.exec(html);
  const published = announced && parseTime(announced[2] + ' 00:00 UTC');
  const updated = stamp && parseTime(stamp[1] + 'T' + stamp[2] + ':00Z');
  const byline = (html.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || []).find(p => /Page last updated/i.test(p));
  if (!published || !updated || updated < published || updated > Date.now() || !clean(byline).startsWith(reviewer.name + ' ')) {
    throw new Error('报告缺少可核对的署名、声明日期或更新时间');
  }
  const table = (html.match(/<table\b[^>]*>[\s\S]*?<\/table>/gi) || []).find(t =>
    Array.from(t.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi), m => clean(m[1]).toLowerCase()).join('|') === 'check|result|detail');
  const checks = [];
  for (const tr of (table || '').match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || []) {
    if (!/<td\b/i.test(tr)) continue;
    const fields = Array.from(tr.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi), m => clean(m[1], 600));
    if (fields.length !== 3 || !fields[0] || !fields[1]) throw new Error('报告检查表结构变化');
    const [name, result, detail] = fields;
    checks.push({name, result, detail, status:statusLabels.get(result.toLowerCase()) || '待解读'});
  }
  const title = clean(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1],200);
  if (!checks.length || !title) throw new Error('报告缺少检查结果或标题');
  return {url:decodeEnt(announced[1]), title, ts:published, updatedAt:updated, checks};
}

async function originalMetadata(url, reviewer) {
  const registered = originals.get(url);
  if (registered && !registered.publisher.includes(reviewer.family)) {
    const bytes = await readDocument(url, 'application/pdf');
    if (createHash('sha256').update(bytes).digest('hex') !== registered.sha256) throw new Error('作者原件已变化，需重新核对');
    return {publisher:registered.publisher, titleZh:registered.titleZh};
  }
  if (!/^https:\/\/arxiv\.org\/abs\/\d{4}\.\d{4,5}(?:v\d+)?$/.test(url)) throw new Error('尚未登记此作者原件');
  const html = (await readDocument(url, 'text/html')).toString();
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  const authors = tags.filter(t => /name=["']citation_author["']/i.test(t))
    .map(t => clean(/content=(["'])(.*?)\1/i.exec(t)?.[2])).filter(Boolean);
  if (!authors.length || authors.some(a => a.toLowerCase().includes(reviewer.family.toLowerCase()))) throw new Error('无法区分作者与核验者');
  return {publisher:authors.join(', ')};
}

async function hnSearch(tags, query, attrs) {
  const params = new URLSearchParams({tags, query, hitsPerPage:'25', restrictSearchableAttributes:attrs});
  const {hits} = await getJson('https://hn.algolia.com/api/v1/search?' + params);
  if (!Array.isArray(hits)) throw new Error('HN 返回结构异常');
  return hits;
}

export async function verificationReports({warnings = [], previous = new Map()} = {}) {
  const rows = [];
  for (const reviewer of reviewers) {
    const urls = new Set(reviewer.reports);
    const recent = [...previous.values()].filter(r => r.sourceId === 'research-verification' && r.ts >= Date.now() - 14 * 86400000);
    for (const row of recent.sort((a,b) => b.ts-a.ts)) {
      const tracked = reportUrl(row.recordUrl, reviewer.directory);
      if (tracked && urls.size < 5) urls.add(tracked);
    }
    try {
      const hits = await hnSearch('comment', new URL(reviewer.directory).host + new URL(reviewer.directory).pathname, 'comment_text');
      for (const hit of hits) {
        for (const match of decodeEnt(hit.comment_text).matchAll(/href=["']([^"']+)["']/gi)) {
          const candidate = reportUrl(match[1], reviewer.directory);
          if (candidate && urls.size < 6) urls.add(candidate);
        }
      }
    } catch (e) { warnings.push('社区报告发现暂缺：' + e.message); }
    for (const recordUrl of urls) {
      try {
        const html = (await readDocument(recordUrl, 'text/html')).toString();
        const {checks, ...report} = parseVerification(html, reviewer);
        const author = await originalMetadata(report.url, reviewer);
        let discoveryUrl = '', attentionAt = 0;
        try {
          const hits = await hnSearch('story', report.url.replace(/^https:\/\//,''), 'url');
          const hit = hits.find(h => h.url === report.url && /^\d+$/.test(h.objectID));
          if (hit) {
            discoveryUrl = 'https://news.ycombinator.com/item?id=' + hit.objectID;
            attentionAt = parseTime(hit.created_at);
          }
        } catch (e) { warnings.push('社区收录链接暂缺：' + e.message); }
        const summary = [...new Set(checks.map(c => c.status))].map(s => s + ' ' + checks.filter(c => c.status === s).length + ' 项').join('，');
        rows.push({...report, ...author, recordUrl, discoveryUrl, attentionAt, updateType:'独立核验更新',
          verification:{reviewer:reviewer.name, checks}, summary:reviewer.name + ' 的核验报告记录了' + summary + '。', tags:['独立核验','研究进展']});
      } catch (error) { warnings.push(recordUrl + '：' + error.message); }
    }
  }
  if (!rows.length && warnings.length) throw new Error(warnings.join('；'));
  return rows.sort((a,b) => b.updatedAt-a.updatedAt);
}
