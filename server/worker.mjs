// Each run has a supervisor independent of the web server. Control is file-based;
// the server never sends a signal to an unverified, persisted PID.
import { spawn, execFile } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync, existsSync, openSync, closeSync, writeSync, statSync } from 'node:fs';
import path from 'node:path';

const runDir = process.argv[2];
const config = JSON.parse(readFileSync(path.join(runDir, 'config.json'), 'utf8'));
const statePath = path.join(runDir, 'state.json');
const logPath = path.join(runDir, 'output.log');
const maxLogBytes = 5 * 1024 * 1024;
let logFd = openSync(logPath, 'a', 0o600);
let logSize = statSync(logPath).size;
let child, leaderExited = false, exitCode = null, exitSignal = null, stopAt = null, forced = false, finished = false;
const state = { status: 'starting', workerPid: process.pid, pid: null, startedAt: new Date().toISOString(), heartbeat: Date.now(), exitCode: null, signal: null, endedAt: null };
function save() {
  state.heartbeat = Date.now();
  writeFileSync(`${statePath}.tmp`, JSON.stringify(state), { mode: 0o600 });
  renameSync(`${statePath}.tmp`, statePath);
}
function log(chunk) {
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  if (logSize + buffer.length > maxLogBytes) {
    closeSync(logFd);
    renameSync(logPath, `${logPath}.1`);
    logFd = openSync(logPath, 'w', 0o600); logSize = 0;
  }
  writeSync(logFd, buffer); logSize += buffer.length;
}
function finish(status, error) {
  if (finished) return;
  finished = true;
  Object.assign(state, { status, endedAt: new Date().toISOString(), exitCode, signal: exitSignal, error: error || null });
  log(`\n[CumHub] ${status === 'stopped' ? '任务已停止' : status === 'failed' ? '任务异常退出' : '任务已结束'}${exitCode !== null ? ` · exit ${exitCode}` : ''}${error ? ` · ${error}` : ''}\n`);
  save(); closeSync(logFd);
  clearInterval(timer);
  setTimeout(() => process.exit(0), 40);
}
function groupAlive() {
  if (!child?.pid) return false;
  if (process.platform === 'win32') return !leaderExited;
  try { process.kill(-child.pid, 0); return true; } catch { return false; }
}
function signalGroup(signal) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/PID', String(child.pid), '/T', ...(signal === 'SIGKILL' ? ['/F'] : [])], { windowsHide: true }, () => {});
  } else {
    try { process.kill(-child.pid, signal); } catch (e) { if (e.code !== 'ESRCH') log(`[CumHub] 停止失败：${e.message}\n`); }
  }
}
function requestStop() {
  if (stopAt || finished) return;
  stopAt = Date.now(); state.status = 'stopping'; save();
  log('\n[CumHub] 正在停止任务…\n'); signalGroup('SIGTERM');
}
const timer = setInterval(() => {
  if (finished) return;
  if (existsSync(path.join(runDir, 'stop'))) requestStop();
  if (stopAt && !forced && Date.now() - stopAt > 5000) { forced = true; signalGroup('SIGKILL'); }
  if (leaderExited && !groupAlive()) finish(stopAt ? 'stopped' : exitCode === 0 ? 'exited' : 'failed');
  else save();
}, 350);
process.on('SIGTERM', requestStop);
process.on('SIGINT', requestStop);
process.on('uncaughtException', error => { signalGroup('SIGKILL'); finish('failed', error.message); });
save();
try {
  log(`[CumHub] ${config.label}\n[CumHub] 工作目录 ${config.spec.cwd}\n\n`);
  child = spawn(config.spec.executable, config.spec.args, {
    cwd: config.spec.cwd, env: config.spec.env, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  state.pid = child.pid || null;
  child.stdout.on('data', log); child.stderr.on('data', log);
  child.on('spawn', () => { state.status = stopAt ? 'stopping' : 'running'; save(); if (stopAt) signalGroup('SIGTERM'); });
  child.on('error', error => finish('failed', error.message));
  child.on('exit', (code, signal) => { leaderExited = true; exitCode = code; exitSignal = signal; });
} catch (error) { finish('failed', error.message); }
