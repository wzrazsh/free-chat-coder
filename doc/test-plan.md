# free-chat-coder 全量回归测试模板

> **使用说明**：本文档作为功能新增、Bug 修复后的全量回归测试模板。每次进行发版或重大合并前，请复制此模板（或直接在副本上修改）并逐项填写测试结果，生成本次发版的测试报告。

## 一、本次测试概览

- **测试版本/Commit**：[填写版本号或 Commit Hash]
- **测试日期**：[YYYY-MM-DD]
- **测试人员**：[填写测试人]
- **本次变更说明**：
  - [新增功能] [简述新增的特性]
  - [Bug 修复] [简述修复的缺陷]
  - [重构优化] [简述重构影响的范围]

## 二、测试环境准备

在开始执行测试前，请确保测试环境已按以下检查项准备就绪：

- [ ] Node.js 16+ 环境就绪。
- [ ] 依赖已安装 (`queue-server` 和 `web-console` 的 `node_modules` 已就绪)。
- [ ] 确保无残留 Chrome 进程 (`taskkill /F /IM chrome.exe`)，防止端口冲突。
- [ ] 已启动 Queue Server (`cd queue-server && npm run dev`)。
- [ ] 已启动 Web Console (`cd web-console && npm run dev`)。
- [ ] 测试浏览器已登录 DeepSeek (`https://chat.deepseek.com/`)。
- [ ] CLine 的 `chrome-devtools-mcp` 已配置并可用（测试中需通过它执行自动化浏览器操作）。

---

## 三、新增特性与 Bug 修复专项验证

*(针对本次发版中专门新增的功能和修复的 Bug，在此补充专项验证点)*

| 验证项分类 | 验证点描述 / 执行步骤 | 预期结果 | 实际结果 | 测试结论 |
| --- | --- | --- | --- | --- |
| [Feature] 示例 | 1. 执行... 2. 观察... | 页面应显示... | | [ ] Pass [ ] Fail |
| [Bug] 示例 | 1. 触发... 2. 检查日志... | 不应再抛出 NPE | | [ ] Pass [ ] Fail |
| [其他] | | | | [ ] Pass [ ] Fail |

---

## 四、全量回归测试清单 (Checklist)

*(执行以下核心业务链路全量回归，确保原有功能未受破坏。若对具体执行步骤有疑问，请参考【附录：测试用例详细步骤参考】)*

### 1. 冒烟与环境测试 (Smoke & Env)
- [ ] **TC-ENV-001** 环境检查脚本：运行 `node validate-environment.js`，输出无报错，检查全绿。
- [ ] **TC-ENV-002** 健康检查：Queue Server 运行中，访问 `/health` 返回 200 且 JSON 包含 `status: ok`。
- [ ] **TC-SMOKE-001** 基础贯通：加载扩展后打开 DeepSeek，Side Panel 可见，简单消息收发正常，Web Console 能查到任务。

### 2. Chrome 扩展与 Side Panel (Side Panel)
- [ ] **TC-SIDE-001** 扩展加载：`chrome://extensions` 开发者模式加载无报错，Service Worker 正常启动。
- [ ] **TC-SIDE-002** 自动触发：打开 DeepSeek 页面并点击任意位置，Side Panel 自动展开。
- [ ] **TC-SIDE-003** 连接状态指示：Queue Server 启停时，右上角连接灯（绿/红）和文字（在线/离线）实时切换。
- [ ] **TC-SIDE-004** 会话列表管理：新建、切换、删除会话功能正常，无会话时显示空态提示。
- [ ] **TC-SIDE-005** 模式切换：快速/专家模式切换 UI 反馈明确，且后续消息使用对应模式发送。

### 3. 消息交互与展现 (Chat)
- [ ] **TC-CHAT-001** 文本收发：输入框输入内容，点击发送或按 Enter，日志区正确出现用户消息气泡。
- [ ] **TC-CHAT-002** Markdown 渲染：AI 回复包含代码块时，格式渲染正确，字体为等宽字体。
- [ ] **TC-CHAT-003** 思考过程展示：进行深度推理时，显示可折叠的 `.ai-thought` 面板，展开收起正常。
- [ ] **TC-CHAT-004** 打字指示器：等待回复期间有打字动画，回复完成后动画自动消失。
- [ ] **TC-CHAT-005** 滚动条行为：历史消息超出一屏时，滚动条行为正常，新消息到来时不抖动。

### 4. 附件上传功能 (File)
- [ ] **TC-FILE-001** 附件选择与预览：单选/多选文件后，预览区正常展示文件名和文件大小。
- [ ] **TC-FILE-002** 附件删除：点击预览区某附件的删除按钮，该附件被正确移除且不影响其他附件。
- [ ] **TC-FILE-003** 随消息发送：附带文件发送消息，AI 能成功读取附件内容并给出相关回复。

### 5. 审批流程与安全边界 (Approval & Security)
- [ ] **TC-APPROVE-001** 审批卡片展示：触发需审批的高危动作（如写文件）时，正确展示参数、风险等级及操作按钮。
- [ ] **TC-APPROVE-002** 批准与拒绝：点击批准后动作继续执行，点击拒绝后动作被拦截，审批列表数量正确扣减。
- [ ] **TC-SEC-001** 路径越界保护：不允许写入非预期目录，不允许通过 `../` 绕过路径限制（需进入审批流）。
- [ ] **TC-SEC-002** 数据持久化：刷新 Side Panel 或 Web Console，历史会话和记录保持不变；重启 Queue Server 后任务不丢失。

### 6. Web Console 控制台 (Web Console)
- [ ] **TC-WEB-001** 主界面加载：`http://localhost:5173` 加载无白屏，顶部 Queue 端口和 WS 状态显示正常。
- [ ] **TC-WEB-002** Transcript 查看：在会话列表中选择会话，Transcript 区域能加载完整的聊天记录流。
- [ ] **TC-WEB-003** API Tester：使用内置测试器发起 `/health` GET 请求，Response 区域正确渲染 HTTP 200 结果。
- [ ] **TC-WEB-004** 新任务提交：在 New Task 输入框提交任务，UI 有反馈，且能在会话记录中查看到。

---

## 五、测试发现缺陷记录 (Bug Report)

在本次回归测试中发现的任何缺陷（含原有功能退化或新功能 Bug），请记录在此处：

| Bug ID | 发现模块 | 缺陷描述与复现步骤 | 严重级别 | 截图/日志链接 | 修复状态 |
| --- | --- | --- | --- | --- | --- |
| BUG-001 | [例如：附件] | 1. 上传... 2. 报错... | P1 | `./artifacts/bug001.png` | [ ] 待修复 [ ] 已验证 |
| BUG-002 | | | | | [ ] 待修复 [ ] 已验证 |

---

## 六、测试结论

- **测试通过率**：__ / __
- **遗留缺陷数**：总计 __ (P0: _ , P1: _ , P2: _ )
- **最终发布结论**：
  - [ ] **🟢 通过 (Pass)**：所有用例通过，无阻塞或严重问题，达到发布标准。
  - [ ] **🟡 条件通过 (Conditional Pass)**：有遗留低优问题，但不影响核心链路，带病发布。
  - [ ] **🔴 不通过 (Fail)**：存在 P0/P1 阻塞问题，打回修复后需重新回归。

---
---

## 附录：测试用例详细步骤参考 (Test Case Reference)

> 本节仅作为上文 Checklist 执行时的详细步骤操作参考，不可修改。

<details>
<summary>点击展开：环境验证 (TC-ENV / TC-SMOKE) 详细步骤</summary>

- **TC-ENV-001**：在项目根目录执行 `node validate-environment.js`。期望输出清晰的扩展 ID、端口号及无阻塞报错。
- **TC-ENV-002**：启动 Queue Server 后，在浏览器或 API Tester 访问 `/health`。期望返回 HTTP 200，并包含 `status: ok`。
- **TC-SMOKE-001**：加载扩展后打开 DeepSeek 页面，侧边栏自动滑出。发送一条消息，验证 WebSocket 传输和 Web Console 状态同步是否均正常。

</details>

<details>
<summary>点击展开：Side Panel (TC-SIDE) 详细步骤</summary>

- **TC-SIDE-001**：进入 `chrome://extensions`，开启开发者模式，加载 `chromevideo/` 目录。期望：无解析错误，Service Worker 激活。
- **TC-SIDE-002**：打开 `https://chat.deepseek.com/`，使用鼠标点击页面任意处。期望：触发 `auto-open-sidepanel.js`，侧边栏滑出。
- **TC-SIDE-003**：在 Queue Server 运行时打开 Side Panel，检查 `#conn-dot`（绿）和 `#conn-text`（在线）。停止服务，观察状态变红及提示重连。
- **TC-SIDE-004**：点击新建会话按钮，检查列表新增项；悬停非激活会话，点击删除图标，期望会话消失且当前激活会话不受影响。
- **TC-SIDE-005**：在 `.mode-selector` 中点击快速或专家模式，期望按钮高亮状态正确切换。

</details>

<details>
<summary>点击展开：消息交互 (TC-CHAT) 详细步骤</summary>

- **TC-CHAT-001**：在输入框输入测试文本，点击发送或按 Enter，验证消息气泡生成且输入框被清空。
- **TC-CHAT-002**：要求 AI 回复一段 JavaScript 代码。验证 `.msg-ai` 气泡中含有 `<pre><code>`，且为等宽字体展示。
- **TC-CHAT-003**：发送需逻辑推理的复杂问题，等待回复，检查 `.ai-thought` 折叠区域的存在和开闭行为。
- **TC-CHAT-004**：消息发出后到收到完整回复前，检查 `.typing-indicator` 是否存在。回复完毕后必须消失。
- **TC-CHAT-005**：积累多条消息直到出现滚动条，手动上下滚动不抖动；新消息来时，滚动条能合理定位。

</details>

<details>
<summary>点击展开：附件功能 (TC-FILE) 详细步骤</summary>

- **TC-FILE-001**：点击附件按钮，触发文件选择并选中一个 `.txt` 文件。检查预览区出现 `.attachment-preview-item` 及对应信息。
- **TC-FILE-002**：上传两个文件后，点击第一个文件的删除图标，验证数量减 1 且另一个文件仍在。
- **TC-FILE-003**：带文件输入 "请总结这个文件内容"，验证 AI 能够读取文件内容作答。

</details>

<details>
<summary>点击展开：审批与安全 (TC-APPROVE / TC-SEC) 详细步骤</summary>

- **TC-APPROVE-001**：模拟触发需审批的动作（如文件写入）。检查 `#approval-strip` 可见，包含动作名称、参数和按钮。
- **TC-APPROVE-002**：点击批准，检查任务继续流转；点击拒绝，检查动作未执行。审批数量相应减少。
- **TC-SEC-001**：构造写入越界目录（含 `../`）的请求，验证被直接拒绝或拦截到高危审批流，未直接落盘。
- **TC-SEC-002**：新建会话并发送消息，刷新 Side Panel 后验证会话及消息未丢失。重启 Queue Server，在 Web Console 验证旧任务记录存在。

</details>

<details>
<summary>点击展开：Web Console (TC-WEB) 详细步骤</summary>

- **TC-WEB-001**：浏览器打开 `http://localhost:5173`。期望不白屏，能看到 Conversations、Pending Approvals、Transcript 等区块。
- **TC-WEB-002**：在 Conversations 列表中点击某条目，Transcript 区域立刻渲染出该会话的所有历史消息（包含 role、seq、content）。
- **TC-WEB-003**：在 API Tester 选 GET 并输入 `/health`，点击 Run，期望在下方 Response 区看到格式化的 JSON 结果。
- **TC-WEB-004**：在 New Task 输入框输入内容并提交，验证服务端日志接收到请求并在 UI 更新状态。

</details>
