import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ACTIVE, HttpError, newId } from './model.mjs';
import { launchSpec } from './platform.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export class ProcessManager {
  constructor(store, dataDir) { this.store = store; this.dataDir = dataDir; this.locks = new Set(); }
  dir(id) { return path.join(this.dataDir, 'runs', id); }
  refresh(run) {
    if (!ACTIVE.has(run.status)) return run;
    let state;
    try { state = JSON.parse(readFileSync(path.join(this.dir(run.id), 'state.json'), 'utf8')); } catch {}
    if (state) {
      let alive = true;
      try { process.kill(state.workerPid, 0); } catch { alive = false; }
      if (ACTIVE.has(state.status) && (!alive || Date.now() - state.heartbeat > 15000)) {
        state = { ...state, status: 'interrupted', endedAt: new Date().toISOString(), error: '任务监控进程已退出，无法确认其子进程状态。请检查后再启动。' };
      }
      const next = { ...run, ...state };
      if (run.status !== next.status || run.pid !== next.pid) {
        this.store.saveRun(next);
        if (!ACTIVE.has(next.status)) this.store.log(next.status, `${run.projectName} · ${run.launcherName}`, run.projectId);
      }
      return next;
    }
    if (Date.now() - Date.parse(run.createdAt) > 15000) {
      const next = { ...run, status: 'interrupted', endedAt: new Date().toISOString(), error: '任务监控进程未能启动' };
      this.store.saveRun(next); return next;
    }
    return run;
  }
  runs() { return this.store.runs().map(run => this.refresh(run)); }
  get(id) { const run = this.store.run(id); if (!run) throw new HttpError(404, '运行记录不存在'); return this.refresh(run); }
  async start(project, launcher) {
    const key = `${project.id}:${launcher.id}`;
    if (this.locks.has(key)) throw new HttpError(409, '此启动项正在启动');
    this.locks.add(key);
    try {
      if (this.runs().some(run => run.projectId === project.id && run.launcherId === launcher.id && ACTIVE.has(run.status))) throw new HttpError(409, '此启动项已经在运行');
      const spec = await launchSpec(project, launcher);
      const run = { id: newId(), projectId: project.id, projectName: project.name, launcherId: launcher.id, launcherName: launcher.name, command: launcher.kind === 'command' ? launcher.command : launcher.file, cwd: spec.cwd, status: 'starting', createdAt: new Date().toISOString(), startedAt: null, endedAt: null, pid: null, exitCode: null };
      const dir = this.dir(run.id); mkdirSync(dir, { recursive: true, mode: 0o700 });
      writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ label: `${project.name} / ${launcher.name}`, spec }), { mode: 0o600 });
      this.store.saveRun(run);
      const worker = spawn(process.execPath, [fileURLToPath(new URL('./worker.mjs', import.meta.url)), dir], { detached: true, stdio: 'ignore', windowsHide: true });
      worker.on('error', error => this.store.saveRun({ ...run, status: 'failed', error: error.message, endedAt: new Date().toISOString() }));
      worker.unref();
      project.lastUsedAt = new Date().toISOString(); this.store.saveProject(project);
      this.store.log('start', `${project.name} · ${launcher.name}`, project.id);
      return run;
    } finally { this.locks.delete(key); }
  }
  async stop(id, wait = false) {
    const run = this.get(id);
    if (!ACTIVE.has(run.status)) return run;
    writeFileSync(path.join(this.dir(id), 'stop'), 'stop', { mode: 0o600 });
    if (!wait) return { ...run, status: 'stopping' };
    for (let i = 0; i < 48; i++) { await delay(250); const next = this.get(id); if (!ACTIVE.has(next.status)) return next; }
    throw new HttpError(409, '任务仍在停止中，请稍后重试');
  }
  async restart(id) {
    const run = this.get(id);
    const project = this.store.project(run.projectId);
    const launcher = project?.launchers.find(l => l.id === run.launcherId);
    if (!launcher) throw new HttpError(404, '原启动项已被删除');
    await this.stop(id, true);
    return this.start(project, launcher);
  }
  logs(id, maxBytes = 220000) {
    const run = this.get(id);
    const files = ['output.log.1', 'output.log'].map(name => path.join(this.dir(id), name));
    let budget = Math.floor(Math.max(512, Math.min(220000, Number(maxBytes) || 220000))); const chunks = [];
    for (const file of files.reverse()) {
      if (!existsSync(file) || budget <= 0) continue;
      const size = statSync(file).size; const len = Math.min(size, budget);
      const fd = openSync(file, 'r'); const buffer = Buffer.alloc(len);
      try { readSync(fd, buffer, 0, len, size - len); } finally { closeSync(fd); }
      chunks.unshift(buffer.toString('utf8')); budget -= len;
    }
    return { text: chunks.join(''), truncated: budget === 0, run };
  }
}
