import { mainPanelUrl, isActiveRun } from './project-utils.js';
import { TerminalWorkspace } from './terminal-workspace.js';
import { ProjectMasonry } from './project-layout.js';

const state = { token: '', projects: [], runs: [], activity: [], platform: '', home: '', view: 'all', query: '', group: 'all', sort: 'recent', modal: null, editor: null, importData: null, importPreview: null };
const layoutStorageKey = 'hub-project-layout';
try { state.projectLayout = localStorage.getItem(layoutStorageKey) === 'horizontal' ? 'horizontal' : 'vertical'; }
catch { state.projectLayout = 'vertical'; }
const expandedProjects = new Set();
const masonry = new ProjectMasonry();
let renderedView;
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const icons = { grid: '▦', activity: '◔', star: '☆', settings: '⚙', plus: '+', folder: '⌂', play: '▶', stop: '■', refresh: '↻', search: '⌕', external: '↗', terminal: '⌁', edit: '✎', dots: '•••', file: '▤', command: '⌘', link: '↗', trash: '×', upload: '↑', download: '↓' };
const statusMeta = { starting: ['starting', '正在启动'], running: ['running', '运行中'], stopping: ['stopping', '正在停止'], exited: ['exited', '已结束'], failed: ['failed', '异常退出'], interrupted: ['interrupted', '已中断'], stopped: ['exited', '已停止'] };
const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
const initial = s => (s || '?').trim().split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase();
const formatTime = value => { if (!value) return ''; const date = new Date(value); const diff = Date.now() - date; if (diff < 60000) return '刚刚'; if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`; if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`; return date.toLocaleDateString('zh-CN', { month:'numeric', day:'numeric' }); };
const projectRuns = id => state.runs.filter(r => r.projectId === id);
const activeRuns = id => projectRuns(id).filter(r => ['starting','running','stopping'].includes(r.status));
const showToast = (message, error = false) => { const el = document.createElement('div'); el.className = `toast${error ? ' error' : ''}`; el.textContent = message; $('#toast-root').append(el); setTimeout(() => el.remove(), 3200); };
async function api(path, options = {}) { const res = await fetch(path, { ...options, headers: { ...(options.body ? {'Content-Type':'application/json'} : {}), ...(state.token ? {'X-Hub-Token': state.token} : {}), ...(options.headers || {}) } }); let data; try { data = await res.json(); } catch { data = {}; } if (!res.ok) throw new Error(data.error || `请求失败（${res.status}）`); return data; }
async function bootstrap() { try { Object.assign(state, await api('/api/bootstrap')); render(); startPolling(); } catch (error) { document.body.innerHTML = `<div class="initial-loading"><div class="brand-mark">h<span>↗</span></div><span>${esc(error.message)}</span></div>`; } }
let pollTimer;
function startPolling() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    try {
      const data = await api('/api/state');
      const changed = JSON.stringify([state.projects, state.runs, state.activity]) !== JSON.stringify([data.projects, data.runs, data.activity]);
      Object.assign(state, data);
      if (changed && !state.modal && document.activeElement?.id !== 'search') render();
      await terminals.refresh();
    } catch {}
    startPolling();
  }, 2000);
}
function layout(content, active = 'all') {
  const runningCount = state.runs.filter(r => ['starting','running','stopping'].includes(r.status)).length;
  return `<div class="shell"><aside class="sidebar">
    <div class="brand"><div class="brand-mark">h<span>↗</span></div><div class="brand-name">CumHub<small>LOCAL PROJECTS</small></div></div>
    <nav class="nav"><button class="${active === 'all' ? 'active' : ''}" data-action="view" data-view="all"><span class="nav-icon">${icons.grid}</span>所有项目 <span class="nav-count">${state.projects.length}</span></button><button class="${active === 'running' ? 'active' : ''}" data-action="view" data-view="running"><span class="nav-icon">${icons.activity}</span>运行中 <span class="nav-count">${runningCount}</span></button><button class="${active === 'activity' ? 'active' : ''}" data-action="view" data-view="activity"><span class="nav-icon">◷</span>活动 <span class="nav-count">${state.activity.length}</span></button><button class="${active === 'favorite' ? 'active' : ''}" data-action="view" data-view="favorite"><span class="nav-icon">${icons.star}</span>收藏</button></nav>
    <div class="side-spacer"></div><div class="side-info">数据保存在本机<br><code>${esc(state.dataDir || '')}</code></div><button class="plain-btn settings-button" style="margin:0 10px;justify-content:center" data-action="settings">${icons.settings} 设置</button>
  </aside><main class="main"><header class="topbar"><div class="crumb">CumHub <strong>${active === 'running' ? '运行中' : active === 'favorite' ? '收藏' : active === 'activity' ? '活动' : '所有项目'}</strong></div><div class="top-actions"><button class="plain-btn terminal-toggle" data-action="toggle-terminals">${icons.terminal} 终端${runningCount?` <span class="task-count">${runningCount}</span>`:''}</button><button class="icon-btn" title="刷新" data-action="refresh">${icons.refresh}</button><button class="primary-btn" data-action="new-project">${icons.plus} 新建项目</button></div></header>${content}</main></div>`;
}
function statCards() { const running = state.runs.filter(r => ['starting','running','stopping'].includes(r.status)).length; const links = state.projects.reduce((n,p) => n + p.links.length, 0); return `<div class="stats"><div class="stat-card"><div><div class="stat-label">项目总数</div><div class="stat-value">${state.projects.length}</div></div><div class="stat-icon">${icons.grid}</div></div><div class="stat-card"><div><div class="stat-label">运行中的任务</div><div class="stat-value">${running}</div></div><div class="stat-icon green">${icons.activity}</div></div><div class="stat-card"><div><div class="stat-label">快捷入口</div><div class="stat-value">${links}</div></div><div class="stat-icon amber">${icons.link}</div></div></div>`; }
function projectAvatar(project) {
  const panel=mainPanelUrl(project);
  return panel
    ? `<a class="project-avatar panel-link ${project.color}" href="${esc(panel)}" target="_blank" rel="noopener" title="主控制面板 · ${esc(panel)}" aria-label="打开 ${esc(project.name)} 主控制面板">${esc(initial(project.name))}<span class="avatar-arrow">↗</span></a>`
    : `<button class="project-avatar panel-link ${project.color}" data-action="edit-project" data-project="${project.id}" title="设置主控制面板" aria-label="设置 ${esc(project.name)} 主控制面板">${esc(initial(project.name))}<span class="avatar-arrow">+</span></button>`;
}
function projectStatus(runs, showIdle = false) {
  const active=runs.filter(isActiveRun), latest=runs[0];
  return active.length
    ? `<div class="running-line"><span class="dot"></span>${active.length} 个任务运行中</div>`
    : latest?.status==='failed'||latest?.status==='interrupted'
      ? `<div class="running-line" style="color:var(--red)"><span class="dot red"></span>${statusMeta[latest.status]?.[1] || '需要检查'}</div>`
      : showIdle ? `<div class="project-status-idle">${statusMeta[latest?.status]?.[1] || '未启动'}</div>` : '';
}
function launcherControl(project, launcher, active) {
  const run=active.find(r=>r.launcherId===launcher.id);
  return run
    ? `<button class="launch-btn stop" data-action="stop-run" data-run="${run.id}" aria-label="停止 ${esc(project.name)} · ${esc(launcher.name)}">${icons.stop} 停止</button>`
    : `<button class="launch-btn" data-action="start" data-project="${project.id}" data-launcher="${launcher.id}" aria-label="启动 ${esc(project.name)} · ${esc(launcher.name)}">${icons.play} 启动</button>`;
}
function projectLaunchers(project, runs) {
  const active=runs.filter(isActiveRun);
  return project.launchers.length ? project.launchers.map(launcher=>{
    const run=active.find(r=>r.launcherId===launcher.id);
    const last=run || runs.find(r=>r.launcherId===launcher.id);
    return `<div class="launcher-row"><span class="launcher-name" title="${esc(launcher.name)}">${esc(launcher.name)}</span>${last?`<button class="launcher-log" data-action="view-run" data-run="${last.id}" title="查看 ${esc(launcher.name)} 终端" aria-label="查看 ${esc(launcher.name)} 终端">${icons.terminal}</button>`:''}${launcherControl(project,launcher,active)}</div>`;
  }).join('') : '<div class="card-meta">还没有启动项</div>';
}
function projectLinks(project) {
  return project.links.map(link=>`<a class="link-chip" href="${esc(link.url)}" target="_blank" rel="noopener" title="${esc(link.url)}">${icons.external} ${esc(link.name)}</a>`).join('');
}
function projectTitle(project) {
  return `<div class="card-title"><h3>${esc(project.name)}</h3><button class="project-path path" data-action="open-project-directory" data-project="${project.id}" title="复制路径并打开 · ${esc(project.directory)}" aria-label="复制路径并打开 ${esc(project.name)} 目录">${esc(project.directory)}</button></div>`;
}
function projectFavorite(project) {
  return `<button class="favorite ${project.favorite?'on':''}" data-action="favorite" data-project="${project.id}" title="${project.favorite?'取消收藏':'收藏'}" aria-label="${project.favorite?'取消收藏':'收藏'} ${esc(project.name)}" aria-pressed="${project.favorite}">${project.favorite?'★':'☆'}</button>`;
}
function projectTerminal(project, active) {
  return `<button class="project-terminal-btn" data-action="view-project-runs" data-project="${project.id}" aria-label="查看 ${esc(project.name)} 终端">${icons.terminal} 终端${active.length?`<span class="task-count">${active.length}</span>`:''}</button>`;
}
function projectMenuButton(project) {
  return `<button class="more-btn" data-action="project-menu" data-project="${project.id}" title="项目操作" aria-label="${esc(project.name)} 项目操作">${icons.dots}</button>`;
}
function projectCard(project) {
  const runs=projectRuns(project.id), active=runs.filter(isActiveRun), links=projectLinks(project);
  return `<article class="project-card ${active.length?'running':''}" data-project-card="${project.id}"><div class="card-top">${projectAvatar(project)}${projectTitle(project)}${projectFavorite(project)}</div><div class="card-body">${projectStatus(runs)}${projectLaunchers(project,runs)}</div><div class="card-tools">${projectTerminal(project,active)}${projectMenuButton(project)}</div>${links?`<div class="card-footer">${links}</div>`:''}</article>`;
}
function projectListItem(project) {
  const runs=projectRuns(project.id), active=runs.filter(isActiveRun), expanded=expandedProjects.has(project.id), links=projectLinks(project);
  const detailId=`project-details-${project.id}`;
  return `<article class="project-card project-list-item ${active.length?'running':''}" data-project-card="${project.id}">
    <div class="project-list-row">
      <button class="project-expand" data-action="expand-project" data-project="${project.id}" aria-expanded="${expanded}" aria-controls="${detailId}" aria-label="${expanded?'收起':'展开'} ${esc(project.name)}"><span aria-hidden="true">›</span></button>
      <div class="project-list-title">${projectAvatar(project)}${projectTitle(project)}</div>
      <div class="project-list-status">${projectStatus(runs,true)}</div>
      <div class="project-list-actions">${project.launchers[0]?launcherControl(project,project.launchers[0],active):''}${projectTerminal(project,active)}${projectFavorite(project)}${projectMenuButton(project)}</div>
    </div>
    <div class="project-details" id="${detailId}" ${expanded?'':'hidden'}>
      <div class="project-detail-heading">启动项 <span>${project.launchers.length}</span></div>
      <div class="project-launchers">${projectLaunchers(project,runs)}</div>
      ${links?`<div class="project-detail-heading project-links-heading">网页入口 <span>${project.links.length}</span></div><div class="project-links">${links}</div>`:''}
    </div>
  </article>`;
}
function projectCollection(projects) {
  return state.projectLayout==='horizontal'
    ? `<div class="project-list" aria-label="横向布局">${projects.map(projectListItem).join('')}</div>`
    : `<div class="project-grid" aria-label="竖向布局">${projects.map(projectCard).join('')}</div>`;
}
function filteredProjects() { let list = [...state.projects]; if (state.view === 'running') list = list.filter(p => activeRuns(p.id).length); if (state.view === 'favorite') list = list.filter(p => p.favorite); if (state.query) { const q = state.query.toLowerCase(); list = list.filter(p => [p.name,p.directory,p.description,p.group,...p.launchers.map(l=>l.name),...p.links.map(l=>l.name)].join(' ').toLowerCase().includes(q)); } if (state.group !== 'all') list = list.filter(p => (p.group || '未分组') === state.group); list.sort((a,b) => state.sort === 'name' ? a.name.localeCompare(b.name, 'zh-CN') : state.sort === 'used' ? (Date.parse(b.lastUsedAt||0)-Date.parse(a.lastUsedAt||0)) : (Date.parse(b.updatedAt||0)-Date.parse(a.updatedAt||0))); return list; }
function homeView() { const list = filteredProjects(); const groups = [...new Set(state.projects.map(p => p.group).filter(Boolean))]; return layout(`<section class="content ${state.projectLayout==='horizontal'?'content-horizontal':''}"><div class="hero"><div><h1>${state.view === 'running' ? '运行中' : state.view === 'favorite' ? '收藏' : '所有项目'}</h1><p>${state.view === 'running' ? '当前正在运行的任务' : '项目、启动项和常用入口'}</p></div><div class="hero-actions"><button class="plain-btn" data-action="import" title="导入 JSON 文件或粘贴内容">导入项目</button><button class="plain-btn" data-action="export" title="下载项目配置到本机">${icons.download} 下载备份</button></div></div>${statCards()}<div class="toolbar"><div class="search"><span>${icons.search}</span><input id="search" value="${esc(state.query)}" placeholder="搜索项目、路径或入口" autocomplete="off"></div><select class="select" id="group-select"><option value="all">所有分组</option>${groups.map(g=>`<option value="${esc(g)}" ${state.group===g?'selected':''}>${esc(g)}</option>`).join('')}</select><select class="select" id="sort-select"><option value="recent" ${state.sort==='recent'?'selected':''}>最近更新</option><option value="used" ${state.sort==='used'?'selected':''}>最近使用</option><option value="name" ${state.sort==='name'?'selected':''}>名称 A–Z</option></select></div><div class="section-label">${list.length ? `${list.length} 个项目` : '项目'}</div>${list.length ? projectCollection(list) : `<div class="empty"><strong>${state.projects.length ? '没有匹配的项目' : '还没有项目'}</strong><span>${state.projects.length ? '试试其他关键词或筛选条件' : '添加第一个项目，开始整理你的工作入口'}</span>${!state.projects.length ? '<br><br><button class="primary-btn" data-action="new-project">+ 添加项目</button>' : ''}</div>`}</section>`, state.view); }
function activityView() { const running = state.runs.filter(r => ['starting','running','stopping'].includes(r.status)); return layout(`<section class="content"><div class="hero"><div><h1>活动</h1><p>最近的启动记录和运行状态</p></div></div><div class="activity-layout"><div class="panel"><div class="panel-head"><h2>运行任务</h2><span class="panel-sub">${running.length} 个进行中</span></div>${state.runs.length ? state.runs.slice(0,30).map(runRow).join('') : '<div class="empty" style="border:0;box-shadow:none">还没有运行记录</div>'}</div><div class="panel"><div class="panel-head"><h2>最近活动</h2><span class="panel-sub">本机</span></div>${state.activity.length ? state.activity.slice(0,20).map(activityRow).join('') : '<div class="empty" style="border:0;box-shadow:none">暂无活动</div>'}</div></div></section>`, 'activity'); }
function runRow(run) { const meta = statusMeta[run.status] || ['exited',run.status]; return `<div class="run-item" data-action="view-run" data-run="${run.id}"><div class="run-row"><span class="dot ${meta[0] === 'exited' ? '' : meta[0] === 'failed' || meta[0] === 'interrupted' ? 'red' : meta[0] === 'stopping' || meta[0] === 'starting' ? 'amber' : ''}"></span><span class="run-name">${esc(run.projectName)} · ${esc(run.launcherName)}</span><span class="run-status">${meta[1]}</span></div><div class="run-command">${esc(run.command || '')}</div></div>`; }
function activityRow(item) { const map = { start:'▶', create:'＋', delete:'×', import:'↓' }; return `<div class="activity-row"><span class="activity-icon">${map[item.type] || '•'}</span><span class="activity-text">${esc(item.message)}</span><span class="activity-time">${formatTime(item.time)}</span></div>`; }
function render() {
  const mainScroll=renderedView===state.view?$('.main')?.scrollTop || 0:0;
  const sidebarScroll=$('.sidebar')?.scrollTop || 0;
  masonry.attach(null);
  $('#app').innerHTML=state.view==='activity'?activityView():homeView();
  bind();
  if (state.modal) {
    $('#overlay-root').innerHTML=state.modal==='project'?projectModal():state.modal==='settings'?settingsModal():state.modal==='menu'?projectMenuModal():state.modal==='import'?importModal():'';
    bindModal();
  } else $('#overlay-root').innerHTML='';
  terminals.sync();
  masonry.attach($('.project-grid'));
  $('.main').scrollTop=mainScroll;
  $('.sidebar').scrollTop=sidebarScroll;
  renderedView=state.view;
}
function field(label, key, value, opts = {}) { return `<div class="field ${opts.full ? 'full' : ''}"><label for="${key}">${label}${opts.optional ? ' <span class="optional">· 可选</span>' : ''}</label>${opts.textarea ? `<textarea class="textarea" id="${key}" rows="3">${esc(value)}</textarea>` : `<input class="input" id="${key}" value="${esc(value)}" ${opts.placeholder ? `placeholder="${esc(opts.placeholder)}"` : ''}>`}${opts.help ? `<div class="help">${opts.help}</div>` : ''}</div>`; }
function projectModal() { const p = state.editor || { name:'',directory:'',description:'',notes:'',mainPanelUrl:'',group:'',color:'violet',favorite:false,launchers:[],links:[] }; const editing = Boolean(p.id); return `<div class="overlay"><form class="modal wide" id="project-form"><div class="modal-head"><div><h2>${editing ? '编辑项目' : '新建项目'}</h2><p>项目资料</p></div><button type="button" class="close" data-action="close-modal">×</button></div><div class="modal-body"><div class="form-grid">${field('项目名称','p-name',p.name,{placeholder:'例如：Minecraft 服务端'})}<div class="field"><label>项目颜色</label><div class="color-picker">${['violet','blue','green','orange','pink','slate'].map(c=>`<button type="button" class="color-choice ${c} ${p.color===c?'selected':''}" data-action="pick-color" data-color="${c}" aria-label="${c}"></button>`).join('')}</div></div><div class="field full"><label for="p-directory">项目目录</label><div class="input-wrap"><input class="input" id="p-directory" value="${esc(p.directory)}" placeholder="/Users/you/Projects/example"><button type="button" class="plain-btn" data-action="pick-directory">选择</button></div><div class="help">默认工作目录</div></div>${field('主控制面板','p-main-panel',p.mainPanelUrl || mainPanelUrl(p),{optional:true,full:true,placeholder:'http://127.0.0.1:3000/admin',help:'点击项目图标打开此地址'})}${field('分组','p-group',p.group,{optional:true,placeholder:'例如：个人、服务器、实验'})}${field('一句话备注','p-description',p.description,{optional:true,placeholder:'帮助你快速识别这个项目'})}${field('备注','p-notes',p.notes,{optional:true,textarea:true,full:true,placeholder:'记录账号提示、部署信息或其他内容'})}<div class="field full"><label>启动项</label><div class="builder" id="launchers-builder">${p.launchers.map((l,i)=>launcherRow(l,i)).join('')}</div><button type="button" class="add-row" data-action="add-launcher">＋ 添加启动项</button><div class="help">命令、脚本、Python、Node、PowerShell 等均可配置</div></div><div class="field full"><label>网页入口</label><div class="builder" id="links-builder">${p.links.map((l,i)=>linkRow(l,i)).join('')}</div><button type="button" class="add-row" data-action="add-link">＋ 添加网页入口</button></div></div></div><div class="modal-foot"><button type="button" class="plain-btn" data-action="close-modal">取消</button><button class="primary-btn" type="submit">${editing ? '保存修改' : '添加项目'}</button></div></form></div>`; }
function launcherRow(l = {}, i) { const kind = l.kind || 'command'; const args = (l.args || []).join('\n'); const env = Object.keys(l.env || {}).length ? JSON.stringify(l.env, null, 2) : ''; return `<div class="builder-row launcher-row-form" data-index="${i}"><div class="builder-row-head"><input class="input l-name" value="${esc(l.name || '')}" placeholder="启动项名称，例如：开发服务"><button type="button" class="remove" data-action="remove-launcher">${icons.trash}</button></div><div class="builder-fields"><div class="segmented"><button type="button" class="${kind==='command'?'active':''}" data-kind="command">命令</button><button type="button" class="${kind==='file'?'active':''}" data-kind="file">文件</button></div><input class="input l-command" value="${esc(kind === 'file' ? l.file : l.command || '')}" placeholder="${kind==='file' ? '选择或填写文件路径' : '例如：npm run dev'}"><button type="button" class="plain-btn l-pick" data-action="pick-launcher-file" style="grid-column:2;width:max-content;${kind==='file'?'':'display:none'}">选择文件</button></div><div class="launcher-extra"><input class="input l-cwd" value="${esc(l.cwd || '')}" placeholder="工作目录（留空使用项目目录）"><input class="input l-interpreter" value="${esc(l.interpreter || '')}" placeholder="解释器路径（文件模式可选）"><textarea class="textarea l-args" rows="2" placeholder="参数，每行一个">${esc(args)}</textarea><textarea class="textarea l-env" rows="2" placeholder='环境变量 JSON，例如 {&quot;PORT&quot;:&quot;3000&quot;}'>${esc(env)}</textarea></div></div>`; }
function linkRow(l = {}, i) { return `<div class="link-builder-row link-row" data-index="${i}"><input class="input link-name" value="${esc(l.name||'')}" placeholder="名称"><input class="input link-url" value="${esc(l.url||'')}" placeholder="https://localhost:3000"><button type="button" class="remove" data-action="remove-link">${icons.trash}</button></div>`; }
function settingsModal() { return `<div class="overlay"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title"><div class="modal-head"><div><h2 id="settings-title">设置</h2></div><button class="close" data-action="close-modal" aria-label="关闭设置">×</button></div><div class="modal-body"><div class="settings-fields"><div class="field"><label id="project-layout-label">项目布局</label><div class="settings-layout-options" role="radiogroup" aria-labelledby="project-layout-label"><label class="settings-layout-option"><input type="radio" name="project-layout" value="vertical" ${state.projectLayout==='vertical'?'checked':''}>竖向布局</label><label class="settings-layout-option"><input type="radio" name="project-layout" value="horizontal" ${state.projectLayout==='horizontal'?'checked':''}>横向布局</label></div></div><div class="field"><label for="settings-data-dir">数据目录</label><div class="input-wrap"><input class="input" id="settings-data-dir" value="${esc(state.dataDir)}" readonly><button class="plain-btn" data-action="open-data">打开</button></div></div><div class="field"><label for="settings-port">服务端口</label><input class="input" id="settings-port" value="${location.port || 80}" readonly></div></div><p class="help" style="margin-top:18px">运行日志保存在数据目录中，不会写入项目备份。</p></div><div class="modal-foot"><button class="plain-btn" data-action="close-modal">关闭</button></div></div></div>`; }
function projectMenuModal() { const p = state.projects.find(x=>x.id===state.menuProject); if (!p) return ''; return `<div class="overlay"><div class="modal" style="width:350px"><div class="modal-head"><div><h2>${esc(p.name)}</h2><p>${esc(p.directory)}</p></div><button class="close" data-action="close-modal">×</button></div><div class="modal-body" style="display:grid;gap:9px"><button class="plain-btn" data-action="edit-project" data-project="${p.id}" style="justify-content:flex-start">${icons.edit} 编辑项目</button><button class="plain-btn" data-action="open-project-directory" data-project="${p.id}" style="justify-content:flex-start">${icons.folder} 打开项目目录</button><button class="danger-btn" data-action="delete-project" data-project="${p.id}" style="text-align:left">${icons.trash} 删除项目</button></div></div></div>`; }
function importModal() {
  const preview = state.importPreview;
  return `<div class="overlay"><div class="modal wide" role="dialog" aria-modal="true" aria-labelledby="import-title">
    <div class="modal-head"><div><h2 id="import-title">导入项目</h2><p>JSON 文件或文本</p></div><button class="close" data-action="close-modal" aria-label="关闭导入">×</button></div>
    <div class="modal-body">
      <div class="import-actions"><button class="plain-btn" data-action="import-files">选择 JSON 文件</button><button class="plain-btn" data-action="import-folder">选择文件夹批量收集</button><span class="help">可多选文件；文件夹只收集 hub-import.json</span></div>
      <input id="import-files" type="file" accept=".json,application/json" multiple hidden>
      <input id="import-folder" type="file" webkitdirectory multiple hidden>
      <div class="field"><label for="import-text">粘贴 JSON</label><textarea class="textarea import-text" id="import-text" placeholder='{"schemaVersion":1,"projects":[…]}' spellcheck="false"></textarea></div>
      <button class="plain-btn" data-action="preview-import-text" style="margin-top:10px">预览文本</button>
      <div id="import-error" class="inline-error" role="alert"></div>
      ${preview ? `<section class="import-preview"><h3>新增 ${preview.created} · 更新 ${preview.updated}</h3><p class="help">同目录项目更新配置。运行任务不会自动启动。</p>${preview.projects.map(p=>`<details class="import-project"><summary><span class="import-badge ${p.action}">${p.action==='create'?'新增':'更新'}</span><strong>${esc(p.name)}</strong><span class="path">${esc(p.directory)}</span></summary><div class="import-detail">${p.mainPanelUrl?`<div>主控制面板 <code>${esc(p.mainPanelUrl)}</code></div>`:''}${p.launchers.map(l=>`<div><strong>${esc(l.name)}</strong><code>${esc(l.kind==='file'?l.file:l.command)}</code></div>`).join('') || '<span class="help">无启动项</span>'}${p.links.map(l=>`<div>${esc(l.name)} <code>${esc(l.url)}</code></div>`).join('')}</div></details>`).join('')}</section>` : ''}
    </div><div class="modal-foot"><button class="plain-btn" data-action="close-modal">取消</button><button class="primary-btn" data-action="confirm-import" ${preview?'':'disabled'}>导入${preview?` ${preview.count} 个项目`:''}</button></div>
  </div></div>`;
}
let importRequest = 0;
async function previewImport(payload) {
  const request = ++importRequest;
  state.importData = null;
  state.importPreview = null;
  const confirm = $('[data-action="confirm-import"]');
  if (confirm) confirm.disabled = true;
  $('.import-preview')?.remove();
  $('#import-error').textContent = '';
  try {
    const preview = await api('/api/import/preview', { method:'POST', body:JSON.stringify(payload) });
    if (request !== importRequest || state.modal !== 'import') return;
    state.importData = payload;
    state.importPreview = preview;
    render();
  } catch (error) {
    if (request === importRequest && state.modal === 'import') $('#import-error').textContent = error.message;
  }
}
async function readImportFiles(files, folder = false) {
  ++importRequest;
  state.importData = null;
  state.importPreview = null;
  $('[data-action="confirm-import"]').disabled = true;
  $('.import-preview')?.remove();
  $('#import-error').textContent = '';
  try {
    const selected = [...files].filter(file => !folder || (file.name === 'hub-import.json' && !/(^|\/)(node_modules|\.git|\.data|\.venv|venv|dist|build)(\/)/.test(file.webkitRelativePath)));
    if (!selected.length) throw new Error(folder ? '未找到 hub-import.json' : '请选择 JSON 文件');
    if (selected.reduce((sum,f)=>sum+f.size,0) > 2*1024*1024) throw new Error('所选文件总大小超过 2 MB');
    const projects = [];
    for (const file of selected) {
      let data;
      try { data = JSON.parse(await file.text()); } catch { throw new Error(`${file.name}：JSON 格式不正确`); }
      if (data.schemaVersion !== 1 || !Array.isArray(data.projects)) throw new Error(`${file.name}：需要 schemaVersion: 1 和 projects 数组`);
      projects.push(...data.projects);
    }
    await previewImport({ schemaVersion:1, projects });
  } catch (error) { if ($('#import-error')) $('#import-error').textContent=error.message; }
}
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return; }
  } catch {}
  const area=document.createElement('textarea');
  area.value=text; area.style.cssText='position:fixed;left:-9999px;top:0';
  document.body.append(area); area.select();
  let copied=false;
  try { copied=document.execCommand('copy'); } catch {}
  area.remove();
  if (!copied) throw new Error('浏览器无法复制，请手动选择文字');
}
const terminals=new TerminalWorkspace({
  root:$('#terminal-root'), api, getRuns:()=>state.runs, getProjects:()=>state.projects,
  onAction:handleAction, toast:showToast, copyText, download,
});
function bind() { $('#search')?.addEventListener('input', e => { state.query=e.target.value; render(); $('#search')?.focus(); }); $('#group-select')?.addEventListener('change',e=>{state.group=e.target.value;render();}); $('#sort-select')?.addEventListener('change',e=>{state.sort=e.target.value;render();}); $$('#app [data-action]').forEach(el=>el.addEventListener('click', handleAction)); }
function bindModal() {
  $$('.overlay [data-action]').forEach(el=>el.addEventListener('click', handleAction));
  $$('input[name="project-layout"]').forEach(input=>input.addEventListener('change',()=>{
    state.projectLayout=input.value==='horizontal'?'horizontal':'vertical';
    try { localStorage.setItem(layoutStorageKey,state.projectLayout); }
    catch { showToast('布局已切换，浏览器未允许保存设置',true); }
    render();
    $(`input[name="project-layout"][value="${state.projectLayout}"]`)?.focus();
  }));
  $('#project-form')?.addEventListener('submit', saveProject);
  $('#import-files')?.addEventListener('change',e=>readImportFiles(e.target.files));
  $('#import-folder')?.addEventListener('change',e=>readImportFiles(e.target.files,true));
  $('#import-text')?.addEventListener('input',()=>{
    ++importRequest; state.importData=null; state.importPreview=null;
    $('[data-action="confirm-import"]').disabled=true; $('.import-preview')?.remove();
  });
  $$('.segmented button').forEach(btn=>btn.addEventListener('click',()=>{
    const row=btn.closest('.launcher-row-form');
    $$('.segmented button',row).forEach(x=>x.classList.toggle('active',x===btn));
    $('.l-command',row).placeholder=btn.dataset.kind==='file'?'选择或填写文件路径':'例如：npm run dev';
    $('.l-pick',row).style.display=btn.dataset.kind==='file'?'inline-flex':'none';
  }));
}
async function handleAction(event) {
  event.preventDefault();
  const el=event.currentTarget, action=el.dataset.action;
  try {
    if(action==='view') {
      state.view=el.dataset.view; state.query=''; state.group='all'; render();
    } else if(action==='refresh') {
      Object.assign(state,await api('/api/state')); render(); await terminals.refresh();
    } else if(action==='expand-project') {
      const id=el.dataset.project;
      if(expandedProjects.has(id)) expandedProjects.delete(id); else expandedProjects.add(id);
      const expanded=expandedProjects.has(id);
      el.setAttribute('aria-expanded',String(expanded));
      const project=state.projects.find(p=>p.id===id);
      el.setAttribute('aria-label',`${expanded?'收起':'展开'} ${project.name}`);
      document.getElementById(el.getAttribute('aria-controls')).hidden=!expanded;
    } else if(action==='toggle-terminals') terminals.toggle();
    else if(action==='new-project') { state.editor=null; state.modal='project'; render(); }
    else if(action==='settings') { state.modal='settings'; render(); }
    else if(action==='close-modal') { ++importRequest; state.modal=null; render(); }
    else if(action==='pick-color') { collectEditor(); state.editor.color=el.dataset.color; render(); }
    else if(action==='add-launcher') { collectEditor(); state.editor.launchers.push({kind:'command'}); render(); }
    else if(action==='remove-launcher') { collectEditor(); state.editor.launchers.splice(Number(el.closest('.launcher-row-form').dataset.index),1); render(); }
    else if(action==='add-link') { collectEditor(); state.editor.links.push({}); render(); }
    else if(action==='remove-link') { collectEditor(); state.editor.links.splice(Number(el.closest('.link-row').dataset.index),1); render(); }
    else if(action==='pick-directory') {
      const result=await api('/api/pick-path',{method:'POST',body:JSON.stringify({kind:'folder'})});
      if(result.path) $('#p-directory').value=result.path;
    } else if(action==='pick-launcher-file') {
      const result=await api('/api/pick-path',{method:'POST',body:JSON.stringify({kind:'file'})});
      if(result.path) el.closest('.launcher-row-form').querySelector('.l-command').value=result.path;
    } else if(action==='start') {
      el.disabled=true;
      const run=await api(`/api/projects/${el.dataset.project}/launchers/${el.dataset.launcher}/start`,{method:'POST',body:'{}'});
      Object.assign(state,await api('/api/state')); render(); terminals.openRun(run.id); showToast('任务已启动');
    } else if(action==='stop-run') {
      el.disabled=true;
      await api(`/api/runs/${el.dataset.run}/stop`,{method:'POST',body:'{}'});
      Object.assign(state,await api('/api/state')); render(); await terminals.refresh(); showToast('已发送停止请求');
    } else if(action==='restart-run') {
      el.disabled=true;
      const run=await api(`/api/runs/${el.dataset.run}/restart`,{method:'POST',body:'{}'});
      Object.assign(state,await api('/api/state')); render(); terminals.replaceRun(el.dataset.run,run.id); showToast('任务已重启');
    } else if(action==='view-run') terminals.openRun(el.dataset.run);
    else if(action==='view-project-runs') terminals.openProject(el.dataset.project);
    else if(action==='project-menu') { state.menuProject=el.dataset.project; state.modal='menu'; render(); }
    else if(action==='edit-project') {
      state.editor=JSON.parse(JSON.stringify(state.projects.find(p=>p.id===el.dataset.project))); state.modal='project'; render();
    } else if(action==='favorite') {
      const project=state.projects.find(p=>p.id===el.dataset.project);
      await api(`/api/projects/${project.id}`,{method:'PUT',body:JSON.stringify({...project,favorite:!project.favorite})});
      Object.assign(state,await api('/api/state')); render();
    } else if(action==='open-project-directory') {
      const project=state.projects.find(p=>p.id===el.dataset.project);
      let copied=false;
      try { await copyText(project.directory); copied=true; } catch {}
      try {
        await api('/api/open-directory',{method:'POST',body:JSON.stringify({projectId:project.id})});
        showToast(copied?'路径已复制，目录已打开':'目录已打开；浏览器未允许复制路径');
      } catch(error) { throw new Error(`${copied?'路径已复制；':''}${error.message}`); }
      if(state.modal==='menu') { state.modal=null; render(); }
    } else if(action==='delete-project') {
      const project=state.projects.find(p=>p.id===el.dataset.project);
      if(confirm(`删除项目“${project.name}”？\n项目文件不会被删除。`)) {
        await api(`/api/projects/${project.id}`,{method:'DELETE'}); state.modal=null;
        Object.assign(state,await api('/api/state')); render(); showToast('项目已删除');
      }
    } else if(action==='export') {
      const data=await api('/api/export'); download(`hub-backup-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(data,null,2),'application/json'); showToast('备份下载已开始');
    } else if(action==='import') {
      ++importRequest; state.importData=null; state.importPreview=null; state.modal='import'; render();
    } else if(action==='import-files'||action==='import-folder') $(`#${action}`).click();
    else if(action==='preview-import-text') {
      try { await previewImport(JSON.parse($('#import-text').value)); }
      catch { state.importData=null; state.importPreview=null; $('[data-action="confirm-import"]').disabled=true; $('.import-preview')?.remove(); $('#import-error').textContent='JSON 格式不正确'; }
    } else if(action==='confirm-import') {
      if(!state.importData) return;
      el.disabled=true;
      try {
        const result=await api('/api/import',{method:'POST',body:JSON.stringify(state.importData)});
        state.modal=null; state.importData=null; state.importPreview=null;
        Object.assign(state,await api('/api/state')); render(); showToast(`导入完成：新增 ${result.created}，更新 ${result.updated}`);
      } catch(error) { el.disabled=false; $('#import-error').textContent=error.message; }
    } else if(action==='open-data') { await api('/api/open-data-directory',{method:'POST',body:'{}'}); showToast('已打开数据目录'); }
  } catch(error) { el.disabled=false; showToast(error.message,true); }
}
function collectEditor() { if(!state.editor) state.editor={launchers:[],links:[],color:'violet'}; state.editor.name=$('#p-name')?.value||'';state.editor.directory=$('#p-directory')?.value||'';state.editor.group=$('#p-group')?.value||'';state.editor.description=$('#p-description')?.value||'';state.editor.notes=$('#p-notes')?.value||'';state.editor.mainPanelUrl=$('#p-main-panel')?.value||''; state.editor.launchers=$$('.launcher-row-form').map((row)=>{const kind=$('.segmented button.active',row)?.dataset.kind||'command'; const value=$('.l-command',row).value; let env={}; const envText=$('.l-env',row)?.value.trim(); if(envText){try{env=JSON.parse(envText);}catch{env={'!invalid':envText};}} return {id:state.editor.launchers[Number(row.dataset.index)]?.id,name:$('.l-name',row).value,kind,...kind==='file'?{file:value}:{command:value},args:$('.l-args',row).value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean),cwd:$('.l-cwd',row).value,interpreter:$('.l-interpreter',row).value,env};}); state.editor.links=$$('.link-row').map(row=>({id:state.editor.links[Number(row.dataset.index)]?.id,name:$('.link-name',row).value,url:$('.link-url',row).value})); return state.editor; }
async function saveProject(e) { e.preventDefault(); try { const p=collectEditor(); const saved=await api(p.id?`/api/projects/${p.id}`:'/api/projects',{method:p.id?'PUT':'POST',body:JSON.stringify(p)}); showToast(p.id?'项目已保存':'项目已添加');state.modal=null;state.editor=null;Object.assign(state,await api('/api/state'));render(); } catch(error){showToast(error.message,true);} }
function download(name, text, type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),60000);}
bootstrap();
