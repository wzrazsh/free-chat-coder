# MCP Server Implementation Tasks

## Overview
将 Chrome 扩展功能封装成 MCP (Model Context Protocol) 服务器，使 AI 模型能够通过标准协议调用 DeepSeek 扩展功能。

## Task List

### Task 1: 安装 MCP SDK 依赖
**状态**: ✅ Completed  
**描述**: 在 queue-server 中安装必要的依赖包  
**操作步骤**:
1. 进入 queue-server 目录
2. 执行 `npm install @modelcontextprotocol/sdk zod`

**验收标准**:
- [x] `@modelcontextprotocol/sdk` 出现在 `queue-server/package.json` 的 dependencies 中
- [x] `zod` 出现在 `queue-server/package.json` 的 dependencies 中
- [x] `node_modules/@modelcontextprotocol` 目录存在
- [x] 无安装错误，npm 返回 0 个漏洞

---

### Task 2: 创建 MCP 服务器核心文件
**状态**: ✅ Completed  
**优先级**: High  
**预计时间**: 30 分钟  
**描述**: 创建 `queue-server/mcp-server.js` 文件，实现 MCP 服务器的基本框架  

**操作步骤**:
1. 创建 `mcp-server.js` 文件
2. 引入必要的依赖（@modelcontextprotocol/sdk, zod）
3. 创建 McpServer 实例
4. 实现 StdioServerTransport 连接
5. 添加基本的错误处理

**验收标准**:
- [x] `queue-server/mcp-server.js` 文件已创建
- [x] 文件使用 CommonJS 语法（`require`/`module.exports`），与 queue-server 保持一致
- [x] 服务器可以启动并在 stdio 上监听
- [x] 运行 `node queue-server/mcp-server.js` 不会立即报错退出
- [x] 可以通过 `console.error` 输出启动日志（不影响 stdio 通信）

---

### Task 3: 实现工具列表接口 (tools/list)
**状态**: ✅ Completed  
**优先级**: High  
**预计时间**: 20 分钟  
**描述**: 实现 MCP 协议的 `tools/list` 接口，返回可用的工具列表  

**操作步骤**:
1. 使用 `server.setRequestHandler('tools/list', ...)` 注册处理器
2. 定义以下工具：
   - `submit_prompt`: 提交提示词给 DeepSeek
   - `get_task_status`: 查询任务状态
   - `list_conversations`: 列出所有会话
   - `get_conversation`: 获取会话详情
3. 为每个工具定义 inputSchema（使用 zod）

**验收标准**:
- [x] `tools/list` 请求返回正确的 JSON-RPC 响应
- [x] 返回的工具列表包含 4 个工具
- [x] 每个工具都有 name, description, inputSchema 字段
- [x] inputSchema 使用正确的 JSON Schema 格式
- [x] 测试：使用 `echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node mcp-server.js` 能收到正确响应

---

### Task 4: 实现 callQueueAPI 辅助函数
**状态**: ✅ Completed  
**优先级**: High  
**预计时间**: 25 分钟  
**描述**: 实现调用 Queue Server HTTP API 的辅助函数  

**操作步骤**:
1. 引入 `http` 模块
2. 实现 `callQueueAPI(path, options)` 函数
3. 使用 `discoverQueueServer()` 自动发现 Queue Server 地址
4. 支持 GET, POST 方法
5. 处理 JSON 请求和响应
6. 添加错误处理和超时

**验收标准**:
- [x] `callQueueAPI('/health')` 能成功调用（需要 Queue Server 运行）
- [x] POST 请求能正确发送 JSON body
- [x] 超时控制在合理范围（默认 5 秒）
- [x] 网络错误能正确抛出并被捕获
- [x] 测试：在 Queue Server 运行时调用 `callQueueAPI('/tasks')` 返回任务列表

---

### Task 5: 实现 submit_prompt 工具
**状态**: ✅ Completed  
**优先级**: High  
**预计时间**: 40 分钟  
**描述**: 实现 `submit_prompt` 工具，提交提示词并等待 DeepSeek 回复  

**操作步骤**:
1. 在 `tools/call` 处理器中添加 `submit_prompt` 分支
2. 调用 `POST /tasks` 创建任务
3. 实现 `pollTask(taskId)` 函数轮询任务状态
4. 轮询间隔 1 秒，超时 60 秒
5. 返回任务结果或错误

**验收标准**:
- [x] 提交提示词后返回任务 ID
- [x] 能正确轮询任务状态直到完成
- [x] 任务完成时返回 DeepSeek 的回复内容
- [x] 任务失败时返回错误信息
- [x] 超时（60秒）能正确抛出错误
- [x] 测试：提交简单提示词 "1+1=?" 能收到数字 "2" 的回复

---

### Task 6: 实现 get_task_status 工具
**状态**: ✅ Completed  
**优先级**: Medium  
**预计时间**: 15 分钟  
**描述**: 实现 `get_task_status` 工具，查询任务状态  

**操作步骤**:
1. 在 `tools/call` 处理器中添加 `get_task_status` 分支
2. 调用 `GET /tasks/:id` 获取任务详情
3. 返回任务的完整信息（status, result, error 等）

**验收标准**:
- [x] 传入有效的 taskId 能返回任务信息
- [x] 传入无效的 taskId 能返回错误
- [x] 返回的信息包含 status, result, error, createdAt 等字段
- [x] 测试：创建一个任务后查询其状态

---

### Task 7: 实现 list_conversations 工具
**状态**: ✅ Completed  
**优先级**: Medium  
**预计时间**: 15 分钟  
**描述**: 实现 `list_conversations` 工具，列出所有会话  

**操作步骤**:
1. 在 `tools/call` 处理器中添加 `list_conversations` 分支
2. 调用 `GET /conversations` 获取会话列表
3. 支持可选的 origin 和 limit 参数

**验收标准**:
- [x] 返回会话列表数组
- [x] 每个会话包含 id, title, modeProfile, createdAt 等字段
- [x] 测试：创建几个会话后能正确列出

---

### Task 8: 实现 get_conversation 工具
**状态**: ✅ Completed  
**优先级**: Medium  
**预计时间**: 20 分钟  
**描述**: 实现 `get_conversation` 工具，获取会话详情和消息  

**操作步骤**:
1. 在 `tools/call` 处理器中添加 `get_conversation` 分支
2. 调用 `GET /conversations/:id` 获取会话详情
3. 调用 `GET /conversations/:id/messages` 获取消息列表
4. 合并返回结果

**验收标准**:
- [x] 传入有效的 conversationId 能返回会话详情和消息
- [x] 返回的消息按时间顺序排序
- [x] 传入无效的 conversationId 能返回错误
- [x] 测试：创建会话并发送消息后能获取到完整信息

---

### Task 9: 添加启动脚本到 package.json
**状态**: ✅ Completed  
**优先级**: Low  
**预计时间**: 5 分钟  
**描述**: 在 `queue-server/package.json` 中添加 MCP 服务器的启动脚本  

**操作步骤**:
1. 编辑 `queue-server/package.json`
2. 在 scripts 中添加 `"start:mcp": "node mcp-server.js"`

**验收标准**:
- [x] `package.json` 的 scripts 中包含 `start:mcp`
- [x] 运行 `npm run start:mcp` 能启动 MCP 服务器
- [x] 启动后不会立即退出

---

### Task 10: 创建 MCP 配置文件示例
**状态**: ✅ Completed  
**优先级**: Low  
**预计时间**: 10 分钟  
**描述**: 创建 `mcp-config.json` 示例，供 AI 模型使用  

**操作步骤**:
1. 创建 `mcp-config.json` 文件
2. 写入 MCP 服务器配置（command, args）
3. 添加注释说明如何在不同客户端中使用

**验收标准**:
- [x] `mcp-config.json` 文件已创建
- [x] JSON 格式正确，可以被 MCP 客户端解析
- [x] 包含完整的 command 和 args 配置
- [x] 文件包含使用说明注释

---

### Task 11: 集成到 Queue Server 主进程（可选）
**状态**: 🔄 Pending  
**优先级**: Low  
**预计时间**: 30 分钟  
**描述**: 修改 `queue-server/index.js`，支持可选启动 MCP 服务器  

**操作步骤**:
1. 检查命令行参数或环境变量（如 `--with-mcp` 或 `MCP_ENABLED=true`）
2. 如果启用，在 Queue Server 启动后启动 MCP 服务器
3. MCP 服务器作为子进程运行
4. 处理主进程退出时关闭 MCP 服务器

**验收标准**:
- [ ] 默认启动 Queue Server 不会启动 MCP 服务器
- [ ] 使用 `--with-mcp` 参数能同时启动 MCP 服务器
- [ ] 主进程退出时 MCP 服务器也退出
- [ ] MCP 服务器崩溃不会影响 Queue Server

---

### Task 12: 端到端测试
**状态**: ✅ Completed  
**优先级**: High  
**预计时间**: 45 分钟  
**描述**: 进行完整的端到端测试，验证所有功能  

**测试步骤**:
1. 启动 Queue Server: `cd queue-server && npm run dev`
2. 启动 Chrome 扩展（加载扩展，打开 DeepSeek 页面）
3. 启动 MCP 服务器: `node queue-server/mcp-server.js`
4. 使用 MCP 客户端（或手动发送 JSON-RPC 请求）测试每个工具
5. 验证工具调用结果正确

**验收标准**:
- [x] 所有 4 个工具都能成功调用
- [x] `submit_prompt` 能收到 DeepSeek 的回复
- [x] `get_task_status` 能正确查询任务状态
- [x] `list_conversations` 能列出会话
- [x] `get_conversation` 能获取会话详情和消息
- [x] 错误处理正确（无效参数、服务不可用等）

---

### Task 13: 前端操作录像
**状态**: ✅ Completed  
**优先级**: High  
**预计时间**: 30 分钟  
**描述**: 使用 Chrome DevTools 工具录制前端操作，展示 MCP 服务器的工作流程  

**录制内容**:
1. 打开 Web Console (http://localhost:5173)
2. 查看 Queue Server 状态（健康检查的返回）
3. 打开 DeepSeek 页面 (https://chat.deepseek.com)
4. 演示通过 MCP 客户端调用 `submit_prompt` 工具
5. 在 Web Console 中查看任务状态更新
6. 在 DeepSeek 页面查看自动提交的提示词和回复
7. 演示查询会话列表和详情

**验收标准**:
- [x] 录制视频清晰展示操作流程
- [x] 视频包含关键步骤的说明文字
- [x] 视频格式为 MP4 或 WebM
- [x] 视频保存在 `docs/videos/` 目录
- [x] 视频长度控制在 3-5 分钟内

---

## Summary

| 状态 | 数量 |
|------|------|
| ✅ Completed | 11 |
| 🔄 Pending | 2 |
| ⏸️ Blocked | 0 |

**Total Tasks**: 13  
**Estimated Total Time**: 5 hours 25 minutes

## Notes
- 任务依赖关系：Task 2-4 是基础，Task 5-8 可以并行开发
- Task 12 (端到端测试) 依赖所有功能任务的完成
- Task 13 (录像) 依赖 Task 12 的测试通过
- 建议按顺序完成 Task 2-4，然后并行完成 Task 5-8，最后完成测试
