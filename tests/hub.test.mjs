import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateProject, HttpError } from '../server/model.mjs';
import { launchSpec } from '../server/platform.mjs';
import { Store } from '../server/store.mjs';
import { ProcessManager } from '../server/processes.mjs';
import { planImport, summarizeImport } from '../server/imports.mjs';
import { mainPanelUrl, dockRuns, latestLauncherRuns } from '../public/project-utils.js';

test('项目资料会规范化并保留编辑时的项目 id', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hub-model-'));
  const project = validateProject({ name: 'Demo', directory: dir, launchers: [{ name: 'Dev', kind: 'command', command: 'node -e "setInterval(()=>{}, 1000)"' }], links: [{ name: 'Home', url: 'http://localhost:3000' }] });
  assert.equal(project.name, 'Demo');
  assert.equal(project.launchers[0].name, 'Dev');
  assert.equal(project.links[0].url, 'http://localhost:3000');
  const edited = validateProject({ ...project, name: 'Demo 2' }, project);
  assert.equal(edited.id, project.id);
  await rm(dir, { recursive: true, force: true });
});

test('危险或不完整的网页入口会被拒绝', () => {
  assert.throws(() => validateProject({ name: 'Bad', directory: '/tmp', links: [{ name: 'x', url: 'javascript:alert(1)' }] }), error => error instanceof HttpError && error.status === 400);
  assert.throws(() => validateProject({ name: 'Bad', directory: '/tmp', launchers: [{ kind: 'command', command: '' }] }), error => error instanceof HttpError && error.status === 400);
});

test('启动规格能识别 Python 文件和命令模式', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hub-spec-'));
  const project = { name: 'Demo', directory: dir };
  const command = await launchSpec(project, { kind: 'command', command: 'echo ok' });
  assert.ok(command.executable);
  assert.deepEqual(command.args.slice(-2), ['-lc', 'echo ok']);
  const file = path.join(dir, 'server.py');
  await (await import('node:fs/promises')).writeFile(file, 'print("ok")');
  const python = await launchSpec(project, { kind: 'file', file });
  assert.equal(python.args[0], '-u');
  assert.equal(python.args[1], file);
  await rm(dir, { recursive: true, force: true });
});

test('任务 supervisor 可以启动、读取日志并停止长期进程', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hub-process-'));
  const store = new Store(dir);
  const manager = new ProcessManager(store, dir);
  const project = { id: 'project-1', name: 'Demo', directory: dir, launchers: [], updatedAt: new Date().toISOString() };
  const launcher = { id: 'launcher-1', name: 'Heartbeat', kind: 'command', command: `${process.execPath} -e "console.log('ready'+'.'.repeat(1600)); setInterval(()=>console.log('tick'), 80)"` };
  project.launchers.push(launcher); store.saveProject(project);
  const created = await manager.start(project, launcher);
  await new Promise(resolve => setTimeout(resolve, 650));
  const running = manager.get(created.id);
  assert.ok(['starting', 'running'].includes(running.status));
  const logs = manager.logs(created.id);
  assert.match(logs.text, /ready/);
  const preview = manager.logs(created.id, 512.5);
  assert.ok(Buffer.byteLength(preview.text) <= 512);
  assert.equal(preview.truncated, true);
  assert.match(preview.text, /tick/);
  const ended = await manager.stop(created.id, true);
  assert.equal(ended.status, 'stopped');
  store.close();
  await rm(dir, { recursive: true, force: true });
});

test('批量导入按目录预览新增，并在重复导入时更新原项目', () => {
  const input = { schemaVersion: 1, projects: [
    { name: 'A', directory: '/tmp/import-a', launchers: [{ name: 'Dev', kind: 'command', command: 'npm run dev' }], links: [] },
    { name: 'B', directory: '/tmp/import-b', launchers: [], links: [] },
  ] };
  const first = planImport(input, [], []);
  assert.equal(summarizeImport(first).created, 2);
  assert.equal(summarizeImport(first).updated, 0);
  assert.equal(summarizeImport(first).count, 2);
  const existing = first.map(item => item.project);
  const second = planImport({ ...input, projects: [{ ...input.projects[0], name: 'A updated' }, input.projects[1]] }, existing, []);
  assert.equal(second.filter(item => item.action === 'update').length, 2);
  assert.equal(second[0].project.id, existing[0].id);
  assert.equal(second[0].project.name, 'A updated');
});

test('主控制面板在编辑和导入时保留，并拒绝非网页协议', () => {
  const input={ name:'Panel', directory:'/tmp/panel', mainPanelUrl:'http://127.0.0.1:3000/admin', links:[] };
  const project=validateProject(input);
  assert.equal(project.mainPanelUrl,input.mainPanelUrl);
  assert.equal(validateProject({...project,name:'Panel 2'},project).mainPanelUrl,input.mainPanelUrl);
  const imported=planImport({schemaVersion:1,projects:[input]},[project]);
  assert.equal(imported[0].project.id,project.id);
  assert.equal(summarizeImport(imported).projects[0].mainPanelUrl,input.mainPanelUrl);
  assert.throws(()=>validateProject({...input,mainPanelUrl:'javascript:alert(1)'}),error=>error.status===400);
});

test('旧项目图标优先打开控制面板，再选管理页，跳过 API 与健康检查', () => {
  const links=[
    {name:'主页',url:'http://localhost:3000/'},
    {name:'管理后台',url:'http://localhost:3000/admin'},
    {name:'主控制面板',url:'http://localhost:3000/control'},
  ];
  assert.equal(mainPanelUrl({links}),links[2].url);
  assert.equal(mainPanelUrl({links:links.slice(0,2)}),links[1].url);
  assert.equal(mainPanelUrl({links,mainPanelUrl:'https://example.com/panel'}),'https://example.com/panel');
  assert.equal(mainPanelUrl({links:[{name:'API',url:'http://localhost:3000/api'},{name:'服务状态',url:'http://localhost:3000/health'}]}),'');
  assert.equal(mainPanelUrl({links:[{name:'后台',url:'javascript:alert(1)'}]}),'');
});

test('任务栏保留各项目的多个运行任务和已打开的退出任务', () => {
  const runs=[
    {id:'b',projectId:'one',launcherId:'two',status:'running'},
    {id:'a',projectId:'one',launcherId:'one',status:'running'},
    {id:'old-a',projectId:'one',launcherId:'one',status:'stopped'},
    {id:'c',projectId:'other',launcherId:'one',status:'failed'},
  ];
  assert.deepEqual(dockRuns(runs,['c']).map(r=>r.id),['b','a','c']);
  assert.deepEqual(latestLauncherRuns(runs,'one').map(r=>r.id),['b','a']);
  assert.deepEqual(dockRuns(runs,[]).map(r=>r.id),['b','a']);
});
