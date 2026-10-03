import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { Store } from './store.mjs';
import { ProcessManager } from './processes.mjs';
import { ACTIVE, HttpError, validateProject, expandPath } from './model.mjs';
import { openLocal, choosePath } from './platform.mjs';
import { planImport, summarizeImport } from './imports.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const dataDir = path.resolve(process.env.HUB_DATA_DIR || path.join(root, '.data'));
const port = Number(process.env.HUB_PORT || 4310);
const token = randomBytes(32).toString('hex');
const store = new Store(dataDir);
const manager = new ProcessManager(store, dataDir);
const lockFile = path.join(dataDir, 'server.json');
let shuttingDown = false;
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
async function body(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new HttpError(415, '需要 JSON 请求');
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 2 * 1024 * 1024) throw new HttpError(413, '数据超过 2 MB'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); }
  catch { throw new HttpError(400, 'JSON 格式不正确'); }
}
function projectOrFail(id) { const p = store.project(id); if (!p) throw new HttpError(404, '项目不存在'); return p; }
const snapshot = () => ({ projects: store.projects(), runs: manager.runs().slice(0, 400), activity: store.activity(), platform: process.platform, hostname: os.hostname(), home: os.homedir(), dataDir, version: '1.0.0' });
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    const expectedPort = server.address()?.port;
    const host = req.headers.host || '';
    if (![ `127.0.0.1:${expectedPort}`, `localhost:${expectedPort}` ].includes(host)) throw new HttpError(403, '只接受本机访问');
    if (req.headers.origin && req.headers.origin !== `http://${host}`) throw new HttpError(403, '拒绝跨站请求');
    if (req.headers['sec-fetch-site'] === 'cross-site' && req.url.startsWith('/api/')) throw new HttpError(403, '拒绝跨站请求');
    const url = new URL(req.url, `http://${host}`);
    const route = url.pathname;
    const method = req.method;
    if (route === '/api/health' && method === 'GET') return json(res, 200, { app: 'local-project-hub', version: '1.0.0', dataDir });
    if (route === '/api/bootstrap' && method === 'GET') return json(res, 200, { token, ...snapshot() });
    if (route.startsWith('/api/')) {
      if (req.headers['x-hub-token'] !== token) throw new HttpError(403, '连接已更新，请刷新页面');
      if (route === '/api/state' && method === 'GET') return json(res, 200, snapshot());
      if (route === '/api/projects' && method === 'POST') {
        const project = validateProject(await body(req));
        store.saveProject(project); store.log('create', `添加了 ${project.name}`, project.id);
        return json(res, 201, project);
      }
      const projectMatch = route.match(/^\/api\/projects\/([a-z0-9-]+)$/);
      if (projectMatch) {
        const old = projectOrFail(projectMatch[1]);
        if (method === 'PUT') {
          const project = validateProject(await body(req), old);
          const active = manager.runs().filter(r => r.projectId === old.id && ACTIVE.has(r.status));
          if (active.some(run => !project.launchers.some(l => l.id === run.launcherId))) throw new HttpError(409, '请先停止要删除的启动项');
          store.saveProject(project); return json(res, 200, project);
        }
        if (method === 'DELETE') {
          if (manager.runs().some(r => r.projectId === old.id && ACTIVE.has(r.status))) throw new HttpError(409, '请先停止此项目的运行任务');
          store.deleteProject(old.id); store.log('delete', `移除了 ${old.name}`);
          return json(res, 200, { ok: true });
        }
      }
      const launchMatch = route.match(/^\/api\/projects\/([a-z0-9-]+)\/launchers\/([a-z0-9-]+)\/start$/);
      if (launchMatch && method === 'POST') {
        await body(req);
        const project = projectOrFail(launchMatch[1]);
        const launcher = project.launchers.find(l => l.id === launchMatch[2]);
        if (!launcher) throw new HttpError(404, '启动项不存在');
        return json(res, 201, await manager.start(project, launcher));
      }
      const runMatch = route.match(/^\/api\/runs\/([a-z0-9-]+)\/(stop|restart|logs)$/);
      if (runMatch) {
        if (runMatch[2] === 'logs' && method === 'GET') return json(res, 200, manager.logs(runMatch[1], url.searchParams.get('tail')));
        if (method === 'POST') {
          await body(req);
          if (runMatch[2] === 'stop') return json(res, 200, await manager.stop(runMatch[1]));
          if (runMatch[2] === 'restart') return json(res, 201, await manager.restart(runMatch[1]));
        }
      }
      if (route === '/api/pick-path' && method === 'POST') {
        const input = await body(req);
        return json(res, 200, { path: await choosePath(input.kind === 'file' ? 'file' : 'folder', os.homedir()) });
      }
      if (route === '/api/open-directory' && method === 'POST') {
        const input = await body(req); const project = projectOrFail(input.projectId);
        await openLocal(project.directory); return json(res, 200, { ok: true });
      }
      if (route === '/api/open-data-directory' && method === 'POST') {
        await body(req); await openLocal(dataDir); return json(res, 200, { ok: true });
      }
      if (route === '/api/check-directory' && method === 'POST') {
        const input = await body(req); const directory = expandPath(input.path);
        let found = false; try { found = (await stat(directory)).isDirectory(); } catch {}
        return json(res, 200, { exists: found, path: directory });
      }
      if (route === '/api/export' && method === 'GET') return json(res, 200, { schemaVersion: 1, exportedAt: new Date().toISOString(), projects: store.projects() });
      if ((route === '/api/import' || route === '/api/import/preview') && method === 'POST') {
        const input = await body(req);
        const plan = planImport(input, store.projects(), manager.runs());
        const summary = summarizeImport(plan);
        if (route.endsWith('/preview')) return json(res, 200, summary);
        store.transaction(() => {
          for (const { project } of plan) store.saveProject(project);
          store.log('import', `导入了 ${plan.length} 个项目（新增 ${summary.created}，更新 ${summary.updated}）`);
        });
        return json(res, 200, summary);
      }
      if (route === '/api/shutdown' && method === 'POST') {
        await body(req); json(res, 200, { ok: true }); setTimeout(shutdown, 100); return;
      }
      throw new HttpError(404, '找不到此操作');
    }
    if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, '不支持此请求');
    const filename = route === '/' ? 'index.html' : decodeURIComponent(route).slice(1);
    const fullPath = path.resolve(root, 'public', filename);
    if (!fullPath.startsWith(path.join(root, 'public') + path.sep)) throw new HttpError(403, '无效路径');
    let data;
    try { data = await readFile(fullPath); } catch { throw new HttpError(404, '页面不存在'); }
    res.writeHead(200, { 'Content-Type': mime[path.extname(fullPath)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(method === 'HEAD' ? undefined : data);
  } catch (error) {
    if (res.headersSent) return res.end();
    if (!error.status) console.error(error);
    json(res, error.status || 500, { error: error.status ? error.message : '操作失败，请查看本地服务日志' });
  }
});
const maintenance = setInterval(() => manager.runs(), 2000);
function shutdown() {
  if (shuttingDown) return; shuttingDown = true;
  clearInterval(maintenance);
  try { const lock = JSON.parse(readFileSync(lockFile, 'utf8')); if (lock.pid === process.pid) unlinkSync(lockFile); } catch {}
  server.close(() => { store.close(); process.exit(0); });
  server.closeIdleConnections();
  setTimeout(() => process.exit(0), 1500).unref();
}
server.on('error', error => { console.error(`CumHub 无法启动：${error.message}`); clearInterval(maintenance); store.close(); process.exit(1); });
server.listen(port, '127.0.0.1', () => {
  const actualPort = server.address().port;
  writeFileSync(lockFile, JSON.stringify({ pid: process.pid, port: actualPort, token, dataDir, startedAt: new Date().toISOString() }), { mode: 0o600 });
  console.log(`CumHub is ready at http://127.0.0.1:${actualPort}`);
  manager.runs();
});
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
