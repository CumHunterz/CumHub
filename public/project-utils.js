const httpUrl = value => {
  if (typeof value !== 'string' || !value.trim()) return '';
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? value.trim() : ''; }
  catch { return ''; }
};

export function mainPanelUrl(project) {
  if (httpUrl(project.mainPanelUrl)) return project.mainPanelUrl.trim();
  const links = (project.links || []).filter(link => httpUrl(link.url));
  const priorities = [
    /主控制面板|主控|本机控制台|控制面板|控制台|dashboard|control\s*panel|console/i,
    /管理|后台|admin|manage/i,
    /工作台|主页|首页|home|workspace/i,
  ];
  for (const pattern of priorities) {
    const match = links.find(link => pattern.test(link.name));
    if (match) return match.url;
  }
  // API and download endpoints do not make useful project control panels.
  return links.find(link => !/api|health|检查|状态|下载|download|模型列表/i.test(`${link.name} ${new URL(link.url).pathname}`))?.url || '';
}

export const isActiveRun = run => ['starting', 'running', 'stopping'].includes(run.status);

export function dockRuns(runs, pinnedIds) {
  const pinned = new Set(pinnedIds);
  return runs.filter(run => isActiveRun(run) || pinned.has(run.id));
}

export function latestLauncherRuns(runs, projectId) {
  const seen = new Set();
  return runs.filter(run => {
    if (run.projectId !== projectId || seen.has(run.launcherId)) return false;
    seen.add(run.launcherId);
    return true;
  });
}
