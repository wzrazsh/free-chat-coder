# 重构裁剪收尾计划 v1：清理自动进化残留入口

更新日期：2026-04-25

## 目标

本文件补充 `refactor-prune-plan.md` 的执行后收尾项。

当前提交已经删除了大部分 `evolution/`、`test-validator/`、autopilot/cron 脚本，但审查发现扩展端、Web Console、测试和文档仍保留旧自动进化入口。这些入口会继续误导用户，也会在运行时调用已经不存在的后端能力。

本轮收尾目标：

- 删除所有用户可触发的 `auto_evolve` / `start_auto_evolve` / `/evolve` 入口。
- 删除对已删除文件 `auto-evolve-monitor.js` 的引用。
- 删除 Web Console 中的 Evolve 编辑器、验证面板和 `/evolve` 调用。
- 更新或删除仍假设 `autoEvolve` 默认走 `deepseek-web` 的测试。
- 清理本地运行时数据中的旧自动进化任务，避免服务启动后加载过期状态。
- 保留新的主线：聊天记录管理、知识库、文件交付、patch 预览和人工确认。

## 审查结论

已经收敛的部分：

- `queue-server/evolution/` 已删除。
- `queue-server/test-validator/` 已删除。
- `scripts/dev-autopilot.sh`、`scripts/cron-dev-cycle.sh`、`scripts/install-dev-cron.sh`、`scripts/nightly-validate.sh` 已删除。
- `queue-server/actions/action-engine.js` 已不注册 `evolve_handler`、`evolve_extension`、`evolve_server`。
- `queue-server/index.js` 已不挂载 `/evolve` 路由。
- `queue-server/data/*` 已从 Git 索引移除。

仍未收敛的部分：

- `chromevideo/offscreen.html` 仍加载已删除的 `auto-evolve-monitor.js`。
- `chromevideo/offscreen.js` 仍引用 `autoEvolveMonitor` 并转发 `auto_evolve`。
- `chromevideo/popup.html` 和 `chromevideo/popup.js` 仍保留自动进化面板和启动逻辑。
- `chromevideo/controllers/prompt-controller.js` 在找不到输入框时仍发送 `auto_evolve`。
- `web-console/src/App.tsx` 仍保留 Evolve Modal、Evolution Validation 面板和 `/evolve` API 调用。
- `queue-server/test-deepseek-provider.js` 和 `queue-server/test-deepseek-server-loop.js` 仍包含 `autoEvolve` 旧假设。
- `README.md`、`scripts/dev-status-report.js` 和旧文档仍描述 auto-evolve / zero-token 主链路，容易继续带偏方向。
- 本地 `queue-server/data/tasks.json` 中仍有旧自动进化历史任务，虽然不再入 Git，但启动时仍会被 QueueManager 加载。

## 必须收尾项

### 1. 清理 Offscreen 自动进化监控残留

涉及文件：

- `chromevideo/offscreen.html`
- `chromevideo/offscreen.js`

当前问题：

- `offscreen.html` 仍有：

```html
<script src="auto-evolve-monitor.js"></script>
```

但 `chromevideo/auto-evolve-monitor.js` 已删除，扩展加载 offscreen 页面时会出现资源缺失。

- `offscreen.js` 仍使用 `autoEvolveMonitor.monitorWebSocket(ws)` 和 `autoEvolveMonitor.getStats()`。
- `offscreen.js` 仍允许从 Service Worker 转发 `auto_evolve` 到 Queue Server。

需要改动：

- 删除 `offscreen.html` 中的 `auto-evolve-monitor.js` script 标签。
- 删除 `offscreen.js` 顶部关于 auto-evolve monitor 的日志。
- 删除 WebSocket 错误监控注入：

```js
if (typeof autoEvolveMonitor !== 'undefined' && autoEvolveMonitor.monitorWebSocket) {
  autoEvolveMonitor.monitorWebSocket(ws);
}
```

- 将消息转发条件从：

```js
if (msg.type === 'task_update' || msg.type === 'auto_evolve') {
```

改为：

```js
if (msg.type === 'task_update') {
```

- 从 `get_extension_status` 响应中删除 `errorStats` 字段，或改为新的普通健康状态字段，不能再引用 `autoEvolveMonitor`。

验收标准：

- `rg -n "auto-evolve-monitor|autoEvolveMonitor|auto_evolve" chromevideo/offscreen.html chromevideo/offscreen.js` 无输出。
- 扩展 offscreen 页面加载时不再请求 `auto-evolve-monitor.js`。

### 2. 删除 Popup 自动进化 UI 和状态机

涉及文件：

- `chromevideo/popup.html`
- `chromevideo/popup.js`

当前问题：

- popup 仍展示“自动进化”面板。
- 点击按钮后会发送 `start_auto_evolve` / `stop_auto_evolve` / `resume_auto_evolve`。
- `background.js` 已删除对应处理器，导致 popup 进入假状态，用户会误以为系统仍在自动进化。

需要删除的 UI：

- `popup.html` 中 `.evolve-group` 整块。
- `popup.html` 中只服务自动进化的样式：
  - `.btn-evolve`
  - `.evolve-group`
  - `.evolve-textarea`
  - `.evolve-status`
  - `.evolve-info`
  - `.evolve-session`
  - `.session-badge`
  - `.btn-resume`

需要删除的 JS：

- `autoEvolveState` 状态对象。
- `loadEvolveState()`
- `saveEvolveState()`
- `updateEvolveUI()`
- `startAutoEvolve()`
- `stopAutoEvolve()`
- `updateEvolveProgress()`
- `evolve_progress` 消息处理分支。
- `start-evolve`、`stop-evolve`、`link-evolve-tab` 的事件监听。
- 初始化阶段的 `loadEvolveState().then(...)` 自动恢复逻辑。

替代行为：

- popup 只保留服务状态、Native Host 安装、打开 Web Console、打开 DeepSeek 的入口。
- 如果仍需要测试 DOM 错误，`reportTestDomError()` 应改成普通诊断事件，不再提示“触发自动进化”。

建议改动：

- 将 `reportTestDomError()` 中的 alert 文案改为“诊断错误已记录”，不要出现“自动进化”。
- 如该测试入口没有实际价值，直接从 service workbench 中移除 `onTestDomError`。

验收标准：

- `rg -n "autoEvolve|AutoEvolve|start_auto_evolve|stop_auto_evolve|resume_auto_evolve|evolve_progress|start-evolve|stop-evolve|link-evolve-tab" chromevideo/popup.html chromevideo/popup.js` 无输出。
- 打开扩展 popup，不再出现自动进化面板。

### 3. 改造 PromptController 的失败上报

涉及文件：

- `chromevideo/controllers/prompt-controller.js`

当前问题：

找不到输入框时仍发送：

```js
chrome.runtime.sendMessage({
  type: 'auto_evolve',
  errorType: 'selector_failed',
  ...
});
```

这会重新引入“错误自动触发修复”的旧路径。

需要改动：

- 删除 `auto_evolve` 消息发送。
- 保留抛错：

```js
throw new Error('InputAreaNotFound: Could not find the chat textarea on the page');
```

- 如需要观测，可改成普通诊断消息，例如：

```js
chrome.runtime.sendMessage({
  type: 'extension_diagnostic',
  level: 'error',
  code: 'INPUT_AREA_NOT_FOUND',
  message: 'Could not find the chat textarea on the page',
  location: 'chromevideo/controllers/prompt-controller.js'
});
```

注意：

- 如果没有接收 `extension_diagnostic` 的处理器，可以先不发送消息，只抛错。
- 不要在这里创建任务，不要自动生成修复 prompt。

验收标准：

- `rg -n "auto_evolve" chromevideo/controllers/prompt-controller.js` 无输出。
- 找不到输入框时，任务失败并向用户展示错误，而不是自动创建修复任务。

### 4. 删除 Web Console 的 Evolve 页面和 API 调用

涉及文件：

- `web-console/src/App.tsx`

当前问题：

Web Console 仍保留：

- `EvolutionValidation` 类型。
- `isEvolveModalOpen`
- `customCode`
- `latestEvolutionValidation`
- `evolutionValidationHistory`
- `evolveSubmitError`
- `isEvolving`
- `fetchEvolutionValidationStatus()`
- 启动时请求 `GET /evolve`
- 轮询 `GET /evolve/validation-status?limit=6`
- `handleEvolveSubmit()` 调用 `POST /evolve`
- Header 中的 `Evolve` 按钮。
- `Latest Evolution Validation` 面板。
- Evolve Modal。

这些后端接口已经不存在，会造成控制台持续报错，也会让用户继续误认为系统支持自修改。

需要删除：

- 所有 `EvolutionValidation` 相关 interface。
- 所有 evolve state。
- `fetchEvolutionValidationStatus()`。
- `useEffect` 中对 `/evolve` 和 `/evolve/validation-status` 的请求、轮询和 cleanup。
- `handleEvolveSubmit()`。
- Header 中的 `Evolve` 按钮。
- `Latest Evolution Validation` 整个面板。
- 文件底部 Evolve Modal。
- 不再需要的 import：
  - `Code`
  - 如果 `Editor` 只用于 Evolve Modal，也要删除 `@monaco-editor/react` import 和依赖使用。

保留：

- Tasks 列表。
- Conversations 列表和 Transcript。
- Pending Approvals。
- API Tester。
- 新任务提交。

替代方向：

- 后续新增 `Patch Review` 面板，但不要复用 `/evolve` 名称。
- 新 API 应是：
  - `GET /patches`
  - `GET /patches/:id`
  - `POST /patches/:id/apply`
  - `POST /patches/:id/reject`

验收标准：

- `rg -n "/evolve|EvolutionValidation|isEvolve|evolutionValidation|handleEvolveSubmit|Latest Evolution|Evolve" web-console/src/App.tsx` 无输出，或只剩普通英文单词且与旧功能无关。
- `npm run build` 在 `web-console/` 下通过。
- 打开 Web Console 后浏览器控制台不再持续请求 `/evolve`。

### 5. 修正 DeepSeek Provider 测试中的旧 autoEvolve 假设

涉及文件：

- `queue-server/test-deepseek-provider.js`
- `queue-server/test-deepseek-server-loop.js`

当前问题：

`queue-server/test-deepseek-provider.js` 仍断言：

```js
providerRegistry.getTaskProvider({ options: { autoEvolve: true } }) === 'deepseek-web'
```

但当前 provider registry 已收敛为：

- 默认 provider：`extension-dom`
- 显式 `{ provider: 'deepseek-web' }` 才使用 DeepSeek Web provider
- `autoEvolve` 不再是路由依据

需要改动：

- 删除所有 `autoEvolve` 特例断言。
- 改成断言：

```js
assert.strictEqual(providerRegistry.getTaskProvider({ options: {} }), 'extension-dom');
assert.strictEqual(providerRegistry.getTaskProvider({ options: { provider: 'deepseek-web' } }), 'deepseek-web');
assert.strictEqual(providerRegistry.getTaskProvider({ options: { autoEvolve: true } }), 'extension-dom');
```

- `canDispatchTask` 测试也要相应更新：带 `autoEvolve: true` 的任务应按默认 `extension-dom` 判断，不能绕过扩展可用性。
- 如果 `queue-server/test-deepseek-server-loop.js` 只是旧 auto-evolve 回归测试，建议删除或改名为普通 `provider` 集成测试。

验收标准：

- `node queue-server/test-deepseek-provider.js` 通过。
- `rg -n "autoEvolve|auto_evolve|evolve_extension|evolve_handler" queue-server/test-*.js` 无输出，除非该测试明确在验证旧字段被忽略。

### 6. 清理运行时任务数据

涉及文件：

- `queue-server/data/tasks.json`
- `queue-server/data/evolution-history.json`
- `queue-server/data/evolution-history.json.backup`

当前问题：

这些文件已不在 Git 索引中，但本地仍存在。`QueueManager` 启动时会加载 `tasks.json`，当前本地数据中仍有 auto-evolve 类历史任务。

建议处理方式：

- 如果不需要保留历史，直接删除：

```powershell
Remove-Item -LiteralPath "queue-server\data\tasks.json" -Force
Remove-Item -LiteralPath "queue-server\data\evolution-history.json" -Force
Remove-Item -LiteralPath "queue-server\data\evolution-history.json.backup" -Force
```

- 如果需要留档，移动到手动归档目录，例如：

```powershell
New-Item -ItemType Directory -Force -Path "queue-server\data\archive" | Out-Null
Move-Item -LiteralPath "queue-server\data\tasks.json" -Destination "queue-server\data\archive\tasks-before-prune-20260425.json"
Move-Item -LiteralPath "queue-server\data\evolution-history.json" -Destination "queue-server\data\archive\evolution-history-before-prune-20260425.json"
Move-Item -LiteralPath "queue-server\data\evolution-history.json.backup" -Destination "queue-server\data\archive\evolution-history-before-prune-20260425.backup.json"
```

注意：

- `queue-server/data/archive/` 如果只是本地归档，应加入 `.gitignore`。
- 不要把旧 auto-evolve 历史作为新知识库种子导入，除非明确标记为废弃历史。

验收标准：

- Queue Server 启动后 `/tasks` 不再返回旧自动进化任务。
- `git status --short` 不出现 `queue-server/data/*`。

### 7. 更新 README 和状态报告脚本

涉及文件：

- `README.md`
- `scripts/dev-status-report.js`
- `doc/archive/deepseek-zero-token-integration-20260417.md`
- `doc/archive/deepseek-web-api-conversion-plan-20260418.md`
- `doc/archive/chromevideo-extension-phase4-changelog.md`
- `doc/archive/chromevideo-extension-plan.md`
- `doc/archive/auto-evolve-task-list.md`
- `doc/archive/progress-summary-20260412.md`

当前问题：

README 和若干旧文档仍把 auto-evolve、zero-token provider、自修改作为项目主线描述。旧文档可以保留为历史，但必须明显标记“已废弃”，否则后续执行会再次跑偏。

README 需要调整：

- 删除“自动进化”作为核心能力的描述。
- 删除 `/evolve` 使用说明。
- 删除 cron/autopilot 安装说明。
- 将 zero-token provider 降级为“已冻结实验能力”或从主线 README 移除。
- 新增当前主线：
  - 扩展管理 DeepSeek 聊天记录。
  - Queue Server 管理本地任务、文件、知识库和 patch。
  - Web Console 管理任务、对话、知识库和 patch review。

`scripts/dev-status-report.js` 需要调整：

- 删除 auto-evolve / zero-token 主线状态。
- 如果脚本仍有价值，改成输出当前收敛主线状态：
  - extension adapter
  - conversations store
  - queue tasks
  - knowledge base
  - patch review

旧文档处理方式：

- 不建议全部删除历史文档。
- 建议在文件顶部加废弃提示：

```md
> Deprecated: 本文档描述的是 2026-04-25 前的自动进化/自修改路线，已从当前主线中移除。当前路线以 `doc/refactor-prune-plan.md` 和 `doc/refactor-prune-followup-plan.md` 为准。
```

验收标准：

- `rg -n "auto_evolve|Auto Evolve|自动进化|/evolve|autopilot|cron" README.md scripts/dev-status-report.js` 无主线描述残留。
- 旧文档中的相关内容必须带 Deprecated 标记。

### 8. 清理共享配置中的废弃 feature flag

涉及文件：

- `shared/config.js`

当前问题：

`shared/config.js` 仍保留：

```js
features: {
  enableAutoEvolve: ...,
  enableEvolveApi: ...
}
```

如果所有旧入口已经删除，这两个 flag 不应继续存在，否则后续开发可能误以为这些能力可以重新打开。

需要改动：

- 删除 `enableAutoEvolve`。
- 删除 `enableEvolveApi`。
- 删除相关环境变量说明：
  - `FCC_ENABLE_AUTO_EVOLVE`
  - `FCC_ENABLE_EVOLVE_API`

验收标准：

- `rg -n "enableAutoEvolve|enableEvolveApi|FCC_ENABLE_AUTO_EVOLVE|FCC_ENABLE_EVOLVE_API" shared chromevideo queue-server web-console` 无输出。

## 建议执行顺序

1. 先清理扩展运行时坏引用：
   - `chromevideo/offscreen.html`
   - `chromevideo/offscreen.js`
   - `chromevideo/controllers/prompt-controller.js`

2. 再清理用户可见旧入口：
   - `chromevideo/popup.html`
   - `chromevideo/popup.js`
   - `web-console/src/App.tsx`

3. 再清理测试和配置：
   - `queue-server/test-deepseek-provider.js`
   - `queue-server/test-deepseek-server-loop.js`
   - `shared/config.js`

4. 最后清理文档和本地数据：
   - `README.md`
   - `scripts/dev-status-report.js`
   - 旧 doc 加 Deprecated 标记
   - 删除或归档 `queue-server/data/tasks.json`

## 最终验收命令

在项目根目录执行：

```powershell
git status --short
rg -n "auto-evolve-monitor|autoEvolveMonitor|auto_evolve|start_auto_evolve|stop_auto_evolve|resume_auto_evolve|evolve_progress|evolve_handler|evolve_extension|evolve_server|/evolve" --glob "!doc/**" --glob "!**/package-lock.json" -S .
node -c queue-server\index.js
node -c queue-server\websocket\handler.js
node -c chromevideo\background.js
node -c chromevideo\offscreen.js
node -c chromevideo\popup.js
node queue-server\test-deepseek-provider.js
```

在 `web-console/` 下执行：

```powershell
npm run build
```

期望结果：

- `rg` 不应再扫出旧自动进化运行时代码。
- Node 语法检查通过。
- provider 测试通过。
- Web Console 构建通过。
- `git status --short` 只显示本轮明确修改的文件。

## 不要在本轮做的事

- 不要实现新的知识库。
- 不要实现新的 patch apply API。
- 不要恢复 `/evolve`，即使改名也不要复用其实现。
- 不要让 DeepSeek 直接触发写文件动作。
- 不要把旧 auto-evolve 历史导入新知识库。
- 不要继续维护 zero-token provider 作为默认主线。

本轮只做收尾清扫。只有旧入口完全清干净后，才进入新主线的协议、知识库和 patch review 实现。
