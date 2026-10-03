import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

export const ACTIVE = new Set(['starting', 'running', 'stopping']);
export const COLORS = ['violet', 'blue', 'green', 'orange', 'pink', 'slate'];
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const newId = () => randomUUID();
export const text = (value, max = 1000) => typeof value === 'string' ? value.trim().slice(0, max) : '';
export function expandPath(value, base = process.cwd()) {
  const p = text(value, 4096);
  return path.resolve(base, p === '~' ? os.homedir() : p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p);
}
export function validateProject(input, old) {
  if (!input || typeof input !== 'object') throw new HttpError(400, '项目数据格式不正确');
  const name = text(input.name, 100);
  if (!name) throw new HttpError(400, '请填写项目名称');
  if (!text(input.directory, 4096)) throw new HttpError(400, '请选择项目目录');
  const directory = expandPath(input.directory);
  const mainPanelUrl = text(input.mainPanelUrl, 4096);
  if (mainPanelUrl) {
    try { if (!['http:', 'https:'].includes(new URL(mainPanelUrl).protocol)) throw new Error(); }
    catch { throw new HttpError(400, '主控制面板需要完整的 http:// 或 https:// 地址'); }
  }
  const rawLaunchers = input.launchers ?? [];
  const rawLinks = input.links ?? [];
  if (!Array.isArray(rawLaunchers) || rawLaunchers.length > 30) throw new HttpError(400, '每个项目最多配置 30 个启动项');
  if (!Array.isArray(rawLinks) || rawLinks.length > 50) throw new HttpError(400, '每个项目最多配置 50 个网页入口');
  const ids = new Set();
  const launchers = rawLaunchers.map((item, i) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new HttpError(400, `启动项 ${i + 1} 格式不正确`);
    const id = old?.launchers.some(l => l.id === item.id) ? item.id : newId();
    if (ids.has(id)) throw new HttpError(400, '启动项重复');
    ids.add(id);
    const kind = item.kind === 'file' ? 'file' : 'command';
    const command = text(item.command, 20000);
    const file = text(item.file, 4096);
    if (kind === 'command' && !command) throw new HttpError(400, `启动项 ${i + 1} 缺少命令`);
    if (kind === 'file' && !file) throw new HttpError(400, `启动项 ${i + 1} 缺少文件路径`);
    if (item.args != null && (!Array.isArray(item.args) || item.args.length > 100 || item.args.some(a => typeof a !== 'string' || a.length > 4096 || a.includes('\0')))) throw new HttpError(400, '启动参数格式不正确');
    const env = {};
    if (item.env != null && (typeof item.env !== 'object' || Array.isArray(item.env))) throw new HttpError(400, '环境变量格式不正确');
    for (const [key, value] of Object.entries(item.env || {})) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== 'string' || value.includes('\0')) throw new HttpError(400, `环境变量 ${key} 格式不正确`);
      env[key] = value.slice(0, 20000);
    }
    return { id, name: text(item.name, 80) || `启动项 ${i + 1}`, kind, command, file, args: item.args || [], cwd: text(item.cwd, 4096), interpreter: text(item.interpreter, 4096), env };
  });
  const links = rawLinks.map((item, i) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new HttpError(400, `网页入口 ${i + 1} 格式不正确`);
    const url = text(item.url, 4096);
    try { if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error(); }
    catch { throw new HttpError(400, `网页入口 ${i + 1} 需要完整的 http:// 或 https:// 地址`); }
    return { id: newId(), name: text(item.name, 60) || '网页', url };
  });
  return {
    id: old?.id || newId(), name, directory, mainPanelUrl,
    description: text(input.description, 1000), notes: text(input.notes, 10000),
    color: COLORS.includes(input.color) ? input.color : 'violet',
    group: text(input.group, 60), favorite: Boolean(input.favorite), launchers, links,
    createdAt: old?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(), lastUsedAt: old?.lastUsedAt || null,
  };
}
