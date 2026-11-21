import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { browser } from '../tools/page-context.mjs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parseTime, parseHot, parseFeed, fmtDate } from '../tools/lib.mjs';
import { finalize, SERVER_SOURCES, normalizeCs2Match } from '../tools/sources-server.mjs';

function snapshot(title = 'OpenAI 发布模型', at = Date.now()) {
  return { schema: 2, generatedAtMs: at, date: fmtDate(new Date(at)),
    sources: [{ id: 'hf', name: 'HF', short: 'HF', ok: true, fallbackCat: 'ai' }],
    items: [{ sourceId: 'hf', title, url: 'https://example.test/article', ts: at, tags: ['论文'] }] };
}
function ingest(ctx, payload) { ctx.payload = payload; return ctx.run('ingestSnapshot(payload)'); }
function seed(ctx) {
  ctx.run(`state.buckets = {};
    var time = Date.now();
    ['hn', 'ghnew'].forEach(function(id, i) {
      var it = makeItem({sourceId:id, evidence:{eventKind:'首次发布',tier:2}, url:'https://example.test/'+id, title:'OpenAI 发布全新模型', hotRaw:100-i, ts:time, src:sourceById(id)});
      state.buckets[id] = [it];
    }); state.items = rebuildItems(state.buckets);`);
}

test('侧栏隐藏空分类，选中分类清空时返回全部，重新有条目时恢复入口', () => {
  const ctx = browser();
  const draw = () => Array.from(ctx.run(`renderChips(); Array.from($('categoryChips').innerHTML.matchAll(/data-fc="([^"]+)"/g), m => m[1])`));
  ctx.run("state.items = [{category:'ai'}, {category:'game'}]; state.fCategory = 'game'");
  assert.deepEqual(draw(), ['all', 'ai', 'game']);
  assert.equal(ctx.run('state.fCategory'), 'game');
  ctx.run('state.items.pop()');
  assert.deepEqual(draw(), ['all', 'ai']);
  assert.equal(ctx.run('state.fCategory'), 'all');
  ctx.run('state.items = []');
  assert.deepEqual(draw(), ['all']);
  ctx.run("state.items = [{category:'game'}]");
  assert.deepEqual(draw(), ['all', 'game']);
});

test('时间及热度解析在浏览器和服务端一致', () => {
  const ctx = browser();
  for (const value of [946684800000, '2000-01-01T00:00:00Z', 1700000000, '', '1604', Infinity]) {
    ctx.value = value;
    assert.equal(ctx.run('parseTimeLoose(value)'), parseTime(value));
  }
  for (const [value, expected] of [['1.2 billion', 1.2e9], ['2 million', 2e6], ['9.55万', 95500], ['947.5w', 9475000], ['1,234', 1234], ['1kw', 1e7], [Infinity, 0], ['9'.repeat(310), 0]]) {
    ctx.value = value;
    assert.equal(parseHot(value), expected);
    assert.equal(ctx.run('parseHotStr(value)'), expected);
  }
});

test('北京时间凌晨的快照归入正确日期', () => {
  assert.equal(fmtDate(new Date('2026-10-14T16:01:00Z')), '2026-10-15');
});

test('Atom 优先正文链接并支持单引号和 XML 实体', () => {
  const rows = parseFeed(`<feed><entry><title>Test</title><link rel="self" href="https://api.test/id"/>
    <link rel='alternate' href='https://example.test/story?a=1&amp;b=2'/><summary>正文</summary></entry></feed>`);
  assert.equal(rows[0].url, 'https://example.test/story?a=1&b=2');
  const longUrl = 'https://example.test/' + 'a'.repeat(500);
  assert.equal(parseFeed(`<rss><item><title>标题</title><link>${longUrl}</link></item></rss>`)[0].url, longUrl);
});

test('服务端归一化拒绝异常热度、链接和标签并保留正常未知时间', () => {
  const now = Date.now();
  const rows = finalize({ id: 'test', maxAgeH: 24 }, [
    { title: '过期', ts: now - 25 * 3600e3 },
    { title: '正常', ts: now, hotRaw: Infinity, url: 'javascript:alert(1)', tags: 'broken' },
    { title: '未知时间', ts: 0 }
  ], { now });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].hotRaw, 0);
  assert.equal(rows[0].url, '');
  assert.deepEqual(rows[0].tags, []);
});

test('快照刷新替换旧条目且不会倒退到更早快照', () => {
  const ctx = browser();
  const now = Date.now();
  ingest(ctx, snapshot('第一条', now - 100));
  ingest(ctx, snapshot('更新条目', now));
  assert.equal(ctx.run('state.items[0].title'), '更新条目');
  assert.equal(ingest(ctx, snapshot('过期响应', now - 200)), false);
  assert.equal(ctx.run('state.items[0].title'), '更新条目');
  const failed = snapshot('不可信旧条目', now + 1);
  failed.sources[0].ok = false;
  ingest(ctx, failed);
  assert.equal(ctx.run('state.items.length'), 0);
  assert.equal(ctx.run('state.status.hf.ok'), false);
});

test('快照缓存恢复包含来源信息；关闭快照后不参与派生', () => {
  const storage = new Map();
  ingest(browser(storage), snapshot());
  const restored = browser(storage);
  assert.equal(restored.run('loadStore()'), true);
  assert.equal(restored.run('state.items.length'), 1);
  assert.equal(restored.run('sourceById("hf").short'), 'HF');
  assert.equal(restored.run('settings.useSnapshot = false; rebuildItems(state.buckets).length'), 0);
});

test('快照边界拒绝危险来源、坏结构，清理不可信元数据', () => {
  const ctx = browser();
  assert.throws(() => ingest(ctx, { items: [] }), /快照结构/);
  const p = snapshot();
  p.sources.push({ id: 'constructor' }, { id: 'hn' }, { id: 'evil" onclick="alert(1)' });
  p.sources[0].icon = '<img src=x onerror=alert(1)>';
  p.sources[0].color = 'red" onclick="alert(1)';
  p.items[0].tags = 'bad';
  p.items[0].url = 'javascript:alert(1)';
  ingest(ctx, p);
  assert.equal(ctx.run('state.snap.sources.length'), 1);
  assert.equal(ctx.run('state.snap.sources[0].color'), '#8a8377');
  assert.equal(ctx.run('state.items[0].url'), '');
  assert.equal(ctx.run('cardHtml({key:"hf", icon:state.snap.sources[0].icon, items:[]}).includes("<img")'), false);
});

test('关闭源不再参与信号分或合并；再次开启可恢复缓存条目', () => {
  const ctx = browser(); seed(ctx);
  assert.equal(ctx.run('state.mergedCount'), 1);
  ctx.run('settings.enabled.hn = false; state.items = rebuildItems(state.buckets);');
  assert.equal(ctx.run('state.items.length'), 1);
  assert.equal(ctx.run('state.items[0].clusterParent'), '');
  assert.equal(ctx.run('state.items[0].signalParts.同现'), undefined);
  assert.equal(ctx.run('settings.enabled.hn = true; rebuildItems(state.buckets).length'), 2);
});

test('筛选只命中簇内子条目时仍可见，头条也保留该结果', () => {
  const ctx = browser(); seed(ctx);
  assert.equal(ctx.run('visibleItems().length'), 1);
  ctx.run('state.fSource = "ghnew";');
  assert.equal(ctx.run('visibleItems().length'), 1);
  assert.equal(ctx.run('topFlash(visibleItems(), 10).length'), 1);
  ctx.run('state.fSource = "all"; state.items[1].summary = "独有检索词"; state.query = "独有检索词";');
  assert.equal(ctx.run('visibleItems().length'), 1);
});

test('同一平台不能两次计入同一个跨平台事件', () => {
  const ctx = browser(); seed(ctx);
  ctx.run('state.buckets.ghnew.push(makeItem({sourceId:"ghnew", title:"OpenAI 发布全新模型", hotRaw:1})); state.items = rebuildItems(state.buckets);');
  assert.equal(ctx.run('state.items.find(function(it){return it.sourceId === "hn";}).clusterSize'), 2);
});

test('重复条目 ID 多次重新派生保持稳定且唯一', () => {
  const ctx = browser(); seed(ctx);
  ctx.run('state.buckets.hn.push(makeItem({sourceId:"hn", title:"OpenAI 发布全新模型", hotRaw:3})); state.items = rebuildItems(state.buckets);');
  const first = ctx.run('JSON.stringify(state.items.map(function(it){return it.id;}).sort())');
  assert.equal(ctx.run('state.items = rebuildItems(state.buckets); JSON.stringify(state.items.map(function(it){return it.id;}).sort())'), first);
  assert.equal(ctx.run('new Set(state.items.map(function(it){return it.id;})).size'), 3);
});

test('24 小时过滤重新计算年龄，不把未知时间的普通快照当成当日榜', () => {
  const ctx = browser();
  ingest(ctx, snapshot());
  assert.equal(ctx.run('isFreshDay({sourceId:"hf", ts:0})'), false);
  assert.equal(ctx.run('isFreshDay({sourceId:"hf", ts:Date.now()-25*3600e3, ageH:1})'), false);
  ctx.run('state.snap.sources[0].dayList = true;');
  assert.equal(ctx.run('isFreshDay({sourceId:"hf", ts:0, snap:true, snapAt:Date.now()-25*3600e3})'), false);
  assert.equal(ctx.run('isFreshDay({sourceId:"hf", ts:0, snap:true, snapAt:Date.now()})'), true);
});

test('存储写入或删除失败时内存回退不会读到旧值', () => {
  const ctx = browser(new Map([['test', 'old']]));
  ctx.localStorage.setItem = ctx.localStorage.removeItem = () => { throw new Error('quota'); };
  assert.equal(ctx.run('stSet("test", "new"); stGet("test")'), 'new');
  assert.equal(ctx.run('stDel("test"); stGet("test")'), null);
});

test('限流失败进入补抓队列，永久失败不会补抓', async () => {
  const ctx = browser();
  ctx.run('requestSource = function(){return Promise.resolve({ok:false, retryable:true, error:"429"});};');
  await ctx.run('fetchOne(sourceById("hn"), 0)');
  assert.equal(ctx.run('state.retryQueue.length'), 1);
  ctx.run('state.retryQueue = []; requestSource = function(){return Promise.resolve({ok:false, retryable:false, error:"403"});};');
  await ctx.run('fetchOne(sourceById("hn"), 0)');
  assert.equal(ctx.run('state.retryQueue.length'), 0);
});

test('单源重试锁住全局刷新直到完成', async () => {
  const ctx = browser();
  ctx.run('requestSource = function(){return new Promise(function(resolve){globalThis.finishRequest = resolve;});}; retrySource("hn");');
  assert.equal(ctx.run('state.loading'), true);
  await ctx.run('refresh(true)');
  ctx.finishRequest({ ok: false, retryable: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ctx.run('state.loading'), false);
});

test('快照解析异常会被捕获且释放共享请求', async () => {
  const ctx = browser();
  ctx.fetch = async () => ({ ok: true, text: async () => '{"items":[]}' });
  assert.equal(await ctx.run('loadSnapshot()'), false);
  assert.match(ctx.run('state.snap.error'), /快照结构/);
  assert.equal(ctx.run('_snapshotRequest'), null);
});

test('JSON 下载不带 BOM，普通文本保留 BOM', async () => {
  const ctx = browser();
  ctx.URL = { createObjectURL: blob => { ctx.outputBlob = blob; return 'blob:test'; }, revokeObjectURL() {} };
  ctx.document.createElement = () => ({ click() {} });
  ctx.document.body = { appendChild() {}, removeChild() {} };
  ctx.run('download("data.json", "{}", "application/json")');
  assert.deepEqual([...new Uint8Array(await ctx.outputBlob.arrayBuffer())], [123, 125]);
  ctx.run('download("data.txt", "hi", "text/plain")');
  assert.deepEqual([...new Uint8Array(await ctx.outputBlob.arrayBuffer())].slice(0, 3), [239, 187, 191]);
});

test('本地 HTTP 部署读取同目录快照，file 页面保留远程兜底', () => {
  const ctx = browser();
  assert.equal(ctx.run('guessSnapshotUrl()'), 'https://example.test/brief/data/latest.json');
  ctx.location.href = 'file:///tmp/brief.html';
  assert.match(ctx.run('guessSnapshotUrl()'), /^https:\/\/raw\.githubusercontent\.com\//);
});

test('三种颜色模式正确解析并保存，旧缓存和非法值默认跟随系统', () => {
  const storage = new Map();
  const ctx = browser(storage);
  ctx.window = { matchMedia: () => ({ matches: true }) };
  const attrs = new Map();
  ctx.document.documentElement = { setAttribute: (key, value) => attrs.set(key, value) };
  ctx.document.querySelectorAll = () => [];
  assert.equal(ctx.run('settings.theme'), 'system');
  assert.equal(ctx.run('mergeSettings({theme:"bad"}).theme'), 'system');
  assert.equal(ctx.run('resolvedTheme("system", true)'), 'dark');
  assert.equal(ctx.run('resolvedTheme("system", false)'), 'light');
  assert.equal(ctx.run('resolvedTheme("light", true)'), 'light');
  ctx.run('chooseTheme("dark")');
  assert.equal(attrs.get('data-theme'), 'dark');
  const restored = browser(storage);
  restored.run('loadStore()');
  assert.equal(restored.run('settings.theme'), 'dark');
  ctx.run('chooseTheme("light")');
  assert.equal(attrs.get('data-theme'), 'light');
  ctx.run('chooseTheme("invalid")');
  assert.equal(ctx.run('settings.theme'), 'light');
});

test('随包离线快照明确标为上次结果，时间与离线标记在缓存中保留', () => {
  const storage = new Map();
  const ctx = browser(storage);
  const payload = snapshot();
  payload.desktopFallback = true;
  ingest(ctx, payload);
  assert.equal(ctx.run('state.snap.fallback'), true);
  assert.equal(ctx.run('state.status.hf.ok'), true);
  assert.equal(ctx.run('state.status.hf.stale'), true);
  const restored = browser(storage);
  restored.run('loadStore()');
  assert.equal(restored.run('state.snap.fallback'), true);
  assert.equal(restored.run('state.snap.at'), payload.generatedAtMs);
});

test('生成器在出网前拒绝错误参数和覆盖完整快照的部分抓取', () => {
  for (const args of [['--only', 'unknown-source'], ['--gap', '-1'], ['--only', 'hf']]) {
    const result = spawnSync(process.execPath, ['tools/build-brief.mjs', ...args], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /未知数据源|非负数字|独立 --out/);
  }
});

test('所有源失败时保留磁盘快照，成功时 manifest 与正文哈希一致', async () => {
  const { mkdtemp, writeFile, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createHash } = await import('node:crypto');
  const dir = await mkdtemp(join(tmpdir(), 'brief-regression-'));
  try {
    const mock = join(dir, 'fetch.mjs');
    const latest = join(dir, 'latest.json');
    await writeFile(latest, 'existing snapshot');
    await writeFile(mock, 'globalThis.fetch = async () => new Response("[]");');
    const args = ['--import', pathToFileURL(mock).href, 'tools/build-brief.mjs', '--only', 'hf', '--gap', '0', '--out', dir];
    const failed = spawnSync(process.execPath, args, { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
    assert.equal(failed.status, 1);
    assert.equal(await readFile(latest, 'utf8'), 'existing snapshot');
    await writeFile(mock, `globalThis.fetch = async () => new Response(JSON.stringify([{paper:{id:'test',title:'Test paper',publishedAt:new Date().toISOString()}}]));`);
    const passed = spawnSync(process.execPath, args, { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
    assert.equal(passed.status, 0, passed.stderr);
    const body = await readFile(latest, 'utf8');
    const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.hash, createHash('sha256').update(body).digest('hex').slice(0, 16));
    assert.equal(manifest.itemCount, 1);
    assert.equal(await readFile(join(dir, 'archive', JSON.parse(body).date + '.json'), 'utf8'), body);
    await writeFile(mock, 'globalThis.fetch = async () => new Response(' + JSON.stringify(JSON.stringify({ results: [matchFixture()] })) + ');');
    const cs2Args = args.map((value) => value === 'hf' ? 'cs2matches' : value);
    const cs2 = spawnSync(process.execPath, cs2Args, { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
    assert.equal(cs2.status, 0, cs2.stderr);
    const cs2Payload = JSON.parse(await readFile(latest, 'utf8'));
    assert.equal(cs2Payload.sources[0].category, 'game');
    assert.equal(cs2Payload.sources[0].ok, true);
    assert.equal(cs2Payload.items[0].sourceId, 'cs2matches');
    await writeFile(mock, `globalThis.fetch = async () => new Response('{"results":[]}');`);
    const empty = spawnSync(process.execPath, cs2Args, { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
    assert.equal(empty.status, 0, empty.stderr);
    const emptyPayload = JSON.parse(await readFile(latest, 'utf8'));
    assert.equal(emptyPayload.sources[0].ok, true);
    assert.equal(emptyPayload.sources[0].count, 0);
    assert.deepEqual(emptyPayload.items, []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('快照请求复用同一个 Promise，避免重复出网', async () => {
  const ctx = browser();
  let count = 0;
  ctx.fetch = async () => { count++; return { ok:true, text:async () => JSON.stringify(snapshot()) }; };
  const first = ctx.run('loadSnapshot()');
  assert.equal(ctx.run('loadSnapshot()'), first);
  await first;
  assert.equal(count, 1);
});

test('快照网络超时不会让页面一直停留在刷新状态', async () => {
  const ctx = browser();
  ctx.fetch = (_, opts) => new Promise((resolve, reject) => {
    opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('timeout'), { name:'AbortError' })));
  });
  ctx.run('var originalFetchJson = fetchJson; fetchJson = function(url) { return originalFetchJson(url, 5); }; SOURCES.forEach(function(s){settings.enabled[s.id]=false;});');
  await ctx.run('refresh(true)');
  assert.equal(ctx.run('state.loading'), false);
  assert.equal(ctx.run('state.snap.error'), '请求超时');
});

test('快照拉取失败时保留已缓存内容但明确标记为上次结果', async () => {
  const ctx = browser(); ingest(ctx, snapshot());
  ctx.fetch = async () => { throw new Error('network unavailable'); };
  assert.equal(await ctx.run('loadSnapshot()'), false);
  assert.equal(ctx.run('state.items.length'), 1);
  assert.equal(ctx.run('state.status.hf.stale'), true);
  assert.equal(ctx.run('state.status.hf.ok'), true);
  assert.equal(ctx.run('state.mode'), 'partial');
});

test('自检脚本拒绝不存在或不属于当前范围的数据源', () => {
  const result = spawnSync(process.execPath, ['tools/verify-sources.mjs', '--client', '--only', 'hf'], { cwd:new URL('..', import.meta.url), encoding:'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /所选范围中没有数据源/);
});

test('游戏和动漫独立分类，普通热榜也能识别 CS2', () => {
  const ctx = browser();
  assert.equal(ctx.run('categoryById("game").name'), '游戏');
  assert.equal(ctx.run('categoryById("anime").name'), '动漫');
  assert.equal(ctx.run('classify("CS2 比赛", "", sourceById("hn"), []).id'), 'game');
  assert.equal(ctx.run('classify("动漫番剧新作公布", "", sourceById("hn"), []).id'), 'anime');
  ctx.run('state.items = [{category:"game"}, {category:"anime"}]; renderChips();');
  assert.match(ctx.document.getElementById('categoryChips').innerHTML, /data-fc="game">[\s\S]*?nav-name">游戏<\/span>/);
  assert.match(ctx.document.getElementById('categoryChips').innerHTML, /data-fc="anime">[\s\S]*?nav-name">动漫<\/span>/);
});

test('CS2 大赛来源分类在快照、筛选、导出和缓存恢复时一致', () => {
  const storage = new Map();
  const ctx = browser(storage);
  const p = snapshot('OpenAI 与 NVIDIA 合作提供赛事分析');
  p.sources = [{ id: 'cs2matches', name: 'CS2 大赛赛果 · BO3.gg', short: 'CS2赛果', category: 'game', fallbackCat: 'game', ok: true }];
  p.items[0].sourceId = 'cs2matches';
  p.items[0].tags = ['CS2'];
  ingest(ctx, p);
  assert.equal(ctx.run('state.items[0].category'), 'game');
  ctx.run('state.fCategory = "game";');
  assert.equal(ctx.run('visibleItems().length'), 1);
  assert.match(ctx.run('buildReportText()'), /游戏/);
  assert.match(ctx.run('itemToText(state.items[0])'), /CS2赛果/);
  const restored = browser(storage);
  assert.equal(restored.run('loadStore()'), true);
  assert.equal(restored.run('state.items[0].category'), 'game');
  assert.equal(restored.run('sourceById("cs2matches").category'), 'game');
});

test('非法来源固定分类会回退到正常分类规则', () => {
  const ctx = browser();
  const p = snapshot();
  p.sources[0].category = 'nonexistent';
  ingest(ctx, p);
  assert.equal(ctx.run('sourceById("hf").category'), '');
  assert.equal(ctx.run('state.items[0].category'), 'ai');
});


function matchFixture(status = 'finished', offsetHours = -1) {
  return {
    id: 123, slug: 'alpha-vs-beta-test', discipline_id: 1, status,
    start_date: new Date(Date.now() + offsetHours * 3600e3).toISOString(),
    team1: { name: 'Alpha' }, team2: { name: 'Beta' }, tournament: { name: 'CS2 Test Cup', tier_rank: 1 },
    team1_score: 0, team2_score: 1, bo_type: 3
  };
}

test('CS2 大赛赛果保留零比分和北京时间，比分更正不改变条目 ID', () => {
  const raw = matchFixture();
  const first = normalizeCs2Match(raw);
  const next = normalizeCs2Match({ ...raw, team1_score: 1 });
  assert.match(first.summary, /已结束 · 大比分 0:1/);
  assert.match(first.summary, /CS2 Test Cup/);
  assert.match(first.summary, /（北京时间） · BO3/);
  assert.equal(first.url, 'https://bo3.gg/matches/alpha-vs-beta-test');
  assert.equal(first.hotRaw, 0);
  const src = SERVER_SOURCES.find((s) => s.id === 'cs2matches');
  assert.equal(finalize(src, [first])[0].id, finalize(src, [next])[0].id);
});

test('CS2 缺失比分不按零处理', () => {
  const missing = normalizeCs2Match({ ...matchFixture(), team1_score: null });
  assert.match(missing.summary, /已结束 · 比分暂缺/);
});

test('CS2 只保留最近 7 天合法的 Tier 1 已结束赛果', () => {
  assert.equal(normalizeCs2Match({ ...matchFixture(), discipline_id: 2 }), null);
  assert.equal(normalizeCs2Match(matchFixture('current')), null);
  assert.equal(normalizeCs2Match(matchFixture('upcoming', 2)), null);
  assert.equal(normalizeCs2Match({ ...matchFixture(), status: 'cancelled' }), null);
  assert.equal(normalizeCs2Match({ ...matchFixture(), tournament: { name: 'Small Cup', tier_rank: 2 } }), null);
  assert.equal(normalizeCs2Match({ ...matchFixture(), tournament: { name: 'Unknown Cup' } }), null);
  assert.equal(normalizeCs2Match({ ...matchFixture(), team1: null }), null);
  assert.equal(normalizeCs2Match({ ...matchFixture(), slug: 'https://evil.test/' }), null);
  assert.equal(normalizeCs2Match(matchFixture('finished', -169)), null);
  assert.equal(normalizeCs2Match(matchFixture('finished', 1)), null);
  assert.ok(normalizeCs2Match(matchFixture('finished', -167)));
});

test('CS2 服务端按顶级赛果查询，并在本地再次过滤小赛与未结束比赛', async (t) => {
  let requested = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    requested++;
    const p = new URL(url).searchParams;
    assert.equal(p.get('filter[matches.status][in]'), 'finished');
    assert.equal(p.get('filter[matches.discipline_id][eq]'), '1');
    assert.equal(p.get('filter[matches.tier_rank][eq]'), '1');
    assert.equal(p.get('sort'), '-start_date');
    const rows = Array.from({ length: 18 }, (_, i) => ({
      ...matchFixture('finished', -i - 1), slug: 'finished-match-' + i,
      team1: { name: 'Alpha ' + i }
    }));
    rows.push(matchFixture('current'), matchFixture('upcoming', 1),
      { ...matchFixture(), tournament: { name: 'Small Cup', tier_rank: 3 } }, rows[0]);
    return new Response(JSON.stringify({ results: rows }));
  });
  const src = SERVER_SOURCES.find((s) => s.id === 'cs2matches');
  assert.equal(SERVER_SOURCES.some((s) => s.id === 'cs2steam'), false);
  const rows = finalize(src, await src.run());
  assert.equal(requested, 1);
  assert.equal(rows.length, 18);
  assert.ok(rows.every((row) => row.tags[1] === '大赛赛果' && row.tags[2] === '已结束'));
  assert.ok(rows.every((row, i) => i === 0 || row.ts <= rows[i - 1].ts));
  const ctx = browser();
  const p = snapshot();
  p.sources = [{ ...src, ok: true }];
  p.items = rows;
  ingest(ctx, p);
  ctx.run('state.fCategory = "game";');
  assert.equal(ctx.run('visibleItems().length'), 15);
  assert.match(ctx.run('buildReportText()'), /CS2 Test Cup/);
  assert.match(ctx.run('buildReportText()'), /Tier 1/);
});

test('没有大赛赛果时快照仍显示源正常，不伪造条目', () => {
  const ctx = browser();
  const p = snapshot();
  p.sources = [{ id: 'cs2matches', name: 'CS2 大赛赛果', category: 'game', ok: true, count: 0 }];
  p.items = [];
  ingest(ctx, p);
  assert.equal(ctx.run('state.status.cs2matches.ok'), true);
  assert.equal(ctx.run('state.status.cs2matches.failed'), false);
  assert.equal(ctx.run('state.items.length'), 0);
});

test('CS2 赛事接口结构变化时明确失败', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('{}'));
  const src = SERVER_SOURCES.find((s) => s.id === 'cs2matches');
  await assert.rejects(src.run(), /赛事接口结构异常/);
});

test('旧快照和旧缓存无法恢复下线来源，用户偏好仍可迁移', () => {
  const storage = new Map([['hot_daily_brief_v1', JSON.stringify({cv:2, settings:{theme:'dark'},
    snapshot:{at:Date.now(), sources:[{id:'juejin'}]}, items:[{sourceId:'juejin',title:'旧条目'}]})]]);
  const ctx = browser(storage);
  assert.equal(ctx.run('loadStore()'), false);
  assert.equal(ctx.run('settings.theme'), 'dark');
  assert.equal(ctx.run('sourceById("juejin")'), null);
  const old = snapshot(); old.schema = 1;
  assert.throws(() => ingest(ctx, old), /版本/);
  const mixed = snapshot();
  mixed.sources.push({id:'juejin',ok:true}); mixed.items.push({sourceId:'juejin',title:'旧条目'});
  ingest(ctx, mixed);
  assert.equal(ctx.run('state.items.length'), 1);
  assert.deepEqual(Array.from(ctx.run('SOURCES.map(s=>s.id)')), ['hn','ghnew']);
  assert.equal(ctx.run('SOURCES.every(s => s.path.startsWith("https://"))'), true);
});

test('原始时间、入榜和观察时间独立，作者更名和重复刷新保留首次发现', () => {
  const now = Date.now(), old = now - 30*86400000;
  const src = SERVER_SOURCES.find(s => s.id === 'hf');
  const raw = {url:'https://arxiv.org/abs/2611.12345',title:'First title',ts:old,attentionAt:now-3600000};
  const [first] = finalize(src,[raw],{now});
  const [again] = finalize(src,[{...raw,title:'Edited'}],{now:now+60000,previous:new Map([[first.id,first]])});
  assert.equal(again.publishedAt,old);
  assert.equal(again.ts,raw.attentionAt);
  assert.equal(again.eventKind,'近期受关注');
  assert.equal(again.firstSeenAt,now);
  assert.equal(again.eventSeenAt,now);
  assert.equal(again.id,first.id);
});

test('跨分类 arXiv ID 聚合保留一手链接，入榜及转载不会抬升原始事件得分', () => {
  const ctx = browser();
  const p = snapshot();
  p.sources.push({id:'arxiv',ok:true,fallbackCat:'academic'});
  const t = Date.now();
  p.items = [{sourceId:'hf',title:'社区译名',tier:2,eventKind:'近期受关注',ts:t,
    eventKey:'arxiv:2611.12345',url:'https://arxiv.org/abs/2611.12345',discoveryUrl:'https://huggingface.co/papers/2611.12345'},
    {sourceId:'arxiv',title:'Open-weight reasoning model',tier:1,eventKind:'首次发布',ts:t,
      eventKey:'arxiv:2611.12345',url:'https://arxiv.org/abs/2611.12345v1'}];
  ingest(ctx,p);
  assert.equal(ctx.run('topFlash(visibleItems(),10)[0].sourceId'), 'arxiv');
  assert.equal(ctx.run('topFlash(visibleItems(),10).length'), 1);
  assert.equal(ctx.run('state.items.find(x=>x.sourceId==="arxiv").evidenceLinks.some(x=>x.url.includes("huggingface"))'), true);
  ctx.run('settings.watch="推理模型, 开放权重";recompute();state.query="推理模型"');
  assert.equal(ctx.run('visibleItems()[0].watch.length'),2);
  assert.equal(ctx.run('visibleItems()[0].signalParts.关注'),10);
  const prev = ctx.run('visibleItems()[0].signal');
  ctx.run('settings.enabled.hf=false;recompute()');
  assert.equal(ctx.run('visibleItems()[0].signal'),prev);
});

test('正式版本与修订的原文保留在快照，首页排除旧文回流与普通预印本修订', async (t) => {
  const now=Date.now(), src=SERVER_SOURCES.find(s=>s.id==='release-vllm');
  const base={tag_name:'v1.2.3',body:'Fix',html_url:'https://github.com/vllm-project/vllm/releases/tag/v1.2.3',published_at:new Date(now-1000).toISOString()};
  t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify([base,{...base,draft:true},{...base,prerelease:true}])));
  const rows=finalize(src,await src.run(),{now});
  assert.equal(rows.length,1);
  assert.equal(rows[0].eventKey,'vllm-project/vllm@v1.2.3');
  const ctx=browser(), p=snapshot();
  p.sources=[{id:src.id,ok:true},{id:'arxiv',ok:true},{id:'openai',ok:true}];
  p.items=[...rows,{...rows[0],sourceId:'arxiv',eventKey:'arxiv:123',eventKind:'论文修订'},
    {...rows[0],sourceId:'openai',eventKey:'case',url:'https://openai.com/business/customer-stories/sample'}];
  ingest(ctx,p);
  assert.equal(ctx.run('topFlash(visibleItems(),10).length'), 1);
  assert.equal(ctx.run('topFlash(visibleItems(),10)[0].sourceId'),src.id);
});

test('Crossref 只跟踪匹配 DOI 的出版社更新，保留撤稿通知链接', async (t) => {
  const now = Date.now(), doi = '10.1234/actual', src = SERVER_SOURCES.find(s=>s.id==='crossref');
  const paper = {sourceId:'arxiv',eventKey:'arxiv:2601.12345',doi,title:'Original',
    url:'https://arxiv.org/abs/2601.12345',publishedAt:now-86400000*30};
  t.mock.method(globalThis,'fetch',async url => {
    const query = new URL(url);
    if (query.searchParams.has('filter')) {
      const notices = [doi,'10.1234/unrelated'].map((id,i)=>({DOI:'10.1234/notice'+i,
        'update-to':[{DOI:id,type:'retraction',updated:{timestamp:now-300000}}]}));
      return Response.json({message:{items:notices}});
    }
    return Response.json({message:{DOI:doi,publisher:'Publisher',published:{'date-parts':[[2026,1,1]]}}});
  });
  const rows = finalize(src,await src.run({papers:[paper]}),{now});
  assert.equal(rows.length,1);
  assert.equal(rows[0].eventKey,paper.eventKey);
  assert.equal(rows[0].recordUrl,'https://doi.org/10.1234/notice0');
  assert.equal(rows[0].eventKind,'撤稿');
  assert.equal(rows[0].ts,now-300000);
  assert.equal(rows[0].publishedAt,paper.publishedAt);
});

test('离线回退逐源保留成功、正常零条和上游错误，恢复远端后清除旧标记', () => {
  const ctx=browser(), p=snapshot();
  p.desktopFallback=true;
  p.snapshotError='HTTP 503';
  p.sources.push({id:'release-pytorch',ok:true,count:0},{id:'crossref',ok:false,error:'HTTP 429'});
  ingest(ctx,p);
  ctx.run('renderStatus()');
  const html=ctx.document.getElementById('srcStatus').innerHTML;
  assert.match(html,/上次采集正常/);
  assert.match(html,/窗口内暂无新增/);
  assert.match(html,/HTTP 429/);
  assert.match(html,/更新失败：HTTP 503/);
  assert.equal(ctx.run('state.snap.sources.filter(s=>state.status[s.id].failed).length'),1);
  delete p.desktopFallback;delete p.snapshotError;
  ingest(ctx,p);
  assert.equal(ctx.run('state.status.hf.stale'),false);
  assert.equal(ctx.run('state.snap.error'),'');
});
