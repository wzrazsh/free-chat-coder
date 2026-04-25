> Deprecated: 本文档描述的是 2026-04-25 前的自动进化/自修改路线，已从当前主线中移除。当前路线以 `doc/refactor-prune-plan.md` 和 `doc/refactor-prune-followup-plan.md` 为准。

# ChromeVideo 扩展功能阶段 4 变更与验证清单

## 1. 本阶段新增功能概述
阶段 4（进化层实现）为系统赋予了“元认知”与“自我修复”能力，即 DeepSeek 可以修改系统自身的代码，并在出现错误时自动触发进化流程。

- **自我修改执行器 (`evolve-executor.js`)**：
  - `evolveExtension`: 修改 Chrome 扩展代码（如 `content.js`, `background.js` 等），保存后向扩展发送 `reload_extension` 事件，实现扩展热重载。
  - `evolveHandler`: 修改 Node.js 端的 `custom-handler.js`，保存后依赖外部 `nodemon` 实现服务热重启。
  - `evolveServer`: 修改 Node.js 端的其他代码。
  - 内置了基础的 JavaScript 语法检测，防止低级语法错误导致系统直接崩溃，并包含 `.bak` 文件备份机制。
- **自动进化触发机制**：
  - 当 `prompt-controller.js`（提交 Prompt 的脚本）在页面上找不到输入框（选择器失效）时，会自动捕获错误，并通过 Chrome 消息机制发送 `auto_evolve` 信号。
  - Queue-Server 收到 `auto_evolve` 信号后，会自动在任务队列中创建一个【自动进化任务】，并将报错的上下文提供给 DeepSeek，让其尝试自我修复。

## 2. 变更文件清单
- **新增**:
  - `queue-server/evolution/evolve-executor.js`
- **修改**:
  - `queue-server/actions/action-engine.js` (注册 `evolve_handler`, `evolve_extension`, `evolve_server` 动作)
  - `queue-server/websocket/handler.js` (增加对 `auto_evolve` 消息的监听并自动创建任务)
  - `chromevideo/controllers/prompt-controller.js` (在输入框查找失败时，派发 `auto_evolve` 消息)
  - `chromevideo/background.js` (转发 `auto_evolve` 到 offscreen，再到 server)
  - `chromevideo/offscreen.js` (透传 `auto_evolve` 消息到 websocket)

## 3. 测试验证步骤

**注意：此阶段修改了扩展的 background.js/offscreen.js 以及 Node.js 服务。请同时重启 Queue-Server 并重新加载 Chrome 扩展。**

### 3.1 验证扩展代码自修改 (`evolve_extension`)
1. 在 Web Console 提交任务：`请帮我修改 chromevideo/content.js 文件，在文件最顶部加一行 console.log('[Evolution Test]');，使用 evolve_extension 动作。`
2. **期望结果**：
   - AI 输出动作 `evolve_extension`。
   - Queue-Server 的 `evolveExecutor` 执行写入，并备份原文件为 `.bak`。
   - Queue-Server 通过 WebSocket 发送 `reload_extension` 指令。
   - 观察 Chrome 扩展管理页，扩展自动刷新；打开 DeepSeek 网页控制台，能看到新的打印信息 `[Evolution Test]`。

### 3.2 验证 Handler 自修改 (`evolve_handler`)
1. 在 Web Console 提交任务：`请使用 evolve_handler 动作修改 queue-server/custom-handler.js。请在 processTask 函数里，将最后返回的字符串前面加上 "[Evolved]" 前缀。`
2. **期望结果**：
   - AI 输出动作 `evolve_handler`。
   - 文件被修改。
   - 运行 Queue-Server 的终端中，`nodemon` 会检测到文件变化并自动重启服务。
   - 再次提交一个普通聊天任务，确认发送到 DeepSeek 的消息带上了 `[Evolved]` 前缀。

### 3.3 验证自动进化触发机制
1. **人为制造故障**：手动打开 `chromevideo/controllers/prompt-controller.js`，把 `const input = document.querySelector('#chat-input')...` 改成一个绝对找不到的选择器，例如 `document.querySelector('#fake-error-id')`。
2. 在 Chrome 中重新加载扩展。
3. 在 Web Console 提交任意普通任务。
4. **期望结果**：
   - 扩展找不到输入框，不会静默失败，而是抛出异常并发送 `auto_evolve`。
   - 观察 Web Console 的任务列表，会**自动新增一个任务**：“[自动进化任务] 系统检测到以下问题需要修复...”。
   - 系统自动将该故障提交给 DeepSeek，AI 开始阅读报错上下文并尝试生成修复代码。

## 4. 已知限制
- Node 端的服务重启依赖开发环境下的 `nodemon`，如果是生产环境运行（如 pm2/systemd），需要确保其监控配置正确。
- `evolveExecutor` 目前只有最基础的语法树检查，若代码逻辑存在死循环，依然可能导致扩展或服务端卡死。这需要更完善的沙箱隔离或多版本回滚机制。
