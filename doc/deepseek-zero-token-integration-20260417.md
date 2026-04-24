> Deprecated: 本文档描述的是 2026-04-25 前的自动进化/自修改路线，已从当前主线中移除。当前路线以 `doc/refactor-prune-plan-20260425.md` 和 `doc/refactor-prune-plan-20260425-v1.md` 为准。

# DeepSeek Web Zero-Token 接入方案

更新日期：2026-04-17

## 目标

在保留当前 Chrome 扩展 DOM 自动化链路的前提下，为仓库新增一条 `DeepSeek Web Zero-Token` 执行通道：用户在真实浏览器里登录一次 DeepSeek，系统随后复用 `.browser-profile` 中的登录态，通过可附加的调试浏览器和网页内部接口完成文本对话、会话复用和自动进化任务执行，降低对输入框、发送按钮和页面 DOM 结构的强耦合。

## 为什么现在做

当前主链路依赖 [chromevideo/controllers/prompt-controller.js](/opt/gitproject/free-chat-coder/chromevideo/controllers/prompt-controller.js) 直接操作网页 DOM。这个方案适合保留为浏览器动作通道，但不适合作为唯一的文本执行通道。Zero-Token provider 更适合承担：

- 普通文本问答
- 自动进化任务
- 多轮工具结果回灌
- 无需截图、上传附件或切会话的后台任务

## 边界

继续保留在扩展链路的能力：

- `upload_screenshot`
- `new_session`
- `switch_session`
- `setModeProfile` / 页面模式切换

优先接入 Zero-Token provider 的能力：

- 任务文本提交与回复读取
- 会话 ID / 父消息 ID 复用
- 自动进化任务执行
- 工具调用结果回灌

## 目标架构

### 1. Provider 目录

新增 `queue-server/providers/deepseek-web/`，至少包含：

- `auth.js`：从 `.browser-profile` 或 CDP 调试浏览器捕获 `cookie`、`bearer`、`userAgent`
- `client.js`：封装 DeepSeek Web 内部接口请求、session 创建、消息发送
- `stream.js`：把网页返回适配为本仓库可消费的文本/事件流
- `store.js`：持久化 provider 凭证与会话映射

### 2. 任务路由抽象

给任务增加 provider 选择能力，最小目标：

- `extension-dom`：当前默认链路
- `deepseek-web`：Zero-Token provider

`queue-server/websocket/handler.js` 不应再假设所有任务都必须发给扩展。文本任务应允许在 Queue Server 内直接执行。

### 3. 会话映射

在现有 `conversationStore` 基础上增加 provider 级会话映射，避免强行把网页 DOM session 和网页内部接口 session 混为同一字段。

建议新增字段：

- `provider`
- `providerSessionId`
- `providerParentMessageId`

### 4. 工具循环兼容

第一阶段不引入新的工具协议，先复用当前 `ActionBlock` + `ActionResult` 循环：

- 输出仍由 [queue-server/actions/action-parser.js](/opt/gitproject/free-chat-coder/queue-server/actions/action-parser.js) 解析
- 工具结果继续由 [queue-server/custom-handler.js](/opt/gitproject/free-chat-coder/queue-server/custom-handler.js) 回灌

后续如有必要，再引入 `<tool_call>` / `<tool_response>` 标签协议。

## 分阶段实施

### Phase 1：登录态捕获与诊断

目标：建立本地凭证捕获与自检能力。

涉及文件：

- `queue-server/providers/deepseek-web/auth.js`
- `scripts/onboard-deepseek-web.js`
- `validate-environment.js`
- `README.md`

验收：

- 能从 `.browser-profile` 对应的调试浏览器里抓到 `cookie` / `bearer` / `userAgent`
- 能输出凭证是否完整、调试浏览器是否可附加、profile 是否匹配
- 不把敏感凭证打印到普通日志

### Phase 2：最小可用 chat provider

目标：让 Queue Server 内直接完成一次 DeepSeek Web 文本问答。

涉及文件：

- `queue-server/providers/deepseek-web/client.js`
- `queue-server/providers/deepseek-web/stream.js`
- `queue-server/routes/tasks.js`
- `queue-server/queue/manager.js`

验收：

- 提交一个 `provider=deepseek-web` 的文本任务后，无需扩展 DOM 输入即可获得回复
- 能在服务端记录 provider session 信息
- 失败时能输出可诊断错误，不泄露凭证

### Phase 3：接入自动进化主链路

目标：让自动进化优先走 Zero-Token provider。

涉及文件：

- `queue-server/websocket/handler.js`
- `queue-server/custom-handler.js`
- `queue-server/evolution/*`

验收：

- `auto_evolve` 任务默认优先走 `deepseek-web`
- 多轮工具回灌可继续执行
- 失败时可回退到 `extension-dom` 或明确报阻塞原因

### Phase 4：会话与 UI 集成

目标：在 Web Console 中显示 provider 类型、会话状态和诊断信息。

涉及文件：

- `queue-server/conversations/store.js`
- `queue-server/routes/conversations.js`
- `web-console/src/App.tsx`

验收：

- 能看到会话来自 `extension-dom` 还是 `deepseek-web`
- 能查看最近一次 Zero-Token 调用状态与失败原因

## 风险控制

- 凭证只允许本机存储，不得通过 WebSocket 广播给扩展或 Web Console。
- `queue-server/index.js` 的日志在接入前必须增加脱敏，至少屏蔽 `cookie`、`Authorization`、`bearer`。
- 任何 Zero-Token 请求失败都必须记录“接口阶段 + HTTP 状态/解析阶段”，不要只报 `Unknown error`。

## 定时任务执行要求

该专项从现在开始作为 autopilot 最高优先级任务处理。自动任务每轮进入会话后，应先读本文件，再按以下顺序推进：

1. 完成 Phase 1
2. 完成 Phase 2 的最小 provider
3. 将自动进化切到 `deepseek-web`
4. 最后再做 UI 和会话可视化

单轮任务原则：每轮只完成一个经过验证的最小单元，并提交。
