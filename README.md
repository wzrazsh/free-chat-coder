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
node validate-environment.js --profile .browser-profile
```

`validate-environment.js` 现在会集中输出扩展 ID、Native Host manifest 安装位置、Queue Server / Web Console 端口状态，以及浏览器、Node 模块和可选 `Xvfb` 依赖的诊断结果；如果存在阻塞问题，会直接给出可执行修复步骤。
当 `.browser-profile` 处于带远程调试的运行状态时，诊断结果还会额外显示 `DeepSeek Web` 分组，用于检查已保存的 zero-token 登录态快照、profile 是否匹配，以及当前浏览器是否仍能抓到 `cookie` / `bearer` / `userAgent`。

如果要为后续的 `DeepSeek Web Zero-Token` provider 预先采集本机登录态，可运行：

```bash
node scripts/onboard-deepseek-web.js --profile .browser-profile
```

该脚本会尝试附加到当前 `.browser-profile` 对应的 Chromium DevTools 端点，检查 DeepSeek 页面的 `cookie` / `bearer` / `userAgent` 是否齐全，并仅在本机把结果写入 `queue-server/data/deepseek-web-auth.json`；终端输出只显示脱敏摘要，不会直接打印敏感值。

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

如果想确认安装结果是否和当前扩展 ID 对齐，建议随后执行：

```bash
node validate-environment.js --profile .browser-profile
```

安装脚本现在同时支持 Windows 和 Linux：

- Windows：写入 Chrome Native Messaging 对应注册表，并生成 `host.bat`
- Linux：生成 `host.sh`，并把 manifest 写入常见浏览器目录，以及仓库自带的 `.browser-profile/NativeMessagingHosts/`，例如 `~/.config/google-chrome/NativeMessagingHosts/`

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

当前自动开发主管还会在单轮 worker 正常结束后自动续跑下一轮，不需要等到下一个 5 分钟窗口；cron 仍然保留，用于健康巡检、卡死恢复和兜底重启。若显式 backlog 暂时跑完，后续轮次会自动转入回归测试、缺陷修复、安装诊断增强或最小可验证功能补齐。

默认情况下，每一轮新任务都会以全新会话启动，只使用当前 prompt 和仓库文件重建上下文，避免历史对话污染；只有在故障恢复、异常处理或明确延续上轮修复时，才会把上一轮日志和模型输出作为恢复上下文带入。

自动开发主管的实际优先级以 `doc/project-roadmap-20260417.md` 为准；如果 roadmap 或状态快照显式引用某个任务设计文档，后续轮次会先读该文档再执行。当前已将 `doc/deepseek-zero-token-integration-20260417.md` 作为最高优先级专项接入计划。

## 验证建议

至少执行以下检查：

```bash
node -c queue-server/index.js
node -c chromevideo/background.js
node -c chromevideo/offscreen.js
node -c chromevideo/sidepanel.js
node test-playwright-e2e.js
```

`node test-playwright-e2e.js` 会在干净状态下启动 Chromium + 扩展，验证 Native Host 自动拉起 `Queue Server` / `Web Console`、检查 `/health` 与 offscreen WebSocket，然后在结束后把这两个本地服务停掉。运行前请先确保 `queue-server/node_modules`、`web-console/node_modules`、`.browser-profile`、`Xvfb` 和浏览器可执行文件都已准备好，且 `Queue Server` / `Web Console` 当前未在运行。

如果已安装 `web-console` 依赖，再执行：

```bash
cd web-console && npm run build
```

最后手动确认：

- Web Console 能正常连接到 Queue Server
- Chrome 扩展能收到任务并回传结果
- `/evolve` 保存后，`nodemon` 能自动重启后端
