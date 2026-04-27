# Tasks - free-chat-coder 下阶段开发计划

> 更新日期：2026-04-28
> 范围：Bug 修复 (代码审查遗留) + P0 任务闭环 (roadmap P0)

---

## 执行顺序总览

```
A (独立快速修复) ──→ 1h 内并行完成
         │
         ↓
B2 (去重) → B3 (路径统一) → B1 (恢复DOM点击)
         │                      │
         ↓                      ↓
    C1 (状态机)         C2 (审批数据结构)  ← C1/C2 可并行
         │                      │
         └────────┬─────────────┘
                  ↓
           C3 (动作解析收敛)
                  ↓
           C4 (Web Console 增强)
```

---

# 阶段 A：独立快速修复 (~1 小时)

不需要理解完整上下文，可以立刻执行。彼此无依赖，可并行。

---

## A1 — Bug 4: `chat-reader.js` 静默丢弃纯 think 消息 (LOW)

**文件**：`chromevideo/controllers/chat-reader.js:42-44`
**预估**：0.5h

### 问题描述
当 `extractAssistantContent` 返回空的 `finalReply`（整个消息被归类为 think）时，消息通过 `continue` 静默丢弃。旧行为会用 `innerText` 作为 fallback。DeepSeek 的纯推理回复会从对话历史中丢失。

### 具体步骤

- [ ] A1.1 当 `finalReply` 为空时 fallback 到 `innerText` 或记录 warning
- [ ] A1.2 确保不会丢失对话轮次

### 验收标准
- [ ] 纯 think 消息不会被静默丢弃
- [ ] 有合理的 fallback 行为（展示 raw text 或标记为 think-only）

---

## A2 — Task 5: `.service-pids.json` 加入 `.gitignore` (NIT)

**文件**：`chromevideo/host/.service-pids.json`，`.gitignore`
**预估**：5min

### 具体步骤

- [ ] A2.1 在 `.gitignore` 中添加 `.service-pids.json`
- [ ] A2.2 `git rm --cached chromevideo/host/.service-pids.json`

### 验收标准
- [ ] `.service-pids.json` 不再被 git 追踪

---

## A3 — Task 6: `mode-controller.js` 缺少末尾换行符 (NIT)

**文件**：`chromevideo/controllers/mode-controller.js:112`
**预估**：1min

### 具体步骤

- [ ] A3.1 在文件末尾添加换行符

### 验收标准
- [ ] 文件以 `\n` 结尾

---

# 阶段 B：Mode 模块三位一体修复 (~3 小时)

Bug 1/2/3 共享同一组源文件 (`mode-controller.js`, `content.js`, `background.js`)，必须按依赖顺序处理。

执行顺序：B2 先做 → B3 接着 → B1 最后

---

## B2 — Bug 2: 重复的 `window.ModeController` 定义 (HIGH)

**文件**：`chromevideo/controllers/mode-controller.js`，`chromevideo/content.js`
**预估**：0.5-1h

### 问题描述
`manifest.json` 中 `mode-controller.js` 在 `content.js` 之前加载，但两个文件都完整定义了 `window.ModeController`。`content.js` 版本在运行时覆盖了 `mode-controller.js` 版本。两者差异：
- `mode-controller.js` 的 `_toggleState` 有 `el.style.color` null-safety 检查
- `content.js` 去掉了该检查

由于 `content.js` 最终生效，null-safety 修复成了死代码。

### 具体步骤

- [ ] B2.1 保留 `mode-controller.js` 中的 `ModeController` 定义（含 `style.color` null-safety）
- [ ] B2.2 从 `content.js` 删除重复的 `ModeController` 定义（保留 `routeAction`、message handler 等不重复部分）
- [ ] B2.3 确认 `manifest.json` 中 `mode-controller.js` 在 `content.js` 之前加载

### 验收标准
- [ ] 全局只有一个 `window.ModeController` 定义
- [ ] `_toggleState` 包含 `style.color` null-safety 检查

---

## B3 — Bug 3: `sendActionToTab` 绕过 content script 路由 (MEDIUM)

**文件**：`chromevideo/background.js:157-186`，`chromevideo/content.js`
**预估**：0.5-1h

### 问题描述
`background.js` 在 `sendActionToTab` 中拦截 `setModeProfile`，改用 `chrome.tabs.executeScript` 而非 `chrome.tabs.sendMessage`。请求永远不会到达 `content.js` 的 `routeAction` switch，出现了两套 `setModeProfile` 实现。

参考 `doc/mcp-usage.md`，background injection 是解决 content-script-not-loaded 的合理方案，应统一采用。

### 具体步骤

- [ ] B3.1 统一采用 background injection 方案（保持 `background.js` 中的 `executeScript` 路径）
- [ ] B3.2 从 `content.js` 的 `routeAction` switch 中删除 `setModeProfile` 对应的死代码

### 验收标准
- [ ] `setModeProfile` 只有一套实现路径（background injection）
- [ ] content.js 中不存在 `setModeProfile` 路由死代码

---

## B1 — Bug 1: `setModelMode` 是空操作 (CRITICAL)

**文件**：`chromevideo/controllers/mode-controller.js:101-111`，`chromevideo/content.js:70-73`
**预估**：1-2h

### 问题描述
`setModelMode` 移除了所有 DOM 操作，不再点击"深度思考"和"联网搜索"切换按钮，直接返回 `{ success: true }`。后果：
- `deepthink_search_fallback` 路径声称成功但实际不做任何 UI 切换
- `prompt-controller.js` 中的 `window.ModeController.setModelMode(mode)` 调用失效
- fallback 路径存在的目的就是当页面找不到 profile toggle 按钮时提供后备方案，但现在永远走 fallback 且无实际效果

### 具体步骤

- [ ] B1.1 在 `mode-controller.js` 的 `setModelMode` 中恢复 DOM 按钮点击逻辑（深度思考 + 联网搜索按钮）
- [ ] B1.2 确保按钮的 toggle 逻辑正确（根据 mode 参数决定点击/不点击）
- [ ] B1.3 验证 `deepthink_search_fallback` 路径确实切换了 DeepSeek 页面的 UI 状态
- [ ] B1.4 验证 `prompt-controller.js` 的 direct 调用生效

### 验收标准
- [ ] `setModelMode({ deepThink: true })` 确实点击了深度思考按钮
- [ ] `setModelMode({ search: true })` 确实点击了联网搜索按钮
- [ ] fallback 路径和 direct 调用都能正常工作
- [ ] 在 `https://chat.deepseek.com/` 上可观察 UI 状态变化

---

# 阶段 C：P0 任务闭环 (~8 小时)

对应 `roadmap.md` P0 方向。C1 和 C2 可并行启动。

---

## C1 — 任务状态机规范化

**文件**：`queue-server/state-machine.js` (新建)，`shared/task-states.js` (新建)
**预估**：2h

### 背景
当前任务状态语义不统一，需要明确的状态转移规则和跨模块共享的状态常量。

### 状态定义

```
pending → assigned → running → waiting_approval → completed
                            ↘     ↓ (拒绝)        ↗
                             waiting_approval → running
                            ↘                    ↗
                             failed ←───────────┘
```

### 具体步骤

- [ ] C1.1 在 `shared/task-states.js` 中定义状态枚举和合法转移表
- [ ] C1.2 在 `queue-server/state-machine.js` 中实现状态转移验证函数
- [ ] C1.3 定义 `waiting_approval` 超时行为（建议：超时后标记为 `failed`，reason 记录超时）
- [ ] C1.4 在 Queue Server 的任务创建/更新路由中接入状态机验证

### 验收标准
- [ ] 非法状态转移被拒绝（如 completed → running）
- [ ] 所有状态转移有日志可追踪
- [ ] `shared/` 中的常量可被 Web Console 和扩展消费

---

## C2 — 审批记录数据结构

**文件**：`queue-server/data/schema.sql`，`queue-server/db.js`，`queue-server/routes/approval.js` (新建)
**预估**：2h

### 数据模型

```sql
CREATE TABLE IF NOT EXISTS approvals (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL,
  action_type   TEXT NOT NULL,
  params        TEXT NOT NULL,       -- JSON
  risk_level    TEXT NOT NULL DEFAULT 'medium',
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending|approved|rejected|expired
  reason        TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at   TEXT
);
```

### 具体步骤

- [ ] C2.1 在 `queue-server/data/schema.sql` 中添加 `approvals` 表定义
- [ ] C2.2 在 `queue-server/db.js` 中添加审批 CRUD 方法
- [ ] C2.3 新建 `queue-server/routes/approval.js`：
  - `GET /api/approvals` — 列表（支持按 task_id、status 过滤）
  - `GET /api/approvals/:id` — 详情
  - `POST /api/approvals/:id/approve` — 批准（含 reason）
  - `POST /api/approvals/:id/reject` — 拒绝（含 reason）
- [ ] C2.4 在 `queue-server/index.js` 中注册审批路由

### 验收标准
- [ ] 审批记录的创建/批准/拒绝/查询 API 可用
- [ ] 每次审批操作记录时间戳和操作人
- [ ] 审批记录与 task_id 关联可追踪

---

## C3 — 动作解析收敛到 Queue Server

**文件**：`queue-server/action-parser.js` (新建)，`chromevideo/content.js` / `background.js`
**预估**：2h

### 背景
当前扩展侧有动作分类逻辑，但按照 `vision.md` 边界，扩展只应负责 DOM 交互和消息转发，业务判断全部在 Queue Server 侧完成。

### 具体步骤

- [ ] C3.1 在 `queue-server/action-parser.js` 中实现动作意图提取：
  - 从 AI 输出文本中识别结构化动作（写文件、执行命令、修改配置等）
  - 返回 `{ type, params, risk_level }` 结构
- [ ] C3.2 从 `chromevideo/content.js` / `background.js` 中移除动作分类/判断逻辑
- [ ] C3.3 扩展侧仅做透传，将 AI 输出原文发送给 Queue Server
- [ ] C3.4 Queue Server 侧：解析动作 → 评估风险 → 需审批的创建审批记录并暂停任务

### 验收标准
- [ ] 动作识别逻辑集中在 Queue Server 侧
- [ ] 扩展侧不保留任何动作分类逻辑
- [ ] 高风险动作自动创建审批记录并暂停任务

---

## C4 — Web Console 任务详情页增强

**文件**：`web-console/src/pages/`，`web-console/src/components/`
**预估**：2h

### 具体步骤

- [ ] C4.1 增强任务详情页，展示完整状态机位置（用可视化步骤条）
- [ ] C4.2 展示关联会话摘要（最近 N 条消息）
- [ ] C4.3 展示历次审批记录（审批人、时间、结果）
- [ ] C4.4 新建或增强 `ApprovalCard` 组件（展示动作类型、参数摘要、风险等级、批准/拒绝按钮）

### 验收标准
- [ ] 用户能从一个页面看到任务的完整生命周期
- [ ] 审批操作有明确的 UI 反馈
- [ ] 任务失败时能看到清晰原因

---

# 完成标准

全部阶段通过后应达到：

1. **无已知 Bug** — 4 个 Bug + 2 个 Nit 全部修复
2. **任务状态可追踪** — 完整的 pending → completed/failed 生命周期
3. **审批有记录** — 每次高风险动作有审批记录可查询
4. **边界清晰** — 扩展只做 DOM 交互和消息透传，业务逻辑在 Queue Server
5. **Web Console 可用** — 任务详情页展示完整信息

下一步参考：
- `doc/test-plan.md` — 完成后执行全量回归测试
- `doc/roadmap.md` — P1 方向 (Patch Review + 诊断) 为后续阶段
