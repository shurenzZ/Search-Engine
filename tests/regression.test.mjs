import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { parseTime, parseHot, parseFeed, fmtDate } from '../tools/lib.mjs';
import { finalize } from '../tools/sources-server.mjs';

const html = readFileSync(new URL('../每日热搜早报.html', import.meta.url), 'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function browser(storage = new Map()) {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      textContent: '', innerHTML: '', value: '', style: {},
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      addEventListener() {}, setAttribute() {}, focus() {}
    });
    return elements.get(id);
  };
  const ctx = vm.createContext({
    console, URL, Blob, AbortController, setTimeout, clearTimeout,
    location: { href: 'https://example.test/brief/index.html' },
    document: { getElementById: element },
    localStorage: {
      getItem: (k) => storage.get(k) || null,
      setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k)
    },
    fetch() { throw new Error('离线测试禁止出网'); }
  });
  // 测试实际内联脚本，只替换启动入口；生产文件不暴露测试接口。
  vm.runInContext(source.slice(0, source.lastIndexOf("if (document.readyState === 'loading')")) +
    'globalThis.run = function(code) { return eval(code); };\n})();', ctx);
  ctx.run('renderAll = renderHeader = setRefreshBtn = toast = function() {};');
  return ctx;
}
function snapshot(title = 'OpenAI 发布模型', at = Date.now()) {
  return { schema: 1, generatedAtMs: at, date: fmtDate(new Date(at)),
    sources: [{ id: 'hf', name: 'HF', short: 'HF', ok: true, fallbackCat: 'ai' }],
    items: [{ sourceId: 'hf', title, url: 'https://example.test/article', ts: at, tags: ['论文'] }] };
}
function ingest(ctx, payload) { ctx.payload = payload; return ctx.run('ingestSnapshot(payload)'); }
function seed(ctx) {
  ctx.run(`state.buckets = {};
    ['weibo', 'baidu'].forEach(function(id, i) {
      var it = makeItem({sourceId:id, title:'OpenAI 发布全新模型', hotRaw:100-i, ts:Date.now(), src:sourceById(id)});
      state.buckets[id] = [it];
    }); state.items = rebuildItems(state.buckets);`);
}

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
  p.sources.push({ id: 'constructor' }, { id: 'weibo' }, { id: 'evil" onclick="alert(1)' });
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
  ctx.run('settings.enabled.weibo = false; state.items = rebuildItems(state.buckets);');
  assert.equal(ctx.run('state.items.length'), 1);
  assert.equal(ctx.run('state.items[0].clusterParent'), '');
  assert.equal(ctx.run('state.items[0].signalParts.同现'), 0);
  assert.equal(ctx.run('settings.enabled.weibo = true; rebuildItems(state.buckets).length'), 2);
});

test('筛选只命中簇内子条目时仍可见，头条也保留该结果', () => {
  const ctx = browser(); seed(ctx);
  assert.equal(ctx.run('visibleItems().length'), 1);
  ctx.run('state.fSource = "baidu";');
  assert.equal(ctx.run('visibleItems().length'), 1);
  assert.equal(ctx.run('topFlash(visibleItems(), 10).length'), 1);
  ctx.run('state.fSource = "all"; state.items[1].summary = "独有检索词"; state.query = "独有检索词";');
  assert.equal(ctx.run('visibleItems().length'), 1);
});

test('同一平台不能两次计入同一个跨平台事件', () => {
  const ctx = browser(); seed(ctx);
  ctx.run('state.buckets.baidu.push(makeItem({sourceId:"baidu", title:"OpenAI 发布全新模型", hotRaw:1})); state.items = rebuildItems(state.buckets);');
  assert.equal(ctx.run('state.items.find(function(it){return it.sourceId === "weibo";}).clusterSize'), 2);
});

test('重复条目 ID 多次重新派生保持稳定且唯一', () => {
  const ctx = browser(); seed(ctx);
  ctx.run('state.buckets.weibo.push(makeItem({sourceId:"weibo", title:"OpenAI 发布全新模型", hotRaw:3})); state.items = rebuildItems(state.buckets);');
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
  await ctx.run('fetchOne(sourceById("weibo"), 0)');
  assert.equal(ctx.run('state.retryQueue.length'), 1);
  ctx.run('state.retryQueue = []; requestSource = function(){return Promise.resolve({ok:false, retryable:false, error:"403"});};');
  await ctx.run('fetchOne(sourceById("weibo"), 0)');
  assert.equal(ctx.run('state.retryQueue.length'), 0);
});

test('单源重试锁住全局刷新直到完成', async () => {
  const ctx = browser();
  ctx.run('requestSource = function(){return new Promise(function(resolve){globalThis.finishRequest = resolve;});}; retrySource("weibo");');
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
    const args = ['--import', mock, 'tools/build-brief.mjs', '--only', 'hf', '--gap', '0', '--out', dir];
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
  assert.equal(ctx.run('state.status.hf.ok'), false);
  assert.equal(ctx.run('state.mode'), 'partial');
});

test('自检脚本拒绝不存在或不属于当前范围的数据源', () => {
  const result = spawnSync(process.execPath, ['tools/verify-sources.mjs', '--client', '--only', 'hf'], { cwd:new URL('..', import.meta.url), encoding:'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /所选范围中没有数据源/);
});
