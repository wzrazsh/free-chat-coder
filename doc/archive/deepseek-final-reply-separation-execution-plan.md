# DeepSeek 最终回复与思考过程分离 — 执行计划

## 1. 背景与根因定位

根据对代码库的分析，问题根因已明确：

### 1.1 DOM 提取层 (chat-reader.js)

**`readChatContent()`**（第 11-79 行）：
- 使用选择器 `.fbb737a4, .ds-markdown, div[class*="markdown"]` 定位助手消息节点
- 调用 `node.innerText` 获取整个节点的文本 —— **这会一次性获取思考区域 + 正式回答区域的所有文本**
- `thinkContent` 字段仅用于提取前一个兄弟节点的思考文本（作为附加元数据），并未从主 `content` 中排除思考区域文本
- **结果**：`content` 字段同时包含思考过程和正式回答，发送到后端后，前端会渲染出两个 "最终回复" 卡片（思考过程一个，正式回答一个）

**`readLatestReply()`**（第 81-124 行）：
- 同样使用 `lastBlock.innerText` 读取整个助手消息容器
- 思考文本与正式回答混在一起

### 1.2 轮询层 (prompt-controller.js)

**`_waitForReply()`**（第 63-115 行）：
- 使用 `lastBlock.innerText || lastBlock.textContent` 获取最新回复文本
- 在发送最终 `reply` 时，内容同样包含思考过程

### 1.3 前端展示层 (sidepanel.js)

**`renderAiMessage()`**（第 596-620 行）：
- 渲染 `{ content, thinkContent }` 结构
- 将 `thinkContent` 渲染为可折叠的"思考过程"区域
- 将 `content` 渲染为"最终回复"区域
- 但由于 `content` 中已混入思考文本，展示时会出现重复/混乱

### 1.4 数据流

```
DeepSeek DOM
  → chat-reader.js (readChatContent / readLatestReply)
    → content = 思考文本 + 正式回答 (混合)
    → thinkContent = 前一个兄弟节点内容 (单独)
  → background.js (queue server / sidepanel 同步)
  → sidepanel.js (renderAiMessage)
    → "思考过程"折叠区 (thinkContent)
    → "最终回复"卡片 (content，含思考文本)
```

---

## 2. 修改方案

### 2.1 方案选择：DOM 结构过滤（推荐）

在 chat-reader.js 中增加 `extractFinalReply()` 辅助函数，从助手消息 DOM 节点中智能提取正式回答正文，排除思考区域。

#### 2.1.1 DeepSeek DOM 结构分析（推测）

根据截图和 PRD 描述，DeepSeek 的助手消息 DOM 结构大致如下：

```html
<div class="ds-markdown">              <!-- 助手消息容器 -->
  <div class="ds-think">               <!-- "已思考"区域（折叠） -->
    <div class="ds-think-header">
      <span>已思考（用时 x 秒）</span>
    </div>
    <div class="ds-think-content">      <!-- 推理文本 -->
      <!-- 这里包含模型的思考过程 -->
    </div>
  </div>
  <div class="ds-markdown-answer">     <!-- 正式回答区域 -->
    <!-- 这里包含最终展示给用户的回答 -->
  </div>
</div>
```

**注意**：实际 DOM 结构可能需要通过 Chrome DevTools 实地验证，以下策略基于常见结构设计。

#### 2.1.2 提取策略

采用 **两阶段 DOM 克隆过滤** 策略（PRD 3.1 方案 3）：

1. **克隆**整个助手消息 DOM 节点
2. **删除**所有与思考区域相关的节点：
   - 包含 "已思考" / "已深度思考" 标题文本的节点
   - class 包含 `think`、`reasoning`、`thought` 的节点
   - 折叠区域 (`<details>`) 中 class/role 匹配思考的节点
3. **读取**剩余文本作为正式回答

同时保留 `thinkContent` 从思考区域单独提取。

---

### 2.2 具体代码修改

#### 2.2.1 新增 `dom-helpers.js` 工具函数

在 `dom-helpers.js` 中新增：

```javascript
/**
 * 从助手消息 DOM 节点中提取正式回答正文，排除思考区域
 * @param {Element} node - 助手消息的 DOM 节点
 * @returns {{ finalReply: string, thinkContent: string }}
 */
extractAssistantContent(node) {
  // 1. 提取思考内容
  const thinkSelectors = [
    '[class*="think"]',
    '[class*="reasoning"]', 
    '[class*="thought"]',
    'details'
  ];
  
  let thinkContent = '';
  for (const selector of thinkSelectors) {
    const thinkEl = node.querySelector(selector);
    if (thinkEl) {
      const text = thinkEl.innerText || thinkEl.textContent || '';
      // 验证是否确实包含思考区域特征文本
      if (text.includes('已思考') || text.includes('已深度思考') || text.includes('reasoning')) {
        thinkContent = text;
        break;
      }
    }
  }

  // 2. 克隆节点并删除思考区域
  const clone = node.cloneNode(true);
  const toRemove = clone.querySelectorAll(
    '[class*="think"], [class*="reasoning"], [class*="thought"], details'
  );
  toRemove.forEach(el => {
    // 检查是否真的是思考区域（避免误删）
    const text = el.innerText || '';
    if (text.includes('已思考') || text.includes('已深度思考') || text.includes('reasoning')) {
      el.remove();
    }
  });

  // 3. 读取剩余文本作为正式回答
  const finalReply = (clone.innerText || clone.textContent || '').trim();

  return { finalReply, thinkContent };
}
```

#### 2.2.2 修改 `chat-reader.js`

**`readChatContent()` 修改**：
- 对 AI 消息节点调用 `DOMHelpers.extractAssistantContent(node)`
- 将返回的 `finalReply` 作为 `content`
- 将返回的 `thinkContent` 保持为单独的字段

**修改后消息结构**：
```javascript
{
  role: 'assistant',
  content: finalReply,           // 只包含正式回答
  thinkContent: thinkContent,    // 思考过程（单独字段）
  codeBlocks: [...],
  // ...
}
```

**`readLatestReply()` 修改**：
- 同样使用 `DOMHelpers.extractAssistantContent(lastBlock)`
- `content` 只包含正式回答
- `thinkContent` 为思考过程

#### 2.2.3 修改 `prompt-controller.js`

**`_waitForReply()` 修改**：
- 在获取 `lastBlock.innerText` 后，使用 `DOMHelpers.extractAssistantContent(lastBlock).finalReply`
- 监控的是正式回答文本的稳定性

#### 2.2.4 修改 `sidepanel.js`

**当前问题**：`content` 中已包含思考文本，所以即便 `renderAiMessage()` 分离了 `content` 和 `thinkContent`，展示仍有问题。

**修改**：无需大规模修改展示层，因为修改提取层后 `content` 已经是干净的正式回答。但需要确保：
- 对于旧数据（存储中已有的混合内容），前端做一层渲染过滤：
  - 如果 `content` 包含 "已思考" / "已深度思考" 开头的段落，在渲染时剪裁掉

#### 2.2.5 Queue Server 存储层检查

需要确认从 content script 发送到 queue server 的消息结构，确保 `reasoning` 和 `final` 分开存储。

---

### 3. 数据模型更新

### 3.1 当前消息结构

```javascript
// chat-reader.js 当前输出
{
  role: 'assistant',
  content: '思考过程文本...正式回答文本...',  // 混合
  thinkContent: '思考过程文本...',             // 也可能存在
  codeBlocks: [...],
}
```

### 3.2 修改后消息结构

```javascript
{
  role: 'assistant',
  content: '正式回答文本...',          // 干净
  thinkContent: '思考过程文本...'      // 单独
  messageType: 'final',                // 新增：标识消息类型
  codeBlocks: [...],
}
```

### 3.3 向后兼容

对于历史数据中已有的混合 `content`，在展示层做判断：
- 如果 `messageType` 不存在，且 `content` 包含 "已思考" 特征文本，触发保守过滤
- 过滤方式：按 `已思考` / `已深度思考` 标题分割，取最后一段

---

## 4. 实施步骤

### Step 1：实地验证 DeepSeek DOM 结构 (优先级: 最高)
- 打开 Chrome DevTools，选择一个包含思考区域的 DeepSeek 助手消息
- 记录 `.ds-markdown` 容器的实际子节点结构
- 确定思考区域和正式回答区域的具体 CSS class / 标签 / 属性
- 确认 `innerText` 是否确实同时包含两者

### Step 2：增加 `DOMHelpers.extractAssistantContent()` (优先级: 高)
- 在 `dom-helpers.js` 中实现该函数
- 基于 Step 1 的 DOM 分析结果选择过滤策略
- 包含重试/兜底逻辑：
  - 如果思考区域节点删除失败，回退到文本分割方案

### Step 3：修改 `chat-reader.js` (优先级: 高)
- `readChatContent()` 中对 AI 消息使用 `extractAssistantContent()`
- `readLatestReply()` 中同样使用
- 增加 `messageType: 'final'` 字段

### Step 4：修改 `prompt-controller.js` (优先级: 高)
- `_waitForReply()` 中监控提取后的正式回答

### Step 5：修改 `sidepanel.js` 渲染兼容 (优先级: 中)
- 对旧数据的 `content` 做保守过滤
- 确保无 `messageType` 的旧数据也能正确渲染

### Step 6：修改 Queue Server 存储 (优先级: 中)
- 确认存储层使用新的消息结构
- 确保 `reasoning` 和 `final` 分开存储

### Step 7：单元测试 (优先级: 高)
- 为 `extractAssistantContent` 编写测试，覆盖以下场景：
  - 思考区域 + 正文（标准情况）
  - 仅正文（无思考区域）
  - 正文中包含 "思考" 字样（避免误过滤）
  - 思考区域有多个子节点
  - 代码块与思考区域共存

### Step 8：集成测试 (优先级: 高)
- 执行 PRD 中的 6 个测试用例

### Step 9：Web Console 前端检查 (优先级: 低)
- 确认 web-console 中最终回复列表的渲染逻辑

---

## 5. 文件修改清单

| 文件 | 修改类型 | 说明 |
|------|----------|------|
| `chromevideo/utils/dom-helpers.js` | 新增函数 | `extractAssistantContent()` |
| `chromevideo/readers/chat-reader.js` | 修改 | `readChatContent()` 和 `readLatestReply()` |
| `chromevideo/controllers/prompt-controller.js` | 修改 | `_waitForReply()` 轮询 |
| `chromevideo/sidepanel.js` | 修改 | `addLogMessage('ai')` / `renderAiMessage()` 旧数据兼容 |
| `queue-server/storage/*` | 检查/修改 | 确认存储字段兼容 |

---

## 6. 测试用例

### 6.1 单元测试（新增）

| ID | 场景 | 输入 | 预期输出 |
|----|------|------|----------|
| UT-001 | 标准思考+回答 | 包含 `<div class="ds-think">` + 正文 | `finalReply` = 仅正文，`thinkContent` = 思考文本 |
| UT-002 | 仅正文 | 无思考区域的普通 markdown | `finalReply` = 完整正文，`thinkContent` = '' |
| UT-003 | 正文含"思考"字样 | 正文中包含 "我思考了一下" | `finalReply` 保留该文本，不被误删 |
| UT-004 | 多层嵌套思考 | 思考区域内有子节点 | 正确过滤所有思考子节点 |
| UT-005 | 空思考区域 | 思考区域存在但无内容 | `finalReply` = 正文，`thinkContent` = '' |

### 6.2 集成测试

执行 PRD 中的 TC-DS-FINAL-001 至 TC-DS-FINAL-006。

---

## 7. 风险与应对

| 风险 | 影响 | 应对措施 |
|------|------|----------|
| DeepSeek DOM 结构变化 | 过滤逻辑失效 | 采用文本关键字兜底 + 日志告警 |
| 误删正式回答 | 内容丢失 | 两阶段验证：DOM 删除前检查关键字匹配 |
| 旧数据兼容 | 历史会话显示混乱 | 前端渲染时做保守过滤 |
| 性能影响 | 克隆 DOM + 多节点查询 | 仅对 AI 消息节点调用（非全页面） |

---

## 8. 时间估算

| 步骤 | 预估时间 | 依赖 |
|------|----------|------|
| Step 1: DOM 验证 | 15-30 分钟 | 无 |
| Step 2: extractAssistantContent | 30-60 分钟 | Step 1 |
| Step 3: chat-reader.js 修改 | 30-45 分钟 | Step 2 |
| Step 4: prompt-controller.js 修改 | 15-30 分钟 | Step 2 |
| Step 5: sidepanel.js 兼容 | 30-45 分钟 | Step 3 |
| Step 6: 存储层检查 | 15-30 分钟 | 无 |
| Step 7: 单元测试 | 30-60 分钟 | Step 2 |
| Step 8: 集成测试 | 30-60 分钟 | Step 3-6 |
| **总计** | **约 3-5 小时** | |

---

## 9. 验证方式

1. `npm test` 确认单元测试通过
2. 打开 DeepSeek 页面，发送 "你好"，观察侧边栏只显示一个最终回复
3. 检查历史会话同步结果
4. 检查代码块和 Markdown 格式是否正确保留

---

## 10. 执行前评估结论与调整约束

本执行计划的总体方向是正确的：根因确实集中在 DeepSeek 助手消息 DOM 的文本提取层。目前 `chromevideo/readers/chat-reader.js` 和 `chromevideo/controllers/prompt-controller.js` 都直接读取助手消息容器的 `innerText` / `textContent`，如果 DeepSeek 将“已思考”区域和正式回答放在同一个助手消息容器内，`content` 和轮询返回值就会混入 reasoning 文本。`chromevideo/sidepanel.js` 本身已经具备 `thinkContent` 与 `content` 的分区渲染能力，所以第一优先级不是重做展示层，而是保证进入展示层的 `content` 已经是干净的最终回答。

需要调整的点如下。

### 10.1 不要把推测 DOM 当成固定事实

计划中对 `.ds-think`、`.ds-markdown-answer` 等结构的描述只能作为假设。执行时必须先用真实 DeepSeek 页面确认 DOM：

1. 记录包含“已思考”的助手消息容器结构。
2. 确认“已思考”区域是否在 `.ds-markdown` 内部，还是作为 `.ds-markdown` 的兄弟节点存在。
3. 确认正式回答是否有稳定容器，是否能直接选择而不需要 clone 后删除。
4. 确认折叠状态、展开状态下 `innerText` 是否一致。

约束：在未确认真实 DOM 前，不要把 class 名写死成唯一判断依据。DeepSeek 的混淆 class 可能变化，稳定性优先级应为：结构关系 > 明确语义属性 > 多选择器组合 > 文本兜底。

### 10.2 第一阶段不要强制引入 `messageType`

计划中提到新增 `messageType: 'final'`。这可以作为后续数据模型优化，但不建议作为第一阶段必做项。

当前 `queue-server/conversations/store.js` 已经把 `thinkContent` 写入 `metadata`，`sidepanel.js` 也从 `message.metadata?.thinkContent` 读取。第一阶段只需要保证：

- `message.content` = 正式回答。
- `message.thinkContent` = 思考过程，可为空。
- `contentHash` 基于干净的 `content` 计算。

约束：除非完整检查所有消费者，否则不要贸然把 `messageType` 作为前后端协议依赖。否则容易出现旧数据、WebSocket 消息、任务结果消息和 Web Console 渲染不一致。

### 10.3 `extractAssistantContent()` 的输出必须保守

建议将 helper 实现为：

```javascript
const { content, thinkContent } = window.DOMHelpers.extractAssistantContent(node);
```

而不是同时混用 `finalReply`、`content` 多套命名。对外返回字段建议直接叫 `content`，这样调用层更不容易误用。

必须满足以下约束：

1. 无法识别思考区域时，返回原始文本，不返回空内容。
2. 只删除高度可信的思考区域节点；不要因为正文里出现“思考”“reasoning”等字样就删除正文。
3. 文本兜底只能处理非常明确的前缀块，例如从开头出现的“已思考（用时...）”块到正式回答前的分隔，不允许全局替换关键字附近文本。
4. 如果 clone 删除后 `content` 为空，但原始文本非空，必须 fallback 到原始文本。
5. 保留代码块提取逻辑，`codeBlocks` 仍然从原始 AI 节点读取，不要从删减后的 clone 读取，以免误删代码。

### 10.4 `prompt-controller.js` 的轮询比较要使用同一套提取逻辑

`_waitForReply()` 目前用 `currentText === lastText` 判断稳定。如果只修改 `chat-reader.js`，自动提交任务返回的 `reply` 仍可能混入 reasoning。

约束：

- 轮询时的 `currentText` 必须来自 `extractAssistantContent(lastBlock).content`。
- 生成中状态仍以 stop button 为主，不要用文本变化替代 stop button。
- 如果最终回答为空但页面仍在生成思考过程，不应提前 resolve 空字符串。
- 超时 fallback 返回 `lastText` 时，也应是清洗后的正式回答文本。

### 10.5 `sidepanel.js` 只做兼容过滤，不做主修复

展示层可以增加旧数据兼容，但不能依赖展示层修复新数据。

约束：

1. `renderAiMessage()` 可以在渲染前调用轻量的 legacy cleaner，但只能处理历史混合内容。
2. 不要在 `renderMarkdown()` 后处理 HTML 字符串，必须在 Markdown 渲染前处理纯文本。
3. 如果 `thinkContent` 已存在，legacy cleaner 不应把同一段 reasoning 再放入最终回复。
4. 对任务结果、系统消息、用户消息不要应用 AI reasoning 过滤。

### 10.6 Queue Server 只需确认，不应扩大改动

目前存储层已将 `thinkContent` 放入 metadata，短期不需要大改 schema。

执行时只需确认：

- `normalizeMessage()` 是否接收并保存清洗后的 `content`。
- `metadata.thinkContent` 是否仍可被 sidepanel 历史会话读取。
- 去重用的 `contentHash` 是否因为清洗后改变而符合预期。

约束：除非测试证明必要，不要修改 SQLite schema 或迁移历史数据。本次目标是阻止新同步数据继续混入 reasoning。

### 10.7 必须补充的测试边界

除原计划测试外，执行时必须增加以下边界：

| ID | 场景 | 预期 |
|---|---|---|
| UT-006 | 思考区域是 `.ds-markdown` 的前一个兄弟节点 | `content` 只含正式回答，`thinkContent` 可读取兄弟节点 |
| UT-007 | 思考区域在 `.ds-markdown` 内部 | clone 删除后 `content` 只含正式回答 |
| UT-008 | 正文包含“我思考了一下” | 正文完整保留 |
| UT-009 | 正文代码块包含 `reasoning` 字符串 | 代码块和正文不被误删 |
| UT-010 | clone 删除后为空 | fallback 到原始文本，避免空最终回复 |

集成测试必须至少覆盖两条链路：

1. 手动读取会话链路：`ChatReader.readChatContent()` / `readLatestReply()`。
2. 自动提交链路：`PromptController.submitPrompt(... waitForReply: true)`。

### 10.8 实施顺序调整

建议按以下顺序执行，降低返工：

1. 真实 DeepSeek DOM 取样，并把关键 DOM 片段记录到测试 fixture 或文档备注。
2. 在 `chromevideo/utils/dom-helpers.js` 增加 `extractAssistantContent()`，保持无外部依赖。
3. 给 helper 写可离线运行的 DOM 样例测试；如果项目没有现成测试框架，先写一个独立 Node/jsdom 或浏览器控制台可运行的验证脚本。
4. 修改 `chat-reader.js`，确保 `contentHash` 使用清洗后的 `content`。
5. 修改 `prompt-controller.js`，确保等待回复返回清洗后的最终回答。
6. 只在必要时给 `sidepanel.js` 加 legacy cleaner。
7. 检查 queue-server 存储和历史读取，不做 schema 迁移。
8. 运行单元样例、真实 DeepSeek 问候测试、多轮测试和历史会话测试。

### 10.9 完成标准

执行完成后必须能证明以下结果：

1. SOLO Coder 中新产生的 AI 消息只出现一个“最终回复”卡片。
2. “最终回复”中不包含“用户发了一个简单的问候”“我需要给出一个友好、自然的回应”等 reasoning 文本。
3. 如果 `thinkContent` 被保留，它只显示在“思考过程”折叠区。
4. 自动提交任务返回的 `reply` 同样不包含 reasoning。
5. 普通 Markdown、代码块和多轮历史会话没有回归。
