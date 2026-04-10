# Free Chat Coder

本地部署的自动化编程辅助系统，通过 Chrome 扩展自动与 DeepSeek WebChat 交互，配合任务队列服务器和 Web 控制台实现"AI 辅助编程"的自动化闭环，并支持系统自我进化。

## 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                      浏览器环境                          │
│  ┌──────────────┐   ┌────────────────────────────────┐  │
│  │  DeepSeek     │◄──│ Chrome 扩展 (Manifest V3)      │  │
│  │  WebChat 页面 │   │  ┌──────────┐ ┌─────────────┐ │  │
│  └──────────────┘   │  │Service   │ │ Offscreen    │ │  │
│                     │  │Worker    │ │ Document     │ │  │
│                     │  └──────────┘ └─────────────┘ │  │
│                     │  ┌──────────────────────────┐ │  │
│                     │  │ Content Script           │ │  │
│                     │  └──────────────────────────┘ │  │
│                     └────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────┘
                           │ WebSocket
┌──────────────────────────▼──────────────────────────────┐
│                       本地服务                           │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────┐  │
│  │ Queue-Server │   │ Web 控制台    │   │ Web IDE    │  │
│  │ :8082        │◄──│ :5173        │   │ :8081      │  │
│  │ Node.js+WS   │   │ React+Monaco │   │ code-server│  │
│  └──────────────┘   └──────────────┘   └────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## 组件说明

### Queue-Server (`queue-server/`)

任务队列中枢，负责管理任务生命周期、WebSocket 双向通信和自我进化机制。

| 文件 | 功能 |
|---|---|
| `index.js` | 入口，启动 HTTP + WebSocket 服务 |
| `queue/manager.js` | 内存任务队列（Map + 数组），支持 JSON 文件持久化 |
| `routes/tasks.js` | RESTful API：任务 CRUD |
| `websocket/handler.js` | WebSocket 连接管理，区分扩展/Web 客户端，任务分发 |
| `evolution/hot-reload.js` | `/evolve` API：语法校验 → 备份 → 写入 → 加载验证 → 回滚 → 重启 |
| `evolution/extension-watcher.js` | 监听 Chrome 扩展目录变更，通知扩展热重载 |
| `custom-handler.js` | 可进化的自定义逻辑模块，导出 `processTask(task)` |

**API 端点：**

| 方法 | 路径 | 功能 |
|---|---|---|
| GET | `/health` | 健康检查 |
| GET | `/tasks` | 获取所有任务及下一个待处理任务 |
| POST | `/tasks` | 创建新任务 `{ prompt, options }` |
| PATCH | `/tasks/:id` | 更新任务状态 `{ status, result?, error? }` |
| GET | `/evolve` | 获取当前 custom-handler.js 代码 |
| POST | `/evolve` | 提交新代码触发进化 `{ code }` |

**WebSocket 协议：**

| 方向 | 事件 | 说明 |
|---|---|---|
| 客户端 → 服务器 | `register` | 注册（`clientType: "extension" \| "web"`） |
| 客户端 → 服务器 | `task_update` | 任务状态更新 |
| 客户端 → 服务器 | `ping` | 心跳 |
| 服务器 → 扩展 | `task_assigned` | 推送新任务 |
| 服务器 → 扩展 | `reload_extension` | 通知扩展重载 |
| 服务器 → Web | `task_added` / `task_update` | 任务变更通知 |
| 服务器 → 客户端 | `pong` | 心跳响应 |

### Chrome 扩展 (`chromevideo/`)

与 DeepSeek 网页自动交互的桥梁。

| 文件 | 功能 |
|---|---|
| `manifest.json` | Manifest V3 配置，声明权限和内容脚本 |
| `background.js` | Service Worker：管理 Offscreen 文档、调度任务执行 |
| `offscreen.js` | Offscreen 文档：维持与 Queue-Server 的持久 WebSocket 连接 |
| `offscreen.html` | Offscreen 文档 HTML 容器 |
| `content.js` | 注入到 DeepSeek 页面的内容脚本：模拟输入、点击发送、等待回复 |

**内容脚本特性：**
- 模拟人类打字（随机分块输入，3-15 字符/块，随机延迟 30-120ms）
- 多重选择器降级查找输入框和发送按钮
- 轮询检测 AI 回复完成（500ms 间隔，连续 10 次无变化判定完成）
- 2 分钟超时保护，超时返回已生成的部分回复

### Web 控制台 (`web-console/`)

基于 React + Monaco Editor 的任务管理界面。

**技术栈：** Vite + React 19 + TypeScript + Tailwind CSS 4 + Monaco Editor

**功能：**
- 任务提交（Monaco 编辑器输入 Prompt）
- 任务队列实时展示（WebSocket 推送状态更新）
- 结果/错误详情展示
- "Evolve Handler" 弹窗：在线编辑 `custom-handler.js` 并触发服务器重启
- 导航栏切换 Console / Web IDE

**Vite 代理配置：**
- `/api` → Queue-Server HTTP
- `/ws` → Queue-Server WebSocket
- `/ide` → Web IDE (code-server)

### Web IDE (`code-server/`)

内嵌的 code-server（VS Code 浏览器版），提供在线代码编辑能力，通过控制台导航栏 "Web IDE" 入口访问。

### 共享配置 (`shared/config.js`)

统一管理所有模块的连接地址和端口：

| 配置项 | 默认值 | 环境变量 |
|---|---|---|
| Queue-Server 端口 | `8082` | `QUEUE_PORT` |
| Queue-Server 主机 | `127.0.0.1` | `QUEUE_HOST` |
| Web IDE 端口 | `8081` | `WEB_IDE_PORT` |
| Web IDE 主机 | `127.0.0.1` | `WEB_IDE_HOST` |
| 工作区路径 | `E:/workspace/free-chat-coder` | `WORKSPACE_PATH` |

### 辅助脚本 (`scripts/sync-config.js`)

将 `shared/config.js` 中的端口配置同步到 Chrome 扩展的 `offscreen.js` 和 `manifest.json`，消除硬编码不一致。

## 数据流

```
用户在控制台输入 Prompt
  → POST /api/tasks → Queue-Server 创建任务
  → Server 通过 WebSocket 推送 task_assigned 给 Offscreen
  → Offscreen 转发给 Service Worker
  → Service Worker 查找/创建 DeepSeek 标签页
  → Content Script 模拟输入 + 点击发送
  → Content Script 轮询等待 AI 回复
  → 回复沿原路返回：Content → SW → Offscreen → Server
  → Server 广播 task_update 给 Web 控制台
```

## 自我进化机制

1. 用户在控制台点击 "Evolve Handler" 打开 Monaco 编辑器
2. 修改 `custom-handler.js` 代码（`processTask` 函数）
3. 点击 "Save & Restart Server"
4. Server 执行：语法检查 → 备份旧文件 → 写入新代码 → 加载验证 → 失败则回滚
5. 验证通过后 `process.exit(0)`，nodemon 自动重启加载新代码
6. Chrome 扩展 WebSocket 断开后自动重连，系统以新逻辑运行

## 快速启动

### 前置要求

- Node.js ≥ 18
- Chrome 浏览器
- pnpm 或 npm

### 1. 启动 Queue-Server

```bash
cd queue-server
npm install
npm run dev
```

服务将在 `http://127.0.0.1:8082` 启动。

### 2. 启动 Web 控制台

```bash
cd web-console
npm install
npm run dev
```

控制台将在 `http://localhost:5173` 启动。

### 3. 加载 Chrome 扩展

1. 打开 `chrome://extensions/`
2. 开启"开发者模式"
3. 点击"加载已解压的扩展程序"，选择 `chromevideo` 目录
4. 扩展安装后自动创建 Offscreen 文档并连接 Queue-Server

### 4. (可选) 同步配置

修改 `shared/config.js` 中的端口后，运行：

```bash
node scripts/sync-config.js
```

将新配置同步到 Chrome 扩展。

## 项目状态

| 迭代 | 内容 | 状态 |
|---|---|---|
| 迭代 0 | 基础骨架：HTTP + WebSocket + 扩展连接 | ✅ 已完成 |
| 迭代 1 | 最小闭环：端到端任务流 | ✅ 已完成 |
| 迭代 2 | 编辑器与进化：Monaco + 热重载 + 语法校验 + 回滚 | ✅ 已完成 |
| 迭代 3 | 健壮性：持久化、防检测、多账号池 | 🔄 进行中 |

**已实现的增强（超出原始设计）：**
- 任务持久化到 `data/tasks.json`（迭代 3 提前实现）
- `/evolve` 接口增加语法校验（`vm.Script`）和模块加载验证
- 进化失败自动回滚（备份 `.bak` 文件）
- Chrome 扩展目录监听 + 热重载通知
- 统一配置管理（`shared/config.js`）
- Web IDE 集成（code-server）
- 内容脚本模拟人类打字（随机分块 + 随机延迟）
