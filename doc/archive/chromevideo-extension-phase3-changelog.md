# ChromeVideo 扩展功能阶段 3 变更与验证清单

## 1. 本阶段新增功能概述
阶段 3（Agent 层实现）主要将本地 Server 从单纯的任务队列升级为了智能体引擎，使 DeepSeek 能够读取本地文件、执行命令和修改代码。

- **动作解析 (`action-parser.js`)**：从 AI 的回复文本中提取出 JSON 格式的 `<ActionBlock>` 动作指令。
- **本地执行器 (`evolution/*-executor.js`)**：
  - `file-executor`: 提供 `read_file`、`write_file`、`list_files` 等安全的文件操作（限制在工作区）。
  - `code-executor`: 提供基于 VM 沙箱的 `run_code` 以及包管理 `install_package`。
  - `system-executor`: 提供 `execute_command`、`get_system_info`，具备基础危险命令拦截。
- **执行引擎与路由 (`action-engine.js`)**：统管注册表分发，并调用 `confirm-manager.js` 拦截高危操作（当前设为测试放行）。
- **多轮对话编排 (`custom-handler.js` / `websocket/handler.js`)**：
  - 每次开启新任务时自动注入包含动作描述的 **系统指令前缀** (`system-prompt/template.js`)。
  - 拦截完成的任务，如果解析出动作，则在本地执行并将 `<ActionResult>` 反馈作为下一轮的 prompt 发给浏览器，直到轮次超限或没有新动作。

## 2. 变更文件清单
- **新增**:
  - `queue-server/actions/action-parser.js`
  - `queue-server/actions/action-engine.js`
  - `queue-server/actions/confirm-manager.js`
  - `queue-server/evolution/file-executor.js`
  - `queue-server/evolution/code-executor.js`
  - `queue-server/evolution/system-executor.js`
  - `queue-server/system-prompt/template.js`
- **修改**:
  - `queue-server/custom-handler.js` (核心修改：重写 processTask 和 processResult)
  - `queue-server/websocket/handler.js` (核心修改：task_update 中引入 processResult 分支和多轮调度)

## 3. 测试验证步骤

阶段 3 的逻辑全部在 Node 端，因此**不需要重启浏览器扩展**，只需重启 `queue-server`。

### 3.1 验证系统指令注入
1. 在 Web Console 提交一个新任务：`你是谁？你能做什么？`
2. 观察 Web IDE 或浏览器的输入框。
3. **期望结果**：输入框中会自动包含一大段以 `[SYSTEM CONTEXT]` 开头的说明，告诉 AI 它可以执行 `read_file` 等操作，然后以 `---` 分隔，最后是你的提问。

### 3.2 验证文件读取与多轮反馈
1. 提交任务：`请帮我看看 queue-server/package.json 里面有哪些依赖，使用 read_file 动作。`
2. **期望结果**：
   - AI 的第一轮回复中会输出一个带有 `{"action": "read_file", "params": {"path": "queue-server/package.json"}}` 的 JSON 代码块。
   - `queue-server` 控制台打印 `[ActionEngine] Executing action: read_file`。
   - 系统自动生成包含 `package.json` 内容的 `<ActionResult>` 并再次发给 DeepSeek（注意观察浏览器，会有第二轮输入）。
   - 最终任务状态变为 `completed`，结果区域显示 AI 对 `package.json` 的最终分析。

### 3.3 验证代码沙箱执行
1. 提交任务：`请使用 run_code 动作计算 1 到 100 的累加和，并告诉我结果。`
2. **期望结果**：
   - AI 构造 JS 代码并通过 `run_code` 执行。
   - `queue-server` 沙箱执行成功，返回结果。
   - AI 根据反馈结果告诉你 `5050`。

### 3.4 验证安全限制 (选做)
1. 提交任务：`使用 read_file 读取 /etc/passwd。`
2. **期望结果**：执行器返回 `Path outside workspace`，并在下一轮反馈给 AI。

## 4. 已知限制
- **确认机制 UI**：目前 `confirm-manager.js` 为了测试方便默认 `autoConfirm: true`，实际使用应将请求发给 Web 控制台并弹出确认框。
- **扩展动作闭环**：`switch_session`、`upload_screenshot` 等扩展端指令在阶段 3 仅派发给客户端，尚未完全串联回调结果收集。这将在下一阶段（阶段 4：进化层与整体集成）中打通。
