/* 服务端源注册表：这些接口对浏览器不开 CORS，只能由 Actions 在服务端抓取后产出快照。
   每个源独立失败，互不影响；输出统一 item 形状，语义抽取（要素/信号分）只在页面里做一次。

   机器之心只能走 Google News RSS：它家 /rss、/articles、文章页、gmis 子站对数据中心
   IP 一律返回「机器之心·数据服务」闸门页（Googlebot UA 同样），/api/v1/articles.json
   是忽略分页、无链接无时间、内容停在 2022-2023 的废弃缓存；robots.txt 声明的
   /shared/sitemap.xml.gz 能取到 3 万条 URL 和发布日期，但条目里没有标题，按 URL 回抓
   文章页又会被闸门挡住。公共 RSSHub 镜像路由 404/503，Bing 的 RSS 忽略 site: 限定。
   要直连它本身，只能自建 RSSHub 或接入它的付费数据服务。 */

import { getJson, getText, parseFeed, parseTime, parseHot, clean, fmtNum, hash8 } from './lib.mjs';

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

export const SERVER_SOURCES = [
  {
    id: 'hf', name: 'HuggingFace 每日论文', short: 'HF论文', icon: '📄', color: '#f59e0b',
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
          url: 'https://huggingface.co/papers/' + p.id,
          summary: clean(p.summary, 600),
          /* 入选榜单的日期比投稿日期更能代表「今天值得看」 */
          ts: parseTime(p.submittedOnDailyAt) || parseTime(p.publishedAt),
          hotRaw: parseHot(p.upvotes),
          hotText: p.upvotes ? fmtNum(p.upvotes) + ' 赞' : '',
          tags: tags
        };
      }).filter(Boolean);
    }
  },
  {
    id: 'arxiv', name: 'arXiv 最新投稿', short: 'arXiv', icon: '🔬', color: '#b45309',
    fallbackCat: 'academic', max: 16, maxAgeH: 72,
    async run() {
      const xml = await getText('https://export.arxiv.org/api/query?search_query=' +
        encodeURIComponent('cat:cs.AI OR cat:cs.CL OR cat:cs.LG OR cat:cs.CV') +
        '&sortBy=submittedDate&sortOrder=descending&max_results=20');
      return parseFeed(xml).map(function (x) {
        return Object.assign({}, x, { tags: ['论文'], hotText: '' });
      });
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
  {
    /* 机器之心全站（/rss、/articles、文章页、gmis 子站）对数据中心 IP 一律返回
       「机器之心·数据服务」闸门页，Googlebot UA 也一样；robots.txt 里的
       /shared/sitemap.xml.gz 能拿到 3 万条 URL 与发布日期，但条目里没有标题，
       而按 URL 去抓文章页又会被闸门挡回来。这里退一步用 Google News 的站限定
       RSS 取最新条目；抓不到时该源自动缺席，不影响其他源。 */
    id: 'jqzx', name: '机器之心', short: '机器之心', icon: '', color: '#e0653a',
    fallbackCat: 'ai', max: 16, maxAgeH: 72,
    async run() {
      /* Actions 上实测：q=site:jiqizhixin.com 返回 0 条，Google News 对中文站的
         site: 限定基本不给结果；改用品牌词查询，再按「标题 - 机器之心」的来源过滤 */
      const xml = await getText('https://news.google.com/rss/search?q=' +
        encodeURIComponent('"机器之心"') + '&hl=zh-CN&gl=CN&ceid=CN:zh-Hans');
      return parseFeed(xml)
        .filter(function (x) { return /机器之心\s*$/.test(x.title); })
        .map(function (x) {
          return {
            title: clean(String(x.title || '').replace(/\s*[-–—]\s*机器之心\s*$/, ''), 200),
            url: x.url, summary: x.summary, ts: x.ts, hotRaw: 0, hotText: '', tags: ['报道']
          };
        });
    }
  },
  {
    id: 'xinzhiyuan', name: '新智元', short: '新智元', icon: '🥇', color: '#c2410c',
    fallbackCat: 'ai', max: 16, maxAgeH: 96,
    async run() { return officialRss('https://www.aiera.com.cn/feed', '报道'); }
  },
  {
    id: 'leiphone', name: '雷锋网', short: '雷锋网', icon: '⛰️', color: '#0d9488',
    fallbackCat: 'tech', max: 16, maxAgeH: 96,
    async run() { return officialRss('https://www.leiphone.com/feed', '报道'); }
  },
  {
    id: 'qbitai', name: '量子位（AI 媒体）', short: '量子位', icon: '📡', color: '#0f766e',
    fallbackCat: 'ai', max: 16, maxAgeH: 72,
    async run() { return officialRss('https://www.qbitai.com/feed', '报道'); }
  },
  {
    id: 'infoq', name: 'InfoQ 中文', short: 'InfoQ', icon: '🧱', color: '#2b6cb0',
    fallbackCat: 'tech', max: 16, maxAgeH: 96,
    async run() { return officialRss('https://www.infoq.cn/feed', '报道'); }
  },
  {
    id: 'sspai', name: '少数派', short: '少数派', icon: '🍊', color: '#e8563f',
    fallbackCat: 'tech', max: 12, maxAgeH: 96,
    async run() { return officialRss('https://sspai.com/feed', '报道'); }
  },
  {
    /* article_rank 返回的 ctime/mtime 恒为 0，只能按「今日热榜」对待而不是按发布时间过滤 */
    id: 'juejin', name: '掘金热榜', short: '掘金', icon: '⛏️', color: '#1e80ff',
    fallbackCat: 'tech', max: 20, maxAgeH: 96, dayList: true,
    async run() {
      const d = await getJson('https://api.juejin.cn/content_api/v1/content/article_rank?category_id=1&type=hot');
      const arr = (d && Array.isArray(d.data)) ? d.data : [];
      return arr.map(function (row) {
        const c = (row && row.content) || {};
        if (!c.title) return null;
        const cc = (row && row.content_counter) || {};
        const author = row && row.author && row.author.name ? row.author.name : '';
        return {
          title: clean(c.title, 200),
          url: 'https://juejin.cn/post/' + c.content_id,
          summary: clean(c.brief, 600),
          ts: parseTime(c.ctime) || parseTime(c.mtime),
          hotRaw: parseHot(cc.view),
          hotText: cc.view ? fmtNum(cc.view) + ' 阅读' : '',
          tags: author ? [author] : []
        };
      }).filter(Boolean);
    }
  },
  {
    id: 'v2ex', name: 'V2EX 今日热议', short: 'V2EX', icon: '💬', color: '#187cd0',
    fallbackCat: 'tech', max: 20, maxAgeH: 48, dayList: true,
    async run() {
      const d = await getJson('https://www.v2ex.com/api/topics/hot.json');
      const arr = Array.isArray(d) ? d : [];
      return arr.map(function (t) {
        if (!t || !t.title) return null;
        return {
          title: clean(t.title, 200),
          url: t.url || '',
          summary: clean(t.content, 600),
          ts: parseTime(t.last_touched) || parseTime(t.created),
          hotRaw: parseHot(t.replies),
          hotText: t.replies ? t.replies + ' 回复' : '',
          tags: t.node && t.node.title ? [t.node.title] : []
        };
      }).filter(Boolean);
    }
  },
  {
    id: 'ghtrend', name: 'GitHub Trending', short: 'GH趋势', icon: '📈', color: '#24292e',
    fallbackCat: 'tech', max: 25, maxAgeH: 0, dayList: true,
    async run() { return parseTrending(await getText('https://github.com/trending?since=daily')); }
  }
];

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
  const list = (raws || []).filter(function (r) { return r && clean(r.title, 200); });
  const windowed = src.maxAgeH > 0
    ? list.filter(function (r) { return !r.ts || now - r.ts <= src.maxAgeH * 3600e3; })
    : list;
  const chosen = windowed.slice(0, src.max || 20);
  return chosen.map(function (r, i) {
    const title = clean(r.title, 200);
    const hotRaw = Number(r.hotRaw) > 0 ? Math.round(Number(r.hotRaw)) : 0;
    return {
      id: src.id + '-' + (i + 1) + '-' + hash8(title),
      sourceId: src.id,
      rank: i + 1,
      title: title,
      summary: clean(r.summary, 600),
      url: r.url || '',
      hot: r.hotText || (hotRaw ? fmtNum(hotRaw) : ''),
      hotRaw: hotRaw,
      ts: r.ts || 0,
      tags: (r.tags || []).slice(0, 4)
    };
  });
}

export const SNAPSHOT_SCHEMA = 1;
