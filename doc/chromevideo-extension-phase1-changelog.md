# ChromeVideo 扩展 - 阶段 1（感知层）改动记录与验证清单

日期：2026-04-10  
阶段目标：实现 DeepSeek 页面状态的读取能力（Read），为后续“操控层 / Agent 层 / 进化层”提供稳定的数据入口。

## 1. 本阶段新增能力（Actions）

以下能力均通过 `content.js` 的 `chrome.runtime.onMessage` 入口对外暴露：

| action | 说明 | 入口实现 |
|---|---|---|
| `readChatContent` | 读取当前会话的聊天记录（含代码块、可选 think 内容） | [content.js](file:///workspace/chromevideo/content.js) → [chat-reader.js](file:///workspace/chromevideo/readers/chat-reader.js) |
| `readLatestReply` | 读取 AI 最新一条回复（含代码块、生成完成状态） | [content.js](file:///workspace/chromevideo/content.js) → [chat-reader.js](file:///workspace/chromevideo/readers/chat-reader.js) |
| `readSessionList` | 读取左侧会话列表（标题、href、粗略时间分组、是否激活） | [content.js](file:///workspace/chromevideo/content.js) → [session-reader.js](file:///workspace/chromevideo/readers/session-reader.js) |
| `readModelState` | 读取“深度思考 / 联网搜索”等按钮的当前状态（启用/禁用） | [content.js](file:///workspace/chromevideo/content.js) → [model-reader.js](file:///workspace/chromevideo/readers/model-reader.js) |
| `readPageState` | 读取页面整体状态（是否在生成、输入框可用、是否登录、错误提示） | [content.js](file:///workspace/chromevideo/content.js) → [page-state-reader.js](file:///workspace/chromevideo/readers/page-state-reader.js) |

## 2. 目录结构变更

在 [chromevideo](file:///workspace/chromevideo) 下新增了以下目录（阶段 1 实际使用到 `utils/` 与 `readers/`）：

- `utils/`
  - [dom-helpers.js](file:///workspace/chromevideo/utils/dom-helpers.js)：DOM 辅助函数（等待元素、按文本查找、模拟输入）
- `readers/`
  - [chat-reader.js](file:///workspace/chromevideo/readers/chat-reader.js)
  - [session-reader.js](file:///workspace/chromevideo/readers/session-reader.js)
  - [model-reader.js](file:///workspace/chromevideo/readers/model-reader.js)
  - [page-state-reader.js](file:///workspace/chromevideo/readers/page-state-reader.js)

## 3. 清单：修改/新增文件

### 3.1 新增文件

- [dom-helpers.js](file:///workspace/chromevideo/utils/dom-helpers.js)
- [chat-reader.js](file:///workspace/chromevideo/readers/chat-reader.js)
- [session-reader.js](file:///workspace/chromevideo/readers/session-reader.js)
- [model-reader.js](file:///workspace/chromevideo/readers/model-reader.js)
- [page-state-reader.js](file:///workspace/chromevideo/readers/page-state-reader.js)

### 3.2 修改文件

- [manifest.json](file:///workspace/chromevideo/manifest.json)
  - `content_scripts[0].js` 按顺序引入 `utils/*` 与 `readers/*`，确保 `content.js` 能调用 `window.*Reader`。
- [content.js](file:///workspace/chromevideo/content.js)
  - 在现有 `submitPrompt` 入口之前新增“感知层 action 路由”，将 `action` 分发给各 Reader。

## 4. 验证前置条件

1. 在 Chrome 打开 `chrome://extensions`，找到扩展并点击“重新加载/更新”（因为新增了脚本文件，热更新通常不够）。
2. 确保已打开 DeepSeek 页面（`https://chat.deepseek.com/*`），并进入任意会话。

## 5. 功能验证步骤（推荐）

在 DeepSeek 页面打开 DevTools → Console，执行以下代码（注意：必须在注入了 content script 的 DeepSeek 标签页中执行）。

### 5.1 readPageState

```js
chrome.runtime.sendMessage({ action: "readPageState", params: {} }, console.log);
```

预期：返回 `success: true`，包含 `isGenerating / isInputReady / currentUrl / isLoggedIn` 等字段。

### 5.2 readModelState

```js
chrome.runtime.sendMessage({ action: "readModelState", params: {} }, console.log);
```

预期：返回 `deepThink.enabled`、`search.enabled` 布尔值（受页面 DOM 影响，若按钮文案或结构变化可能为 false）。

### 5.3 readSessionList

```js
chrome.runtime.sendMessage({ action: "readSessionList", params: { includeDates: true } }, console.log);
```

预期：返回 `sessions[]` 数组，每项包含 `id/title/href/dateGroup/isActive`。

### 5.4 readChatContent（全部）

```js
chrome.runtime.sendMessage({
  action: "readChatContent",
  params: { format: "text", includeUserMessages: true, includeAiMessages: true, startIndex: 0, count: -1 }
}, console.log);
```

预期：返回 `messages[]`，并在 AI 消息中尽可能提取 `codeBlocks`。

### 5.5 readLatestReply

```js
chrome.runtime.sendMessage({
  action: "readLatestReply",
  params: { includeCodeBlocks: true, includeThinkContent: true }
}, console.log);
```

预期：返回 `data.content`，并且 `data.isComplete` 在停止生成后应为 `true`。

## 6. 已知限制（本阶段合理的“先跑通”取舍）

- 读取逻辑依赖 DeepSeek 页面 DOM，选择器是启发式的；页面升级后可能需要调优。
- `readChatContent` 的用户/AI 角色区分目前为简化推断，后续可在“操控层/Agent 层”配合更稳定的消息容器选择器升级。
- 会话列表的 `dateGroup` 目前为粗略向上查找，后续可改为按分组容器结构解析。

