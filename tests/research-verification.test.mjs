import test from 'node:test';
import assert from 'node:assert/strict';
import { verificationReports, parseVerification } from '../tools/research-verification.mjs';
import { finalize, SERVER_SOURCES } from '../tools/sources-server.mjs';
import { browser } from '../tools/page-context.mjs';

const reviewer = {name:'Andrew Sutherland'};
const source = SERVER_SOURCES.find(s => s.id === 'research-verification');
const reportUrl = 'https://math.mit.edu/~drew/example/';
const paperUrl = 'https://arxiv.org/abs/2501.01234v2';
const stamp = new Date(Date.now() - 3600e3).toISOString().slice(0,16).replace('T',' ');
const html = `<h1>A computational test of a conjecture</h1>
<p>Announced at <a href="${paperUrl}">paper</a> on 1 January 2025.</p>
<p>Andrew Sutherland (MIT). Page last updated ${stamp} UTC.</p>
<table><tr><th>Check</th><th>Result</th><th>Detail</th></tr>
<tr><td>Experiment</td><td>pass</td><td>Baseline reproduced</td></tr>
<tr><td>Extension</td><td>running</td><td>More runs required</td></tr>
<tr><td>Variant</td><td>declined</td><td>Unsupported version</td></tr></table>`;

function mockNetwork(t, {authors = 'Test Author', discussion = true, comments = true} = {}) {
  const requested = [];
  t.mock.method(globalThis,'fetch', async (input, options) => {
    const url = new URL(input);
    requested.push(url.href);
    if (url.host === 'hn.algolia.com') {
      if (url.searchParams.get('tags') === 'comment') {
        return Response.json({hits:comments ? [{comment_text:'<a href="' + reportUrl.replaceAll('/','&#x2F;') +
          '">results</a><a href="https://unregistered.example/check/">other</a>'}] : []});
      }
      return discussion ? Response.json({hits:[{objectID:'1',url:paperUrl+'9'}, {objectID:'2',url:paperUrl}]}) : new Response('',{status:503});
    }
    assert.equal(options.redirect,'error');
    if (url.href === reportUrl || url.href === paperUrl) return new Response(url.href === reportUrl ? html :
      '<meta name="citation_author" content="' + authors + '">',{headers:{'content-type':'text/html'}});
    return new Response('',{status:404});
  });
  return requested;
}

test('新报告由评论发现，必须有作者原件、核验者署名与逐项记录；社区讨论只按原件关联',async t => {
  const requested = mockNetwork(t);
  const rows = await verificationReports();
  assert.equal(rows.length,1);
  const [item] = finalize(source, rows, {});
  assert.equal(item.recordUrl,reportUrl);
  assert.equal(item.discoveryUrl,'https://news.ycombinator.com/item?id=2');
  assert.equal(item.publishedAt,Date.UTC(2025,0,1));
  assert.equal(item.ts,Date.parse(stamp.replace(' ','T')+':00Z'));
  assert.deepEqual(item.verification.checks.map(c=>c.status),['通过','进行中','未执行或不适用']);
  assert.equal(requested.some(url => url.includes('unregistered')),false);

  const storage = new Map(), ctx = browser(storage);
  ctx.payload = {schema:2,generatedAtMs:Date.now(),sources:[{...source,ok:true}],items:[item]};
  ctx.example = {url:paperUrl,title:item.title,objectID:'2'};
  ctx.run(`ingestSnapshot(payload);var hn=sourceById('hn');state.buckets.hn=[
    normalizeItem(example,hn,0),normalizeItem({...example,url:'https://elsewhere.example/paper',objectID:'3'},hn,1)];
    recompute();saveStore();`);
  assert.equal(ctx.run('state.items.find(x=>x.verification).clusterSize'),2);
  assert.equal(ctx.run('state.items.find(x=>x.url.includes("elsewhere")).clusterParent'),'');
  assert.equal(ctx.run('topFlash(visibleItems(),10).length'),1);
  assert.equal(ctx.run('state.items.find(x=>x.verification).evidenceLinks.length'),3);
  const restored = browser(storage);
  restored.run('loadStore();globalThis.it=state.items.find(i=>i.verification);state.expanded[it.id]=true;');
  assert.match(restored.run('flashRowHtml(it,0,"hot")'),/进行中 1 项/);
  assert.match(restored.run('itemHtml(it)'),/Unsupported version/);
  assert.match(restored.run('itemToText(it)'),/发现渠道 · Hacker News/);
});

test('讨论索引失联后，历史报告重新读取原件，保持报告本身时间',async t => {
  mockNetwork(t,{comments:false,discussion:false});
  const previous = new Map([['known',{sourceId:source.id,recordUrl:reportUrl,ts:Date.now()}]]);
  const warnings = [];
  const [row] = await verificationReports({previous,warnings});
  assert.equal(row.discoveryUrl,'');
  assert.ok(warnings.some(v => v.includes('社区收录链接暂缺')));
  assert.equal(row.updatedAt,Date.parse(stamp.replace(' ','T')+':00Z'));
});

test('自证或报告不可读取时不生成核验条目',async t => {
  mockNetwork(t,{authors:'Sutherland, Andrew'});
  await assert.rejects(verificationReports(),/区分作者与核验者/);
});

test('报告时间、署名或表结构缺失时拒绝提升，未知与失败结论保留原义',() => {
  for (const [from,to] of [['Page last updated','Checked today'],['Andrew Sutherland','Anonymous'],['<th>Result','<th>Label']]) {
    assert.throws(()=>parseVerification(html.replace(from,to),reviewer));
  }
  const changed = parseVerification(html.replace('>pass<','>mismatch<').replace('>running<','>inconclusive<'),reviewer);
  assert.deepEqual(changed.checks.map(c=>c.status),['未通过','待解读','未执行或不适用']);
});
