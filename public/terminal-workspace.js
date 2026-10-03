import { dockRuns, isActiveRun, latestLauncherRuns } from './project-utils.js';

const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
const labels = { starting:'正在启动', running:'运行中', stopping:'正在停止', stopped:'已停止', exited:'已结束', failed:'异常退出', interrupted:'已中断' };
const initial = name => (name || '?').trim().slice(0, 2).toUpperCase();

export class TerminalWorkspace {
  constructor({ root, api, getRuns, getProjects, onAction, toast, copyText, download }) {
    Object.assign(this, { root, api, getRuns, getProjects, onAction, toast, copyText, download });
    this.pinned = new Set();
    this.cache = new Map();
    this.selected = null;
    this.visible = false;
    this.version = 0;
    this.position = null;
    this.size = null;
    this.dragging = false;
    this.signature = '';
    try {
      const saved = JSON.parse(sessionStorage.getItem('hub-terminal-workspace') || '{}');
      this.pinned = new Set(Array.isArray(saved.pinned) ? saved.pinned : []);
      this.selected = typeof saved.selected === 'string' ? saved.selected : null;
      this.visible = Boolean(saved.visible);
    } catch {}
    root.innerHTML = '<aside id="terminal-dock" class="terminal-dock" aria-label="终端任务栏" hidden></aside><div id="terminal-window-host"></div>';
    root.addEventListener('click', e => this.handleClick(e));
    document.addEventListener('selectionchange', () => {
      const log = this.logElement();
      if (log && this.hasSelection(log)) this.pause();
    });
    window.addEventListener('resize', () => this.clampPosition());
  }

  run(id = this.selected) { return this.getRuns().find(run => run.id === id); }
  entry(id) {
    if (!this.cache.has(id)) this.cache.set(id, { text:'', preview:'', previewStatus:null, request:0, loaded:false, paused:false, truncated:false, error:'', scrollTop:null });
    return this.cache.get(id);
  }
  logElement() { return this.root.querySelector('#run-log'); }
  persist() {
    try { sessionStorage.setItem('hub-terminal-workspace', JSON.stringify({ pinned:[...this.pinned], selected:this.selected, visible:this.visible })); } catch {}
  }
  currentRuns() { return dockRuns(this.getRuns(), this.pinned); }

  sync() {
    const ids = new Set(this.getRuns().map(run => run.id));
    for (const id of this.pinned) if (!ids.has(id)) this.pinned.delete(id);
    for (const id of this.cache.keys()) if (!ids.has(id)) this.cache.delete(id);
    if (this.selected && !ids.has(this.selected)) this.minimize();
    const runs = this.currentRuns();
    const dock = this.root.querySelector('#terminal-dock');
    dock.hidden = !runs.length && !this.visible;
    document.body.classList.toggle('has-terminal-dock', !dock.hidden);
    const signature = JSON.stringify(runs.map(run => [run.id, run.status, run.projectName, run.launcherName, this.getProjects().find(p => p.id===run.projectId)?.color])) + `:${this.selected}`;
    if (signature !== this.signature) {
      this.signature = signature;
      const scrollTop = dock.scrollTop;
      dock.innerHTML = `<div class="dock-heading"><strong>终端</strong><span>${runs.filter(isActiveRun).length} 运行中</span></div>
        <div class="dock-stack">${runs.map(run => this.dockCard(run)).join('') || '<div class="dock-empty">暂无运行任务</div>'}</div>`;
      dock.scrollTop = scrollTop;
    }
    if (this.selected && !this.root.querySelector('#terminal-window')) this.renderWindow();
    this.updateStatus();
    this.persist();
    this.clampPosition();
  }

  dockCard(run) {
    const project = this.getProjects().find(p => p.id===run.projectId);
    const cache = this.entry(run.id);
    return `<article class="dock-card ${this.selected===run.id?'selected':''}" data-dock-run="${run.id}">
      <button class="dock-open" data-terminal-action="open" data-run="${run.id}" aria-label="查看终端：${esc(run.projectName)} · ${esc(run.launcherName)}" aria-pressed="${this.selected===run.id}">
        <div class="dock-caption"><span class="dock-avatar ${project?.color || 'violet'}">${esc(initial(run.projectName))}</span><span><strong>${esc(run.projectName)}</strong><small>${esc(run.launcherName)}</small></span></div>
        <pre class="dock-preview" data-preview="${run.id}" aria-hidden="true">${esc(cache.preview || cache.text.split('\n').filter(Boolean).slice(-4).join('\n') || run.command || '等待输出…')}</pre>
        <span class="dock-status ${run.status}"><i></i>${labels[run.status] || esc(run.status)}</span>
      </button>${!isActiveRun(run) ? `<button class="dock-remove" data-terminal-action="remove" data-run="${run.id}" aria-label="移除终端：${esc(run.projectName)} · ${esc(run.launcherName)}" title="移除缩略卡片">×</button>` : ''}
    </article>`;
  }

  saveScroll() {
    if (this.selected && this.logElement()) this.entry(this.selected).scrollTop = this.logElement().scrollTop;
    const win = this.root.querySelector('#terminal-window');
    if (win) { const rect = win.getBoundingClientRect(); this.size = { width:rect.width, height:rect.height }; }
  }
  openRun(id) {
    const run = this.run(id);
    if (!run) return;
    this.saveScroll();
    ++this.version;
    this.selected = id;
    this.visible = true;
    this.pinned.add(id);
    this.renderWindow();
    this.sync();
    this.refresh();
  }
  openProject(projectId) {
    const runs = latestLauncherRuns(this.getRuns(), projectId);
    if (!runs.length) { this.toast('还没有运行记录，请先启动一个任务'); return; }
    for (const run of runs) this.pinned.add(run.id);
    this.openRun(runs.find(isActiveRun)?.id || runs[0].id);
  }
  toggle() {
    if (this.selected) { this.minimize(); return; }
    const run = this.currentRuns()[0];
    if (run) this.openRun(run.id);
    else { this.visible = !this.visible; this.signature=''; this.sync(); }
  }
  minimize() {
    this.saveScroll();
    ++this.version;
    this.selected = null;
    this.root.querySelector('#terminal-window-host').innerHTML = '';
    this.sync();
  }
  remove(id) {
    this.pinned.delete(id);
    if (this.selected===id) this.minimize();
    else this.sync();
  }
  replaceRun(oldId, newId) {
    this.pinned.delete(oldId);
    this.openRun(newId);
  }

  renderWindow() {
    const run = this.run();
    if (!run) return;
    const cache = this.entry(run.id);
    this.root.querySelector('#terminal-window-host').innerHTML = `<section class="terminal-window" id="terminal-window" role="region" aria-label="终端浮窗：${esc(run.projectName)} · ${esc(run.launcherName)}">
      <header class="terminal-head" data-drag-handle>
        <div class="window-controls"><button class="window-dot red" data-terminal-action="close" title="关闭浮窗" aria-label="关闭终端浮窗"></button><button class="window-dot yellow" data-terminal-action="minimize" title="最小化" aria-label="最小化终端"></button></div>
        <div class="terminal-title"><strong>${esc(run.projectName)}</strong><span>${esc(run.launcherName)}</span></div>
        <span class="terminal-badge" data-run-status></span>
        <button class="terminal-process-btn" data-run-control data-action="${isActiveRun(run)?'stop-run':'restart-run'}" data-run="${run.id}">${isActiveRun(run)?'停止':'重启'}</button>
      </header>
      <div class="terminal-toolbar"><span class="refresh-indicator" data-refresh-status></span><span class="toolbar-spacer"></span><button data-terminal-action="pause" data-log-toggle></button><button data-terminal-action="copy">复制输出</button><button data-terminal-action="save">保存输出</button></div>
      <pre class="terminal terminal-log" id="run-log" tabindex="0" aria-label="终端输出">${esc(cache.loaded ? cache.text || '暂无输出' : '正在读取输出…')}</pre>
      <div class="terminal-notice" data-log-notice role="status"></div>
      <details class="terminal-details"><summary>运行信息</summary><dl><dt>命令</dt><dd>${esc(run.command)}</dd><dt>工作目录</dt><dd>${esc(run.cwd)}</dd><dt>PID</dt><dd data-run-pid>${run.pid || '—'}</dd><dt>启动时间</dt><dd data-run-start></dd><dt>退出码</dt><dd data-run-exit>${run.exitCode ?? '—'}</dd></dl></details>
    </section>`;
    const log = this.logElement();
    if (this.size) {
      const win = this.root.querySelector('#terminal-window');
      win.style.width = `${this.size.width}px`; win.style.height = `${this.size.height}px`;
    }
    log.scrollTop = cache.scrollTop ?? log.scrollHeight;
    log.addEventListener('pointerdown', () => this.pause());
    log.addEventListener('scroll', () => {
      if (cache.loaded && log.scrollHeight-log.scrollTop-log.clientHeight>40) this.pause();
    });
    this.bindDrag();
    this.updateStatus();
    this.clampPosition();
  }

  hasSelection(el) {
    const selection = window.getSelection();
    return Boolean(selection && !selection.isCollapsed && selection.rangeCount && selection.containsNode(el, true));
  }
  pause() {
    if (!this.selected) return;
    this.entry(this.selected).paused = true;
    this.updateStatus();
  }
  resume() {
    const log = this.logElement();
    if (log && this.hasSelection(log)) window.getSelection().removeAllRanges();
    this.entry(this.selected).paused = false;
    this.updateStatus();
    this.refresh();
  }
  updateStatus() {
    const run = this.run();
    const win = this.root.querySelector('#terminal-window');
    if (!run || !win) return;
    const cache = this.entry(run.id);
    const badge = win.querySelector('[data-run-status]');
    badge.className = `terminal-badge ${run.status}`;
    badge.textContent = labels[run.status] || run.status;
    const control = win.querySelector('[data-run-control]');
    control.dataset.action = isActiveRun(run)?'stop-run':'restart-run';
    control.textContent = isActiveRun(run)?'停止':'重启';
    control.dataset.run = run.id;
    control.disabled = run.status==='stopping';
    const refresh = win.querySelector('[data-refresh-status]');
    refresh.textContent = cache.paused?'已暂停':'实时输出';
    refresh.classList.toggle('paused', cache.paused);
    win.querySelector('[data-log-toggle]').textContent = cache.paused?'继续刷新':'暂停刷新';
    win.querySelector('[data-run-pid]').textContent = run.pid || '—';
    win.querySelector('[data-run-start]').textContent = run.startedAt ? new Date(run.startedAt).toLocaleString('zh-CN') : '—';
    win.querySelector('[data-run-exit]').textContent = run.exitCode ?? '—';
    win.querySelector('[data-log-notice]').textContent = cache.error || (cache.truncated?'当前为最近约 220 KB 输出':'');
  }

  async refresh() {
    this.sync();
    const version = this.version;
    const selected = this.selected;
    const runs = this.currentRuns();
    // Small tails keep the right-hand previews cheap even with many tasks.
    const queue = runs.filter(run => isActiveRun(run) || this.entry(run.id).previewStatus!==run.status);
    if (selected && !this.entry(selected).paused && !queue.some(run => run.id===selected)) queue.unshift(this.run(selected));
    for (let i=0; i<queue.length; i+=4) {
      await Promise.all(queue.slice(i,i+4).map(async run => {
        if (!run) return;
        const entry = this.entry(run.id);
        const request = ++entry.request;
        const full = run.id===selected && !entry.paused;
        try {
          const data = await this.api(`/api/runs/${run.id}/logs${full?'':'?tail=1200'}`);
          if (version!==this.version || !this.run(run.id) || request!==entry.request) return;
          const cache = this.entry(run.id);
          cache.preview = data.text.split('\n').filter(Boolean).slice(-4).join('\n');
          cache.previewStatus = run.status;
          const preview = this.root.querySelector(`[data-preview="${run.id}"]`);
          if (preview && preview.textContent!==cache.preview) preview.textContent=cache.preview || run.command;
          if (!full || this.selected!==run.id || cache.paused) return;
          const log = this.logElement();
          if (!log) return;
          if (this.hasSelection(log)) { this.pause(); return; }
          const bottom = cache.scrollTop===null || log.scrollHeight-log.scrollTop-log.clientHeight<40;
          cache.text=data.text; cache.loaded=true; cache.truncated=data.truncated; cache.error='';
          const text=cache.text || '暂无输出';
          if (log.textContent!==text) log.textContent=text;
          if (bottom) log.scrollTop=log.scrollHeight;
          cache.scrollTop=log.scrollTop;
          this.updateStatus();
        } catch (error) {
          if (version===this.version && this.selected===run.id && request===entry.request) { this.entry(run.id).error=error.message; this.updateStatus(); }
        }
      }));
    }
  }

  async handleClick(event) {
    const button = event.target.closest('button');
    if (!button || !this.root.contains(button)) return;
    if (button.dataset.action) { this.onAction({ preventDefault:()=>event.preventDefault(), currentTarget:button }); return; }
    const action = button.dataset.terminalAction;
    if (!action) return;
    event.preventDefault();
    try {
      if (action==='open') this.openRun(button.dataset.run);
      else if (action==='minimize') this.minimize();
      else if (action==='close') this.remove(this.selected);
      else if (action==='remove') this.remove(button.dataset.run);
      else if (action==='pause') this.entry(this.selected).paused ? this.resume() : this.pause();
      else if (action==='copy') {
        const text=this.entry(this.selected).text;
        if (!text) throw new Error('暂无可复制的输出');
        await this.copyText(text); this.toast('当前输出已复制');
      } else if (action==='save') {
        const cache=this.entry(this.selected);
        if (!cache.loaded) throw new Error('输出尚未读取');
        this.download(`hub-${this.selected}.log`,cache.text,'text/plain;charset=utf-8');
      }
    } catch (error) { this.toast(error.message,true); }
  }

  bindDrag() {
    const win = this.root.querySelector('#terminal-window');
    const handle = win.querySelector('[data-drag-handle]');
    let drag = null;
    handle.addEventListener('pointerdown', event => {
      if (event.button!==0 || event.target.closest('button')) return;
      const rect=win.getBoundingClientRect();
      drag={ x:event.clientX, y:event.clientY, left:rect.left, top:rect.top };
      this.dragging=true;
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    handle.addEventListener('pointermove', event => {
      if (!drag) return;
      this.position={ left:drag.left+event.clientX-drag.x, top:drag.top+event.clientY-drag.y };
      this.clampPosition();
    });
    const end=()=>{ drag=null; this.dragging=false; };
    handle.addEventListener('pointerup',end);
    handle.addEventListener('pointercancel',end);
    handle.addEventListener('lostpointercapture',end);
  }
  clampPosition() {
    const chromeBottom=document.querySelector('.topbar')?.getBoundingClientRect().bottom || 86;
    this.root.style.setProperty('--hub-chrome-bottom',`${Math.round(chromeBottom)}px`);
    const win=this.root.querySelector('#terminal-window');
    if (!win || !this.position) return;
    const rect=win.getBoundingClientRect();
    const left=Math.max(8,Math.min(this.position.left,document.documentElement.clientWidth-rect.width-8));
    const top=Math.max(8,Math.min(this.position.top,window.innerHeight-rect.height-8));
    this.position={left,top};
    win.style.left=`${left}px`; win.style.top=`${top}px`; win.style.right='auto';
  }
}
