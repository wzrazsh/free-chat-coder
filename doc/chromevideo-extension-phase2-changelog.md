# ChromeVideo 扩展 - 阶段 2（操控层）改动记录与验证清单

日期：2026-04-10  
阶段目标：实现 DeepSeek 页面交互能力（Write），为后续 Agent 动作执行与进化闭环提供可复用的页面操控接口。

## 1. 本阶段新增能力（Actions）

以下能力均通过 `content.js` 的 `chrome.runtime.onMessage` 入口对外暴露：

| action | 说明 | 入口实现 |
|---|---|---|
| `submitPrompt` | 增强版发送消息：支持模式预设、附件、系统指令前缀、打字速度、可选等待回复 | [content.js](file:///workspace/chromevideo/content.js) → [prompt-controller.js](file:///workspace/chromevideo/controllers/prompt-controller.js) |
| `setModelMode` | 切换“深度思考 / 联网搜索”开关（按需点击，避免重复切换） | [content.js](file:///workspace/chromevideo/content.js) → [mode-controller.js](file:///workspace/chromevideo/controllers/mode-controller.js) |
| `uploadAttachment` | 上传图片/文件附件（base64 → File → input[type=file]） | [content.js](file:///workspace/chromevideo/content.js) → [upload-controller.js](file:///workspace/chromevideo/controllers/upload-controller.js) |
| `captureScreenshot` | 捕获视口截图；支持 element 裁剪；可选自动上传到对话 | [content.js](file:///workspace/chromevideo/content.js) → [screenshot-controller.js](file:///workspace/chromevideo/controllers/screenshot-controller.js) |
| `createSession` | 创建新会话（点击“开启新对话/新对话”按钮） | [content.js](file:///workspace/chromevideo/content.js) → [session-controller.js](file:///workspace/chromevideo/controllers/session-controller.js) |
| `switchSession` | 切换会话（按 sessionId 或 titleMatch 匹配） | [content.js](file:///workspace/chromevideo/content.js) → [session-controller.js](file:///workspace/chromevideo/controllers/session-controller.js) |

## 2. 关键实现点

- 模拟输入统一收敛到 [anti-detection.js](file:///workspace/chromevideo/utils/anti-detection.js)，提供 `human/fast/instant` 三档速度。
- `captureScreenshot` 通过 Service Worker 调用 `chrome.tabs.captureVisibleTab` 获取视口截图，并在 content 侧进行元素裁剪。
- 兼容旧协议：background 仍可传 `prompt` 字段；新协议可传 `params` 对象（推荐）。

## 3. 清单：修改/新增文件

### 3.1 新增文件

- [anti-detection.js](file:///workspace/chromevideo/utils/anti-detection.js)
- [mode-controller.js](file:///workspace/chromevideo/controllers/mode-controller.js)
- [upload-controller.js](file:///workspace/chromevideo/controllers/upload-controller.js)
- [screenshot-controller.js](file:///workspace/chromevideo/controllers/screenshot-controller.js)
- [session-controller.js](file:///workspace/chromevideo/controllers/session-controller.js)
- [prompt-controller.js](file:///workspace/chromevideo/controllers/prompt-controller.js)

### 3.2 修改文件

- [manifest.json](file:///workspace/chromevideo/manifest.json)
  - `permissions` 增加 `tabs`、`activeTab`（用于截图）。
  - `content_scripts[0].js` 增加 `utils/anti-detection.js` 与 `controllers/*` 注入顺序。
- [content.js](file:///workspace/chromevideo/content.js)
  - `submitPrompt` 由增强版 PromptController 接管。
  - 新增操控层 action 路由：`setModelMode/uploadAttachment/captureScreenshot/createSession/switchSession`。
- [background.js](file:///workspace/chromevideo/background.js)
  - 新增 `capture_screenshot` 消息处理，调用 `chrome.tabs.captureVisibleTab`。
  - 注入脚本列表更新为与 manifest 一致，避免只注入 `content.js` 导致依赖缺失。

## 4. 验证前置条件

1. 在 Chrome 打开 `chrome://extensions`，找到扩展并点击“重新加载/更新”（新增了脚本文件和权限）。
2. 在扩展详情页确认权限提示已通过（截图能力需要 `tabs/activeTab`）。
3. 打开 DeepSeek 页面（`https://chat.deepseek.com/*`）并进入任意会话。

## 5. 功能验证步骤（推荐）

在 DeepSeek 页面打开 DevTools → Console 执行。

### 5.1 setModelMode

```js
chrome.runtime.sendMessage({
  action: "setModelMode",
  params: { deepThink: true, search: null }
}, console.log);
```

预期：深度思考被打开（如果页面支持且选择器命中）。

### 5.2 submitPrompt（instant + 不等待回复）

```js
chrome.runtime.sendMessage({
  action: "submitPrompt",
  params: {
    prompt: "阶段2验证：instant 输入，不等待回复。",
    typingSpeed: "instant",
    waitForReply: false
  }
}, console.log);
```

预期：消息被发送，返回 `success: true`。

### 5.3 submitPrompt（human + 等待回复）

```js
chrome.runtime.sendMessage({
  action: "submitPrompt",
  params: {
    prompt: "阶段2验证：human 输入，等待回复。请回复 OK。",
    typingSpeed: "human",
    waitForReply: true,
    replyTimeout: 120000
  }
}, console.log);
```

预期：返回 `reply` 字段。

### 5.4 captureScreenshot（viewport）

```js
chrome.runtime.sendMessage({
  action: "captureScreenshot",
  params: { target: "viewport", uploadToChat: false, returnBase64: true }
}, (r) => console.log(r?.data?.base64?.slice(0, 80), r));
```

预期：返回 `data.base64` 为 `data:image/png;base64,...`。

### 5.5 captureScreenshot（element 裁剪）

```js
chrome.runtime.sendMessage({
  action: "captureScreenshot",
  params: { target: "element", elementSelector: ".ds-markdown", uploadToChat: false, returnBase64: true }
}, (r) => console.log(r?.data?.base64?.slice(0, 80), r));
```

预期：返回裁剪后的 `data.base64`（若选择器匹配不到会返回 `ElementNotFound`）。

### 5.6 createSession

```js
chrome.runtime.sendMessage({ action: "createSession", params: {} }, console.log);
```

预期：打开一个新对话（如果按钮文案命中）。

### 5.7 switchSession（titleMatch）

```js
chrome.runtime.sendMessage({
  action: "switchSession",
  params: { titleMatch: "evolve" }
}, console.log);
```

预期：切换到标题包含 `evolve` 的会话（如果存在）。

## 6. 已知限制（本阶段合理的“先跑通”取舍）

- `captureScreenshot` 目前支持 `viewport` 与 `element`，`fullpage` 未实现。
- `uploadAttachment` 依赖页面存在 `input[type=file]`，若 DeepSeek UI 改为动态创建，需要后续增强选择器与触发流程。
- `createSession` / `switchSession` 依赖按钮文案与链接结构，后续可以通过更稳定的结构化 DOM 路径升级。

