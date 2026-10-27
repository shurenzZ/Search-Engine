const { createHash } = require('node:crypto');

const APP_URL = 'brief://app/';

function isAppUrl(value) {
  return typeof value === 'string' && value.split('#')[0] === APP_URL;
}

function isExternalUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

function validateExport(value) {
  if (!value || typeof value.filename !== 'string' || typeof value.text !== 'string' ||
      value.text.length > 25 * 1024 * 1024 || value.filename.length > 160 ||
      /[\\/\x00-\x1f<>:"|?*]/.test(value.filename) || !/\.(txt|json)$/i.test(value.filename)) {
    throw new Error('无效的导出文件');
  }
  return value;
}

function contentSecurityPolicy(html) {
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error('页面缺少入口脚本');
  const hash = createHash('sha256').update(script).digest('base64');
  return `default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src https: http: brief:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'`;
}

module.exports = { APP_URL, isAppUrl, isExternalUrl, validateExport, contentSecurityPolicy };
