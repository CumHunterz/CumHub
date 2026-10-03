import { spawn, execFile } from 'node:child_process';
import { access, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { expandPath, HttpError } from './model.mjs';

const exec = promisify(execFile);
export async function launchSpec(project, launcher) {
  const cwd = launcher.cwd ? expandPath(launcher.cwd, project.directory) : project.directory;
  try { if (!(await stat(cwd)).isDirectory()) throw new Error(); }
  catch { throw new HttpError(400, `工作目录不存在：${cwd}`); }
  const env = { ...process.env, PYTHONUNBUFFERED: '1', ...launcher.env };
  delete env.HUB_TOKEN;
  const win = process.platform === 'win32';
  if (launcher.kind === 'command') {
    return { executable: win ? process.env.ComSpec || 'cmd.exe' : process.env.SHELL || '/bin/sh', args: win ? ['/d', '/s', '/c', launcher.command] : ['-lc', launcher.command], cwd, env };
  }
  const file = expandPath(launcher.file, project.directory);
  try { if (!(await stat(file)).isFile()) throw new Error(); }
  catch { throw new HttpError(400, `启动文件不存在：${file}`); }
  const args = launcher.args || [];
  if (launcher.interpreter) return { executable: launcher.interpreter, args: [file, ...args], cwd, env };
  const ext = path.extname(file).toLowerCase();
  if (['.bat', '.cmd'].includes(ext)) {
    if (!win) throw new HttpError(400, 'bat / cmd 文件需要在 Windows 上运行');
    // cmd.exe is unavoidable for batch files. Reject metacharacters instead of silently executing them.
    const values = [file, ...args];
    if (values.some(v => /["%\r\n&|<>^!]/.test(v))) throw new HttpError(400, '批处理路径和参数不能包含 CMD 控制字符；复杂调用请使用命令模式');
    return { executable: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${values.map(v => `"${v}"`).join(' ')}"`], cwd, env };
  }
  if (ext === '.ps1') return { executable: win ? 'powershell.exe' : 'pwsh', args: ['-NoProfile', '-File', file, ...args], cwd, env };
  if (ext === '.py') return { executable: win ? 'python' : 'python3', args: ['-u', file, ...args], cwd, env };
  if (['.js', '.mjs', '.cjs'].includes(ext)) return { executable: process.execPath, args: [file, ...args], cwd, env };
  try { await access(file, constants.X_OK); return { executable: file, args, cwd, env }; } catch {}
  if (!win && ['.sh', '.command', '.bash', '.zsh'].includes(ext)) {
    const firstLine = (await readFile(file, 'utf8')).split('\n')[0].replace(/\r$/, '');
    const words = firstLine.startsWith('#!') ? firstLine.slice(2).trim().split(/\s+/) : ['/bin/sh'];
    return { executable: words[0], args: [...words.slice(1), file, ...args], cwd, env };
  }
  throw new HttpError(400, '无法确定此文件的运行方式，请填写解释器或改用命令模式');
}

export async function openLocal(target) {
  const resolved = expandPath(target);
  try { await access(resolved); } catch { throw new HttpError(404, '文件或目录不存在'); }
  const exe = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
  await exec(exe, [resolved], { timeout: 10000, windowsHide: true });
}
export async function choosePath(kind, initial) {
  if (process.platform === 'darwin') {
    const script = `POSIX path of (choose ${kind === 'file' ? 'file' : 'folder'} with prompt "${kind === 'file' ? '选择启动文件' : '选择项目目录'}")`;
    try { const { stdout } = await exec('osascript', ['-e', script], { timeout: 120000 }); return stdout.trim().replace(/\/$/, ''); }
    catch (e) { if (String(e.stderr).includes('-128')) return null; throw new HttpError(500, '系统选择器不可用，请直接填写路径'); }
  }
  if (process.platform === 'win32') {
    const script = kind === 'file' ? 'Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.OpenFileDialog; if ($d.ShowDialog() -eq "OK") { $d.FileName }' : 'Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; if ($d.ShowDialog() -eq "OK") { $d.SelectedPath }';
    try { const { stdout } = await exec('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { timeout: 120000, windowsHide: true }); return stdout.trim() || null; }
    catch { throw new HttpError(500, '系统选择器不可用，请直接填写路径'); }
  }
  try { const { stdout } = await exec('zenity', ['--file-selection', ...(kind === 'file' ? [] : ['--directory']), `--filename=${initial}/`], { timeout: 120000 }); return stdout.trim() || null; }
  catch { throw new HttpError(400, '此系统没有可用的文件选择器，请直接填写路径'); }
}
