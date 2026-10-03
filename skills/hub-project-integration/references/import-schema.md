# CumHub import schema

The CumHub import endpoint accepts one JSON object:

```json
{
  "schemaVersion": 1,
  "projects": [
    {
      "name": "Example",
      "directory": "/Users/me/Projects/example",
      "group": "个人",
      "description": "短备注",
      "mainPanelUrl": "http://127.0.0.1:3000/admin",
      "launchers": [
        {
          "name": "开发服务",
          "kind": "command",
          "command": "npm run dev",
          "cwd": "/Users/me/Projects/example",
          "args": [],
          "env": {}
        },
        {
          "name": "启动脚本",
          "kind": "file",
          "file": "/Users/me/Projects/example/Start.command",
          "args": [],
          "env": {}
        }
      ],
      "links": [
        { "name": "主页", "url": "http://127.0.0.1:3000/" }
      ]
    }
  ]
}
```

`kind` is `command` or `file`. `mainPanelUrl` and `links` must use complete `http://` or `https://` URLs. `mainPanelUrl` is optional and opens when the project icon is clicked; prioritize the project's main operational dashboard or admin/control panel. If no suitable page is verified, omit it. Keep secondary pages in `links`.

`directory`, `cwd`, and `file` should be absolute paths. `favorite`, `color`, `notes`, and `group` are optional. Multiple files can be selected together in CumHub; their `projects` arrays are merged. Existing projects without `mainPanelUrl` fall back to a suitable control/admin link. Importing the same project id or directory updates its configuration.
