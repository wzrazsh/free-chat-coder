# free-chat-coder API 契约

更新日期：2026-04-25

## 1. 文档定位

本文档定义 `free-chat-coder` 当前本地服务对外暴露的 HTTP API、WebSocket 消息和核心数据对象契约。它服务于 Chrome 扩展、Web Console、Queue Server 和后续 Patch Review / Knowledge Base 模块之间的协作。

当前契约以 `queue-server/` 现有实现为准；尚未实现的接口只在“规划接口”中声明，不应被前端或扩展当作已可用能力调用。

## 2. 基础约定

### 2.1 服务地址

Queue Server 默认监听本地地址：

```text
http://127.0.0.1:8080
ws://127.0.0.1:8080
```

如果 8080 被占用，服务会按候选端口自动回退。客户端应优先通过 `/health` 或共享配置发现实际端口。

### 2.2 数据格式

- HTTP 请求体：`application/json`
- HTTP 响应体：JSON
- WebSocket 消息：JSON 字符串
- 时间字段：ISO 8601 字符串
- ID 字段：服务端生成的字符串，不要求客户端解析内部结构

### 2.3 错误格式

当前错误响应以最小结构为主：

```json
{
  "error": "Error message"
}
```

后续如需统一错误码，应扩展为：

```json
{
  "error": "Human readable message",
  "code": "STABLE_ERROR_CODE",
  "details": {}
}
```

## 3. 核心对象

### 3.1 Task

任务由 Queue Server 管理，保存在 `queue-server/data/tasks.json`。

```json
{
  "id": "1710000000000-abcde",
  "prompt": "用户提交给 DeepSeek 的任务内容",
  "options": {
    "provider": "extension-dom",
    "conversationId": "conv-xxx",
    "attachments": []
  },
  "status": "pending",
  "result": "可选，任务完成后的文本结果",
  "error": "可选，任务失败原因",
  "executionChannel": "extension",
  "createdAt": "2026-04-25T00:00:00.000Z",
  "updatedAt": "2026-04-25T00:00:00.000Z"
}
```

当前已使用状态：

| 状态 | 含义 |
| :--- | :--- |
| `pending` | 等待调度 |
| `processing` | 已分配给扩展或 Queue Server provider 执行 |
| `completed` | 已完成 |
| `failed` | 已失败 |

路线图中提到的 `waiting_approval` 等状态属于后续规范化方向，当前实现尚未作为稳定状态机落地。

### 3.2 Task Options

```json
{
  "provider": "extension-dom",
  "conversationId": "conv-xxx",
  "attachments": []
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `provider` | string | 否 | 支持 `extension-dom`、`deepseek-web`；缺省为 `extension-dom` |
| `conversationId` | string | 否 | 关联会话 ID；存在时任务 prompt/result/error 会同步进会话 |
| `attachments` | array | 否 | 任务附件占位；当前未形成完整文件交付协议 |

### 3.3 Conversation

会话由 SQLite 存储，映射 DeepSeek 会话和本地任务上下文。

```json
{
  "id": "conv-xxx",
  "deepseekSessionId": "deepseek-session-id",
  "origin": "extension",
  "modeProfile": "expert",
  "title": "会话标题",
  "status": "active",
  "metadata": {},
  "lastMessageHash": "sha1",
  "lastSyncedAt": "2026-04-25T00:00:00.000Z",
  "messageCount": 3,
  "lastMessagePreview": "最近一条消息内容",
  "createdAt": "2026-04-25T00:00:00.000Z",
  "updatedAt": "2026-04-25T00:00:00.000Z"
}
```

### 3.4 Message

```json
{
  "id": "msg-xxx",
  "conversationId": "conv-xxx",
  "seq": 1,
  "role": "user",
  "content": "消息内容",
  "contentHash": "sha1",
  "source": "task_prompt",
  "metadata": {},
  "createdAt": "2026-04-25T00:00:00.000Z",
  "syncedAt": "2026-04-25T00:00:00.000Z"
}
```

### 3.5 Confirm

审批项由 `confirm-manager` 在内存中维护，当前重启后不持久化。

```json
{
  "confirmId": "confirm-xxx",
  "action": "execute_command",
  "riskLevel": "high",
  "params": {},
  "taskId": "task-xxx",
  "createdAt": "2026-04-25T00:00:00.000Z",
  "expiresAt": "2026-04-25T00:03:00.000Z"
}
```

默认超时：3 分钟。超时后自动拒绝。

## 4. HTTP API

### 4.1 Health

#### `GET /health`

获取 Queue Server 当前健康状态和实际端口。

响应：

```json
{
  "status": "ok",
  "service": "free-chat-coder-queue-server",
  "port": 8080,
  "preferredPort": 8080
}
```

### 4.2 Tasks

#### `GET /tasks`

获取全部任务和当前下一个 pending 任务。

响应：

```json
{
  "tasks": [],
  "nextPending": null
}
```

#### `POST /tasks`

创建任务。

请求：

```json
{
  "prompt": "请分析当前项目结构",
  "options": {
    "provider": "extension-dom",
    "conversationId": "conv-xxx",
    "attachments": []
  }
}
```

响应 `201`：

```json
{
  "id": "1710000000000-abcde",
  "status": "pending",
  "task": {}
}
```

错误：

| 状态码 | 条件 |
| :--- | :--- |
| 400 | `prompt` 缺失 |
| 400 | `options.provider` 不是已知 provider |

创建成功后，服务端会：

- 尝试调度任务。
- 向 Web Console 广播 `task_added`。
- 如果存在 `options.conversationId`，将 prompt 作为 `task_prompt` 同步进会话。

#### `PATCH /tasks/:id`

REST fallback：更新任务状态。

请求：

```json
{
  "status": "completed",
  "result": "任务结果",
  "error": null
}
```

响应：

```json
{
  "success": true,
  "task": {}
}
```

错误：

| 状态码 | 条件 |
| :--- | :--- |
| 404 | 任务不存在 |

### 4.3 Confirms

#### `GET /tasks/confirms`

获取待审批列表。

响应：

```json
{
  "confirms": []
}
```

#### `POST /tasks/confirms/test`

创建一个仅用于本地联调的合成审批项。

请求：

```json
{
  "action": "execute_command",
  "riskLevel": "high",
  "params": {
    "command": "whoami",
    "cwd": "."
  },
  "taskId": "synthetic-task"
}
```

响应 `201`：

```json
{
  "success": true,
  "confirmId": "confirm-xxx"
}
```

#### `POST /tasks/confirms/:id`

同意或拒绝审批项。

请求：

```json
{
  "approved": true
}
```

响应：

```json
{
  "success": true,
  "approved": true
}
```

错误：

| 状态码 | 条件 |
| :--- | :--- |
| 404 | 审批项不存在或已被处理 |

### 4.4 Conversations

#### `GET /conversations`

获取会话列表。

查询参数：

| 参数 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `origin` | string | 无 | 按会话来源过滤 |
| `limit` | number | 50 | 返回数量上限 |

响应：

```json
{
  "conversations": []
}
```

#### `POST /conversations`

创建会话记录。

请求：

```json
{
  "deepseekSessionId": "deepseek-session-id",
  "origin": "extension",
  "modeProfile": "expert",
  "title": "新会话",
  "status": "active",
  "metadata": {}
}
```

响应 `201`：

```json
{
  "conversation": {}
}
```

创建成功后，服务端会向 Web Console 广播 `conversation_created`。

#### `GET /conversations/:id`

获取会话摘要。

响应：

```json
{
  "conversation": {}
}
```

错误：

| 状态码 | 条件 |
| :--- | :--- |
| 404 | 会话不存在 |

#### `GET /conversations/:id/messages`

获取会话摘要和消息列表。

响应：

```json
{
  "conversation": {},
  "messages": []
}
```

错误：

| 状态码 | 条件 |
| :--- | :--- |
| 404 | 会话不存在 |

#### `POST /conversations/:id/sync`

同步 DeepSeek 页面会话状态、消息和元数据到 SQLite。

请求：

```json
{
  "deepseekSessionId": "deepseek-session-id",
  "title": "会话标题",
  "modeProfile": "expert",
  "status": "active",
  "metadata": {},
  "pageState": {},
  "modelState": {},
  "sessionList": [],
  "messages": [
    {
      "role": "assistant",
      "content": "消息内容",
      "source": "deepseek_page",
      "metadata": {}
    }
  ]
}
```

响应：

```json
{
  "conversation": {},
  "insertedCount": 1,
  "totalMessages": 1,
  "lastMessageHash": "sha1",
  "messages": []
}
```

错误：

| 状态码 | 条件 |
| :--- | :--- |
| 404 | 会话不存在 |
| 500 | 同步失败 |

#### `DELETE /conversations/:id`

删除会话及其关联消息。

响应：

```json
{
  "success": true
}
```

错误：

| 状态码 | 条件 |
| :--- | :--- |
| 404 | 会话不存在 |

### 4.5 Native Host

#### `POST /install-native-host`

通过 Queue Server 执行 Native Messaging Host 安装脚本。

请求：

```json
{
  "extensionId": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}
```

响应：

```json
{
  "success": true,
  "message": "Native Host installed successfully",
  "stdout": "",
  "stderr": ""
}
```

错误：

| 状态码 | 条件 |
| :--- | :--- |
| 400 | `extensionId` 不是 32 位 `a-p` 字符 |
| 500 | 安装脚本不存在 |

安装脚本执行失败时，当前实现可能返回 `200` 且 `success: false`。

## 5. WebSocket 契约

### 5.1 连接

客户端连接 Queue Server WebSocket 地址后，必须先注册身份。

```json
{
  "type": "register",
  "clientType": "web"
}
```

支持的 `clientType`：

| 值 | 说明 |
| :--- | :--- |
| `web` | Web Console |
| `extension` | Chrome 扩展 offscreen client |

### 5.2 Client -> Server

#### `register`

```json
{
  "type": "register",
  "clientType": "extension"
}
```

注册扩展后，服务端会尝试分配 pending task。

#### `ping`

```json
{
  "type": "ping"
}
```

响应：

```json
{
  "type": "pong"
}
```

#### `task_update`

扩展回传任务执行状态。

```json
{
  "type": "task_update",
  "taskId": "task-xxx",
  "status": "completed",
  "result": "DeepSeek 回复文本",
  "error": null
}
```

当 `status` 为 `completed` 时，服务端会先交给 `custom-handler` 处理多轮动作，再决定最终任务状态。

#### `browser_action_result` / `action_result`

扩展回传浏览器动作执行结果。

```json
{
  "type": "browser_action_result",
  "requestId": "request-xxx",
  "conversationId": "conv-xxx",
  "success": true,
  "result": {},
  "error": null,
  "syncPayload": {}
}
```

服务端行为：

- 如果有 `requestId`，更新 `browser_actions` 状态。
- 如果有 `conversationId` 和 `syncPayload`，同步会话。
- 向 Web Console 广播 `browser_action_result`。

### 5.3 Server -> Extension

#### `task_assigned`

```json
{
  "type": "task_assigned",
  "task": {}
}
```

扩展收到后负责在 DeepSeek 页面执行任务，并通过 `task_update` 回传结果。

#### `execute_action` / `browser_action`

```json
{
  "type": "browser_action",
  "requestId": "request-xxx",
  "action": "sync_conversation",
  "conversationId": "conv-xxx",
  "params": {}
}
```

此类消息由动作系统发出，扩展负责执行页面侧动作并回传 `browser_action_result`。

#### `confirm_resolved`

```json
{
  "type": "confirm_resolved",
  "confirmId": "confirm-xxx",
  "approved": true
}
```

审批完成后广播给扩展，用于继续或停止等待中的动作。

### 5.4 Server -> Web Console

#### `task_added`

```json
{
  "type": "task_added",
  "task": {}
}
```

#### `task_update`

```json
{
  "type": "task_update",
  "task": {}
}
```

#### `confirm_request`

```json
{
  "type": "confirm_request",
  "confirmId": "confirm-xxx",
  "action": "execute_command",
  "riskLevel": "high",
  "params": {},
  "taskId": "task-xxx",
  "timestamp": "2026-04-25T00:00:00.000Z"
}
```

#### `confirm_resolved`

```json
{
  "type": "confirm_resolved",
  "confirmId": "confirm-xxx",
  "approved": false,
  "reason": "timeout"
}
```

`reason` 只在部分路径中出现，例如审批超时。

#### `conversation_created`

```json
{
  "type": "conversation_created",
  "conversation": {}
}
```

#### `conversation_updated`

```json
{
  "type": "conversation_updated",
  "conversation": {}
}
```

#### `conversation_messages_updated`

```json
{
  "type": "conversation_messages_updated",
  "conversationId": "conv-xxx",
  "insertedCount": 1,
  "totalMessages": 10
}
```

#### `conversation_deleted`

```json
{
  "type": "conversation_deleted",
  "conversationId": "conv-xxx"
}
```

#### `browser_action_result`

```json
{
  "type": "browser_action_result",
  "requestId": "request-xxx",
  "conversationId": "conv-xxx",
  "success": true,
  "result": {},
  "error": null
}
```

## 6. Provider 契约

当前 provider 由 `queue-server/providers/index.js` 管理。

| Provider | 类型 | 当前定位 |
| :--- | :--- | :--- |
| `extension-dom` | extension | 默认 provider，通过 Chrome 扩展操作 DeepSeek Web 页面 |
| `deepseek-web` | server | 可选 provider，在 Queue Server 内执行文本请求 |

Provider 选择规则：

1. `POST /tasks` 未传 `options.provider` 时使用 `extension-dom`。
2. 传入未知 provider 时返回 400。
3. `extension-dom` 需要扩展在线才能调度。
4. `deepseek-web` 同一时间只允许一个任务占用执行通道。
5. `autoEvolve` 不参与 provider 路由。

## 7. 当前不提供的 API

以下能力属于已废弃或尚未实现范围，客户端不应调用：

- `/evolve`
- 自动进化启动、停止、恢复接口
- 自动自修复接口
- AI 直接写文件接口
- AI 直接执行本地命令接口

## 8. 规划接口占位

以下接口方向与路线图一致，但尚未实现。实现前必须先补充正式契约。

### 8.1 Patch Review

规划目标：

- 接收 AI 生成的补丁提案。
- 保存 diff、影响文件、风险说明和来源会话。
- 由用户审批后再应用到本地工作区。

候选接口：

```text
POST /patches
GET /patches
GET /patches/:id
POST /patches/:id/approve
POST /patches/:id/reject
POST /patches/:id/apply
```

### 8.2 File Delivery

规划目标：

- 管理任务附件、文件包和发送给 DeepSeek 的上下文资产。
- 记录附件上传状态和关联任务。

候选接口：

```text
POST /files/packages
GET /files/packages/:id
POST /files/packages/:id/attach-to-task
```

### 8.3 Knowledge Base

规划目标：

- 索引项目文档、任务摘要、会话摘要和补丁记录。
- 为任务 prompt 提供可追踪的上下文来源。

候选接口：

```text
POST /knowledge/sources
POST /knowledge/index
GET /knowledge/search
```

## 9. 契约维护规则

1. 新增或修改 HTTP API 时，必须同步更新本文档。
2. 新增 WebSocket `type` 时，必须说明方向、字段和接收方。
3. 新增任务状态、审批状态或 provider 时，必须更新核心对象和枚举说明。
4. 尚未实现的接口只能放在“规划接口占位”，不能混入当前可用 API。
5. 与 `vision.md`、`roadmap.md`、`design-doc.md` 冲突时，应先确认产品边界，再调整实现或文档。

