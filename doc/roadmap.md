# free-chat-coder 路线图

更新日期：2026-04-25

## 1. 当前阶段判断

`free-chat-coder` 已经从早期脚本和自动化实验，收敛为一个本地运行的 DeepSeek 辅助开发工作台。当前主线是通过 Chrome 扩展连接 DeepSeek Web，通过 Queue Server 管理任务、会话、动作审批和后续文件交付，通过 Web Console 提供可视化管理入口。

项目现阶段的重点不是扩大自动执行能力，而是稳定“AI 建议 + 本地调度 + 人工确认”的协作闭环，确保每个可能影响本地工作区的动作都有明确边界、记录和审批。

## 2. 当前主线

### 2.1 保持的能力方向

- 使用 Chrome 扩展接管 DeepSeek Web 会话，完成输入、附件上传、会话切换和结果读取。
- 使用 Queue Server 作为本地事实中心，管理任务队列、会话存储、审批记录和 provider 调度。
- 使用 Web Console 展示任务、会话、审批、诊断和后续 patch review 入口。
- 使用 SQLite 保存 conversations、messages、browser_actions、tool_calls、sync_states 等状态数据。
- 通过人工审批或 patch review 承接本地高风险动作，避免 AI 直接修改项目文件。

### 2.2 明确不恢复的旧方向

- 不恢复 `/evolve` API。
- 不恢复 auto-evolve、自动进化、自动自修复、cron/autopilot 循环。
- 不允许 DeepSeek 直接写文件、改代码、重启服务。
- 不把旧 auto-evolve 历史任务导入新知识库。
- 不把 `autoEvolve` 作为 provider 路由条件。

## 3. 已具备的基础能力

1. Chrome 扩展已有主体结构，包含 background、offscreen WebSocket、content scripts、side panel、popup 和 Native Messaging Host。
2. Queue Server 已具备 Express API、WebSocket 通道、任务队列、会话 API、动作解析和审批雏形。
3. Web Console 已具备任务查看、会话浏览、审批入口和 API 测试基础。
4. SQLite 会话存储已有主体，能保存会话、消息、浏览器动作、工具调用和同步状态。
5. DeepSeek 页面交互已有主体，支持页面读取、prompt 提交、附件上传和会话切换。
6. DeepSeek Web 直连 provider 保留为可选能力，但当前默认主线仍是 `extension-dom`。

## 4. 当前主要短板

1. 文本任务主链路仍依赖扩展操作 DeepSeek 页面 DOM，页面结构变化会影响稳定性。
2. 动作审批还停留在基础确认层，缺少完整的补丁提案、diff 预览、校验和应用流程。
3. 任务附件和文件交付协议尚未统一，扩展上传能力还没有沉淀成端到端任务资产模型。
4. 知识库与上下文检索尚未完整实现，项目文档、任务记录和会话内容还没有形成可检索上下文层。
5. 安装、启动、诊断和排障链路仍偏开发者视角，普通用户难以快速判断 Native Host、Queue Server、扩展和 DeepSeek 页面状态。
6. 旧自动进化相关代码、文档和概念仍需持续清理，避免与当前产品边界混淆。

## 5. 优先级路线

### P0：稳定受控任务闭环

目标：让用户能提交任务、关联 DeepSeek 会话、查看执行状态，并在高风险动作发生前完成明确审批。

重点事项：

1. 梳理任务状态机，明确 pending、assigned、running、waiting_approval、completed、failed 等状态语义。
2. 补齐审批记录的数据结构，确保每次同意、拒绝和过期都有可追踪记录。
3. 将动作解析、审批和执行边界收敛到 Queue Server，避免扩展侧承载业务决策。
4. 在 Web Console 中强化任务详情页，展示关联会话、消息摘要、动作意图和审批结果。

验收标准：

- 用户能从 Web Console 提交并追踪一个完整任务。
- 高风险动作不会绕过审批直接执行。
- 任务失败时能看到清晰原因和下一步排障入口。

### P1：Patch Review 与文件交付协议

目标：把“AI 给出修改建议”升级为“AI 生成补丁提案，本地系统校验并等待用户确认后应用”。

重点事项：

1. 设计任务附件、文件包、补丁提案和应用结果的数据模型。
2. 支持 DeepSeek 输出结构化 patch proposal，由 Queue Server 解析、校验和存储。
3. 在 Web Console 中提供 diff 预览、风险提示、同意应用和拒绝入口。
4. 应用补丁前增加工作区状态检查，避免覆盖用户未确认的本地修改。
5. 将文件交付结果与原任务、会话和审批记录关联。

验收标准：

- AI 不能直接写入项目文件，只能提交补丁提案。
- 用户能在应用前看到 diff 和影响文件。
- 每次补丁应用都有任务、会话和审批记录可追踪。

### P1：诊断与安装体验

目标：降低本地运行和排障成本，让用户能快速判断系统哪一环出现问题。

重点事项：

1. 增加扩展启动诊断，覆盖 DeepSeek 页面状态、WebSocket 连接、Queue Server 端口和 Native Host 状态。
2. 提供本地环境自检脚本，检查依赖、端口、SQLite、Native Host 注册和扩展连接。
3. 在 Web Console 中集中展示最近失败、连接状态和关键日志入口。
4. 收敛错误码和错误消息，让扩展、Queue Server、Web Console 使用一致的诊断语言。

验收标准：

- 用户能区分是 DeepSeek 页面、扩展连接、Native Host、Queue Server 还是 Web Console 出错。
- 常见启动失败有明确修复建议。
- 关键服务状态能在一个界面看到。

### P2：知识库与上下文检索

目标：让项目文档、任务历史和会话内容成为可检索上下文，辅助后续 DeepSeek 协作。

重点事项：

1. 设计知识库 schema，区分项目文档、任务记录、会话摘要、审批记录和补丁记录。
2. 建立最小可用索引与检索流程，优先覆盖 `doc` 目录、任务摘要和会话摘要。
3. 设计上下文注入协议，明确哪些内容可以进入 DeepSeek prompt，哪些只在本地展示。
4. 避免把旧 auto-evolve 历史任务导入新知识库主线。

验收标准：

- 用户能从任务中引用项目文档和历史会话摘要。
- DeepSeek prompt 中的上下文来源可追踪。
- 检索结果不会混入已废弃的自动进化主线。

### P3：工程化与回归防护

目标：减少代码和文档漂移，让关键链路具备持续验证能力。

重点事项：

1. 为 Queue Server API、WebSocket 消息、会话存储和审批流程补齐回归测试。
2. 为 Chrome 扩展关键 DOM 交互增加选择器诊断和失败采样。
3. 将 Web Console 构建、关键后端测试和文档路径检查纳入常规验证。
4. 持续清理旧自动进化代码、废弃文档和生成产物，降低工作区噪音。
5. 保持 `vision.md`、`roadmap.md`、`design-doc.md` 和实现状态一致。

验收标准：

- 主链路改动能通过可重复测试验证。
- 文档中不再出现与当前主线冲突的旧实现指引。
- 新增模块能明确归属到现有架构边界。

## 6. 文档维护规则

- `vision.md` 说明长期愿景和产品边界。
- `roadmap.md` 说明阶段优先级、短板和验收标准。
- `design-doc.md` 说明当前架构、模块边界、接口和数据模型。
- `refactor-prune-plan.md`、`refactor-prune-followup-plan.md`、`refactor-prune-execution-plan.md` 用于清理旧能力和执行重构。
- `archive/` 只保存历史文档，不作为当前实现依据。

路线图发生变化时，应优先检查是否会影响 `vision.md` 的产品边界和 `design-doc.md` 的架构描述。

