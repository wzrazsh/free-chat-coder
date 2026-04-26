n'gng# free-chat-coder

`free-chat-coder` 是一个围绕 **DeepSeek** 构建的本地 AI 辅助开发工具集。它把浏览器扩展、任务队列服务、Web 控制台和可选的 Web IDE 整合在一起，让你可以在本地调度 AI 任务、管理聊天会话，并在需要时进行人工确认。

核心设计思路：**文本任务走服务端直连**，**浏览器动作走扩展 DOM**，两条链路互补，降低对页面结构变化的脆弱依赖。

---

## 核心特性

- **双通道任务执行**
  - `deepseek-web`：Queue Server 内直接请求 DeepSeek Web 内部接口，无需操控页面 DOM。
  - `extension-dom`：Chrome 扩展在 DeepSeek 页面内执行输入、发送、截图、上传、会话切换等动作。
- **本地任务队列**
  - Express + WebSocket 后端，负责任务排队、会话同步、审批流与热重载。
- **Web 控制台**
  - Vite + React 前端，查看任务状态、审批操作、浏览扩展会话。
- **Chrome 扩展（DeepSeek Agent Bridge）**
  - Side Panel、Popup、Offscreen WebSocket、Native Messaging Host。
  - 访问 DeepSeek 页面时自动唤起 Side Panel，支持页面读写、截图、附件上传。
- **一键环境诊断**
  - `validate-environment.js` 集中检查扩展 ID、Native Host 安装、端口占用、登录态快照和依赖完整性。

---

## 架构概览

```
┌─────────────────┐     WebSocket/HTTP      ┌─────────────────┐
│  Web Console    │ ◄──────────────────────► │  Queue Server   │
│  (Vite+React)   │                        │  (Express+WS)   │
│   Port 5173     │                        │  Port 8080~8090 │
└─────────────────┘                        └────────┬────────┘
                                                     │
                       ┌────────────────────────────┼────────────────────────────┐
                       │                            │                            │
              ┌────────▼────────┐          ┌────────▼────────┐          ┌────────▼────────┐
              │  deepseek-web   │          │ extension-dom   │          │   (reserved)    │
              │   Provider      │          │   Provider      │          │                 │
              │  (服务端直连)    │          │  (Chrome扩展)    │          │                 │
              └─────────────────┘          └─────────────────┘          └─────────────────┘
                                                    │
                          Native Messaging      │     content scripts / offscreen
                          ┌─────────────────────┘
                          │
                ┌─────────▼──────────┐
                │   Chrome Extension  │
                │  (DeepSeek Agent    │
                │     Bridge)         │
                └─────────────────────┘
```

### 目录说明

| 目录 | 说明 |
|---|---|
| `queue-server/` | 任务队列、会话管理、provider 执行、热重载后端 |
| `web-console/` | 可视化控制台，基于 Vite + React + Monaco Editor |
| `chromevideo/` | Chrome 扩展、Offscreen 页面、Side Panel、Native Messaging Host |
| `shared/` | 共享配置与队列服务发现逻辑 |
| `scripts/` | 维护脚本：环境同步、DeepSeek 登录态采集、provider 验证、状态报告 |
| `doc/` | 设计文档、阶段记录、路线图 |

---

## 快速开始

### 1. 环境要求

- Node.js 16+
- Chrome / Chromium（加载扩展时需要）
- 可选：`code-server`（默认端口 8081）

### 2. 环境检查

```bash
node validate-environment.js
node validate-environment.js --profile .browser-profile
```

该脚本会输出扩展 ID、Native Host manifest 位置、Queue Server / Web Console 端口状态，以及 DeepSeek Web 登录态快照诊断。如果存在阻塞问题，会直接给出修复步骤。

### 3. 安装依赖

仓库不是 workspace 模式，需要分别安装：

```bash
cd queue-server && npm install
cd ../web-console && npm install
```

### 4. 启动服务

**Queue Server**（后端）：

```bash
cd queue-server
npm run dev
```

**Web Console**（前端）：

```bash
cd web-console
npm run dev
```

如需本地 Web IDE，再单独启动：

```bash
npx @coder/code-server --port 8081
```

### 5. 加载 Chrome 扩展

1. 打开 `chrome:///extensions`
2. 开启**开发者模式**
3. 选择**加载已解压的扩展程序**
4. 选择仓库中的 `chromevideo/` 目录

### 6. 安装 Native Messaging Host

如需使用扩展启停本地服务的能力：

```bash
node chromevideo/host/install_host.js
```

然后执行一次环境检查，确认安装结果与当前扩展 ID 对齐：

```bash
node validate-environment.js --profile .browser-profile
```

---

## DeepSeek Web Zero-Token Provider

这是项目当前的核心专项。目标是在保留扩展 DOM 自动化的同时，新增一条服务端直连 DeepSeek Web 的文本执行通道，降低对页面输入框、发送按钮和回复 DOM 的脆弱依赖。

### 采集本机登录态

```bash
# 附加到当前 .browser-profile 对应的浏览器
node scripts/onboard-deepseek-web.js --profile .browser-profile

# 或自动拉起浏览器并采集
node scripts/onboard-deepseek-web.js --profile .browser-profile --launch-browser
```

登录态保存在 `queue-server/data/deepseek-web-auth.json`，终端只输出脱敏摘要。

### 验证 provider 可用性

```bash
node scripts/verify-deepseek-web-provider.js --prompt "Reply with exactly: FCC_DEEPSEEK_OK"
```

该命令会使用已保存的登录态，从 Queue Server 侧发起一次真实 DeepSeek Web 文本请求，并输出脱敏后的 endpoint、responseMode、sessionId 和回复预览。

### 诊断接口契约漂移

如果真实接口契约有变化，可叠加参数做定点诊断：

```bash
node scripts/verify-deepseek-web-provider.js \
  --prompt "test" \
  --endpoint-path "/api/v0/chat/completion" \
  --header "X-Custom: value" \
  --json
```

更多设计细节见 `doc/deepseek-web-api-conversion-plan-20260418.md`。

---

## 端口说明

| 服务 | 默认端口 | 说明 |
|---|---|---|
| Queue Server | `8080` | 若被占用，自动回退到 `8082`~`8090` |
| code-server | `8081` | 保留端口 |
| Web Console | `5173` | 固定端口 |

`web-console`、Chrome 扩展、Offscreen 页面和 Native Host 均通过 `/health` 自动发现 Queue Server 实际端口，无需手动同步。

快速验证后端：

```bash
curl http://127.0.0.1:8080/health
```

---

## MCP 工具使用

> 本项目使用 Chrome DevTools MCP 工具进行浏览器自动化测试和开发调试。

### 打开 DeepSeek + Side Panel

1. **用 MCP 工具打开 DeepSeek**
   - 使用 `cwCaAk0mcp0navigate_page` 工具导航到 `https://chat.deepseek.com/`

2. **触发 Side Panel 打开**
   - 在页面上点击任意位置（空白处、按钮、输入框等）
   - `chromevideo/content-scripts/auto-open-sidepanel.js` 会检测到 click 事件并自动打开 Side Panel
   - 使用 `cwCaAk0mcp0click` 工具点击页面元素

### 常用 MCP 工具

- `cwCaAk0mcp0navigate_page`: 导航到 URL
- `cwCaAk0mcp0take_snapshot`: 获取页面快照
- `cwCaAk0mcp0click`: 点击元素（需要元素的 uid）
- `cwCaAk0mcp0fill`: 填写表单
- `cwCaAk0mcp0type_text`: 输入文本
- `cwCaAk0mcp0list_pages`: 列出所有打开的页面
- `cwCaAk0mcp0select_page`: 选择页面

### 注意事项

1. **MCP 连接**：如果 MCP 工具报错 "No connection found"，需要用 MCP 工具重新打开 Chrome
2. **Side Panel 触发**：Chrome Side Panel API 要求必须由用户交互触发，不能自动打开
3. **元素定位**：使用 `take_snapshot` 获取页面元素及其 uid，然后用 uid 进行操作

详细文档见 `doc/mcp-usage.md`。

---

## 常用命令

```bash
# 启动开发服务
cd queue-server && npm run dev
cd web-console && npm run dev

# 构建与检查
cd web-console && npm run build
cd web-console && npm run lint

# 同步扩展默认端口与 manifest 权限
node scripts/sync-config.js

# 状态报告
node scripts/dev-status-report.js
```

---

## 验证建议

至少执行以下检查：

```bash
# 语法检查
node -c queue-server/index.js
node -c chromevideo/background.js
node -c chromevideo/offscreen.js
node -c chromevideo/sidepanel.js

# 端到端测试（扩展 + Native Host + Queue Server + Web Console）
node test-playwright-e2e.js
```

> `test-playwright-e2e.js` 会在干净状态下启动 Chromium + 扩展，验证 Native Host 自动拉起服务、检查 `/health` 与 Offscreen WebSocket，然后自动清理。运行前请确保依赖、`.browser-profile`、Xvfb（无桌面环境时）和浏览器可执行文件已准备好，且 Queue Server / Web Console 当前未运行。

**推进 DeepSeek Web 专项时的建议验证顺序**：

```bash
node scripts/onboard-deepseek-web.js --profile .browser-profile
node scripts/verify-deepseek-web-provider.js --prompt "Reply with exactly: FCC_DEEPSEEK_OK"
cd web-console && npm run build
```

最后手动确认：

- Web Console 能正常连接到 Queue Server
- Chrome 扩展能收到任务并回传结果

---

## 设计文档

| 文档 | 内容 |
|---|---|
| `doc/design-doc-v0.1.md` | 整体架构设计 |
| `doc/project-roadmap-20260417.md` | 项目路线图与优先级 |
| `doc/deepseek-zero-token-integration-20260417.md` | DeepSeek Web Zero-Token 接入计划 |
| `doc/deepseek-web-api-conversion-plan-20260418.md` | DeepSeek Web API 化详细方案 |
| `doc/chromevideo-extension-plan.md` | 扩展开发计划 |
| `doc/chromevideo-extension-phase1-changelog.md` | 扩展 Phase 1~4 变更记录 |
| `doc/任务列表.md` | 中文任务跟踪 |

---

## 许可证

MIT
