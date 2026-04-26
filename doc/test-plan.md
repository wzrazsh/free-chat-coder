# free-chat-coder 完整功能测试方案

本文档用于指导一次可执行、可复盘的功能验证。测试目标是使用 `chrome-devtools-mcp` 打开 Chrome，对 `free-chat-coder` 的 Queue Server、Web Console、Chrome 扩展、DeepSeek 页面交互、WebSocket 通信、审批流、附件上传和本地 Native Host 能力进行完整验证。

## 一、测试目标

1. 验证本地服务可以启动、健康检查正常、端口发现逻辑可用。
2. 验证 Chrome 扩展可以加载，Side Panel、Popup、Offscreen、Content Script 和 Service Worker 正常协同。
3. 验证 DeepSeek 页面自动化链路可用，包括页面注入、输入、发送、回复读取、会话切换和附件上传。
4. 验证 Queue Server 的 HTTP、WebSocket、任务队列、会话同步和审批流程。
5. 验证 Web Console 可以查看会话、任务、审批、Transcript，并能直接调用 API。
6. 验证失败场景、持久化、安全边界和浏览器刷新/重载后的恢复能力。

## 二、测试环境

### 依赖

- Node.js 16+
- Chrome / Chromium
- 项目依赖已安装：
  - `queue-server/node_modules`
  - `web-console/node_modules`
- **[新增] chrome-devtools-mcp**：CLine 使用的 MCP 服务，负责打开和管理 Chrome 浏览器。无需手动安装，由 CLine 自动加载。
- **[新增] playwright-mcp-config.json**（可选）：旧版 Playwright 配置，仅作为备用。测试优先使用 chrome-devtools-mcp。
- 如需验证真实 DeepSeek 交互，测试浏览器需要已登录 `https://chat.deepseek.com/`

### 建议启动命令

```bash
# 1. 先关闭所有 Chrome 进程（避免端口冲突）
taskkill /F /IM chrome.exe  2>nul || echo Chrome not running

# 2. 启动 Queue Server（终端 1）
cd queue-server
npm run dev

# 3. 启动 Web Console（终端 2）
cd ../web-console
npm run dev
```

> **Chrome 启动方式**：不再手动启动 Chrome，而是通过 CLine 的 **chrome-devtools-mcp** 工具自动管理。测试执行者在 CLine 中依次使用 MCP 工具（`navigate_page`、`click`、`take_snapshot` 等）操作浏览器（详见"附：MCP 工具速查"）。

### 常用地址

- Web Console: `http://localhost:5173`
- Queue Server 健康检查：`http://localhost:8080/health` 或实际 fallback 端口
- DeepSeek: `https://chat.deepseek.com/`
- Chrome 扩展管理页：`chrome://extensions`（通过 MCP 的 `navigate_page` 访问）
- Queue Server 日志端口：在终端 1 中查看实际绑定的端口号

## 三、测试记录标准

每个用例执行时都应记录：

- 用例 ID
- 执行时间
- 执行环境
- 实际结果
- 是否通过
- 截图路径
- Console 错误
- Network 错误
- 关联日志文件

建议统一格式：

| 用例 ID | 结果 | 实际表现 | 截图 | 日志 | 备注 |
|---|---|---|---|---|---|
| TC-ENV-001 | PASS / FAIL |  |  |  |  |

## 四、冒烟测试

完整测试前先执行 10-15 分钟冒烟测试。冒烟失败时暂停完整测试，优先修复环境或启动链路问题。

### TC-SMOKE-001：基础链路验证

**步骤**

1. 执行 `node validate-environment.js`。
2. 启动 Queue Server。
3. 启动 Web Console。
4. 打开 `http://localhost:5173`。
5. 加载 Chrome 扩展。
6. 打开 DeepSeek 页面并确认 Side Panel 可见。
7. 发送一条简单消息。
8. 确认 WebSocket 连接正常。
9. 确认 Web Console 能看到任务状态或会话状态。

**预期结果**

- 环境检查无阻塞错误。
- Web Console 页面加载无白屏。
- Queue Server 健康检查返回 `status: ok`。
- Side Panel 显示在线或可重连状态。
- 无持续 Console 错误。

## 五、环境验证测试用例

### TC-ENV-001：环境检查脚本

**步骤**

1. 在项目根目录执行 `node validate-environment.js`。
2. 记录输出中的扩展 ID、Native Host manifest、Queue Server 端口、Web Console 端口和 DeepSeek 登录态提示。

**预期结果**

- 脚本可以正常完成。
- 如果存在阻塞项，输出明确修复建议。
- 不出现未捕获异常。

### TC-ENV-002：Queue Server 健康检查

**步骤**

1. 启动 Queue Server。
2. 访问 `/health`。
3. 记录返回 JSON。

**预期结果**

- 返回 HTTP 200。
- JSON 包含 `status`、`service`、`port`、`preferredPort`。
- `status` 为 `ok`。

### TC-ENV-003：端口 fallback 验证

**步骤**

1. 占用首选 Queue Server 端口。
2. 启动 Queue Server。
3. 查看日志和 `/health` 返回端口。

**预期结果**

- 服务自动选择候选端口。
- 日志提示首选端口不可用。
- Web Console 和扩展可发现实际端口。

## 六、使用 chrome-devtools-mcp 执行测试的通用流程

在执行后续涉及浏览器操作的测试用例（Section 七～十八）之前，请先熟悉以下使用 chrome-devtools-mcp 的通用操作流程。

### MCP 工具调用方式

1. **在 CLine 中发起 MCP 工具调用**：CLine 会自动调用 chrome-devtools-mcp 提供的工具（`navigate_page`、`take_snapshot`、`click`、`fill`、`type_text` 等）来操作 Chrome 浏览器。
2. **获取页面元素**：使用 `take_snapshot` 获取当前页面的 DOM 快照，其中包含每个可交互元素的 `uid` 和选择器信息，后续操作依赖这些 `uid`。
3. **执行交互**：通过 `click`（传入 uid）点击元素，通过 `fill` 或 `type_text` 输入文本，通过 `navigate_page` 跳转到指定 URL。

### 常用操作示例

| 操作 | MCP 工具 | 说明 |
|---|---|---|
| 打开 DeepSeek | `navigate_page` | 导航到 `https://chat.deepseek.com/` |
| 打开扩展管理页 | `navigate_page` | 导航到 `chrome://extensions` |
| 获取页面快照 | `take_snapshot` | 获取当前页面的 DOM + 所有可交互元素 uid |
| 点击元素 | `click` | 传入 target uid 进行点击 |
| 填写输入框 | `fill` | 传入 target uid + 文本值 |
| 输入文本 | `type_text` | 逐字符输入（用于复杂输入框） |
| 列出页面 | `list_pages` | 列出所有已打开的标签页 |
| 切换页面 | `select_page` | 按页面 ID 切换焦点 |
| 读取页面文本（获取回复） | `take_snapshot` | 通过快照读取 AI 回复内容 |

### 重要注意事项

1. **Side Panel 触发**：Chrome Side Panel API 要求必须由用户交互触发。打开 DeepSeek 页面后，通过 `click` 点击页面任意位置触发 `auto-open-sidepanel.js`。
2. **快照是核心**：`take_snapshot` 返回的 DOM 快照包含了元素 uid，后续所有 `click`/`fill` 操作都需要通过 uid 定位元素。
3. **连接状态**：如果 MCP 工具报错 "No connection found"，说明 Chrome 未正确启动或被关闭，需要通过 CLine 重新启动 chrome-devtools-mcp 连接。
4. **截图保存**：使用 `take_snapshot` 获取页面状态截图，测试报告需包含这些截图。

### chrome-devtools-mcp 可用工具列表

以下是 chrome-devtools-mcp 提供的主要工具，各测试用例中会引用这些工具名：

- `{mcp_prefix}navigate_page` — 导航到指定 URL
- `{mcp_prefix}take_snapshot` — 获取当前页面快照（含元素 uid）
- `{mcp_prefix}click` — 点击指定 uid 元素
- `{mcp_prefix}fill` — 填入文本（清除已有内容后填入）
- `{mcp_prefix}type_text` — 逐字符输入文本
- `{mcp_prefix}list_pages` — 列出所有页面
- `{mcp_prefix}select_page` — 切换活动页面
- `{mcp_prefix}get_page_html` — 获取页面 HTML（备用）
- `{mcp_prefix}scroll` — 页面滚动
- `{mcp_prefix}set_viewport` — 设置视口尺寸
- `{mcp_prefix}evaluate_javascript` — 执行 JavaScript 并返回结果

> 注：`{mcp_prefix}` 是 CLine 环境中 chrome-devtools-mcp 的工具名前缀，具体可在 CLine 中通过 `use_mcp_tool` 查看实际工具名称。

## 七、Chrome 扩展和 Side Panel 测试用例

### TC-SIDE-001：扩展加载状态

**步骤**

1. 打开 `chrome://extensions`。
2. 开启开发者模式。
3. 加载 `chromevideo/` 目录。
4. 检查扩展名称、版本和错误状态。

**预期结果**

- 扩展名称为 `DeepSeek Agent Bridge`。
- 版本与 `chromevideo/manifest.json` 一致。
- 无 manifest 解析错误或 service worker 启动错误。

### TC-SIDE-002：DeepSeek 页面自动打开 Side Panel

**步骤**

1. 打开 `https://chat.deepseek.com/`。
2. 点击页面任意位置，触发 `auto-open-sidepanel.js`。
3. 观察 Side Panel 是否打开。
4. 截图保存。

**预期结果**

- DeepSeek 页面点击后 Side Panel 自动打开。
- Side Panel 页面为 `sidepanel.html`。
- 页面不应重复打开多个 Side Panel。

### TC-SIDE-003：Side Panel 主界面加载

**步骤**

1. 打开 Side Panel。
2. 使用 DevTools snapshot 检查 DOM。
3. 验证以下元素存在：
   - `#main-view`
   - `#conn-dot`
   - `#conn-text`
   - `#log-area`
   - `#chat-input`
   - `#btn-send`
   - `#btn-attach`

**预期结果**

- 主界面正常加载。
- 欢迎提示可见。
- 输入框和按钮可交互。

### TC-SIDE-004：连接状态显示

**步骤**

1. Queue Server 运行时打开 Side Panel。
2. 检查 `#conn-dot` 和 `#conn-text`。
3. 停止 Queue Server。
4. 等待 5 秒后再次检查连接状态。

**预期结果**

- 服务运行时显示在线状态。
- 服务停止后显示离线或重连状态。
- 页面不崩溃。

### TC-SIDE-005：会话列表展示

**步骤**

1. 打开 Side Panel。
2. 检查 `#conversation-list`、`#conversation-strip-meta`。
3. 如无会话，检查 `#conversation-empty`。
4. 创建或同步一个会话后再次检查列表。

**预期结果**

- 无会话时显示空态。
- 有会话时显示会话芯片。
- 会话数量与 `#conversation-strip-meta` 一致。

### TC-SIDE-006：新建会话

**步骤**

1. 点击 `#create-conversation`。
2. 等待 1 秒。
3. 检查 `#conversation-list` 数量。
4. 记录新会话是否激活。

**预期结果**

- 会话数量增加。
- 新会话可被选中或自动激活。
- 不影响原有会话。

### TC-SIDE-007：会话删除

**步骤**

1. 准备至少 2 个会话。
2. 悬停非激活会话芯片。
3. 点击删除按钮。
4. 检查会话数量和当前激活会话。

**预期结果**

- 删除按钮只在合适状态出现。
- 被删除会话从 DOM 中移除。
- 当前激活会话不会被误删。

### TC-SIDE-008：快速/专家模式切换

**步骤**

1. 检查 `.mode-selector`。
2. 点击 `.mode-option[data-mode="quick"]`。
3. 验证快速模式按钮获得 `.active`。
4. 点击 `.mode-option[data-mode="expert"]`。
5. 验证专家模式按钮获得 `.active`。

**预期结果**

- 模式按钮切换状态正确。
- UI 反馈清晰。
- 切换后后续发送消息使用对应模式。

## 八、消息交互测试用例

### TC-CHAT-001：文本消息发送

**步骤**

1. 在 `#chat-input` 输入 `测试消息 TC-CHAT-001`。
2. 检查 `#btn-send` 是否可点击。
3. 点击发送。
4. 等待消息出现在 `#log-area`。

**预期结果**

- 用户消息出现在日志区域。
- 消息气泡具有 `.msg-user` 类。
- 内容包含输入文本。

### TC-CHAT-002：Enter 发送

**步骤**

1. 在 `#chat-input` 输入 `测试 Enter 发送`。
2. 按 Enter。
3. 检查是否发送成功。

**预期结果**

- Enter 触发发送。
- 输入框清空或进入等待状态。
- 日志中出现用户消息。

### TC-CHAT-003：Markdown 格式化显示

**步骤**

1. 发送：`请用 Markdown 格式回复，包括一个 JavaScript 代码块`。
2. 等待 AI 回复出现。
3. 检查 `.msg-ai:last-child` 内是否包含 `pre` 和 `code`。

**预期结果**

- AI 回复使用 `.msg-ai` 气泡展示。
- 代码块被 `<pre><code>` 包裹。
- 代码字体为等宽字体。

### TC-CHAT-004：AI 思考过程显示

**步骤**

1. 发送一个需要推理的问题。
2. 等待回复完成。
3. 检查是否存在 `.ai-thought`。
4. 如存在，点击展开。

**预期结果**

- 思考过程显示在 `.ai-thought` 中。
- 默认可折叠。
- 展开/折叠状态正确。

### TC-CHAT-005：打字指示器动画

**步骤**

1. 发送一条复杂问题。
2. 立即截图或 snapshot。
3. 检查 `.typing-indicator` 和内部圆点。
4. 回复完成后再次检查。

**预期结果**

- 等待回复期间显示打字指示器。
- 回复完成后指示器消失。
- 不残留重复指示器。

### TC-CHAT-006：历史消息滚动

**步骤**

1. 准备多条消息。
2. 记录 `#log-area` 的 `scrollTop` 和 `scrollHeight`。
3. 滚动到顶部。
4. 再滚动到底部。

**预期结果**

- 消息区域可以滚动。
- 旧消息和新消息都能正确查看。
- 滚动过程中布局不抖动。

## 九、附件上传测试用例

### TC-FILE-001：附件按钮点击

**步骤**

1. 检查 `#btn-attach` 按钮。
2. 点击附件按钮。
3. 检查隐藏的 `#file-input` 是否被触发。

**预期结果**

- 文件选择流程被触发。
- 不出现 JS 错误。

### TC-FILE-002：单文件上传

**步骤**

1. 使用自动化工具上传一个 `.txt` 文件。
2. 等待 1 秒。
3. 检查 `#attachment-preview`。

**预期结果**

- 出现 `.attachment-preview-item`。
- 显示文件名、文件大小和删除按钮。

### TC-FILE-003：多文件上传

**步骤**

1. 上传第一个测试文件。
2. 上传第二个测试文件。
3. 检查预览区附件数量。

**预期结果**

- 多个附件都出现在预览区。
- 顺序与上传顺序一致。
- 每个附件有独立删除按钮。

### TC-FILE-004：附件删除

**步骤**

1. 上传至少一个附件。
2. 记录附件数量。
3. 点击第一个附件的删除按钮。
4. 再次记录附件数量。

**预期结果**

- 附件数量减少 1。
- 删除操作不影响其他附件。

### TC-FILE-005：附件随消息发送

**步骤**

1. 上传一个 `.txt` 文件。
2. 输入 `请读取这个文件`。
3. 点击发送。
4. 等待回复。

**预期结果**

- 消息气泡显示附件相关信息。
- 附件被随消息提交。
- AI 可以读取或明确反馈附件处理状态。

## 十、审批流程测试用例

### TC-APPROVE-001：审批区域显示

**步骤**

1. 触发一个需要审批的动作。
2. 检查 `#approval-strip`。
3. 检查 `#approval-count` 和 `#approval-list`。

**预期结果**

- 有待审批动作时 `#approval-strip` 可见。
- 审批数量正确。
- 无审批时显示空态或隐藏审批区域。

### TC-APPROVE-002：审批卡片内容

**步骤**

1. 获取 `#approval-list` 中第一张卡片。
2. 检查动作名称、风险等级、元信息、参数详情和操作按钮。

**预期结果**

- 显示动作类型，例如 `write_file` 或命令执行类动作。
- 显示风险等级。
- 显示目标路径或参数。
- 有批准和拒绝按钮。

### TC-APPROVE-003：批准操作

**步骤**

1. 记录当前审批数量。
2. 点击批准按钮。
3. 等待 1 秒。
4. 再次检查审批数量。

**预期结果**

- 审批数量减少。
- 相关动作继续执行。
- 日志显示审批结果。

### TC-APPROVE-004：拒绝操作

**步骤**

1. 记录当前审批数量。
2. 点击拒绝按钮。
3. 等待 1 秒。
4. 再次检查审批数量和副作用。

**预期结果**

- 审批数量减少。
- 被拒绝动作不得执行。
- 日志显示拒绝结果。

## 十一、Web Console 测试用例

### TC-WEB-001：主界面加载

**步骤**

1. 打开 `http://localhost:5173`。
2. 等待页面加载完成。
3. 检查 header、统计卡片、Conversations、Pending Approvals、Transcript、New Task、API Tester 区域。

**预期结果**

- 页面加载无白屏。
- 主界面元素完整。
- Queue 端口和 WS 状态显示正常。

### TC-WEB-002：Queue Server 连接状态

**步骤**

1. Queue Server 启动时打开 Web Console。
2. 检查页面顶部 Queue 端口和 `WS online`。
3. 停止 Queue Server。
4. 等待页面状态变化。

**预期结果**

- 在线时显示 `WS online`。
- 断开后显示 `WS offline`。
- 页面仍可操作，不崩溃。

### TC-WEB-003：会话列表展示

**步骤**

1. 确保存在扩展会话。
2. 在 Conversations 区域选择会话。
3. 检查会话标题、ID、预览和更新时间。

**预期结果**

- 会话列表按更新时间展示。
- 点击会话后 Transcript 区域切换。
- 当前会话高亮。

### TC-WEB-004：Transcript 查看

**步骤**

1. 选择一个有消息的会话。
2. 检查 Transcript 消息列表。
3. 验证 role、seq、createdAt、source 和 content。

**预期结果**

- 消息历史完整展示。
- 长文本可滚动查看。
- 不出现文本溢出破坏布局。

### TC-WEB-005：新任务提交

**步骤**

1. 在 New Task 输入框输入测试任务。
2. 点击提交按钮。
3. 观察任务状态和会话记录。

**预期结果**

- 新任务可以提交。
- Queue Server 收到请求。
- UI 显示状态变化或反馈。

### TC-WEB-006：API Tester

**步骤**

1. 在 API Tester 中选择 GET。
2. 输入 `/health`。
3. 点击 Run。
4. 查看 Response 区域。

**预期结果**

- 返回 HTTP 200。
- Response 显示 status、headers 和 body。
- 错误请求有明确错误提示。

### TC-WEB-007：Pending Approvals

**步骤**

1. 触发待审批动作。
2. 在 Web Console 查看 Pending Approvals。
3. 分别验证批准和拒绝按钮。

**预期结果**

- 审批项可见。
- 参数展示清晰。
- 审批响应能回传 Queue Server。

## 十二、WebSocket 通信测试用例

### TC-WS-001：WebSocket 连接建立

**步骤**

1. 打开浏览器 DevTools Network 面板。
2. 刷新 Side Panel 或 Web Console。
3. 查找 WebSocket 连接。
4. 检查状态码和连接 URL。

**预期结果**

- WebSocket 成功建立。
- 状态为 `101 Switching Protocols`。
- 连接到 Queue Server 实际端口。

### TC-WS-002：实时消息推送

**步骤**

1. 在 Side Panel 发送消息。
2. 观察 WebSocket 发送帧。
3. 等待 AI 回复或服务端响应。
4. 观察 WebSocket 接收帧。

**预期结果**

- 发送和接收都有数据帧。
- 数据格式为 JSON。
- 前端状态随事件更新。

### TC-WS-003：断线重连

**步骤**

1. 保持 Side Panel 或 Web Console 已连接。
2. 停止 Queue Server。
3. 等待 5 秒。
4. 重启 Queue Server。
5. 观察连接状态是否恢复。

**预期结果**

- 断开时状态变为离线。
- 自动尝试重连。
- 重连成功后恢复在线状态。

## 十三、设置页面测试用例

### TC-SET-001：设置视图切换

**步骤**

1. 点击 `#btn-settings`。
2. 检查 `#main-view` 和 `#settings-view`。
3. 截图保存。

**预期结果**

- 主视图隐藏。
- 设置视图显示。
- 切换动画平滑。

### TC-SET-002：服务状态卡片

**步骤**

1. 打开设置视图。
2. 检查 `#service-workbench`。
3. 记录 Queue Server、Web Console、Native Host 状态。

**预期结果**

- 每个服务都有状态指示。
- 运行中和停止状态视觉区分明确。
- 状态与实际进程一致。

### TC-SET-003：返回主视图

**步骤**

1. 在设置页点击 `#btn-back`。
2. 检查 `#settings-view` 和 `#main-view`。

**预期结果**

- 设置视图隐藏。
- 主视图恢复显示。
- 原有连接和输入状态保持一致。

## 十四、DeepSeek Web Provider 测试用例

### TC-PROVIDER-001：登录态采集

**步骤**

1. 确认浏览器已登录 DeepSeek。
2. 执行 `node scripts/onboard-deepseek-web.js --profile .browser-profile`。
3. 检查 `queue-server/data/deepseek-web-auth.json`。

**预期结果**

- 登录态采集成功。
- 终端输出脱敏摘要。
- 不在日志中泄露完整 token。

### TC-PROVIDER-002：服务端直连调用

**步骤**

1. 确认 `deepseek-web` provider 配置可用。
2. 提交一条文本任务。
3. 观察 Queue Server 日志。

**预期结果**

- 服务端直连 DeepSeek Web 内部接口。
- 返回内容能被解析并写入会话。
- 失败时有明确错误分类。

### TC-PROVIDER-003：DOM Provider 回退

**步骤**

1. 让 `deepseek-web` provider 不可用或禁用。
2. 使用 `extension-dom` 路径提交任务。
3. 观察扩展是否执行页面输入和发送。

**预期结果**

- DOM 自动化链路可作为回退。
- Queue Server 任务状态清晰。
- 页面交互结果能回传。

## 十五、Native Host 测试用例

### TC-NATIVE-001：安装脚本

**步骤**

1. 执行 `node chromevideo/host/install_host.js`。
2. 检查 Native Messaging manifest 安装路径。
3. 再次执行 `node validate-environment.js`。

**预期结果**

- manifest 安装成功。
- 扩展 ID 与 manifest 中允许来源一致。
- 环境检查通过。

### TC-NATIVE-002：安装接口参数校验

**步骤**

1. 向 `/install-native-host` 提交非法 `extensionId`。
2. 向 `/install-native-host` 提交合法 `extensionId`。

**预期结果**

- 非法 ID 返回 HTTP 400。
- 合法 ID 才会执行安装脚本。
- 错误响应不泄露敏感路径之外的信息。

### TC-NATIVE-003：本地服务启停

**步骤**

1. 通过扩展设置页或 Native Host 能力触发服务启动。
2. 检查 Queue Server/Web Console 进程状态。
3. 触发停止。
4. 再次检查状态。

**预期结果**

- 启停动作反馈明确。
- 状态卡片与实际进程一致。
- 失败时有错误提示。

## 十六、失败场景测试用例

### TC-ERR-001：Queue Server 未启动时 Side Panel 状态

**预期结果**

- 连接状态显示离线。
- 不应出现 JS 报错导致页面崩溃。
- 应有重连或错误提示。

### TC-ERR-002：Web Console 无法连接 Queue Server

**预期结果**

- 页面仍可加载。
- 显示连接失败状态。
- 不出现白屏。

### TC-ERR-003：DeepSeek 未登录状态

**预期结果**

- 系统能识别未登录。
- 不应继续提交真实任务。
- 提示用户完成登录。

### TC-ERR-004：附件过大或非法类型

**预期结果**

- 明确拒绝或提示。
- 不应卡死。
- 不应破坏已选附件列表。

### TC-ERR-005：Queue Server 请求返回 500

**预期结果**

- Web Console 和 Side Panel 显示错误。
- 任务状态进入失败态。
- 日志保留足够上下文。

## 十七、数据持久化测试用例

### TC-PERSIST-001：刷新 Side Panel 后会话保持

**步骤**

1. 创建新会话。
2. 发送消息。
3. 刷新 Side Panel。
4. 检查会话和消息是否恢复。

**预期结果**

- 会话仍存在。
- 消息历史可查看。
- 当前会话状态合理恢复。

### TC-PERSIST-002：重启 Queue Server 后任务记录保持

**步骤**

1. 创建任务。
2. 停止 Queue Server。
3. 重启 Queue Server。
4. 打开 Web Console 检查任务记录。

**预期结果**

- 已持久化的会话和消息仍可查询。
- 任务状态不被错误重置。

### TC-PERSIST-003：Web Console 刷新后状态恢复

**步骤**

1. 打开 Web Console 并选择一个会话。
2. 刷新页面。
3. 检查会话列表、Transcript 和连接状态。

**预期结果**

- 页面恢复到可用状态。
- 不出现空白或重复数据。

## 十八、安全边界测试用例

### TC-SEC-001：未审批动作不得执行

**预期结果**

- 需要审批的写文件或执行命令动作必须进入审批队列。
- 拒绝后不得产生副作用。
- 超时后按拒绝处理。

### TC-SEC-002：路径越界保护

**预期结果**

- 不允许写入非预期目录。
- 不允许通过 `../` 绕过路径限制。
- 风险路径需要明确审批或拒绝。

### TC-SEC-003：Native Host 安装接口参数校验

**预期结果**

- 非法 `extensionId` 返回 400。
- 不应执行安装脚本。
- 日志记录非法请求但不泄露敏感信息。

### TC-SEC-004：敏感信息脱敏

**预期结果**

- DeepSeek token、cookie、authorization header 不应完整出现在日志和 UI 中。
- 测试报告只记录脱敏摘要。

## 十九、浏览器兼容和刷新测试用例

### TC-BROWSER-001：扩展重新加载后功能恢复

**步骤**

1. 打开 `chrome://extensions`。
2. 重新加载扩展。
3. 回到 DeepSeek 页面。
4. 检查 Side Panel、WebSocket、会话状态。

**预期结果**

- 扩展重新加载后可恢复。
- Side Panel 可以重新打开。
- 连接状态最终正确。

### TC-BROWSER-002：DeepSeek 页面刷新后 content script 恢复

**步骤**

1. 刷新 DeepSeek 页面。
2. 检查 content script 是否重新注入。
3. 检查 Side Panel 是否仍能操作页面。

**预期结果**

- Content script 自动恢复。
- 页面输入、发送、读取能力可用。

### TC-BROWSER-003：Web Console 移动宽度检查

**步骤**

1. 将浏览器视口调整到移动宽度。
2. 检查统计卡片、三栏布局、API Tester 和 Transcript。

**预期结果**

- 不出现文本重叠。
- 横向滚动只在必要区域出现。
- 按钮和输入区域仍可操作。

## 二十、执行顺序建议

```text
Phase 1: 冒烟测试（10-15 分钟）
  TC-SMOKE-001

Phase 2: 环境验证（5 分钟）
  TC-ENV-001 -> TC-ENV-002 -> TC-ENV-003

Phase 3: Web Console 与 Queue Server（15 分钟）
  TC-WEB-001 -> TC-WEB-002 -> TC-WEB-003 -> TC-WEB-004
  TC-WEB-005 -> TC-WEB-006 -> TC-WEB-007

Phase 4: Chrome 扩展与 Side Panel（15 分钟）
  TC-SIDE-001 -> TC-SIDE-002 -> TC-SIDE-003 -> TC-SIDE-004
  TC-SIDE-005 -> TC-SIDE-006 -> TC-SIDE-007 -> TC-SIDE-008

Phase 5: 核心交互（20 分钟）
  TC-CHAT-001 -> TC-CHAT-002 -> TC-CHAT-003
  TC-CHAT-004 -> TC-CHAT-005 -> TC-CHAT-006
  TC-FILE-001 -> TC-FILE-002 -> TC-FILE-003 -> TC-FILE-004 -> TC-FILE-005

Phase 6: 审批、WebSocket、设置（15 分钟）
  TC-APPROVE-001 -> TC-APPROVE-002 -> TC-APPROVE-003 -> TC-APPROVE-004
  TC-WS-001 -> TC-WS-002 -> TC-WS-003
  TC-SET-001 -> TC-SET-002 -> TC-SET-003

Phase 7: Provider、Native Host、异常和安全（20 分钟）
  TC-PROVIDER-001 -> TC-PROVIDER-002 -> TC-PROVIDER-003
  TC-NATIVE-001 -> TC-NATIVE-002 -> TC-NATIVE-003
  TC-ERR-* -> TC-PERSIST-* -> TC-SEC-* -> TC-BROWSER-*
```

建议先执行冒烟测试，再执行 Web Console + Queue Server，再执行 Chrome Extension Side Panel，最后执行 DeepSeek 真实交互、附件和审批流。这样更容易快速定位问题。

## 二十一、测试输出物

完整测试执行后建议产出：

1. `test-report.md`
2. 截图目录：`test-artifacts/screenshots/`
3. Console 日志：`test-artifacts/console.log`
4. Network 记录：`test-artifacts/network.har`
5. 失败问题清单：`test-artifacts/bugs.md`

### 测试报告模板

```md
# free-chat-coder 功能测试报告

## 环境

- 日期：
- 操作系统：
- Chrome 版本：
- Queue Server 端口：
- Web Console 地址：
- 扩展 ID：
- DeepSeek 登录态：

## 总览

| 分类 | 总数 | 通过 | 失败 | 阻塞 | 备注 |
|---|---:|---:|---:|---:|---|
| 冒烟测试 |  |  |  |  |  |
| 环境验证 |  |  |  |  |  |
| Side Panel |  |  |  |  |  |
| 消息交互 |  |  |  |  |  |
| 附件上传 |  |  |  |  |  |
| 审批流程 |  |  |  |  |  |
| Web Console |  |  |  |  |  |
| WebSocket |  |  |  |  |  |
| 设置页面 |  |  |  |  |  |
| 异常/安全/持久化 |  |  |  |  |  |

## 失败问题

### BUG-001：标题

- 严重级别：P1 / P2 / P3
- 复现步骤：
- 预期结果：
- 实际结果：
- 截图：
- 日志：
- 初步判断：
```

## 二十二、更新记录

- 2026-04-25：创建测试方案。
- 2026-04-25：补充冒烟测试、失败标准、失败场景、持久化、安全边界、浏览器兼容和输出物格式。
- 2026-04-25：整理为完整可执行测试方案，覆盖 Queue Server、Web Console、Chrome 扩展、DeepSeek Provider、Native Host、审批和 WebSocket。
- 2026-04-26：调整测试环境配置，用 chrome-devtools-mcp 替代 Playwright 管理 Chrome；新增"使用 chrome-devtools-mcp 执行测试的通用流程"章节（Section 六），包含工具调用方式、常用操作示例、注意事项和工具列表；更新依赖说明和启动命令；修正后续章节编号。
