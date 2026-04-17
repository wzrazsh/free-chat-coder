---
name: sidepanel-ui-redesign
overview: 重构 Chrome 扩展侧边栏 UI：从控制面板布局改为"对话+日志"中心布局，设置功能收进右上角齿轮按钮，底部加聊天输入框直接发送 prompt 给 DeepSeek
design:
  architecture:
    framework: html
  styleKeywords:
    - Dark Mode
    - Glassmorphism
    - Chat UI
    - Tech
  fontSystem:
    fontFamily: PingFang-SC
    heading:
      size: 16px
      weight: 600
    subheading:
      size: 13px
      weight: 500
    body:
      size: 13px
      weight: 400
  colorSystem:
    primary:
      - "#6366f1"
      - "#818cf8"
      - "#4f46e5"
    background:
      - "#1a1a2e"
      - "#16213e"
      - "#0f3460"
    text:
      - "#e2e8f0"
      - "#94a3b8"
      - "#ffffff"
    functional:
      - "#10b981"
      - "#ef4444"
      - "#f59e0b"
      - "#3b82f6"
todos:
  - id: rewrite-sidepanel-html
    content: 重写 sidepanel.html：主视图(头部+日志区+输入框) + 设置视图(服务控制+进化面板)
    status: completed
  - id: rewrite-sidepanel-js
    content: 重写 sidepanel.js：视图切换、聊天发送、日志渲染、Native Host 通信、设置逻辑
    status: completed
    dependencies:
      - rewrite-sidepanel-html
  - id: modify-background-js
    content: 改造 background.js：新增 sidepanel_chat 消息路由和 chat_reply 回传逻辑
    status: completed
    dependencies:
      - rewrite-sidepanel-js
  - id: test-integration
    content: 测试完整流程：聊天发送→日志显示→设置操作→视图切换
    status: completed
    dependencies:
      - modify-background-js
---

## 产品概述

重新设计 Chrome 扩展侧边栏 UI，从"控制面板"布局转为"对话 + 日志"为中心的布局，服务控制操作收入设置页面。

## 核心功能

- **主界面**：中间区域显示 DeepSeek 输出内容和 Queue Server 执行结果日志（自动滚动，分角色/来源着色显示）；底部为聊天输入框，可直接输入 prompt 发送给 DeepSeek
- **设置页面**：右上角齿轮按钮打开，包含 Queue Server 启停、Web Console 启停、DeepSeek Agent 操作、自动进化控制等原有功能
- **头部**：保留标题 + 连接状态指示 + 齿轮设置按钮
- **日志类型**：用户消息、DeepSeek 回复、Queue Server 任务结果、系统消息（连接/错误），每种类型有不同的视觉标识

## Tech Stack

- Chrome Extension Side Panel (Manifest V3)
- 原生 HTML/CSS/JavaScript（与现有项目保持一致，不引入框架）
- Chrome Extension APIs: sidePanel, runtime.sendMessage, tabs, storage, nativeMessaging

## Implementation Approach

采用**单页面视图切换**方案——在 `sidepanel.html` 中同时包含主视图和设置视图，通过 CSS 显示/隐藏切换。这比多 HTML 页面方案更简单，且共享同一个 Native Host 连接和状态管理。

**核心数据流改造**：

- **聊天发送**：sidepanel 输入 → `chrome.runtime.sendMessage({type:'sidepanel_chat', prompt})` → background.js 转发 → content.js submitPrompt → waitForReply → background.js 回传 → sidepanel 显示
- **日志采集**：background.js 监听所有 task_update / heartbeat / 错误消息 → 转发给 sidepanel → 追加到日志区域
- **设置操作**：保留现有 Native Host 通信机制（connectHost / sendCommand），迁移到设置视图中

**关键技术决策**：

1. 不新建单独的 settings.html，用 CSS 视图切换避免多页面间的状态同步问题
2. 聊天消息发送走 background.js 中转（与现有 executeDeepSeekTask 流程类似，但更轻量），而不是让 sidepanel 直连 content script
3. 日志区域使用 `innerHTML` 追加而非 DOM 操作库，保持零依赖
4. 自动滚动到最新消息，但用户向上滚动时暂停自动滚动

## Implementation Notes

- 聊天消息发送需要先确保 DeepSeek 标签页存在（复用 background.js 中已有的标签页查找/创建逻辑）
- content.js 的 `waitForReply()` 可能返回 Markdown 格式文本，日志区域需简单渲染（至少支持代码块显示）
- Native Host 断开时应在主界面头部状态条显示，而非弹出 alert
- 保留 3 秒状态轮询机制，但改为后台运行（不阻塞 UI）
- 设置页面的自动进化 textarea 需保留原有功能

## Architecture Design

```
sidepanel.html/js
├── 主视图 (#main-view)
│   ├── 头部栏 (标题 + 连接状态 + ⚙️按钮)
│   ├── 日志区域 (#log-area) ← 自动滚动
│   │   ├── 用户消息 (右对齐，蓝色)
│   │   ├── DeepSeek 回复 (左对齐，深色)
│   │   ├── 系统消息 (居中，灰色)
│   │   └── 任务结果 (左对齐，绿色/红色)
│   └── 输入区域 (textarea + 发送按钮)
└── 设置视图 (#settings-view) ← 齿轮切换
    ├── 返回按钮
    ├── Queue Server 卡片
    ├── Web Console 卡片
    ├── DeepSeek Agent 卡片
    └── 自动进化卡片

background.js (改造)
├── 新增 sidepanel_chat 消息处理
├── 新增 chat_reply 回传给 sidepanel
└── 保留所有现有功能

content.js (不改)
└── submitPrompt / waitForReply 不变
```

## Directory Structure

```
chromevideo/
├── sidepanel.html     # [MODIFY] 完全重写：主视图(日志+聊天) + 设置视图
├── sidepanel.js       # [MODIFY] 完全重写：聊天发送、日志显示、视图切换、设置逻辑
├── background.js      # [MODIFY] 新增 sidepanel_chat 消息路由，新增 chat_reply 回传
├── popup.html         # [保留] 不改动
├── popup.js           # [保留] 不改动
├── content.js         # [保留] 不改动
├── manifest.json      # [保留] 不改动
└── offscreen.js       # [保留] 不改动
```

## 设计风格

采用现代深色科技风格，参考 ChatGPT/Claude 侧边栏设计，与 DeepSeek 页面风格呼应。背景使用深色（#1a1a2e），日志区域使用略浅的卡片色，消息气泡带微圆角和微阴影。

## 主视图布局

- **头部栏**：固定顶部，深色背景，左侧 Logo + 标题，中间连接状态指示灯，右侧齿轮按钮
- **日志区域**：flex-grow 占满剩余空间，内部可滚动，消息从上到下排列。用户消息右对齐蓝色气泡，AI 回复左对齐深灰气泡，系统消息居中半透明，任务结果左对齐带状态图标
- **输入区域**：固定底部，深色背景，圆角输入框 + 发送按钮，回车发送 Shift+回车换行

## 设置视图布局

- 从右侧滑入覆盖（或全屏切换），深色背景，标题栏左侧返回箭头
- 各设置项用卡片分隔，保留原有的启停按钮和状态指示

## 交互动效

- 视图切换：slide 过渡动画
- 消息出现：fade-in + 轻微上移
- 齿轮按钮：hover 旋转
- 发送按钮：点击缩放反馈