---
name: hub-project-integration
description: After creating or changing a local project, generate a verified CumHub import file, prioritizing its main control panel as the project icon's entry point.
---

# CumHub project integration

Use this skill when a local project is created, substantially changed, or given a new startup entry.

- Inspect the real project directory, startup command or file, working directory, and confirmed HTTP(S) entry points after the work is complete.
- Write `hub-import.json` in the project root, or a clearly named combined JSON file when the task covers multiple projects. Use schema version 1 and a `projects` array.
- Use absolute paths. Record only commands, files, and URLs that were actually verified; do not invent ports or routes.
- Set `mainPanelUrl` to the project's main control panel, dashboard, or admin page. CumHub opens this URL from the project icon. Prefer the operational control panel over a public homepage, API, health check, or download page; omit it if no suitable verified page exists.
- Keep secrets out of the file: no passwords, tokens, private keys, or credential-bearing URLs.
- Keep the project architecture independent of CumHub. The file is an integration artifact, not a runtime dependency.
- In the final response, give the import file path and say that CumHub's “导入项目 → 选择 JSON 文件” accepts multiple files for batch import.

Read [references/import-schema.md](references/import-schema.md) only when creating or checking the JSON shape.
