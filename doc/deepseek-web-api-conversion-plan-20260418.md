# DeepSeek Web 页面 API 化接入详细方案

更新日期：2026-04-18

## 1. 背景与问题定义

当前项目的 DeepSeek 主链路仍保留了浏览器扩展直接操作网页 DOM 的能力，这条链路适合处理截图、上传附件、切换会话、模式切换等“必须发生在页面里”的动作，但不适合作为唯一的文本执行链路。

现有 DOM 驱动方案的主要问题：

1. 对输入框、发送按钮、回复气泡结构强依赖，页面改版后容易失效。
2. 自动进化任务本质上以“纯文本生成 + 多轮工具回灌”为主，继续走 DOM 提交会放大页面波动带来的不稳定性。
3. 服务端无法直接拿到稳定的 provider 级会话信息，很多状态只能从页面行为侧推断。
4. 文本任务与浏览器动作任务耦合过深，不利于后续把任务调度、验证和回退逻辑收敛到 Queue Server 内部。

本专项的目标不是替换扩展，而是把“文本问答”从 DOM 通道迁移到服务端 provider 通道，使浏览器扩展保留为动作执行层，Queue Server 新增一条可以直接请求 DeepSeek Web 内部接口的稳定文本链路。

## 2. 专项目标

本方案要完成的是一条 `DeepSeek Web Zero-Token` 服务端 provider 链路，核心能力包括：

1. 使用本机已登录的 `.browser-profile` 捕获并复用 `cookie`、`bearer`、`userAgent`。
2. 在 Queue Server 内直接发起 DeepSeek Web 文本请求，无需扩展操控页面输入框。
3. 在任务和会话层保存 provider 级元数据，包括 `providerSessionId`、`providerParentMessageId`、`providerMessageId`、`requestId`、`endpointPath`。
4. 让 `auto_evolve` 任务默认优先走 `deepseek-web`，失败时明确回退到 `extension-dom`。
5. 建立面向真实线上页面的 onboarding、probe、回归与诊断流程，避免无效 snapshot 污染排障结论。

## 3. 范围与边界

### 3.1 本专项负责的内容

1. 文本任务提交与结果解析。
2. provider 级登录态捕获与本机存储。
3. provider 级会话复用与多轮消息上下文承接。
4. 自动进化主链路切换与失败回退。
5. 调试命令、错误码、回归测试和脱敏诊断输出。

### 3.2 本专项暂不替代的内容

1. 截图上传。
2. DeepSeek 页面上的会话切换、新建会话、模式切换。
3. 依赖浏览器 DOM 的复杂交互。
4. 完整的 Web Console 可视化面板重构。

结论是：文本任务 API 化，浏览器动作保留在扩展链路。

## 4. 当前架构落点

当前实现已经围绕 `queue-server/providers/deepseek-web/` 建起了 Zero-Token provider 的基础结构：

1. `auth.js`
   负责从 `.browser-profile` 或可附加的调试浏览器中采集、校验和持久化登录态。
2. `client.js`
   负责拼装请求、向 DeepSeek Web 内部接口发起调用、处理错误码和返回 provider 元数据。
3. `stream.js`
   负责把网页接口返回的 JSON / SSE 风格结果转换成服务端可消费的文本输出。
4. `scripts/onboard-deepseek-web.js`
   负责采集登录态、输出脱敏摘要、在必要时自动拉起 workspace 浏览器。
5. `scripts/verify-deepseek-web-provider.js`
   负责使用已保存的 snapshot 发起一次真实 probe，并输出请求与回复的脱敏诊断信息。
6. `queue-server/routes/tasks.js` 与 `queue-server/websocket/handler.js`
   已支持 provider 选择、服务端执行、provider 元数据回写和失败回退。
7. `queue-server/providers/index.js`
   已把 `auto_evolve` 的隐式 provider 切到 `deepseek-web`，并保留 `extension-dom` 作为 fallback。

## 5. 目标架构

### 5.1 逻辑分层

建议把 DeepSeek Web API 化后的职责明确分成四层：

1. 认证层
   负责捕获和验证本机登录态，只保存本机所需的最小凭证集合。
2. Provider 传输层
   负责请求构造、接口路径尝试、响应解析、错误码标准化。
3. 任务调度层
   负责根据 provider 类型把任务发送到 Queue Server 内执行，或回退到扩展侧执行。
4. 会话与展示层
   负责把 provider 级会话状态同步到任务、会话、Web Console 视图。

### 5.2 数据与状态

当前及后续建议统一维护以下状态：

1. 登录态快照
   默认存储在 `queue-server/data/deepseek-web-auth.json`。
2. 任务级 provider 状态
   包括 `provider`、`providerSessionId`、`providerParentMessageId`、`providerMessageId`、`providerEndpointPath`、`providerRequestId`、`providerResponseMode`。
3. 会话级 provider 状态
   在 conversation metadata 中保存 providerState，作为多轮对话复用与 UI 展示依据。

### 5.3 错误标准化

必须继续坚持当前的 provider 错误码标准化策略，至少保留以下语义：

1. `DEEPSEEK_AUTH_REQUIRED`
2. `DEEPSEEK_AUTH_INCOMPLETE`
3. `DEEPSEEK_AUTH_CHALLENGED`
4. `DEEPSEEK_AUTH_LOGGED_OUT`
5. `DEEPSEEK_AUTH_TOKEN_SOURCE_INVALID`
6. `DEEPSEEK_AUTH_INVALID`
7. `DEEPSEEK_HTTP_ERROR`
8. `DEEPSEEK_RESPONSE_EMPTY`
9. `DEEPSEEK_API_ERROR`

只有把“认证无效”和“请求契约不匹配”区分开，后续的真实排障才不会反复绕路。

## 6. 分阶段实施方案

### Phase A：登录态采集与有效性过滤

目标：确保只有“真实已登录 chat 页面”的 snapshot 才允许进入 provider 流程。

实施点：

1. 使用 `scripts/onboard-deepseek-web.js --profile .browser-profile` 作为默认采集入口。
2. 对无可附加浏览器或 `DevToolsActivePort` 失效的情况，使用 `--launch-browser` 自动启动 workspace 浏览器并重试。
3. 在 `auth.js` 中继续保留对以下无效来源的拦截：
   - `/sign_in` 或其他 auth page
   - AWS WAF challenge 页面
   - `APMPLUS` / `__tea_*` telemetry token
   - 短 session metadata 或弱 signal token
4. 终端输出一律只显示脱敏摘要，不打印原始 cookie、bearer 或 Authorization。

阶段验收：

1. `readyToPersist=true`
2. 输出结果不再落入 `logged_out`、`challenge_page`、`telemetry_token`、`incomplete_snapshot`
3. 本地保存的 snapshot 可被 provider 与 probe 复用

### Phase B：最小文本 provider 可用

目标：让服务端可以用保存的 snapshot 发起一次真实文本问答。

实施点：

1. 在 `client.js` 中维护默认 endpoint path 列表，并允许 probe 传入临时覆盖。
2. 统一封装请求头、cookie、bearer、userAgent 和 request body 组装逻辑。
3. 在 `stream.js` 中解析 DeepSeek Web 接口返回的文本、消息 ID、session ID、request ID。
4. 对 HTTP 200 但 body 中返回业务错误的情况，继续显式转成 provider error，而不是误报为 `response-empty`。

阶段验收：

1. `node scripts/verify-deepseek-web-provider.js --prompt "Reply with exactly: FCC_DEEPSEEK_OK"` 能返回真实回复
2. 输出中包含脱敏后的 `endpointPath`、`responseMode`、`providerSessionId`、`providerMessageId`、`requestId`
3. 请求失败时能区分是认证问题、接口漂移问题还是响应解析问题

### Phase C：任务路由与 Queue Server 服务端执行

目标：文本任务不再强制依赖扩展 DOM 提交。

实施点：

1. 在 `routes/tasks.js` 中继续把 provider 归一化为 `extension-dom` 或 `deepseek-web`。
2. 在 `websocket/handler.js` 中对 server-side provider 直接在 Queue Server 内执行。
3. provider 执行成功后，把 provider 元数据写回 task 和 conversation。
4. provider 执行失败时输出结构化错误，不泄露凭证。

阶段验收：

1. 提交 `provider=deepseek-web` 的文本任务后，Queue Server 能直接执行
2. 结果中可以看到 provider 级 session / message / request 状态
3. 无扩展参与时仍能完成文本任务

### Phase D：自动进化主链路切换与回退

目标：把 `auto_evolve` 的文本执行默认迁移到 `deepseek-web`。

实施点：

1. 在 provider registry 中把 `autoEvolve === true` 的默认 provider 设为 `deepseek-web`。
2. 保留 `extension-dom` 作为 fallback provider。
3. 只在 provider 执行失败时触发 fallback，不在 provider 正常情况下把文本任务再发回页面 DOM。
4. 对 fallback 过程写入任务级 metadata，避免后续排障时混淆“真实失败点”。

阶段验收：

1. `auto_evolve` 默认走 `deepseek-web`
2. 失败时能看到从 `deepseek-web` 到 `extension-dom` 的回退记录
3. 回退不会覆盖原始 provider 的诊断信息

### Phase E：真实请求契约对齐

目标：完成从“本地 fake-server 可用”到“真实线上请求稳定成功”的最后一公里。

实施点：

1. 先拿到一次真实有效 snapshot，而不是继续用已知无效 snapshot 排障。
2. 在 probe 成功前，持续用浏览器 Network 面板比对真实请求与 `client.js` 当前实现，重点检查：
   - endpoint path
   - Authorization 头和 cookie 的组合方式
   - userAgent、origin、referer、额外 headers
   - request body 字段名、session 字段和 parent message 字段
3. 如果真实接口继续返回 `INVALID_TOKEN`，优先判断是 token 来源错误还是请求契约仍不匹配，而不是盲目扩大 fallback。
4. 每次调整请求契约后，先跑 focused tests，再跑 live probe。

阶段验收：

1. probe 成功返回真实文本
2. 不再出现“有效 snapshot 仍被错误识别为登录失效”的误判
3. 对同一有效 snapshot 可重复完成至少一轮问答

### Phase F：会话与 UI 可视化

目标：把 provider 类型、状态和失败原因暴露到 Web Console，而不是只能翻日志。

实施点：

1. 在会话存储层保留 `providerState`
2. 在 conversations API 和前端视图中显示 provider 来源、最近一次 endpoint 和请求状态
3. 把“上次错误原因”和“上次成功调用摘要”集中展示

阶段验收：

1. 用户能看出会话是走 `extension-dom` 还是 `deepseek-web`
2. 最近一次 Zero-Token 调用失败原因可直接查看
3. 无需翻 `.workbuddy` 或服务端日志即可完成大部分排障

## 7. 验证与回归策略

### 7.1 本地静态与单元验证

建议保持以下 focused 验证命令：

```bash
node queue-server/test-deepseek-provider.js
node queue-server/test-deepseek-provider-probe.js
node test-deepseek-web-auth.js
node scripts/dev-status-report.js
```

目的：

1. 验证 auth snapshot 过滤逻辑
2. 验证 provider transport / response parse 逻辑
3. 验证 probe 的错误码与建议输出
4. 更新本地状态报告，避免下一轮任务从过期结论起步

### 7.2 真实环境验证

真实环境验证顺序建议固定为：

```bash
node scripts/onboard-deepseek-web.js --profile .browser-profile --launch-browser
node scripts/verify-deepseek-web-provider.js --prompt "Reply with exactly: FCC_DEEPSEEK_OK"
```

判定标准：

1. onboard 成功且 `readyToPersist=true`
2. probe 返回真实 reply，而不是仅返回 `sessionId` 或空响应
3. 如果失败，必须从错误码上能明确判断失败阶段

### 7.3 与主链路结合验证

在 live probe 成功后，再执行：

1. 提交一个 `provider=deepseek-web` 的普通文本任务
2. 提交一个 `auto_evolve` 任务，确认默认 provider 为 `deepseek-web`
3. 验证 provider 失败时是否正确回退到 `extension-dom`

## 8. 风险与控制措施

### 8.1 凭证风险

风险：

1. cookie / bearer 泄露到日志或 WebSocket 广播
2. 调试输出包含原始 Authorization

控制：

1. 只允许本机存储到 `queue-server/data/deepseek-web-auth.json`
2. 所有 CLI 和服务端日志坚持脱敏输出
3. 不在 Web Console 和扩展侧直接显示敏感值

### 8.2 误判风险

风险：

1. 使用登录页、challenge 页或 telemetry token 继续排障
2. 把认证问题误判成接口漂移问题

控制：

1. onboarding 与 probe 先做 auth 状态分类，再进入 provider 请求
2. 继续扩大弱 token、短 metadata 和 telemetry source 的拒绝规则

### 8.3 漂移风险

风险：

1. DeepSeek Web endpoint、headers 或 body 契约变动
2. 单次成功后缺乏稳定性回归

控制：

1. probe 支持自定义 endpoint path、headers、request body
2. nightly 验证保留 focused 回归入口
3. live 成功后补至少一轮重复性验证

## 9. 里程碑与交付标准

### M1：有效 snapshot 可稳定采集

完成标准：

1. `readyToPersist=true`
2. 不再落入无效 auth 分类

### M2：真实 provider probe 成功

完成标准：

1. 服务端可直接完成一轮真实文本问答
2. 返回 provider 级元数据

### M3：auto_evolve 主链路可用

完成标准：

1. `auto_evolve` 默认使用 `deepseek-web`
2. 失败时可诊断并可回退

### M4：会话和 UI 状态可见

完成标准：

1. 会话来源和最近一次 provider 状态可视化
2. 排障无需翻底层日志

## 已完成内容

1. 已新增 `queue-server/providers/deepseek-web/`，具备最小 provider 结构，包括 `auth.js`、`client.js`、`stream.js`。
2. 已实现本机登录态采集脚本 `scripts/onboard-deepseek-web.js`，支持直接附加已有浏览器和 `--launch-browser` 自动拉起浏览器两种模式。
3. 已把登录态默认保存到 `queue-server/data/deepseek-web-auth.json`，并保持脱敏输出。
4. 已补齐 auth 诊断和过滤逻辑，能拒绝 AWS WAF challenge、`/sign_in`、`APMPLUS` / `__tea_*` telemetry token，以及短 session metadata / weak signal 假阳性。
5. 已提供真实 provider probe 工具 `scripts/verify-deepseek-web-provider.js`，可复用保存的 snapshot 做一次真实文本请求并输出诊断摘要。
6. 已在 provider 层把 HTTP 200 但 body 内返回的业务错误显式标准化，例如把 `INVALID_TOKEN` 映射为 `DEEPSEEK_AUTH_INVALID`，避免误报为 `response-empty`。
7. 已在 `queue-server/routes/tasks.js` 接入 provider 选择和归一化逻辑，文本任务已支持指定 `deepseek-web`。
8. 已在 `queue-server/websocket/handler.js` 接入服务端 provider 执行链路，能够在 Queue Server 内直接执行 server-side provider。
9. 已把 `providerSessionId`、`providerParentMessageId`、`providerMessageId`、`providerEndpointPath`、`providerRequestId`、`providerResponseMode` 等元数据写回任务和会话状态。
10. 已把 `auto_evolve` 的默认 provider 切到 `deepseek-web`，并保留失败时回退到 `extension-dom` 的策略。
11. 已补齐 focused tests 与状态报告更新逻辑，当前专项状态会被写入 `scripts/dev-status-report.js` 生成的本地状态文件。

## 未完成内容

1. 还没有在真实有效的 `.browser-profile` 登录态上稳定完成一轮线上 `DeepSeek Web` 文本问答，这是当前最大的 blocker。
2. 当前必须先重新采集一个 `readyToPersist=true` 的真实已登录 snapshot；如果 snapshot 仍来自 `/sign_in`、telemetry token 或弱信号 metadata，就不能继续做接口契约排障。
3. `client.js` 与浏览器真实请求之间的最终契约尚未完全对齐，仍需继续比对 `endpoint path`、Authorization / cookie 组合、额外 headers 和 request body 字段。
4. `DEEPSEEK_AUTH_INVALID` 这一类错误虽然已经能被准确识别，但问题本身还没有彻底解决，仍需要真实网络请求比对来收口。
5. 真实 probe 稳定成功后，还需要补一轮“普通文本任务 + auto_evolve + fallback”结合验证，确认主链路切换没有引入新的回归。
6. 会话与 Web Console 的可视化仍未做完，目前 provider 状态虽然已经写入 metadata，但还没有形成完整的用户可见诊断界面。
7. 针对真实 DeepSeek Web 接口契约漂移的长期回归策略仍需补强，尤其是 live success 之后的重复性验证和问题告警。
