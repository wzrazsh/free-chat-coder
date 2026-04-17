# free-chat-coder

`free-chat-coder` 是一个本地多组件原型工程，包含任务队列服务、Web 控制台、Chrome 扩展，以及可选的 `code-server` Web IDE。

## 目录结构

- `queue-server/`：Express + WebSocket 后端，负责任务队列、会话同步、审批与热更新。
- `web-console/`：Vite + React 控制台，用于查看任务、审批操作、浏览扩展会话和编辑 `custom-handler.js`。
- `chromevideo/`：Chrome 扩展、offscreen WebSocket 客户端、side panel 和 Native Messaging Host。
- `shared/`：共享配置与队列服务发现逻辑。
- `scripts/`：维护脚本。
- `doc/`：设计文档和阶段记录。

## 环境要求

- Node.js 16 及以上
- Chrome 或 Chromium（加载扩展时需要）
- 可选：`code-server`，默认端口 `8081`

先执行一次环境检查：

```bash
node validate-environment.js
```

## 安装依赖

仓库不是 workspace 模式，需要分别安装：

```bash
cd queue-server && npm install
cd ../web-console && npm install
```

## 本地启动

启动 Queue Server：

```bash
cd queue-server
npm run dev
```

启动 Web Console：

```bash
cd web-console
npm run dev
```

如需本地 Web IDE，再单独启动：

```bash
npx @coder/code-server --port 8081
```

## 端口说明

- Queue Server 优先使用 `8080`
- 如果 `8080` 已被占用，会自动回退到 `8082`、`8083`…`8090`
- `8081` 保留给 `code-server`
- Web Console 固定为 `5173`

当前实现中，`web-console`、Chrome 扩展、offscreen 页面和 Native Host 都会通过 `/health` 自动发现 Queue Server 的实际端口，因此不需要手动同步 `8080/8082`。

Queue Server 健康检查：

```bash
curl http://127.0.0.1:8080/health
```

如果 `8080` 被占用，请查看后端启动日志里实际选择的端口。

## Chrome 扩展

1. 打开 `chrome://extensions`
2. 开启开发者模式
3. 选择“加载已解压的扩展程序”
4. 选择仓库中的 `chromevideo/`

如果要使用扩展中的本地服务启停能力，还需要安装 Native Messaging Host：

```bash
node chromevideo/host/install_host.js
```

安装脚本现在同时支持 Windows 和 Linux：

- Windows：写入 Chrome Native Messaging 对应注册表，并生成 `host.bat`
- Linux：生成 `host.sh`，并把 manifest 写入用户级 Native Messaging 目录，例如 `~/.config/google-chrome/NativeMessagingHosts/`

执行脚本时需要先从 `chrome://extensions` 里复制当前扩展的 ID。

## 常用命令

```bash
cd queue-server && npm run dev
cd web-console && npm run dev
cd web-console && npm run build
cd web-console && npm run lint
node scripts/sync-config.js
```

`scripts/sync-config.js` 当前主要用于同步扩展里的默认端口展示和 `manifest.json` 的本地访问权限；运行时端口发现不依赖这个脚本。

## 定时开发任务

如果希望用本机定时任务持续推进开发并执行夜间验证，可以安装仓库自带的 cron 配置：

```bash
./scripts/install-dev-cron.sh
```

安装后会创建两类任务：

- 每 5 分钟运行一次自动开发主管：检查当前任务是否仍在运行、是否卡死；没有运行中的任务时自动拉起新的 `codex exec`
- 每天凌晨 2:20 生成一次 `.workbuddy/auto-nightly-validation.md`

自动开发主管的动态状态保存在 `.workbuddy/autopilot-state.json`，最近一次模型输出保存在 `.workbuddy/autopilot-last-message.md`。

## 验证建议

至少执行以下检查：

```bash
node -c queue-server/index.js
node -c chromevideo/background.js
node -c chromevideo/offscreen.js
node -c chromevideo/sidepanel.js
```

如果已安装 `web-console` 依赖，再执行：

```bash
cd web-console && npm run build
```

最后手动确认：

- Web Console 能正常连接到 Queue Server
- Chrome 扩展能收到任务并回传结果
- `/evolve` 保存后，`nodemon` 能自动重启后端
