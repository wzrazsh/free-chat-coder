# 重构裁剪执行计划：从自动进化系统收敛为 DeepSeek 本地知识库代理

基于 `doc/refactor-prune-plan-20260425.md` 制定本执行计划。

---

## 现状速览

当前代码库存在以下需要裁剪的自动进化相关代码：

| 位置 | 内容 |
|------|------|
| `chromevideo/background.js:59-65` | `importScripts('auto-evolve-monitor.js')` |
| `chromevideo/background.js:308-553` | `AutoEvolveController` 类（主动进化控制器） |
| `chromevideo/background.js:1080-1113` | `auto_evolve`, `start_auto_evolve`, `stop_auto_evolve`, `resume_auto_evolve` 消息处理 |
| `chromevideo/sidepanel.js:20-27` | 自动进化状态变量 |
| `chromevideo/sidepanel.js:793-908` | 自动进化 UI 控制函数 |
| `chromevideo/sidepanel.html:896-913` | 自动进化设置面板 UI |
| `queue-server/websocket/handler.js:482-562` | `auto_evolve` WebSocket 消息处理，自动创建修复任务 |
| `queue-server/actions/action-engine.js:23-25` | `evolve_handler`, `evolve_extension`, `evolve_server` 动作注册 |
| `queue-server/index.js:12-13,77` | `/evolve` 路由和 `extension-watcher` 引入 |
| `queue-server/evolution/` | 10 个文件：auto-evolve-manager, evolve-executor, hot-reload, self-diagnosis 等 |
| `queue-server/test-validator/` | 13 个文件：自动验证与回滚系统 |
| `queue-server/test-auto-evolve*.js` | 4 个测试脚本 |
| `scripts/` | 4 个 autopilot/cron 脚本 |
| `queue-server/data/evolution-history.json` | 已入 Git 索引的运行时数据 |

---

## 方案一：保守两阶段裁剪（已批准）

第一阶段先用 feature flag 冻结所有危险入口，确保新主线可安全运行；第二阶段确认稳定后再物理删除。

---

### 阶段 0：冻结危险入口（不删文件，只禁用）

> **状态：✅ 已完成**  
> **执行时间：2026-04-25**  
> **验证结果：服务正常启动，`POST /evolve` 返回 410 Gone，语法检查全部通过**

#### Step 0.1 — 增加全局 feature flag
- [x] `shared/config.js`
  - [x] 新增 `features: { enableAutoEvolve: false, enableEvolveApi: false }`
  - [x] 支持环境变量覆盖：`process.env.FCC_ENABLE_AUTO_EVOLVE`, `process.env.FCC_ENABLE_EVOLVE_API`
- [x] `chromevideo/utils/queue-config.js`
  - [x] 新增 `features: { enableAutoEvolve: false }`（扩展侧硬编码，不依赖 Node API）

#### Step 0.2 — 冻结扩展侧自动进化
- [x] `chromevideo/background.js`
  - [x] `importScripts('auto-evolve-monitor.js')` 改为条件导入（仅在 `queueConfig.features.enableAutoEvolve` 为 true 时执行）
  - [x] `AutoEvolveController.start()` 入口加 guard，若 flag 为 false 直接返回 `{ success: false, message: 'Auto-evolve is disabled' }`
  - [x] `msg.type === 'auto_evolve'` 加 guard，flag 为 false 时返回拒绝响应
  - [x] `msg.type === 'start_auto_evolve'` 加 guard
  - [x] `msg.type === 'stop_auto_evolve'` 保持可用（安全操作）
  - [x] `msg.type === 'resume_auto_evolve'` 加 guard
- [x] `chromevideo/sidepanel.js`
  - [x] `startAutoEvolve()` 开头检查 flag，false 时提示"⛔ 自动进化已冻结"
  - [x] 保留 `loadEvolveState()`, `updateEvolveUI()` 但不再自动激活轮询
- [x] `chromevideo/sidepanel.html`
  - [x] 自动进化卡片加 `opacity: 0.5` + `pointer-events: none` 遮罩，按钮加 `disabled`
  - [x] 状态文字改为：`自动进化功能已冻结`

#### Step 0.3 — 冻结服务端自动进化
- [x] `queue-server/websocket/handler.js`
  - [x] `data.type === 'auto_evolve'` 分支开头加 guard，读取 `sharedConfig.features.enableAutoEvolve`
  - [x] feature 关闭时返回 `{ type: 'evolution_disabled', message: 'Auto-evolve is disabled by configuration.' }`
  - [x] 不创建任何修复任务
- [x] `queue-server/actions/action-engine.js`
  - [x] `evolve_handler`, `evolve_extension`, `evolve_server` 的 executor 替换为占位函数：
    ```js
    executor: () => ({ success: false, error: 'Evolve actions are disabled by configuration.' })
    ```
  - [x] 保留注册表条目和 `require('../evolution/evolve-executor')`（避免破坏模块加载链）

#### Step 0.4 — 废弃 `/evolve` API 并停止热重载
- [x] `queue-server/index.js`
  - [x] `app.use('/evolve', evolutionRoutes)` 改为条件挂载
  - [x] 默认对 `/evolve` 返回 `410 Gone`
  - [x] `watchExtension()` 改为条件调用（仅在 `FCC_ENABLE_EVOLVE_API` 为 true 时执行）

#### Step 0.5 — 冻结 test-validator
- [x] 确认 `queue-server/index.js` 未直接 require `test-validator`
- [x] 确认 `queue-server/websocket/handler.js` 未直接 require `test-validator`
- [x] `queue-server/evolution/evolve-executor.js` 内部引用了 `test-validator`，阶段 0 不删文件，通过 action-engine 占位函数阻止调用

#### Step 0.6 — Git 索引清理
- [x] `queue-server/data/evolution-history.json` 已不在 Git 索引中（`git ls-files` 返回空）
- [x] 确认 `.gitignore` 已包含 `queue-server/data/evolution-history.json`
- [x] 确认 `.gitignore` 已包含 `queue-server/data/evolution-history.json.backup`
- [x] 补充 `.gitignore`：`web-console/dist/`

#### 阶段 0 验收标准
- [x] 启动 queue-server 后，`auto_evolve` WebSocket 消息不会创建修复任务
- [x] `POST /evolve` 返回 `410 Gone`
- [x] `git status` 不出现 `queue-server/data/` 下任何文件的变更
- [x] 扩展侧点击"开始进化"提示已冻结，不发送请求

---

### 阶段 1：物理删除与归档（确认新主线稳定后执行）

> **状态：⏳ 待执行**  
> **前置条件：新主线（任务协议 + patch 确认流程）验证稳定**

#### Step 1.1 — 删除扩展侧进化代码
- [ ] `chromevideo/background.js`
  - [ ] 删除 `importScripts('auto-evolve-monitor.js')`
  - [ ] 删除 `AutoEvolveController` 类（约 245 行）
  - [ ] 删除 `autoEvolveController` 全局实例
  - [ ] 删除 `msg.type === 'auto_evolve'` 分支
  - [ ] 删除 `msg.type === 'start_auto_evolve'` 分支
  - [ ] 删除 `msg.type === 'stop_auto_evolve'` 分支
  - [ ] 删除 `msg.type === 'resume_auto_evolve'` 分支
  - [ ] 删除 `forwardAutoEvolveRequest` 函数（如仍存在）
- [ ] `chromevideo/sidepanel.js`
  - [ ] 删除 `autoEvolveState` 变量声明
  - [ ] 删除 `loadEvolveState()`, `saveEvolveState()`, `updateEvolveUI()`
  - [ ] 删除 `startAutoEvolve()`, `stopAutoEvolve()`, `updateEvolveProgress()`
- [ ] `chromevideo/sidepanel.html`
  - [ ] 删除自动进化卡片 DOM
- [ ] `chromevideo/auto-evolve-monitor.js`
  - [ ] **删除整个文件**

#### Step 1.2 — 删除服务端进化代码
- [ ] `queue-server/websocket/handler.js`
  - [ ] 删除 `data.type === 'auto_evolve'` 整个分支
  - [ ] 删除顶部未使用的 import：`autoEvolveManager`, `selfDiagnosis`, `evolutionHistory`
- [ ] `queue-server/actions/action-engine.js`
  - [ ] 删除 `evolve_handler`, `evolve_extension`, `evolve_server` 注册条目
  - [ ] 删除 `const evolveExecutor = require('../evolution/evolve-executor');`
- [ ] `queue-server/index.js`
  - [ ] 删除 `const evolutionRoutes = require('./evolution/hot-reload');`
  - [ ] 删除 `const watchExtension = require('./evolution/extension-watcher');`
  - [ ] 删除 `app.use('/evolve', evolutionRoutes);`
  - [ ] 删除 `watchExtension();`

#### Step 1.3 — 归档/删除 evolution 目录
- [ ] `queue-server/evolution/auto-evolve-manager.js` — 删除/归档
- [ ] `queue-server/evolution/code-executor.js` — 删除/归档
- [ ] `queue-server/evolution/code-writer.js` — 删除/归档
- [ ] `queue-server/evolution/evolution-history.js` — 删除/归档
- [ ] `queue-server/evolution/evolve-executor.js` — 删除/归档
- [ ] `queue-server/evolution/extension-watcher.js` — 删除/归档
- [ ] `queue-server/evolution/file-executor.js` — **注意：action-engine.js 中的 `read_file`, `write_file`, `list_files` 依赖此文件，若保留 action-engine 则需保留 file-executor**
- [ ] `queue-server/evolution/hot-reload.js` — 删除/归档
- [ ] `queue-server/evolution/self-diagnosis.js` — 删除/归档
- [ ] `queue-server/evolution/system-executor.js` — **注意：action-engine.js 中的 `execute_command`, `get_system_info` 依赖此文件**
- [ ] **决策点**：如果 action-engine 中的 `read_file`/`write_file`/`list_files`/`execute_command` 仍需保留，则不能删除 `file-executor.js` 和 `system-executor.js`。这两个文件需移到 `queue-server/actions/` 或 `queue-server/utils/` 下。

#### Step 1.4 — 归档/删除 test-validator
- [ ] `queue-server/test-validator/communicator.js` — 删除/归档
- [ ] `queue-server/test-validator/event-bus.js` — 删除/归档
- [ ] `queue-server/test-validator/index.js` — 删除/归档
- [ ] `queue-server/test-validator/rollback-manager.js` — 删除/归档
- [ ] `queue-server/test-validator/run-tests.js` — 删除/归档
- [ ] `queue-server/test-validator/state-manager.js` — 删除/归档
- [ ] `queue-server/test-validator/test-error-detection.js` — 删除/归档
- [ ] `queue-server/test-validator/test-executor.js` — 删除/归档
- [ ] `queue-server/test-validator/test-result-analyzer.js` — 删除/归档
- [ ] `queue-server/test-validator/test-runner.js` — 删除/归档
- [ ] `queue-server/test-validator/test-websocket-flow.js` — 删除/归档
- [ ] `queue-server/test-validator/unified-test-runner.js` — 删除/归档
- [ ] `queue-server/test-validator/validation-service.js` — 删除/归档

#### Step 1.5 — 删除测试脚本
- [ ] `queue-server/test-auto-evolve.js` — 删除
- [ ] `queue-server/test-auto-evolve-loop.js` — 删除
- [ ] `queue-server/test-auto-evolve-loop2.js` — 删除
- [ ] `queue-server/test-evolve-executor.js` — 删除

#### Step 1.6 — 删除 cron/autopilot 脚本
- [ ] `scripts/cron-dev-cycle.sh` — 归档到 `doc/archive/scripts/` 或直接删除
- [ ] `scripts/dev-autopilot.sh` — 同上
- [ ] `scripts/dev-autopilot-prompt.md` — 同上
- [ ] `scripts/install-dev-cron.sh` — 同上
- [ ] `scripts/nightly-validate.sh` — 同上
- [ ] **保留**：`scripts/dev-status-report.js`, `scripts/sync-config.js`, `scripts/onboard-deepseek-web.js`, `scripts/verify-deepseek-web-provider.js`

#### Step 1.7 — 降级 DeepSeek Web Zero-Token Provider
- [ ] `queue-server/providers/deepseek-web/` 代码保留但不作为默认 provider
- [ ] 在 `README.md` 或 `shared/config.js` 注释中注明：MVP 默认走 `extension-dom`，zero-token 为实验能力

#### 阶段 1 验收标准
- [ ] 代码库中不存在 `auto_evolve` 消息处理逻辑
- [ ] 代码库中不存在 `evolve_handler`/`evolve_extension`/`evolve_server` 动作
- [ ] `/evolve` 路由不存在（服务启动时无此路由）
- [ ] `queue-server/evolution/` 已删除或归档
- [ ] `git status` 干净，无运行时数据泄漏

---

## 方案二：激进一次性裁剪（备选）

跳过 feature flag 阶段，直接执行阶段 1 的所有删除操作（Step 1.1 ~ 1.7）。

**风险：** 如果删除后发现问题，需要 git 回滚才能恢复；不适合当前"新主线尚未验证"的状态。

**适用场景：** 已确认新主线（任务协议 + patch 确认流程）可完整跑通，且团队愿意承担回滚风险。

---

## 后续阶段（本计划不立即执行，仅列 roadmap）

| 阶段 | 目标 | 关键产出 |
|------|------|----------|
| 阶段 2 | 新任务协议 | `shared/protocol.js`，DeepSeek response parser，`POST /patches/:id/apply` |
| 阶段 3 | 知识库 MVP | SQLite 表（conversations, messages, tasks, task_files, patches, patch_changes） |
| 阶段 4 | 上下文选择 | 文件摘要 + SQLite FTS 搜索，推荐相关文件 |

---

## 执行优先级

1. ✅ **阶段 0（冻结）** — 已完成
2. ⏳ **验证新主线稳定** — 等待任务协议 + patch 确认流程可完整跑通
3. ⏳ **阶段 1（删除）** — 待前置条件满足后执行
