import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Manager } from './lib/manager.mjs';
import { Discovery } from './lib/discovery.mjs';

export async function createApp(root, options = {}) {
  const manager = await new Manager(root, options).init(), secret = randomBytes(32).toString('hex');
  const discovery = new Discovery(manager);
  const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); };
  const server = http.createServer(async (req, res) => {
    try {
      const host = req.headers.host || '';
      if (!/^127\.0\.0\.1:\d+$/.test(host)) return json(res, 403, { error: '仅限本机访问。' });
      const url = new URL(req.url, `http://${host}`);
      if (req.headers.origin && req.headers.origin !== `http://${host}`) return json(res, 403, { error: '跨站请求已拒绝。' });
      if (req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error: '跨站请求已拒绝。' });
      if (url.pathname === '/api/session' && req.method === 'GET') return json(res, 200, { token: secret });
      if (url.pathname.startsWith('/api/')) {
        const token = req.headers['x-shelf-token'] || '';
        if (typeof token !== 'string' || token.length !== secret.length || !timingSafeEqual(Buffer.from(token), Buffer.from(secret))) return json(res, 403, { error: '请刷新管理页面。' });
        if (req.method === 'GET' && url.pathname === '/api/overview') return json(res, 200, await manager.overview());
        if (req.method === 'GET' && url.pathname === '/api/github/status') return json(res, 200, { authenticated: manager.authenticated, mode: manager.authenticated ? '精确代码搜索 + 仓库发现' : '公开仓库发现', tokenStoredInBrowser: false });
        if (req.method !== 'POST') return json(res, 405, { error: '不支持这个操作。' });
        if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: '需要 JSON 请求。' });
        let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 12000) return json(res, 413, { error: '请求过大。' }); }
        const body = JSON.parse(raw || '{}');
        const routes = {
          '/api/github/search': () => discovery.search(body.query, body.page),
          '/api/github/repository': () => discovery.inspect(body.repo, body.query || ''),
          '/api/github/detail': () => discovery.detail(body.url),
          '/api/sync': () => manager.sync(), '/api/import': () => manager.importSource(body.url),
          '/api/preview': () => manager.preview(body.id), '/api/install': () => manager.install(body.token),
          '/api/uninstall': () => manager.uninstall(body.id), '/api/rollback': () => manager.rollback(body.id),
          '/api/favorite': () => manager.favorite(body.id),
        };
        if (!routes[url.pathname]) return json(res, 404, { error: '接口不存在。' });
        return json(res, 200, await routes[url.pathname]());
      }
      if (req.method !== 'GET') return json(res, 405, { error: '不支持这个操作。' });
      const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
      if (!files[url.pathname]) return json(res, 404, { error: '页面不存在。' });
      const [file, mime] = files[url.pathname];
      res.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'", 'Referrer-Policy': 'no-referrer' });
      res.end(await fs.readFile(path.join(root, 'public', file)));
    } catch (e) { json(res, 400, { error: e.message === 'fetch failed' ? '无法连接 GitHub。请检查网络后重试；本地目录仍可浏览。' : e.message }); }
  });
  return { server, manager };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.dirname(fileURLToPath(import.meta.url)), port = Number(process.env.SKILL_SHELF_PORT || 4318);
  const { server } = await createApp(root);
  server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `端口 ${port} 已占用，请打开已有页面或设置 SKILL_SHELF_PORT。` : e.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Skill Shelf 已启动：http://127.0.0.1:${server.address().port}\n安装位置：${path.join(root, '.agents', 'skills')}`));
}
