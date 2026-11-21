import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../每日热搜早报.html', import.meta.url), 'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
export function browser(storage = new Map()) {
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
    document: { getElementById: element, querySelectorAll: () => [] },
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
