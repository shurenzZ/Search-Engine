// 页面和快照生成器共用同一翻译协议，仅提交公开的标题和摘要。
(function () {
  'use strict';
  function needsTranslation(text) {
    if (!text || !/[a-z]{2}/i.test(text)) return false;
    if (/^[\w.-]+\/[\w.-]+(?:\s+v?[\d.\w-]+)?$/.test(text)) return false;
    return !/[\u3400-\u9fff]/.test(text) || (text.match(/[a-z]{3,}/gi) || []).length > 8;
  }

  const terms = new Map([
    ['diffusion transformer','扩散 Transformer'], ['vision transformer','视觉 Transformer'],
    ['posterior matching','后验匹配'], ['post-training','后训练']
  ]);
  function protectTerms(text) {
    const preserved = [];
    const query = text.replace(/\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\b(?:diffusion transformers?|vision transformers?|posterior matching|post-training)\b/gi, token => {
      preserved.push(terms.get(token.toLowerCase().replace(/transformers$/, 'transformer')) || token);
      return '⟦' + (preserved.length - 1) + '⟧';
    });
    return {query, preserved};
  }

  async function translate(items, {known = new Map(), fetcher = fetch, onBatch, active = () => true} = {}) {
    const pending = new Map();
    for (const field of ['title','summary']) {
      const target = field + 'Zh';
      for (const item of items) {
        const text = item[field];
        if (item[target] && text) known.set(text, item[target]);
        if (!needsTranslation(text) || item[target]) continue;
        if (known.has(text) && protectTerms(text).preserved.every(term => known.get(text).includes(term))) {
          item[target] = known.get(text); continue;
        }
        if (!pending.has(text)) pending.set(text, []);
        pending.get(text).push({item, target});
      }
    }
    const entries = [...pending];
    for (let i = 0; i < entries.length && active();) {
      const batch = [];
      let size = 0;
      while (i < entries.length && batch.length < 20 && size + entries[i][0].length <= 4500) {
        const [text, targets] = entries[i++];
        size += text.length;
        batch.push({text, targets, ...protectTerms(text)});
      }
      if (!batch.length) { i++; continue; }
      const body = new URLSearchParams(batch.map(b => ['q',b.query]));
      const response = await fetcher('https://translate.googleapis.com/translate_a/t?client=gtx&sl=en&tl=zh-CN',
        {method:'POST', body, credentials:'omit', referrerPolicy:'no-referrer', signal:AbortSignal.timeout(9000)});
      if (!response.ok) throw new Error('翻译服务 HTTP ' + response.status);
      const values = await response.json();
      if (!Array.isArray(values) || values.length !== batch.length || values.some(v => typeof v !== 'string'))
        throw new Error('翻译结果与原文数量不符');
      for (const [index, b] of batch.entries()) {
        let value = values[index].trim();
        if (!value || value.length > 6000) continue;
        if (b.preserved.some((_, j) => value.split('⟦' + j + '⟧').length !== 2)) continue;
        value = value.replace(/⟦(\d+)⟧/g, (marker, j) => b.preserved[j] ?? marker);
        known.set(b.text, value);
        b.targets.forEach(({item, target}) => { item[target] = value; });
      }
      if (onBatch) onBatch();
    }
  }

  const api = {needsTranslation, translate};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.BriefTranslation = api;
})();
