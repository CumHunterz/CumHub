#!/bin/zsh
cd -- "${0:A:h}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  osascript -e 'display alert "CumHub 需要 Node.js 22.13 或更新版本" message "安装后再次打开 Start.command。"'
  exit 1
fi
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 13) ? 0 : 1)'
if [ "$?" -ne 0 ]; then
  osascript -e 'display alert "CumHub 需要 Node.js 22.13 或更新版本" message "升级 Node.js 后再次打开 Start.command。"'
  exit 1
fi
node scripts/launch.mjs
result=$?
if [ "$result" -ne 0 ]; then
  printf '\n启动失败。按回车关闭。'
  read
fi
exit "$result"
