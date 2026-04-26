# 重构裁剪计划：从自动进化系统收敛为 DeepSeek 本地知识库代理

更新日期：2026-04-25

## 目标

当前项目已经偏离最初目标，过多精力投入到了 `auto_evolve`、自修改、自动回滚、cron autopilot、provider fallback 等能力。这些能力会扩大风险面，也会持续污染主线设计。

新的目标应收敛为：

- Chrome 扩展负责适配 DeepSeek Web：采集聊天记录、发送任务上下文、读取返回结果。
- 本地服务负责文件系统能力：读取本地文件、保存聊天记录、建立知识库、生成和应用补丁。
- Web Console 负责管理面板：查看聊天记录、任务、知识库、补丁预览和人工确认。
- DeepSeek 返回内容必须通过固定协议解析，不能直接自由执行。

本文件只描述需要冻结、删除、迁移和替换的内容，供后续执行时按步骤处理。

## 保留的新主线

### 保留组件

- `chromevideo/`
  - 重构为 `DeepSeek Web Adapter`。
  - 只保留页面读写、聊天记录采集、文件/文本上下文发送、回复读取、side panel 基础交互。
  - 不再承担自我修复、自我进化、自动重载等职责。

- `queue-server/`
  - 重构为 `Local Agent API`。
  - 负责本地任务、文件读取、SQLite 知识库、补丁校验、补丁应用、审计记录。
  - 不再自动创建“修复自己”的任务。

- `web-console/`
  - 重构为控制台。
  - 负责任务创建、文件选择、知识库浏览、聊天记录查看、diff 预览、人工确认。

- `shared/`
  - 保留服务发现、端口配置、任务协议类型。
  - 后续可新增 `shared/protocol.js` 或 `shared/protocol.ts`，集中定义 DeepSeek 交付协议。

### 新核心闭环

1. 用户创建任务。
2. 本地服务选择或读取文件。
3. 本地服务组装协议化上下文。
4. 扩展将上下文发送给 DeepSeek Web。
5. 扩展读取 DeepSeek 回复。
6. 本地服务解析固定协议。
7. 本地服务生成 diff 或 patch。
8. 用户确认后写入文件。
9. 聊天记录、上下文、patch、结果写入知识库。

## 必须冻结的能力

以下能力先冻结，不再开发新功能，不再接入新流程。

### 1. 自动进化链路

冻结原因：

- 它会让系统在错误发生后自动创建自修改任务，风险边界不清晰。
- 它和新目标“由用户明确发起任务并确认修改”冲突。
- 它会诱导项目继续扩大成自修复平台，而不是知识库代理。

涉及文件：

- `chromevideo/auto-evolve-monitor.js`
- `queue-server/evolution/auto-evolve-manager.js`
- `queue-server/evolution/evolve-executor.js`
- `queue-server/evolution/evolution-history.js`
- `queue-server/evolution/extension-watcher.js`
- `queue-server/evolution/file-executor.js`
- `queue-server/evolution/hot-reload.js`
- `queue-server/evolution/self-diagnosis.js`
- `queue-server/evolution/system-executor.js`
- `queue-server/evolution/code-executor.js`
- `queue-server/evolution/code-writer.js`
- `queue-server/test-auto-evolve.js`
- `queue-server/test-auto-evolve-loop.js`
- `queue-server/test-auto-evolve-loop2.js`
- `queue-server/test-evolve-executor.js`

需要改动：

- 从 `chromevideo/background.js` 移除或禁用 `auto-evolve-monitor.js` 的加载。
- 从 `chromevideo/background.js` 移除 `start_auto_evolve`、`stop_auto_evolve`、`resume_auto_evolve`、`auto_evolve` 消息处理。
- 从 `chromevideo/sidepanel.js` 移除自动进化 UI 状态、按钮和事件。
- 从 `queue-server/websocket/handler.js` 移除 `auto_evolve` 消息创建任务的逻辑。
- 从 `queue-server/actions/action-engine.js` 移除 `evolve_handler`、`evolve_extension`、`evolve_server` 动作注册。

保守执行方式：

- 第一阶段先用 feature flag 禁用，例如 `FCC_ENABLE_AUTO_EVOLVE=false`。
- 第二阶段确认新主线可跑后，再删除文件和引用。

## 建议删除或归档的功能块

### 1. 自修改动作

需要删除的动作：

- `evolve_handler`
- `evolve_extension`
- `evolve_server`

删除原因：

- 新目标中，DeepSeek 只能返回补丁建议，不能直接触发自修改动作。
- 文件写入必须走“diff 预览 + 用户确认 + 本地服务应用”的路径。
- 自修改动作和知识库代理的安全模型冲突。

涉及文件：

- `queue-server/actions/action-engine.js`
- `queue-server/actions/confirm-manager.js`
- `queue-server/evolution/evolve-executor.js`
- `queue-server/evolution/hot-reload.js`
- `web-console/src/App.tsx` 中和 `/evolve`、代码编辑、自动保存相关的 UI
- `queue-server/custom-handler.js` 如果只服务旧 `/evolve` 流程，应迁移或删除

替代方案：

- 新增 `PATCH_PROPOSAL` 协议。
- DeepSeek 只能返回补丁数据。
- 本地服务校验 patch 是否只影响允许路径。
- Web Console 展示 diff。
- 用户确认后调用 `POST /patches/:id/apply`。

### 2. `/evolve` API

需要废弃：

- `POST /evolve`
- 任何直接写入 `custom-handler.js` 并触发热重载的接口。

删除原因：

- 它代表旧目标：让系统修改自己的处理逻辑。
- 新目标是管理用户项目文件，不是在线热改本系统。

执行建议：

- 先改为返回 `410 Gone`，响应中说明接口已废弃。
- 等前端和扩展不再引用后删除实现。

替代 API：

- `POST /tasks`
- `POST /tasks/:id/context`
- `POST /tasks/:id/deepseek-response`
- `GET /patches/:id`
- `POST /patches/:id/apply`

### 3. cron autopilot 和 workbuddy 自动任务

需要删除或归档：

- `scripts/install-dev-cron.sh`
- `scripts/cron-dev-cycle.sh`
- `scripts/dev-autopilot.sh`
- `scripts/dev-autopilot-prompt.md`
- `.workbuddy/` 里的自动开发状态和计划，保留历史可归档到 `doc/archive/`。

删除原因：

- 自动拉起 `codex exec` 持续改代码，会继续扩大范围。
- 新阶段需要人为控制重构，不适合后台自动推进。

执行建议：

- 如果已经安装系统 cron 或计划任务，先手动卸载。
- 之后再删除仓库脚本。
- `.workbuddy/` 已在 `.gitignore`，但如果已有内容被跟踪，需要先 `git rm --cached`。

### 4. DeepSeek Web Zero-Token provider 的主链路地位

需要降级：

- `queue-server/providers/deepseek-web/`
- `scripts/onboard-deepseek-web.js`
- `scripts/verify-deepseek-web-provider.js`
- `doc/deepseek-zero-token-integration-20260417.md`
- `doc/deepseek-web-api-conversion-plan-20260418.md`

不是立即删除，而是从“默认主线”降级为“实验能力”。

降级原因：

- 新目标明确依赖 DeepSeek Web 页面交互和扩展适配。
- Zero-token 内部接口容易漂移，会让重构阶段被外部不稳定因素拖住。
- 当前诊断显示登录态未 onboard，真实可用性不应作为 MVP 前提。

执行建议：

- provider 代码保留到 `queue-server/experimental/deepseek-web/` 或保留原目录但不接默认任务。
- README 中明确：MVP 默认走 `extension-dom`。
- 只有在主线稳定后，再考虑恢复 zero-token provider。

### 5. 复杂测试验证器与自动回滚系统

需要冻结：

- `queue-server/test-validator/`

冻结原因：

- 它服务于自动进化前后的验证与回滚，不服务于新的 MVP。
- 当前优先级应是文件补丁协议和知识库，不是搭建通用测试编排平台。

后续替代：

- 只保留简单命令：
  - `node -c queue-server/index.js`
  - `npm run build` in `web-console`
  - 针对 patch parser 的单元测试
  - 针对 SQLite 知识库存取的单元测试

## 需要保留但改名/改职责的内容

### `queue-server`

当前职责过多，建议改名或在文档中重新定义为 `local-agent`。

保留职责：

- 任务 API
- 文件读取 API
- patch 生成、校验、应用
- SQLite 知识库
- WebSocket 任务状态通知

移除职责：

- 自我修复
- 自我重启
- 自动修改扩展代码
- 自动修改后端代码
- 自动创建进化任务

### `chromevideo`

当前目录名不表达真实用途，建议后续改为 `extension/`。

保留职责：

- DeepSeek 页面输入
- 回复读取
- 会话读取
- 附件上传
- Side Panel 基础控制
- Offscreen WebSocket 连接

移除职责：

- auto-evolve monitor
- 自动开启自修复任务
- 自动重载扩展
- 自修改进度 UI

### `web-console`

保留职责：

- 任务列表
- 聊天记录
- 文件上下文选择
- 知识库浏览
- diff 预览
- 应用 patch 的人工确认

移除职责：

- 编辑 `custom-handler.js`
- 触发 `/evolve`
- 展示自动进化状态
- 展示自修复进度

## 数据和 Git 边界清理

### 必须从 Git 索引移除的运行时数据

当前 `queue-server/data/evolution-history.json` 已经被 Git 跟踪，即使 `.gitignore` 包含它，也会继续污染 diff。

需要执行：

```bash
git rm --cached queue-server/data/evolution-history.json
```

确认以下文件不应入库：

- `queue-server/data/evolution-history.json`
- `queue-server/data/evolution-history.json.backup`
- `queue-server/data/tasks.json`
- `queue-server/data/chat-state.db`
- `queue-server/data/chat-state.db-shm`
- `queue-server/data/chat-state.db-wal`
- `queue-server/data/deepseek-web-auth.json`
- `.browser-profile/`
- `.workbuddy/`
- `node_modules/`
- `web-console/dist/`

### 新知识库数据位置

建议统一为：

- `queue-server/data/knowledge.db`
- `queue-server/data/knowledge.db-shm`
- `queue-server/data/knowledge.db-wal`

这些文件必须保持 ignored，不进入 Git。

## 新协议建议

### 发送给 DeepSeek 的任务协议

```json
{
  "type": "coding_task",
  "taskId": "task-xxx",
  "goal": "修复或实现的目标",
  "files": [
    {
      "path": "src/app.ts",
      "content": "...",
      "purpose": "入口文件"
    }
  ],
  "constraints": [
    "只返回 JSON",
    "不要直接解释无关内容",
    "只能返回 patch 或 question"
  ]
}
```

### DeepSeek 返回 patch

```json
{
  "type": "patch",
  "taskId": "task-xxx",
  "changes": [
    {
      "path": "src/app.ts",
      "diff": "--- a/src/app.ts\n+++ b/src/app.ts\n..."
    }
  ]
}
```

### DeepSeek 返回问题

```json
{
  "type": "question",
  "taskId": "task-xxx",
  "message": "需要用户确认的信息"
}
```

## 建议执行顺序

### 阶段 0：冻结危险入口

目标：阻止项目继续自动扩大。

操作：

1. 禁用 auto-evolve 消息处理。
2. 禁用 `evolve_*` 动作。
3. 废弃 `/evolve`。
4. 停用 cron autopilot。
5. 从 Git 索引移除运行时数据。

验收：

- 启动服务后，不会因为扩展错误自动创建修复任务。
- DeepSeek 回复不能直接写入本仓库文件。
- `git status` 不再因为运行服务出现 data 文件变化。

### 阶段 1：建立新任务协议

目标：让 DeepSeek 输入输出变得可解析、可审计、可确认。

操作：

1. 新增任务协议定义。
2. 新增 DeepSeek response parser。
3. 新增 patch proposal 存储。
4. 新增 patch apply API。
5. Web Console 展示 diff 并要求人工确认。

验收：

- DeepSeek 返回非协议内容时，本地服务拒绝应用。
- DeepSeek 返回 patch 时，只生成 pending patch，不直接写文件。
- 用户确认后才写入文件。

### 阶段 2：知识库 MVP

目标：保存聊天记录和任务上下文。

操作：

1. 新建 SQLite 表：
   - `conversations`
   - `messages`
   - `tasks`
   - `task_files`
   - `patches`
   - `patch_changes`
2. 扩展采集 DeepSeek 会话后写入本地服务。
3. Web Console 可查看会话和任务。

验收：

- DeepSeek 聊天记录能落库。
- 每次任务能关联输入文件、DeepSeek 回复、生成 patch、应用结果。

### 阶段 3：上下文选择和知识检索

目标：从“手动选文件”升级到“半自动找上下文”。

操作：

1. 先实现文件摘要。
2. 再实现 SQLite FTS 搜索。
3. 最后再考虑向量库。

验收：

- 用户输入目标后，系统能推荐相关文件。
- 用户仍然可以手动确认最终发送给 DeepSeek 的文件。

## 不建议现在做的事情

- 不要继续做自动进化。
- 不要继续做系统自修改。
- 不要先上向量数据库。
- 不要把 DeepSeek zero-token 内部接口作为 MVP 依赖。
- 不要让扩展直接写本地文件。
- 不要让 DeepSeek 回复绕过人工确认直接应用。
- 不要继续扩展 cron autopilot。

## 最小删除清单

如果只做一轮最小裁剪，优先处理这些引用：

1. `chromevideo/background.js`
   - 移除 `importScripts('auto-evolve-monitor.js')`。
   - 移除 `auto_evolve`、`start_auto_evolve`、`stop_auto_evolve`、`resume_auto_evolve` 分支。

2. `chromevideo/sidepanel.js`
   - 移除自动进化状态、按钮事件、进度显示。

3. `chromevideo/sidepanel.html`
   - 移除自动进化相关 UI。

4. `queue-server/websocket/handler.js`
   - 移除 `auto_evolve` 消息处理。
   - 移除 fallback 到自动进化任务的逻辑。

5. `queue-server/actions/action-engine.js`
   - 移除 `evolve_handler`、`evolve_extension`、`evolve_server`。

6. `queue-server/index.js`
   - 废弃或删除 `/evolve` 路由。

7. `scripts/`
   - 归档或删除 autopilot/cron 相关脚本。

8. Git 索引
   - `git rm --cached queue-server/data/evolution-history.json`

## 最终判断标准

裁剪完成后，项目应该满足：

- 用户明确创建任务。
- 本地服务明确选择文件。
- 扩展只负责和 DeepSeek Web 交互。
- DeepSeek 返回内容只形成待确认 patch。
- 用户确认后才写本地文件。
- 所有聊天、上下文、patch、结果都能进入知识库。
- 系统不会自动修改自己。

