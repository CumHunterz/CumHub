import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dataDir = path.resolve(process.env.HUB_DATA_DIR || path.join(root, '.data'));
const port = Number(process.env.HUB_PORT || 4310);
const url = `http://127.0.0.1:${port}`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 13)) {
  console.error(`CumHub 需要 Node.js 22.13 或更新版本，当前是 ${process.versions.node}`);
  process.exit(1);
}
async function health() {
  try { return await (await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(800) })).json(); } catch { return null; }
}
if (process.argv.includes('--stop')) {
  let lock;
  try { lock = JSON.parse(readFileSync(path.join(dataDir, 'server.json'), 'utf8')); } catch { console.log('CumHub 未运行。'); process.exit(0); }
  try {
    const res = await fetch(`http://127.0.0.1:${lock.port}/api/shutdown`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Token': lock.token }, body: '{}', signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log('CumHub 已关闭。项目任务仍在后台运行，下次启动会重新连接。');
  } catch (error) { console.error(`无法连接 CumHub：${error.message}`); process.exitCode = 1; }
} else {
  let running = await health();
  if (running && (running.app !== 'local-project-hub' || running.dataDir !== dataDir)) throw new Error(`端口 ${port} 已被占用，请设置 HUB_PORT 后重新启动。`);
  if (!running) {
    try {
      const lock = JSON.parse(readFileSync(path.join(dataDir, 'server.json'), 'utf8'));
      if (lock.port && lock.port !== port) {
        const other = await (await fetch(`http://127.0.0.1:${lock.port}/api/health`, { signal: AbortSignal.timeout(800) })).json();
        if (other.app === 'local-project-hub' && other.dataDir === dataDir) throw new Error(`CumHub 已在 http://127.0.0.1:${lock.port} 运行，请直接打开该地址。`);
      }
    } catch (error) {
      if (error.message.startsWith('CumHub 已在')) throw error;
    }
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const fd = openSync(path.join(dataDir, 'server.log'), 'a', 0o600);
    const child = spawn(process.execPath, [path.join(root, 'server/main.mjs')], { cwd: root, env: { ...process.env, HUB_DATA_DIR: dataDir, HUB_PORT: String(port) }, detached: true, stdio: ['ignore', fd, fd], windowsHide: true });
    child.on('error', e => console.error(e.message)); child.unref(); closeSync(fd);
    for (let i = 0; i < 50; i++) { await delay(150); running = await health(); if (running?.app === 'local-project-hub') break; }
    if (!running || running.dataDir !== dataDir) throw new Error(`CumHub 启动失败，请查看 ${path.join(dataDir, 'server.log')}`);
  }
  console.log(`CumHub 已运行：${url}`);
  if (!process.argv.includes('--no-open')) {
    const exe = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32.exe' : 'xdg-open';
    const child = spawn(exe, process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => console.log(`请在浏览器打开 ${url}`)); child.unref();
  }
}
