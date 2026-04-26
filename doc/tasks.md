# Tasks - free-chat-coder 优化计划

> 生成日期：2026-04-25  
> 优先级：高优先级任务（3-5 个）  
> 核心目标：页面操作体验优化 + Patch Review 补丁模式

---

## Task 1: Patch 数据层实现

**优先级**：P0  
**预估工时**：2-3 小时  
**依赖**：无

### 任务描述
实现 Patch Review 的数据层基础设施，包括数据库表和存储模块。

### 具体步骤

- [ ] 1.1 在 `queue-server/storage/sqlite.js` 中新增 `patches` 和 `patch_events` 表
  ```sql
  CREATE TABLE patches (
    id TEXT PRIMARY KEY,
    task_id TEXT,
    conversation_id TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    summary TEXT,
    changes TEXT,  -- JSON 数组
    risk_level TEXT DEFAULT 'medium',
    source TEXT DEFAULT 'deepseek',
    created_at TEXT,
    updated_at TEXT
  );

  CREATE TABLE patch_events (
    id TEXT PRIMARY KEY,
    patch_id TEXT,
    event TEXT,
    actor TEXT,
    timestamp TEXT,
    details TEXT,
    FOREIGN KEY (patch_id) REFERENCES patches(id)
  );
  ```

- [ ] 1.2 创建 `queue-server/storage/patch-store.js`
  - 实现 `createPatch(patchData)` - 创建 patch 提案
  - 实现 `getPatches(filters)` - 查询 patch 列表
  - 实现 `getPatch(patchId)` - 获取单个 patch
  - 实现 `updatePatchStatus(patchId, status)` - 更新状态
  - 实现 `validatePatch(patch)` - 验证安全性
  - 实现 `applyPatch(patchId, workspacePath)` - 应用到文件系统

- [ ] 1.3 创建 `queue-server/actions/diff-generator.js`
  - 实现 `generateUnifiedDiff(oldContent, newContent, filePath)` - 生成 unified diff
  - 实现 `parseUnifiedDiff(diffText)` - 解析为结构化数据
  - 实现 `validateDiffPaths(diff, workspacePath)` - 路径安全校验

### 验收标准
- [ ] patch-store 模块能正确创建、读取、更新 patch 数据
- [ ] diff-generator 能生成正确的 unified diff
- [ ] 路径校验能阻止 workspace 外的文件修改

---

## Task 2: Patch Parser 与 Custom Handler 集成

**优先级**：P0  
**预估工时**：2-3 小时  
**依赖**：Task 1

### 任务描述
实现从 DeepSeek 回复中解析 patch 提案，并集成到 custom-handler 流程中。

### 具体步骤

- [ ] 2.1 创建 `queue-server/actions/patch-parser.js`
  - 实现 `parsePatchProposal(replyText)` - 从 DeepSeek 回复解析 patch
  - 实现 `hasPatchProposal(replyText)` - 检测是否包含 patch
  - 实现 `extractFileModifications(replyText)` - 提取代码修改建议

- [ ] 2.2 修改 `queue-server/custom-handler.js`
  - 在 `processResult()` 中调用 `patch-parser` 检测 patch
  - 如果检测到 patch，调用 `patch-store.createPatch()` 创建提案
  - 更新任务状态为 `waiting_approval`
  - 通过 WebSocket 广播 patch 提案事件

- [ ] 2.3 修改 `queue-server/websocket/handler.js`
  - 新增 patch 相关广播函数
  - 广播 `patch_created`、`patch_updated` 事件

### 验收标准
- [ ] DeepSeek 回复包含代码修改建议时，自动生成 patch 提案
- [ ] patch 提案状态为 `draft`，等待验证
- [ ] Web Console 能收到 patch 创建通知

---

## Task 3: Patch Review REST API

**优先级**：P0  
**预估工时**：1-2 小时  
**依赖**：Task 1

### 任务描述
实现 Patch Review 的 REST API，供前端调用。

### 具体步骤

- [ ] 3.1 创建 `queue-server/routes/patches.js`
  - `GET /` - 获取 patch 列表
  - `POST /` - 创建 patch（手动创建入口）
  - `GET /:id` - 获取 patch 详情
  - `POST /:id/validate` - 验证 patch 安全性
  - `POST /:id/approve` - 批准 patch
  - `POST /:id/reject` - 拒绝 patch
  - `POST /:id/apply` - 应用 patch
  - `GET /:id/diff` - 获取格式化 diff

- [ ] 3.2 修改 `queue-server/index.js`
  - 挂载 `/patches` 路由

### 验收标准
- [ ] 所有 API 端点正确响应
- [ ] 批准后 patch 状态变为 `approved`，应用后变为 `applied`
- [ ] 拒绝后 patch 状态变为 `rejected`

---

## Task 4: Web Console Patch Review 面板

**优先级**：P1  
**预估工时**：3-4 小时  
**依赖**：Task 3

### 任务描述
在 Web Console 中实现 Patch Review 面板，展示 patch 列表和 diff 预览。

### 具体步骤

- [ ] 4.1 创建 `web-console/src/components/DiffViewer.tsx`
  - 实现 diff 可视化组件
  - 支持行级别的新增/删除高亮
  - 支持文件折叠/展开

- [ ] 4.2 创建 `web-console/src/components/PatchReviewPanel.tsx`
  - 实现 patch 列表组件
  - 实现 patch 详情查看
  - 实现 Approve/Reject 按钮

- [ ] 4.3 修改 `web-console/src/App.tsx`
  - 集成 `PatchReviewPanel` 组件
  - 添加 WebSocket 监听 patch 事件
  - 添加 patch 区域到侧边栏

### 验收标准
- [ ] Web Console 显示 patch 列表
- [ ] 点击 patch 显示 diff 预览
- [ ] 能正确执行 approve/reject 操作

---

## Task 5: Side Panel Patch 审批入口

**优先级**：P1  
**预估工时**：2-3 小时  
**依赖**：Task 4

### 任务描述
在 Chrome 扩展 Side Panel 中添加 patch 审批入口和状态展示。

### 具体步骤

- [ ] 5.1 创建 `chromevideo/sidepanel-patch.css`
  - 定义 patch 审批相关样式

- [ ] 5.2 修改 `chromevideo/sidepanel.html`
  - 添加 patch 审批区域 UI

- [ ] 5.3 修改 `chromevideo/sidepanel.js`
  - 实现 patch 状态监听
  - 实现 patch 审批交互
  - 添加 WebSocket 或轮询获取 patch 更新

### 验收标准
- [ ] Side Panel 能显示待审批的 patch
- [ ] 能直接在 Side Panel 中查看 diff 和执行审批
- [ ] 审批结果同步到 Web Console

---

## 实现顺序

```
Task 1 (Patch 数据层)
    ↓
Task 3 (REST API)
    ↓
Task 2 (Parser 集成) ← 可与 Task 3 并行
    ↓
Task 4 (Web Console)
    ↓
Task 5 (Side Panel)
```

## 文档参考

详细技术方案请参考 `@implementation_plan.md`

---

## 附录：快捷命令

```bash
# 语法检查
node -c queue-server/storage/sqlite.js
node -c queue-server/storage/patch-store.js
node -c queue-server/actions/patch-parser.js
node -c queue-server/actions/diff-generator.js

# Web Console 构建
cd web-console && npm run build

# 运行测试（后续实现）
node queue-server/test-patch-parser.js
node queue-server/test-diff-generator.js
node queue-server/test-patch-store.js
```
