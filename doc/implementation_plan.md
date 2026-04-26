# Implementation Plan

[Overview]
优化 free-chat-coder 的页面操作体验并实现 Patch Review 补丁模式。聚焦于 Side Panel 和 Web Console 的交互改进，以及文件修改的 diff 预览和人工确认流程。

[Types]

## Patch 数据模型

```typescript
interface Patch {
  id: string;                    // patch-xxx
  taskId: string;                // 关联任务
  conversationId?: string;       // 关联会话
  status: 'draft' | 'parsed' | 'validated' | 'approved' | 'rejected' | 'applied' | 'failed';
  summary: string;               // 修改摘要
  changes: PatchChange[];         // 文件变更列表
  riskLevel: 'low' | 'medium' | 'high';
  source: 'deepseek' | 'manual';
  createdAt: string;
  updatedAt: string;
}

interface PatchChange {
  path: string;                  // 文件路径
  oldContent?: string;           // 原内容（用于生成 diff）
  newContent: string;            // 新内容
  diff?: string;                 // 生成的 unified diff
  changeType: 'create' | 'modify' | 'delete';
}

interface PatchReviewEvent {
  id: string;
  patchId: string;
  event: 'created' | 'parsed' | 'validated' | 'approved' | 'rejected' | 'applied';
  actor: 'system' | 'user' | 'ai';
  timestamp: string;
  details?: string;
}
```

## 任务状态扩展

```typescript
interface Task {
  // 现有字段...
  status: 'pending' | 'processing' | 'waiting_approval' | 'completed' | 'failed';
  // 新增字段
  patchId?: string;              // 关联的补丁提案
}
```

## Diff 预览数据结构

```typescript
interface DiffPreview {
  patchId: string;
  files: DiffFile[];
  totalChanges: number;
  riskWarnings: string[];        // 风险警告列表
}

interface DiffFile {
  path: string;
  changeType: 'create' | 'modify' | 'delete';
  additions: number;              // 新增行数
  deletions: number;              // 删除行数
  hunks: DiffHunk[];             // diff 块
}

interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

interface DiffLine {
  type: 'context' | 'add' | 'remove';
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
}
```

[Files]

## 新增文件

| 文件路径 | 用途 |
|----------|------|
| `queue-server/routes/patches.js` | Patch Review REST API |
| `queue-server/storage/patch-store.js` | Patch 数据持久化 |
| `queue-server/actions/patch-parser.js` | DeepSeek 回复解析为 patch |
| `queue-server/actions/diff-generator.js` | unified diff 生成器 |
| `web-console/src/components/PatchReviewPanel.tsx` | Patch 列表和详情组件 |
| `web-console/src/components/DiffViewer.tsx` | diff 可视化组件 |
| `chromevideo/sidepanel-patch.css` | Patch 审批 UI 样式 |

## 修改文件

| 文件路径 | 修改内容 |
|----------|----------|
| `queue-server/index.js` | 挂载 `/patches` 路由 |
| `queue-server/websocket/handler.js` | 广播 patch 相关 WebSocket 消息 |
| `queue-server/custom-handler.js` | 检测 patch 提案并触发审批流 |
| `queue-server/actions/action-engine.js` | 移除 `write_file` 的自动执行，改为生成 patch |
| `queue-server/storage/sqlite.js` | 新增 patches 表和 patch_events 表 |
| `web-console/src/App.tsx` | 集成 PatchReviewPanel 组件 |
| `chromevideo/sidepanel.html` | 新增 patch 审批 UI 区域 |
| `chromevideo/sidepanel.js` | 新增 patch 审批交互逻辑 |

[Functions]

## 新增函数

### Patch Store (queue-server/storage/patch-store.js)

```javascript
// 创建 patch 提案
createPatch(patchData: PatchInput): Patch

// 获取 patch 列表
getPatches(filters?: { taskId?, status?, limit?, offset? }): Patch[]

// 获取单个 patch 详情
getPatch(patchId: string): Patch | null

// 更新 patch 状态
updatePatchStatus(patchId: string, status: PatchStatus, eventDetails?: string): Patch | null

// 验证 patch 安全性
validatePatch(patch: Patch): { valid: boolean, warnings: string[] }

// 应用 patch 到文件系统
applyPatch(patchId: string, workspacePath: string): { success: boolean, applied: string[], failed: string[] }
```

### Diff Generator (queue-server/actions/diff-generator.js)

```javascript
// 生成 unified diff
generateUnifiedDiff(oldContent: string, newContent: string, filePath: string): string

// 解析 unified diff 为结构化数据
parseUnifiedDiff(diffText: string): DiffPreview

// 验证 diff 不会修改 workspace 外的文件
validateDiffPaths(diff: DiffPreview, workspacePath: string): { valid: boolean, invalidPaths: string[] }
```

### Patch Parser (queue-server/actions/patch-parser.js)

```javascript
// 从 DeepSeek 回复中解析 patch 提案
parsePatchProposal(replyText: string): Patch | null

// 检测回复是否包含 patch 提案
hasPatchProposal(replyText: string): boolean

// 提取代码块中的文件修改建议
extractFileModifications(replyText: string): FileModification[]
```

### REST API (queue-server/routes/patches.js)

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/patches` | 获取 patch 列表 |
| POST | `/patches` | 创建 patch 提案 |
| GET | `/patches/:id` | 获取 patch 详情 |
| POST | `/patches/:id/validate` | 验证 patch 安全性 |
| POST | `/patches/:id/approve` | 批准 patch |
| POST | `/patches/:id/reject` | 拒绝 patch |
| POST | `/patches/:id/apply` | 应用 patch |
| GET | `/patches/:id/diff` | 获取格式化的 diff |

### Web Console 组件

```typescript
// PatchReviewPanel
interface PatchReviewPanelProps {
  onPatchApplied?: (patchId: string) => void;
  onPatchRejected?: (patchId: string) => void;
}

// DiffViewer
interface DiffViewerProps {
  diff: DiffPreview;
  onApprove?: () => void;
  onReject?: () => void;
  readOnly?: boolean;
}
```

[Classes]

## 无新增类

现有架构无需新增类，主要通过函数式模块扩展功能。

[Dependencies]

## 无新增外部依赖

使用现有依赖完成实现：
- `diff` 包（Node.js 内置，用于 diff 生成）
- 已有 `better-sqlite3` 或 `sqlite3` 进行数据持久化

如需更美观的 diff 显示，可考虑添加 `diff2html`（可选优化项）。

[Testing]

## 测试文件

| 测试文件 | 覆盖内容 |
|----------|----------|
| `queue-server/test-patch-parser.js` | patch 解析单元测试 |
| `queue-server/test-diff-generator.js` | diff 生成和验证测试 |
| `queue-server/test-patch-store.js` | patch CRUD 测试 |

## 验收测试

1. 提交一个包含代码修改建议的任务，验证生成 patch 提案
2. 在 Web Console 查看 patch 列表和 diff 预览
3. 批准 patch，验证文件正确修改
4. 拒绝 patch，验证文件未修改
5. 验证 patch 不会修改 workspace 外的文件

[Implementation Order]

1. **数据库扩展**：在 SQLite 中新增 `patches` 和 `patch_events` 表
2. **Patch Store**：实现 patch 数据的增删改查
3. **Diff Generator**：实现 unified diff 生成器
4. **Patch Parser**：实现从 DeepSeek 回复中解析 patch 提案
5. **REST API**：实现 `/patches` 路由
6. **Custom Handler 集成**：在 `custom-handler.js` 中调用 patch parser
7. **WebSocket 集成**：广播 patch 相关事件
8. **Web Console - PatchReviewPanel**：实现 patch 列表组件
9. **Web Console - DiffViewer**：实现 diff 可视化组件
10. **Side Panel 集成**：在 sidepanel 中添加 patch 审批入口
11. **端到端测试**：验证完整流程

---

## 页面操作体验优化方案

### 当前问题
1. Side Panel 交互不够直观
2. 会话切换操作复杂
3. 附件上传反馈不清晰
4. 审批流程分散，不易追踪

### 优化措施

1. **会话管理简化**
   - 新建会话：优化按钮位置，一键创建
   - 切换会话：列表项点击即切换，无需额外确认
   - 删除会话：长按或右键菜单，避免误删

2. **输入体验优化**
   - 支持 Markdown 预览
   - 发送按钮状态反馈
   - 附件拖拽上传

3. **状态可视化**
   - 任务进度条
   - AI 思考过程折叠/展开
   - 审批状态实时更新

4. **快捷操作**
   - 常用命令快捷键
   - 最近会话快速切换
