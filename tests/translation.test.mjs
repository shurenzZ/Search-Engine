import test from 'node:test';
import assert from 'node:assert/strict';
import translation from '../web/translation.js';
import { browser } from '../tools/page-context.mjs';

test('批量机译按字段复用，保留数学公式、模型术语和仓库名', async () => {
  const items = [{title:'Diffusion Transformers',summary:'Find $x$.'},{title:'Diffusion Transformers'},{title:'org/repo'}];
  let calls = 0;
  await translation.translate(items, {known:new Map([['Diffusion Transformers','扩散变压器']]), fetcher:async (_,options) => {
    calls++;
    assert.deepEqual(options.body.getAll('q'), ['⟦0⟧','Find ⟦0⟧.']);
    return Response.json(['⟦0⟧','求 ⟦0⟧。']);
  }});
  assert.equal(calls,1);
  assert.equal(items[0].titleZh,'扩散 Transformer');
  assert.equal(items[1].titleZh,items[0].titleZh);
  assert.equal(items[0].summaryZh,'求 $x$。');
  assert.equal(items[2].titleZh,undefined);
  const row = {title:'Find $x$.'};
  await translation.translate([row],{fetcher:async () => Response.json(['求。'])});
  assert.equal(row.titleZh,undefined);
  await assert.rejects(translation.translate([row],{fetcher:async () => Response.json([])}),/数量/);
});

test('中文视图、原文视图和双语检索共用同一条资讯', () => {
  const ctx = browser();
  ctx.s = {schema:2,generatedAtMs:Date.now(),sources:[{id:'hf',ok:true}],items:[
    {sourceId:'hf',title:'A translation example',summary:'Original abstract',titleZh:'译文示例',summaryZh:'中文摘要',url:'https://example.test/paper'}]};
  ctx.run('ingestSnapshot(s)');
  assert.match(ctx.run('itemHtml(state.items[0])'),/中文摘要/);
  assert.match(ctx.run("flashRowHtml(state.items[0], 0, 'hot')"),/译文示例/);
  for (const q of ['译文示例','Original abstract']) {
    ctx.q=q;assert.equal(ctx.run('state.query=q; visibleItems().length'),1);
  }
  ctx.run("settings.contentLanguage='original'");
  assert.match(ctx.run('itemHtml(state.items[0])'),/Original abstract/);
});
