# 给新项目使用的短提示词

```text
完成项目后生成 hub-import.json（schemaVersion: 1、projects 数组）：记录真实绝对目录、已验证的启动项和网页地址；mainPanelUrl 优先放项目主控制面板/管理后台，供 CumHub 图标直接打开。无已确认地址则省略，不猜测，不含密钥。多个项目可合并；最后给文件路径，支持 CumHub 多选批量导入。
```

如果当前 Codex 已安装 `$hub-project-integration`，可在提示词开头加上：

```text
使用 $hub-project-integration。
```
