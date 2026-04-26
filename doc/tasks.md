# Tasks - free-chat-coder 代码审查修复

> 生成日期：2026-04-27
> 来源：code review of uncommitted changes
> 核心目标：修复 review 发现的问题，按严重程度处理

---

## Bug 1: `setModelMode` 是空操作（CRITICAL）

**严重程度**：Critical
**文件**：`chromevideo/controllers/mode-controller.js:101-111`，`chromevideo/content.js:70-73`
**预估工时**：1-2 小时

### 问题描述
`setModelMode` 移除了所有 DOM 操作——不再点击"深度思考"和"联网搜索"切换按钮，直接返回 `{ success: true }`。这意味着：
- `deepthink_search_fallback` 路径会声称成功但实际不做任何 UI 切换
- `prompt-controller.js` 中的 `window.ModeController.setModelMode(mode)` 调用也失效
- 这个 fallback 路径存在的目的恰恰是当页面找不到 profile toggle 按钮时提供后备方案——现在它永远走 fallback 且没有实际效果

### 具体步骤

- [ ] 1.1 恢复 `setModelMode` 中的 DOM 按钮点击逻辑
- [ ] 1.2 确保深度思考/联网搜索按钮正确被 toggle
- [ ] 1.3 验证 `deepthink_search_fallback` 路径确实切换了 UI 状态
- [ ] 1.4 验证 direct `prompt-controller.js` 调用生效

### 验收标准
- [ ] `setModelMode({ deepThink: true })` 确实点击了深度思考按钮
- [ ] `setModelMode({ search: true })` 确实点击了联网搜索按钮
- [ ] fallback 路径和 direct 调用都能正常工作

---

## Bug 2: 重复的 `window.ModeController` 定义（HIGH）

**严重程度**：High
**文件**：`chromevideo/controllers/mode-controller.js`，`chromevideo/content.js`
**预估工时**：0.5-1 小时

### 问题描述
`manifest.json` 中 `mode-controller.js` 在 `content.js` 之前加载，但两个文件都完整定义了 `window.ModeController`。`content.js` 中的版本在运行时覆盖了 `mode-controller.js` 的版本。两者之间存在细微差异：
- `mode-controller.js` 在 `_toggleState` 中保留了 `el.style.color` 检查（含 null-safety 保护）
- `content.js` 完全去掉了 `style.color` 检查

由于 `content.js` 最终生效，`style.color` 的 null-safety 修复成了死代码。

### 具体步骤

- [ ] 2.1 选择其中一个文件保留 `ModeController` 定义
- [ ] 2.2 删除另一个文件中的重复定义
- [ ] 2.3 确保 `_toggleState` 保留 `style.color` 的 null-safety 检查
- [ ] 2.4 验证 `manifest.json` 加载顺序正确

### 验收标准
- [ ] 只有一个 `window.ModeController` 定义
- [ ] `_toggleState` 包含 `style.color` null-safety 检查

---

## Bug 3: `sendActionToTab` 绕过 content script 路由（MEDIUM）

**严重程度**：Medium
**文件**：`chromevideo/background.js:157-186`，`chromevideo/content.js`
**预估工时**：0.5-1 小时

### 问题描述
`background.js` 中的代码在 `sendActionToTab` 中拦截 `setModeProfile`，改用 `chrome.tabs.executeScript` 而非 `chrome.tabs.sendMessage`。这意味着：
- 请求永远不会到达 `content.js` 中的 `routeAction` switch
- content script 中定义的 `ModeController` 对此 action 完全未被使用
- 出现了两套 `setModeProfile` 实现路径

虽然用 background injection 来解决 content-script-not-loaded 问题是一个合理的方案（见 `doc/mcp-usage.md`），但应该统一处理。

### 具体步骤

- [ ] 3.1 决定统一方案：全程用 injection 方式，还是修复 content script 加载问题
- [ ] 3.2 如采用 injection 方案，删除 content script 中对应的死代码
- [ ] 3.3 如修复加载问题，移除 background.js 中的 bypass

### 验收标准
- [ ] `setModeProfile` 只有一套实现路径
- [ ] 不存在死代码路径

---

## Bug 4: `chat-reader.js` 静默丢弃纯 think 消息（LOW）

**严重程度**：Low
**文件**：`chromevideo/controllers/chat-reader.js:42-44`
**预估工时**：0.5 小时

### 问题描述
当 `extractAssistantContent` 返回空的 `finalReply`（即整个消息被归类为 think 内容）时，消息通过 `continue` 被静默丢弃。旧行为会将其 include 到使用 `innerText` 的结果中。如果 DeepSeek 返回一条消息，其全部内容块都是 think 性质的（例如一段简短的仅推理回复），这条消息会从对话历史中丢失。

### 具体步骤

- [ ] 4.1 当 `finalReply` 为空时的处理策略：fallback 到 raw text 或记录 warning
- [ ] 4.2 确保不会丢失对话轮次

### 验收标准
- [ ] 纯 think 消息不会被静默丢弃

---

## Task 5: `.service-pids.json` 加入 `.gitignore`（NIT）

**严重程度**：Nit
**文件**：`chromevideo/host/.service-pids.json`，`.gitignore`
**预估工时**：5 分钟

### 问题描述
`chromevideo/host/.service-pids.json` 是一个运行时状态文件，包含特定于开发者机器的进程 ID 和时间戳。它被 git 追踪且频繁变更。

### 具体步骤

- [ ] 5.1 在 `.gitignore` 中添加 `.service-pids.json`
- [ ] 5.2 `git rm --cached chromevideo/host/.service-pids.json`

### 验收标准
- [ ] `.service-pids.json` 不再被 git 追踪

---

## Task 6: `mode-controller.js` 缺少末尾换行符（NIT）

**严重程度**：Nit
**文件**：`chromevideo/controllers/mode-controller.js:112`
**预估工时**：1 分钟

### 具体步骤

- [ ] 6.1 在文件末尾添加换行符

### 验收标准
- [ ] 文件以换行符结尾

---

## 修复顺序

```
Bug 1 (setModelMode no-op)  ← 最高优先级
    ↓
Bug 2 (重复定义)
    ↓
Bug 3 (sendActionToTab bypass)
    ↓
Bug 4 (chat-reader 静默丢弃)
    ↓
Task 5 (.gitignore)
    ↓
Task 6 (末尾换行符)
```

Bug 2 和 Bug 3 可以并行修复。

---

## 附录：原始 Patch Review 任务（暂缓）

原始 `tasks.md` 中的 Patch Review 数据层任务（Task 1-5）已暂缓，保留以供参考。详见 git 历史或 `doc/implementation_plan.md`。
