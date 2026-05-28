# Ralphloop 用户流程测试用例

## 目的

这份文档把 Ralphloop 当前的测试用例按真实用户流程重新整理，方便我们对齐“到底测了什么”。它不是单纯列测试文件，而是从创建者和朋友的视角描述步骤、预期结果、自动化覆盖和仍需要浏览器 dogfood 的部分。

本版对齐两条产品口径：

- 朋友侧主流程必须是多轮 Agent 会话，不是一次性任务提交。
- 创建者侧必须覆盖已有分享链接的查看、状态判断和管理动作，不只覆盖“生成新链接”。

## 测试基线

- 创建者：`owner-1`
- 本地 Host：`host-1`
- 开发分享 token：`local-friend`
- Owner 页面：`http://127.0.0.1:5181/app/owner`
- Friend 默认页面：`http://127.0.0.1:5181/app/share/local-friend`，应 302 到新版 Agent Chat。
- 新版 Agent Chat 分享入口：`http://127.0.0.1:5181/app/share/local-friend/assistant-ui`
- 旧版兼容页面：`http://127.0.0.1:5181/app/share/local-friend/classic`
- 本地启动命令：`npm run dev:productized:outbound`
- 核心前端方向：当前 server-rendered HTML 对齐 assistant-ui / AG-UI 概念，后续迁移 React 前端。
- 当前创建者复制出的默认分享 URL 指向 `/app/share/:token/assistant-ui`；裸 `/app/share/:token` 会重定向到新版 Agent Chat；旧 friend page 只保留在 `/app/share/:token/classic`，作为兼容入口和脚本级回归对象。

## 流程 1：创建者启动桌面 Agent Host

### TC-1.1 Host 注册成功

**用户动作**

1. 创建者启动本地 Ralphloop outbound Host。
2. Host 使用 bootstrap secret 注册设备。
3. Host 上报支持的 Agent 框架。

**期望结果**

- Host 被登记为 `online`。
- Host 返回设备密钥。
- Owner 页面能看到设备名、状态、上次心跳和可选 Agent 框架。
- 不向朋友页面暴露设备密钥、bootstrap secret 或 host auth 材料。

**自动化覆盖**

- `apps/share-gateway/test/productization/httpServer.test.ts`
- `apps/share-gateway/test/productization/routes.test.ts`
- `apps/share-gateway/test/productization/security.test.ts`
- `apps/share-gateway/test/productization/devOutbound.test.ts`

**验证命令**

```bash
npm run test:contract
npm run test:integration
npm run test:security
```

### TC-1.2 Host 心跳保持在线

**用户动作**

1. 创建者保持 Host 运行。
2. 等待超过原来的 30 秒心跳超时时间。
3. 刷新 Owner 页面或请求 owner hosts API。

**期望结果**

- Host 仍为 `online`。
- `offlineReason` 为空。
- 继续允许创建分享链接。

**自动化覆盖**

- `apps/share-gateway/test/productization/devOutbound.test.ts`
- `apps/share-gateway/test/productization/routes.test.ts`

**浏览器/运行时 dogfood**

- 本地启动 `npm run dev:productized:outbound`。
- 等待 30 秒以上。
- 请求 `/v1/owner/hosts?ownerId=owner-1`，确认 `status === "online"`。

## 流程 2：创建者生成、查看并管理分享链接

### TC-2.1 创建者生成私密分享链接

**用户动作**

1. 创建者打开 Owner 页面。
2. 选择一个 Agent 框架。
3. 点击“生成分享链接”。

**期望结果**

- 接口返回 `201`。
- 页面展示可打开的 `/app/share/:token` 链接。
- 按钮不会因为接口失败永久 disabled。
- 如果 Host 离线，页面显示“创建失败：host_unavailable”，并刷新 Host 状态。

**自动化覆盖**

- `apps/share-gateway/test/productization/httpServer.test.ts`
- `apps/share-gateway/test/productization/routes.test.ts`
- `apps/share-web/test/owner-page.test.ts`

**验证命令**

```bash
node scripts/test.mjs apps/share-gateway/test/productization/httpServer.test.ts
node scripts/test.mjs apps/share-web/test/owner-page.test.ts
```

### TC-2.2 创建者查看已有分享链接

**用户动作**

1. 创建者打开 Owner 页面。
2. 进入“分享链接”列表。
3. 点击刷新或等待页面加载已有链接。

**期望结果**

- 页面展示当前 owner 下所有已有分享链接。
- 每条链接展示名称、状态、允许的 Agent 框架和用量摘要。
- active 链接显示“暂停”动作。
- paused 链接显示“启用”动作。
- revoked 链接显示不可恢复状态。
- 列表不展示 raw token、token hash、host device key 或 bootstrap secret。

**自动化覆盖**

- `apps/share-gateway/test/productization/httpServer.test.ts`
- `apps/share-gateway/test/productization/controls.test.ts`

**验证命令**

```bash
node scripts/test.mjs apps/share-gateway/test/productization/httpServer.test.ts
npm run test:security
```

**当前缺口**

- 2026-05-23 已完成 Chrome dogfood：Owner 页面已有链接列表可见，单个链接可完成 active -> paused -> active -> revoked。
- 2026-05-24 已补脚本级 UI 自动化：`apps/share-gateway/test/productization/httpServer.test.ts` 直接执行 Owner 页面内联 JS，验证列表中的暂停、启用、撤销动作真实命中 HTTP API。
- 仍可补强：创建两个以上链接后的列表排序与批量管理体验。

### TC-2.3 创建者暂停、启用、撤销分享链接

**用户动作**

1. 创建者查看分享链接列表。
2. 对 active 链接执行暂停。
3. 对 paused 链接执行启用。
4. 对列表中的当前或已有链接执行撤销。

**期望结果**

- active 链接可以暂停。
- paused 链接可以恢复。
- revoked 链接不可恢复。
- 撤销链接会取消相关会话、任务并停止 Host runtime。
- 朋友访问 paused/revoked 链接时只看到中性不可用状态，不泄露创建者内部信息。

**自动化覆盖**

- `apps/share-gateway/test/productization/controls.test.ts`
- `apps/share-gateway/test/productization/routes.test.ts`
- `apps/share-gateway/test/productization/httpServer.test.ts`：覆盖 HTTP API、Owner 页面 HTML 合约，并通过脚本级 UI harness 验证已有链接列表 active -> paused -> active -> revoked。

**浏览器 dogfood**

2026-05-23 已用 Chrome 验证：

1. 启动 `PORT=5181 npm run dev:productized:outbound`。
2. 打开 Owner 页面，确认 Host 在线且已有 `active` 链接。
3. 点击已有链接“暂停”，列表变为 `paused`。
4. 点击“启用”，列表恢复 `active`。
5. 点击已有链接“撤销”，列表变为 `revoked` 并显示“不可恢复”。
6. 打开 Friend App 链接返回中性 HTML 不可用页；JSON API 仍返回不可用状态，不泄露内部原因或密钥。

**验证命令**

```bash
npm run test:security
npm run test:integration
```

### TC-2.4 创建者更新已有链接配置

**用户动作**

1. 创建者选择一个已有分享链接。
2. 修改链接名称或允许的 Agent 框架。
3. 保存配置。

**期望结果**

- 只有 link owner 可以修改。
- 只能选择 Host 支持的 Agent 框架。
- revoked 链接不可修改。
- 更新后的链接继续使用同一个私密入口，但新任务按新策略执行。

**自动化覆盖**

- `apps/share-gateway/test/productization/httpServer.test.ts`
- `apps/share-gateway/test/productization/controls.test.ts`
- `apps/share-gateway/test/productization/httpServer.test.ts`：覆盖 Owner 页面行内编辑表单和内联 JS，模拟把已有链接名称与允许框架保存到 PATCH API。

**当前状态**

- 2026-05-24 已补 Owner 页面已有链接行内编辑：每条 active/paused 链接可修改名称、勾选允许的 Agent 框架并保存。
- 脚本级 UI 自动化已覆盖：`Ralphloop Agent / opencode` 保存为 `Research Agent / codex`，确认列表刷新、后端数据更新、状态提示为“已保存链接配置”，且列表不泄露 `tokenHash`、设备密钥、bootstrap secret 或模型价格。
- revoked/expired 链接仍保持不可编辑状态，只展示不可恢复生命周期状态。

## 流程 3：朋友打开分享链接

### TC-3.1 朋友看到多 Session Chatbot，而不是 Agent 控制台

**用户动作**

1. 朋友打开 `http://127.0.0.1:5181/app/share/local-friend`。
2. 浏览器被重定向到 `/app/share/local-friend/assistant-ui`。

**期望结果**

- 默认页面主体验是 assistant-ui Chatbot Session，而不是表单式控制台。
- 如果 URL 不带 `sessionId`，朋友直接输入第一条消息后必须创建真实后端 Session，并且左侧只展示这个真实 Session。
- 页面包含：
  - `assistant-ui-runtime-shell`
  - `assistant-ui-thread-rail`
  - `assistant-ui-thread-panel`
  - `assistant-ui-message-list`
  - `assistant-ui-composer`
- 显式打开 `/app/share/local-friend/classic` 时，旧页仍包含 `friend-chat-shell`、Session sidebar、chat thread、composer、preview drawer 和 `friend-assistant-ui-link`。
- 页面显示 Agent 名称、Host 在线、当前 Session 状态。
- 桌面预览默认收起，通过右侧 drawer 打开。
- 确认请求以内联 action card 呈现在消息流中。
- 默认入口首条消息提交后，URL 必须写入真实 `sessionId/taskId`，rail 和 localStorage 都不包含 `assistant-ui-preview`。
- 页面不出现成本、预算、token hash、模型价格等字段。

**自动化覆盖**

- `apps/share-gateway/test/productization/httpServer.test.ts`
  - HTML 合约覆盖裸 URL 302 到 assistant-ui、classic 兼容页 `friend-chat-shell`、Session sidebar、chat thread、composer、preview drawer 和 inline approval card。
  - 脚本级 UI 覆盖 `sessionStore`、`activeSessionId`、`localStorage`、`newSession()`、`switchSession()`、`appendChatMessage()`。
  - 泄露检查覆盖 `cost`、`budget`、`tokenHash`、`模型价格`。
- `apps/share-web/test/share-page.test.ts`
  - 产品模型覆盖 `experienceLabel`、`sessionSidebar`、`chatThread`、`chatComposer`、`previewDrawer`。

**验证命令**

```bash
node scripts/test.mjs apps/share-gateway/test/productization/httpServer.test.ts
node scripts/test.mjs apps/share-web/e2e/friend-session-browser.test.ts
node scripts/test.mjs apps/share-web/test/share-page.test.ts
```

### TC-3.2 朋友页面移动端可用

**用户动作**

1. 朋友在窄屏或手机视口打开分享链接。

**期望结果**

- Chat thread 占满主屏。
- Session sidebar 折叠为 session menu。
- Composer 固定在底部且不遮挡最新消息。
- Preview drawer 变成全屏 sheet。
- 不产生横向滚动。

**当前覆盖**

- 2026-05-24 已完成真实浏览器 QA：Playwright 临时驱动本机 Chrome，375x812 视口下断言 `document.documentElement.scrollWidth <= window.innerWidth`，结果 `375 <= 375`。
- 截图证据：
  - `.gstack/qa-reports/screenshots/friend-chat-session-mobile.png`
  - `.gstack/qa-reports/screenshots/friend-chat-session-preview-open.png`

**仍需补强**

- 仍需后续把当前临时 Playwright QA 固化为仓库内可重复运行的 e2e 用例。

## 流程 4：朋友进行多轮 Agent 会话

### TC-4.1 朋友创建、切换 Session 并提交第一轮任务

**用户动作**

1. 朋友打开分享链接。
2. 如果没有 Session，页面自动创建第一个 Session。
3. 朋友点击“新会话”创建第二个 Session。
4. 朋友在当前 Session 输入任务并提交。

**期望结果**

- Session sidebar 至少展示当前分享链接下的本地 Session。
- 每个 Session 绑定真实后端 `sessionId`。
- 朋友可以切换 Session。
- 任务提交到当前 share link 绑定的 Host。
- Chat thread 状态从“等待任务”进入“运行中”或最终态。
- 提交按钮保持可再次使用。

**自动化覆盖**

- `apps/share-gateway/test/productization/taskFlow.test.ts`
- `apps/share-gateway/test/productization/httpServer.test.ts`
- `apps/share-web/e2e/share-flow.test.ts`

**验证命令**

```bash
npm run test:e2e
npm run test:integration
```

### TC-4.2 朋友看到 Chatbot 消息流

**用户动作**

1. 朋友提交任务后等待 Agent 执行。
2. 页面轮询 task events。

**期望结果**

- 页面把用户任务渲染为 `user` 消息。
- 页面把 Agent 输出渲染为 `assistant` 消息。
- 如果本地 outbound Host 分多段推送 `task.output`，同一个 task 的输出必须合并为一条连续的 Agent 消息，按事件顺序保留换行，不能拆成多张零散卡片。
- Friend 本地 `sessionStore` 中缓存的 Agent 输出必须与 events API 的输出一致，重复轮询不能重复追加同一段 output。
- 任务提交异常时，页面必须保留朋友刚发送的用户消息，并显示友好的失败消息；不能把 `session_unavailable`、`shared_agent_unavailable`、网络异常栈、内部路径、成本或 token 信息直接展示给朋友。
- 页面把 `task.completed` / `task.failed` / `task.cancelled` 等终态渲染为轻量 status message。
- 状态标签随事件更新为“已完成”“失败”或“已取消”。
- 如果提交响应尚未带回事件，页面继续轮询直到终态或达到上限。

**自动化覆盖**

- `apps/share-gateway/test/productization/httpServer.test.ts`
- `apps/share-gateway/test/productization/hostClient.test.ts`
- `apps/share-gateway/test/productization/hostTransport.test.ts`

**当前状态**

- 2026-05-25 已补脚本级 UI 合同：`productized friend chatbot renders local host output as one consistent Agent message` 使用真实 productized HTTP outbound command/event API 构造本地 Host 多段输出，验证朋友页只渲染一条 Agent output 消息，内容为 events API 文本按顺序合并，且本地 `sessionStore` 只缓存一条 `task.output`。
- 2026-05-25 已补异常消息合同：`productized friend chatbot keeps the user message and shows a friendly failure on task request errors` 模拟 task request 抛出网络异常，验证用户消息仍在 thread 中、失败文案为“任务提交失败，请稍后重试”，且不泄露异常细节。

**浏览器 dogfood**

当前已用 Chrome 验证：

1. 打开 Friend 页面。
2. 输入任务。
3. 提交任务。
4. 页面显示 `已完成`。
5. 事件流出现 Agent 输出和完成事件。
6. 2026-05-25 追加异常场景：浏览器拦截 task response 为业务失败 JSON，页面保留用户消息并展示友好失败消息，console error 为空。

### TC-4.3 朋友在同一 Session 中连续进行多轮任务

**用户动作**

1. 朋友打开同一个分享链接。
2. 提交第一轮任务，例如“总结当前目录结构”。
3. 等待第一轮输出完成。
4. 在同一个页面继续提交第二轮任务，例如“基于上一步结果提出下一步建议”。
5. 可选继续第三轮任务。

**期望结果**

- 页面保持同一个 Agent Session。
- 第二轮任务能在同一个 Chat thread 中继续，不要求朋友重新打开链接。
- 消息流保留前一轮用户任务和 Agent 输出，不应被第二轮覆盖。
- 同一 Session 中快速连续发送多个消息时，页面先按用户发送顺序渲染消息，再按 Session 队列提交；后发消息不能因为前一轮运行中而丢失、插队或显示裸 `session_unavailable`。
- 每一轮都有独立的运行状态和终态事件。
- 预览、确认请求和事件轮询都绑定到当前轮次，同时不破坏历史轮次展示。
- 页面仍不展示成本、预算、token hash、模型价格等字段。

**自动化覆盖**

- API 层覆盖：`apps/share-gateway/test/productization/taskFlow.test.ts` 的 explicit session 复用。
- HTTP 层覆盖：`apps/share-gateway/test/productization/httpServer.test.ts` 的 explicit session 创建与复用、同 session follow-up task、Friend 页面 `sessionStore` / `activeSessionId` / `appendChatMessage` / `data-task-id` 合约。
- UI 脚本级覆盖：`apps/share-gateway/test/productization/httpServer.test.ts` 直接执行 Friend 页面内联 JS，验证同页连续两轮任务会保留第一轮输出、追加第二轮输出、提交成功后清空输入框，并继续隐藏 `cost` / `budget` / `tokenHash` / `模型价格`。
- 多 Session UI 覆盖：`productized friend chatbot creates and switches sessions without mixing messages` 验证自动创建 Session、新建第二个 Session、切回第一/第二 Session 时消息互不串线。
- 并发消息 UI 覆盖：`productized friend chatbot queues rapid same-session messages in user send order` 验证同一 Session 快速连发两条消息时，用户消息和 Agent 输出都按发送顺序保留。
- 并行 Session UI 覆盖：`productized friend chatbot keeps parallel session responses bound to the originating session` 验证 Session A 任务未返回时切到 Session B 并发送任务，两个任务的返回仍写回各自 Session。

**浏览器 dogfood**

2026-05-23 已用 Chrome 验证：

1. 启动 `PORT=5181 npm run dev:productized:outbound`。
2. 打开 Friend 页面。
3. 提交 `round one please acknowledge`，状态最终为“已完成”，thread 出现用户任务、Agent 输出、完成事件。
4. 同页提交 `round two please continue same thread`，状态最终为“已完成”。
5. 2026-05-25 追加真实浏览器 QA：同一 Session 快速连发两条消息，页面按发送顺序保留两条用户消息并显示 Agent 输出。
6. 2026-05-25 追加真实浏览器 QA：Session A 提交后立刻新建 Session B 并提交，切换两个 Session 时消息没有串线。
5. 第二轮完成后，第一轮用户任务与 Agent 输出仍保留，第二轮事件追加在同一 thread 内。
6. 页面未出现 `cost`、`budget`、`tokenHash`、`模型价格`。

**仍需补强**

- 2026-05-24 已完成真实浏览器 dogfood：多 Session 创建、两轮任务、切换回第一 Session、预览抽屉开关、移动端无横向溢出、console errors 为空。
- 仍需后续把临时 Playwright 脚本沉淀为仓库内 e2e。

**建议验证命令**

```bash
node scripts/test.mjs apps/share-gateway/test/productization/taskFlow.test.ts
node scripts/test.mjs apps/share-gateway/test/productization/httpServer.test.ts
```

## 流程 5：朋友查看桌面预览

### TC-5.1 只读预览 drawer 空态

**用户动作**

1. 朋友打开分享链接但尚未产生 preview frame。

**期望结果**

- Preview drawer 默认收起。
- 点击预览按钮后，右侧 drawer 打开并显示“只读预览”空态。
- 点击关闭后 drawer 收起。
- 页面不暗示朋友可以直接操控创建者电脑。
- Chat thread 不因 drawer 开关丢失消息。

**自动化覆盖**

- `apps/share-gateway/test/productization/httpServer.test.ts`
- `apps/share-web/test/share-page.test.ts`

**浏览器 dogfood**

2026-05-24 已完成：

1. 打开 `/app/share/local-friend`，确认 preview drawer 初始 `aria-hidden="true"`。
2. 提交第一轮任务后打开 drawer，确认 `is-open` class 生效。
3. 关闭 drawer，确认 `aria-hidden="true"` 且 `is-open` 被移除。
4. 移动端关闭态 `visibility: hidden`，避免 full-page QA 截图误判为抽屉仍打开。

### TC-5.2 预览 frame 按 session/task 隔离

**用户动作**

1. Host 提交 preview frame。
2. 朋友通过匹配的 token、session、task 请求预览。
3. 使用错误 token、session 或 task 请求预览。

**期望结果**

- 正确 session/task 能看到 preview frame。
- 错误 token/session/task 返回中性错误。
- 超大 preview 被拒绝并记录审计。
- 过期 preview 返回 stale 状态。

**自动化覆盖**

- `apps/share-gateway/test/productization/preview.test.ts`
- `apps/share-gateway/test/productization/httpServer.test.ts`

**验证命令**

```bash
npm run test:security
npm run test:integration
```

## 流程 6：高风险动作与权限确认

### TC-6.1 需要朋友本人确认的动作

**用户动作**

1. Agent 尝试以朋友身份执行需要确认的动作。
2. 朋友页面刷新确认队列。
3. 朋友点击批准或拒绝。

**期望结果**

- 朋友只看到自己 session 范围内的确认请求。
- 批准/拒绝只影响对应 request。
- 朋友看不到 owner-only 审批数据。

**自动化覆盖**

- `apps/share-gateway/test/productization/approvals.test.ts`
- `apps/share-gateway/test/productization/security.test.ts`
- `apps/share-gateway/test/productization/httpServer.test.ts`

**当前状态**

- 2026-05-24 已补 Friend 页面脚本级 UI 覆盖：确认请求渲染为 `data-testid="friend-approval-card"` 内联消息卡，批准按钮命中朋友侧 confirmation endpoint，批准后卡片从 thread 移除，owner approval API 可查到 approved 状态。

### TC-6.2 需要创建者批准的动作

**用户动作**

1. Agent 触发需要创建者批准的高风险动作。
2. Owner 页面出现审批请求。
3. 创建者批准或拒绝。

**期望结果**

- Owner 只能处理自己 ownerId 下的审批。
- 朋友页面显示等待创建者确认的状态。
- 非 owner 不能越权处理 owner approval。

**自动化覆盖**

- `apps/share-gateway/test/productization/approvals.test.ts`
- `apps/share-gateway/test/productization/security.test.ts`

## 流程 7：异常、风控与安全边界

### TC-7.1 Host 离线

**用户动作**

1. Host 心跳超时或被标记离线。
2. 朋友打开链接或提交任务。

**期望结果**

- 朋友看到中性不可用状态。
- 不 fallback 到本地 server runtime。
- 不泄露 Host 离线内部细节给朋友。

**自动化覆盖**

- `apps/share-gateway/test/productization/routes.test.ts`
- `apps/share-gateway/test/productization/taskFlow.test.ts`
- `apps/share-gateway/test/productization/security.test.ts`

### TC-7.2 滥用保护

**用户动作**

1. 朋友高频创建 session 或提交任务。
2. 超过并发或速率限制。

**期望结果**

- 新请求被拒绝。
- 朋友侧错误保持中性。
- Owner 审计日志记录原因。

**自动化覆盖**

- `apps/share-gateway/test/productization/taskFlow.test.ts`
- `apps/share-gateway/test/productization/security.test.ts`

### TC-7.3 敏感信息不泄露

**用户动作**

1. 朋友请求 share API、auth gateway、preview、events。
2. 创建者请求 owner API。

**期望结果**

- 朋友响应不包含 host device key、bootstrap secret、token hash、成本字段、策略内部字段。
- 持久化 store 不保存原始 share token 或原始 device key。
- invalid token 返回中性错误。

**自动化覆盖**

- `apps/share-gateway/test/productization/security.test.ts`
- `apps/share-gateway/test/productization/relayStore.test.ts`
- `apps/share-gateway/test/productization/routes.test.ts`

## 流程 8：Agent 框架适配

### TC-8.1 框架发现

**用户动作**

1. Host 检测 Claude Code、Codex、OpenCode 等 Agent 框架。
2. Owner 页面展示可用框架。

**期望结果**

- 支持框架按稳定顺序展示。
- 未安装或未配置框架显示对应状态。
- Owner 创建分享链接时只能选择 Host 支持的 adapter。

**自动化覆盖**

- `apps/share-gateway/test/adapters/registry.test.ts`
- `apps/share-gateway/test/productization/routes.test.ts`
- `apps/share-web/test/owner-page.test.ts`

### TC-8.2 真实 adapter smoke

**用户动作**

1. 运行 adapter smoke 测试。
2. 在本机环境中检测真实 CLI 或返回未安装/未配置。

**期望结果**

- Claude Code、Codex、OpenCode adapter 的 detect / submit / stream 映射行为符合预期。
- 没有因为本机缺少某个 CLI 而误判产品失败。

**自动化覆盖**

- `apps/share-gateway/test/adapters/claude.test.ts`
- `apps/share-gateway/test/adapters/codex.test.ts`
- `apps/share-gateway/test/adapters/opencode.test.ts`
- `apps/share-gateway/test/productization/realAdapterSmoke.test.ts`

**当前状态**

- 2026-05-25 已补 Codex 真实 CLI 调用保护：`CodexAdapter` 在执行 `codex exec` 时忽略 stdin，并为真实推理任务设置 120 秒超时，避免非交互环境中进程挂起导致朋友页一直等待。
- 2026-05-25 已完成真实浏览器 smoke：`local-friend-2` 使用 `codex` adapter，朋友页提交 `REAL_UI_OK` 任务后显示真实 Codex 输出 `REAL_UI_OK 42`，QA JSON 为 `.gstack/qa-reports/friend-real-codex-output-browser-qa.json`。
- 2026-05-25 已补本轮真实浏览器 dogfood：headless Chrome 打开 `local-friend-2`，朋友侧提交任务后展示真实 Codex 输出 `REAL_BROWSER_QA_OK 37`，QA JSON 为 `.gstack/qa-reports/friend-chat-ui-real-browser-qa-2026-05-25-stop-cycle.json`。

**验证命令**

```bash
npm run test:smoke:real-adapter
```

## 浏览器 Dogfood 用例

### TC-B1 朋友侧多 Session Chatbot 主流程

**步骤**

1. 启动 `npm run dev:productized:outbound`。
2. 打开 `http://127.0.0.1:5181/app/share/local-friend`。
3. 确认页面存在 Chatbot Session 结构。
4. 确认 sidebar 中至少有一个 Session。
5. 输入第一轮任务。
6. 点击发送。
7. 等待最多 4 秒，确认第一轮出现输出。
8. 点击“新会话”，创建第二个 Session。
9. 在第二个 Session 输入任务并发送。
10. 切回第一个 Session，确认第一轮消息仍可见。
11. 打开和关闭 Preview drawer。
12. 在同一 Session 快速连续发送两条消息，确认两条用户消息按发送顺序保留。
13. 模拟任务提交异常，确认用户消息不丢失且错误文案友好。
14. 在 Session A 任务返回前切到 Session B 并发送消息，确认两个 Session 的 Agent 输出不串线。

**期望结果**

- 页面标题为 Ralphloop Share。
- DOM 有 `[data-testid="friend-chat-shell"]`、`[data-testid="friend-session-sidebar"]`、`[data-testid="friend-chat-thread"]`、`[data-testid="friend-chat-composer"]`、`[data-testid="friend-preview-drawer"]`。
- 每一轮状态为“运行中”“已完成”或“失败”。
- 消息流至少出现两轮任务对应的 message。
- Session 切换不会串线或覆盖历史。
- 同一 Session 快速连发不会丢消息、乱序或展示裸内部错误。
- 异常提交不会丢用户消息，且不泄露 `session_unavailable`、`shared_agent_unavailable`、网络异常栈、成本、预算或 token 信息。
- 多个 Session 并行返回时，Agent 输出绑定原始 Session，不依赖当前激活 Session。
- Preview drawer 默认关闭，并可打开/关闭。
- 页面文本不包含 `cost`、`budget`、`tokenHash`、`模型价格`。

**当前状态**

- 2026-05-24 产品方向已调整为多 Session Chatbot；旧 Agent 控制台验收不再作为目标。
- 2026-05-24 已完成脚本级 UI 自动化：多 Session 创建、切换、消息隔离、预览抽屉、inline confirmation card。
- 2026-05-24 已完成真实浏览器 dogfood：临时 Playwright 驱动本机 Chrome 通过完整朋友侧主流程，QA JSON 为 `.gstack/qa-reports/friend-chat-session-browser-qa.json`。
- 2026-05-25 已补真实浏览器 dogfood：从 HTTP API 写入本地 Host 的两段 `task.output`，朋友页加载后显示一条合并后的 Agent 输出消息，QA JSON 为 `.gstack/qa-reports/friend-local-output-browser-qa.json`。
- 2026-05-25 已补消息可靠性 QA：临时 Playwright 驱动 Chrome 覆盖同一 Session 快速连发、业务失败友好展示、多 Session 并行隔离和移动端无横向溢出，QA JSON 为 `.gstack/qa-reports/friend-message-reliability-browser-qa.json`。
- 2026-05-25 本轮补充 CDP 浏览器 QA：验证 bootstrap Session 不额外抢建、朋友提交后本地 Codex 输出进入 Agent bubble、输入框清空、停止按钮回到 disabled，console error 为 0。
- 截图证据：
  - `.gstack/qa-reports/screenshots/friend-chat-session-initial.png`
  - `.gstack/qa-reports/screenshots/friend-chat-session-first-message.png`
  - `.gstack/qa-reports/screenshots/friend-chat-session-second-message.png`
  - `.gstack/qa-reports/screenshots/friend-chat-session-switched-back.png`
  - `.gstack/qa-reports/screenshots/friend-rapid-same-session.png`
  - `.gstack/qa-reports/screenshots/friend-request-failure.png`
  - `.gstack/qa-reports/screenshots/friend-parallel-session-isolation.png`
  - `.gstack/qa-reports/screenshots/friend-message-reliability-mobile.png`
  - `.gstack/qa-reports/screenshots/friend-chat-session-preview-open.png`
  - `.gstack/qa-reports/screenshots/friend-chat-session-mobile.png`
  - `.gstack/qa-reports/screenshots/friend-local-output-consistent.png`
  - `.gstack/qa-reports/screenshots/friend-chat-ui-real-browser-stop-cycle-2026-05-25.png`

### TC-B2 创建者侧查看和生成链接

**步骤**

1. 打开 `http://127.0.0.1:5181/app/owner`。
2. 确认 Host 为在线。
3. 查看“分享链接”列表。
4. 点击“生成分享链接”。
5. 再次查看“分享链接”列表。

**期望结果**

- 已有链接展示名称、状态、Agent 框架和用量。
- 按钮点击后不会卡死。
- 页面生成 `/app/share/local-friend` 链接。
- 新链接或已有链接出现在列表中。
- 如果 Host 离线，显示“创建失败：host_unavailable”，按钮恢复可点。

### TC-B3 创建者侧管理已有链接

**步骤**

1. 打开 `http://127.0.0.1:5181/app/owner`。
2. 在“分享链接”列表中选择 active 链接。
3. 点击“暂停”。
4. 验证朋友访问该链接不可用。
5. 回到 Owner 页面点击“启用”。
6. 验证朋友访问该链接恢复可用。
7. 撤销当前链接。

**期望结果**

- active -> paused -> active -> revoked 的状态转移可见。
- paused/revoked 时朋友侧只出现中性不可用。
- revoked 链接不可再次启用。
- 审计日志出现 `share_link.paused`、`share_link.resumed`、`share_link.revoked`。

**当前状态**

- API、HTML 合约和脚本级 Owner UI 动作已有自动化覆盖。
- 2026-05-23 Chrome dogfood 已执行并通过：已有链接 active -> paused -> active -> revoked，撤销后 Friend 链接不可用。
- 2026-05-24 已补脚本级 UI 自动化：直接执行 Owner 页面内联 JS，验证列表动作触发 API 并刷新列表状态。
- 尚未固化为真实浏览器验收；仍需补截图、布局和跨浏览器层面的检查。

## 回归命令清单

每次认为 Ralphloop 当前阶段完成前，应运行：

```bash
node scripts/test.mjs apps/share-web/test/share-page.test.ts
node scripts/test.mjs apps/share-gateway/test/productization/httpServer.test.ts
npm test
npm run lint
npm run typecheck
npm run build
npm run test:contract
npm run test:integration
npm run test:security
npm run test:e2e
npm run test:smoke:real-adapter
git diff --check
```

## 2026-05-25 朋友侧 Chat 体验增量

### TC-F1 Enter 发送与 Shift+Enter 草稿

**用户动作**

1. 朋友打开分享链接。
2. 在消息输入框输入一段文字。
3. 按 Shift+Enter。
4. 再输入或保留草稿并按 Enter。

**期望结果**

- Shift+Enter 不提交消息，输入框内容保留。
- Enter 提交消息，并清空输入框。
- 对话区出现用户消息和 Agent 输出。

**自动化覆盖**

- `productized friend composer submits with Enter and preserves Shift Enter drafts`

### TC-F2 运行态停止

**用户动作**

1. 朋友在 outbound Host 模式下提交任务。
2. 任务进入运行中。
3. 点击“停止”。

**期望结果**

- 页面状态变为“已取消”。
- 停止按钮禁用。
- 会话消息出现“任务已取消”。
- 本地 Session store 的状态为 `cancelled`。
- 后端通过 friend-scoped cancel API 取消该 Session，并写入 `task.cancelled` runtime event。

**自动化覆盖**

- `productized friend chatbot can stop the active outbound session`

### TC-F3 隐藏内部 runtime 事件

**用户动作**

1. Agent runtime 返回 `task.accepted`、`task.output`、`task.completed`。
2. 朋友查看对话区。

**期望结果**

- 对话区只展示用户消息、Agent 输出和必要终态。
- 不出现“事件 task.accepted”这类内部事件文本。
- `task.output` 多段输出仍按同一任务聚合为一条 Agent 消息。

**自动化覆盖**

- `productized friend chatbot hides internal accepted events from the conversation`
- `productized friend chatbot renders local host output as one consistent Agent message`

### TC-F4 首屏快速发送不重复创建 Session

**用户动作**

1. 朋友打开分享链接。
2. 页面 bootstrap Session 尚未完成时，朋友立即输入第一条消息并发送。

**期望结果**

- 前端复用正在创建中的 bootstrap Session。
- 不重复 POST `/sessions`。
- 不触发 `maxConcurrentSessions` 的 429。
- 第一条消息正常进入同一个 Session 并返回 Agent 输出。

**自动化覆盖**

- `productized friend chatbot reuses the pending bootstrap session for the first quick submit`

### TC-F5 朋友停止传播到 outbound Host

**用户动作**

1. 朋友提交任务，任务以 outbound Host command 形式排队。
2. Host 尚未领取 `task.submit` 前，朋友点击“停止”。
3. Host 下一轮轮询 commands。

**期望结果**

- Relay 将 Session 和 Task 标记为 `cancelled`。
- Relay 写入朋友可见的 `task.cancelled` runtime event。
- Relay 排入 `session.cancel` Host command。
- Host poll 时跳过已经取消的旧 `task.submit`，不会启动 adapter。
- Host client ack `session.cancel` 后，该 command 变为 `completed`，队列清空。

**自动化覆盖**

- `friend session cancel skips stale outbound submit and is acknowledged by host`
- `host client acknowledges session cancel commands without running stale task submit`

**当前状态**

- 2026-05-25 已实现 queued cancel 链路：朋友取消会生成 `session.cancel` command；Host poll 会跳过已取消的 stale `task.submit`；Host client ack `session.cancel` 时不会启动 adapter。
- 2026-05-25 已补测试稳定性：Enter 发送测试不再依赖固定 tick，而是等待朋友页聊天状态进入“已完成”，避免全量并发验证时出现未等待 fetch 泄漏。

### TC-F6 朋友停止中断 running Host task

**用户动作**

1. 朋友提交任务，Host 已领取 `task.submit` 并开始执行 adapter。
2. 朋友点击“停止”，Relay 排入 `session.cancel`。
3. Host client 的下一次并发 poll 领取 `session.cancel`。

**期望结果**

- Host client 在跨 poll tick 的运行态表中找到对应 active task。
- Host client 触发 `AbortController.abort()`，并调用 adapter `stop()` 清理 runtime。
- Codex、Claude Code、OpenCode adapter 都能收到 `AbortSignal`，底层 CLI 命令可以被终止。
- 已取消任务最终只写入 `task.cancelled`，不会再展示 `task.completed`、`task.failed` 或取消后的输出。
- Relay 不重复写入朋友可见的 `task.cancelled`。

**自动化覆盖**

- `host client aborts an active task when a session cancel command is claimed concurrently`
- `friend browser stop terminates a running outbound host child process`
- `submitTask passes cancellation signal to the Codex command runner`
- `submitTask passes cancellation signal to the Claude command runner`
- `submitTask uses opencode run attached to the runtime endpoint`

## 2026-05-25 本轮回归验证记录

**完成标准**

- 朋友侧真实 Codex 输出必须出现在 Agent 消息中，而不是只靠 demo adapter 或用户 prompt 命中。
- 朋友停止 queued outbound task 后，Relay 和 Host command queue 都进入可验证的取消/ack 状态。
- 朋友停止 running outbound task 后，Host client 必须 abort active task，并让 adapter 命令收到 `AbortSignal`。
- 全量测试、分层测试、类型、lint、构建和 diff 检查都必须无失败。

**命令结果**

- `node scripts/test.mjs apps/share-gateway/test/productization/httpServer.test.ts`：32 pass / 0 fail。
- `node scripts/test.mjs apps/share-gateway/test/productization/hostTransport.test.ts apps/share-gateway/test/productization/hostClient.test.ts`：5 pass / 0 fail。
- `npm test`：157 pass / 0 fail。
- `npm run lint`：exit 0。
- `npm run typecheck`：exit 0。
- `npm run build`：exit 0。
- `npm run test:contract`：24 pass / 0 fail。
- `npm run test:integration`：80 pass / 0 fail。
- `npm run test:security`：50 pass / 0 fail。
- `npm run test:e2e`：1 pass / 0 fail。
- `npm run test:smoke:real-adapter`：22 pass / 0 fail。
- `git diff --check`：exit 0。
- headless Chrome CDP QA：passed，真实 Codex 输出 `REAL_BROWSER_QA_OK 37`，console error 为 0。

## 2026-05-25 本轮运行中取消验证记录

**完成标准**

- `session.cancel` 不只处理 queued task，也要能中断 Host client 中正在执行的 task。
- Codex、Claude Code、OpenCode adapter 的命令执行层必须接收 `AbortSignal`。
- 真实浏览器 smoke 仍能通过本机真实 Codex adapter 输出，并且无 console error。

**命令结果**

- `node scripts/test.mjs apps/share-gateway/test/productization/hostClient.test.ts apps/share-gateway/test/adapters/codex.test.ts apps/share-gateway/test/adapters/claude.test.ts apps/share-gateway/test/adapters/opencode.test.ts`：24 pass / 0 fail。
- `npm run lint`：exit 0。
- `npm run typecheck`：exit 0。
- `npm run test:contract`：24 pass / 0 fail。
- `npm run test:integration`：81 pass / 0 fail。
- `npm test`：160 pass / 0 fail。
- `npm run build`：exit 0。
- `npm run test:security`：50 pass / 0 fail。
- `npm run test:e2e`：1 pass / 0 fail。
- `npm run test:smoke:real-adapter`：24 pass / 0 fail。
- headless Chrome CDP QA：passed，临时 `5182` 端口真实 Codex 输出 `RUNNING_CANCEL_QA_OK 51`，console error 为 0，报告为 `.gstack/qa-reports/friend-chat-ui-real-browser-qa-2026-05-25-running-cancel.json`。

## 2026-05-25 本轮固定浏览器 E2E 验证记录

**完成标准**

- 固定 e2e 必须打开真实朋友页，而不是只执行 fake DOM。
- 朋友在页面输入任务并提交后，Host task 必须处于 running 状态。
- 朋友点击真实 UI 的“停止”按钮后，Host client 必须用同一个运行态表处理 `session.cancel`，触发 adapter stop 和 `AbortSignal`。
- adapter 必须启动一个真实长运行子进程，并在取消后观察到该子进程以 `SIGTERM` 退出。
- 若提交响应或任务轮询在停止之后才返回，朋友页仍必须保持 `已取消`，不能回退到 `运行中`。
- 页面最终只展示取消终态，不展示 completed 输出，且无 console error / runtime exception。

**命令结果**

- `node scripts/test.mjs apps/share-web/e2e/friend-running-cancel-browser.test.ts`：1 pass / 0 fail；用例 `friend browser stop terminates a running outbound host child process` 断言子进程 `child-exit:SIGTERM`。
- `npm run test:e2e`：2 pass / 0 fail。
- `npm run lint`：exit 0。
- `npm run typecheck`：exit 0。
- `npm run build`：exit 0。
- `npm run test:contract`：24 pass / 0 fail。
- `npm run test:integration`：81 pass / 0 fail。
- `npm run test:security`：50 pass / 0 fail。
- `npm run test:smoke:real-adapter`：24 pass / 0 fail。
- `npm test`：161 pass / 0 fail。
- `git diff --check`：exit 0。

## 2026-05-25 本轮子进程级取消与停止竞态验证记录

**完成标准**

- 固定浏览器 e2e 必须证明 UI 停止能终止一个真实长运行子进程，而不只是 JS mock 收到 signal。
- 子进程必须以 `SIGTERM` 退出。
- 停止后若任务提交响应晚到，朋友页必须继续显示 `已取消`，不能被后到响应覆盖成 `运行中`。

**命令结果**

- `node scripts/test.mjs apps/share-web/e2e/friend-running-cancel-browser.test.ts`：1 pass / 0 fail；用例 `friend browser stop terminates a running outbound host child process` 覆盖 `child-started`、`child-exit:SIGTERM` 和取消终态保持。
- `npm run test:e2e`：2 pass / 0 fail。
- `npm run lint`：exit 0。
- `npm run typecheck`：exit 0。
- `npm run build`：exit 0。
- `npm run test:contract`：24 pass / 0 fail。
- `npm run test:integration`：81 pass / 0 fail。
- `npm run test:security`：50 pass / 0 fail。
- `npm run test:smoke:real-adapter`：24 pass / 0 fail。
- `npm test`：161 pass / 0 fail。
- `git diff --check`：exit 0。

## 2026-05-25 本轮朋友页响应式浏览器验证记录

**完成标准**

- 固定 e2e 必须使用真实 headless Chrome，而不是 fake DOM。
- 桌面 `1440x1000` viewport 下，朋友页 shell/sidebar/chat/thread/composer 必须在 viewport 内，无 document 级横向滚动。
- 移动 `390x844` viewport 下，朋友页必须无 document 级横向滚动，sidebar 在 chat 上方，thread 在 composer 上方。
- 移动 preview drawer 关闭态必须隐藏且不可点击；打开态必须在 viewport 内并覆盖可视高度。
- 桌面和移动两种状态都必须能捕获非空截图数据，console error / runtime exception 为 0。

**自动化覆盖**

- `friend browser chat layout stays usable across desktop and mobile viewports`

**命令结果**

- `node scripts/test.mjs apps/share-web/e2e/friend-running-cancel-browser.test.ts`：2 pass / 0 fail。
- `npm run test:e2e`：3 pass / 0 fail。
- `npm run lint`：exit 0。
- `npm run typecheck`：exit 0。
- `npm run build`：exit 0。
- `npm run test:contract`：24 pass / 0 fail。
- `npm run test:integration`：81 pass / 0 fail。
- `npm run test:security`：50 pass / 0 fail。
- `npm run test:smoke:real-adapter`：24 pass / 0 fail。
- `npm test`：162 pass / 0 fail。
- `git diff --check`：exit 0。

## 2026-05-25 本轮创建者页真实浏览器管理验证记录

**完成标准**

- 固定 e2e 必须使用真实 headless Chrome 打开 `/app/owner`，不能只调用 owner API 或 fake DOM。
- 测试 fixture 必须注册本机 Host，并预置至少两个已有分享链接，覆盖“查看已有链接”而不只覆盖“生成新链接”。
- 创建者必须能在真实页面中编辑已有链接名称并保存，页面显示保存成功且列表文本更新。
- 创建者必须能在真实页面中暂停已有链接，再重新启用同一链接。
- 桌面 `1440x1000` viewport 下，owner shell、topbar、workspace、分享操作区、链接列表和编辑表单必须在 viewport 内，无 document 级横向滚动。
- 移动 `390x844` viewport 下，链接列表、名称输入框、框架选择和保存按钮必须在 viewport 内，表单控件按纵向顺序排列，无 document 级横向滚动。
- 桌面和移动两种状态都必须能捕获非空截图数据，console error / runtime exception 为 0。

**自动化覆盖**

- `owner browser share-link management stays usable across desktop and mobile viewports`

**命令结果**

- `node scripts/test.mjs apps/share-web/e2e/owner-responsive-browser.test.ts`：1 pass / 0 fail。
- `node scripts/test.mjs apps/share-web/e2e/friend-running-cancel-browser.test.ts`：2 pass / 0 fail。
- `npm run test:e2e`：4 pass / 0 fail。
- `npm run lint`：exit 0。
- `npm run typecheck`：exit 0。
- `npm run build`：exit 0。
- `npm run test:contract`：24 pass / 0 fail。
- `npm run test:integration`：81 pass / 0 fail。
- `npm run test:security`：50 pass / 0 fail。
- `npm run test:smoke:real-adapter`：24 pass / 0 fail。
- `npm test`：163 pass / 0 fail。
- `git diff --check`：exit 0。

## 2026-05-25 本轮朋友页真实浏览器行为与截图归档验证记录

**完成标准**

- 固定 e2e 必须使用真实 headless Chrome 打开 `/app/share/local-friend`。
- 同一 Session 快速连续发送两条消息时，两条用户消息必须按顺序保留，两条 Host 输出必须按顺序展示，状态最终为 `已完成`，不能因为后发消息清掉先发任务的轮询。
- 多个 Session 并行提交时，第二个 Session 只能看到自己的输入和输出；切回第一个 Session 后只能看到第一个 Session 的输入和输出。
- 任务请求异常时，朋友刚输入的消息必须保留，页面必须显示 `任务提交失败，请稍后重试`，不能泄露 `TypeError`、网络内部错误、成本、预算、token、deviceKey 或 bootstrap 字段。
- 每个固定浏览器行为场景必须归档非空 PNG 截图到 `.gstack/qa-reports/browser-screenshots`。
- 所有新增浏览器行为场景 console error / runtime exception 为 0。

**自动化覆盖**

- `friend browser queues rapid same-session messages in send order`
- `friend browser keeps parallel session outputs bound to their originating session`
- `friend browser preserves the user message and hides internal error details on task request failure`

**缺陷与修复**

- 真实浏览器全套回归中发现快速连发竞态：全局 `taskPollTimer` 会让后一次提交清掉前一次任务轮询，导致第一条 Agent 输出偶发丢失。
- 修复为按 `sessionId:taskId` 维护 `taskPollTimers`，并阻止旧任务终态覆盖同一 Session 的较新 `currentTaskId`。

**截图证据**

- `.gstack/qa-reports/browser-screenshots/friend-rapid-same-session.png`
- `.gstack/qa-reports/browser-screenshots/friend-parallel-session-second.png`
- `.gstack/qa-reports/browser-screenshots/friend-parallel-session-first.png`
- `.gstack/qa-reports/browser-screenshots/friend-friendly-failure.png`

**命令结果**

- `node scripts/test.mjs apps/share-web/e2e/friend-session-browser.test.ts`：3 pass / 0 fail。
- `node scripts/test.mjs apps/share-gateway/test/productization/httpServer.test.ts`：32 pass / 0 fail。
- `npm run test:e2e`：7 pass / 0 fail。
- `npm run lint`：exit 0。
- `npm run typecheck`：exit 0。
- `npm run build`：exit 0。
- `npm run test:contract`：24 pass / 0 fail。
- `npm run test:integration`：81 pass / 0 fail。
- `npm run test:security`：50 pass / 0 fail。
- `npm run test:smoke:real-adapter`：24 pass / 0 fail。
- `npm test`：166 pass / 0 fail。
- `git diff --check`：exit 0。

## 2026-05-25 本轮 AG-UI Runtime Contract 验证记录

**完成标准**

- 必须有独立 contract 测试证明内部 `RuntimeEvent` 可以转换为 AG-UI 兼容事件流。
- `task.output` 必须映射为 `TEXT_MESSAGE_START`、一个或多个 `TEXT_MESSAGE_CONTENT`、`TEXT_MESSAGE_END`，并用同一个 `messageId` 绑定。
- `task.completed` 必须映射为 `RUN_FINISHED`；`task.failed` 必须映射为 `RUN_ERROR`；`task.cancelled` 必须映射为 Ralphloop 自定义取消事件和取消终态。
- `RUN_STARTED` 必须带 `threadId`、`runId`，并在可用时带用户输入 message，方便后续 assistant-ui / AG-UI runtime 恢复上下文。
- `task.accepted` 不得出现在 AG-UI 输出中。
- HTTP `GET /v1/share/:token/events?sessionId=...&taskId=...&format=ag-ui` 必须返回 AG-UI 事件格式，同时默认不带 `format` 时仍返回既有 RuntimeEvent，避免破坏当前朋友页。
- AG-UI 格式不得泄露成本、预算、tokenHash、deviceKey 或 bootstrap 字段。

**自动化覆盖**

- `RuntimeEvent output maps to AG-UI run lifecycle and streaming text events`
- `RuntimeEvent failure and cancellation map to terminal AG-UI events without internal accepted events`
- `friend events API can return AG-UI formatted events for a task`
- `HTTP friend events endpoint exposes AG-UI format through query parameter`

**命令结果**

- `node scripts/test.mjs apps/share-gateway/test/productization/agUiEvents.test.ts`：4 pass / 0 fail。
- `npm run test:contract`：28 pass / 0 fail。
- `node scripts/test.mjs apps/share-gateway/test/productization/hostTransport.test.ts apps/share-gateway/test/productization/httpServer.test.ts`：35 pass / 0 fail。
- `npm run lint`：exit 0。
- `npm run typecheck`：exit 0。
- `npm run build`：exit 0。
- `npm run test:integration`：81 pass / 0 fail。
- `npm run test:security`：50 pass / 0 fail。
- `npm run test:e2e`：7 pass / 0 fail。
- `npm run test:smoke:real-adapter`：24 pass / 0 fail。
- `npm test`：170 pass / 0 fail。
- `git diff --check`：exit 0。

## 2026-05-25 本轮朋友页 AG-UI 客户端消费验证记录

**完成标准**

- 朋友页恢复已有 Session 或轮询任务事件时，必须请求 `GET /v1/share/:token/events?...&format=ag-ui`。
- 客户端必须能从 `RUN_STARTED.input.messages` 恢复用户原始输入，让已有 Session 的对话上下文完整展示。
- 客户端必须把同一 `messageId` 的 `TEXT_MESSAGE_CONTENT.delta` 合并成一条 Agent message，且不会因为任务提交响应和事件刷新重复追加输出。
- `RUN_FINISHED` 必须驱动完成态；`RUN_ERROR` 必须驱动失败态；Ralphloop `CUSTOM` 事件必须能映射回取消、计划、进度、授权或确认类 UI message。
- 如果服务端返回旧 RuntimeEvent 格式，客户端仍保留兼容 fallback。
- 朋友页渲染不得暴露成本、预算、tokenHash、deviceKey、bootstrap 或内部错误栈。

**TDD 红绿记录**

- RED：先把 `productized friend chatbot renders local host output as one consistent Agent message` 升级为客户端 contract，测试要求事件请求必须带 `format=ag-ui`；未实现时 `node scripts/test.mjs apps/share-gateway/test/productization/httpServer.test.ts` 失败，31 pass / 1 fail，失败断言为 `agUiEventRequestCount >= 1`。
- GREEN：实现朋友页 AG-UI 事件消费、用户消息恢复、Agent 输出 upsert 合并、AG-UI 终态识别后，同一命令通过，32 pass / 0 fail。
- 回归修复：全量 `npm test` 曾暴露 fake DOM harness 的异步等待缺口：停止按钮和 pending bootstrap 用例的事件监听器都会 `void` 掉页面内部 async handler，测试在全量负载下可能先关闭 server，随后产生 `fetch failed` 或状态仍为“运行中”。修复为等待明确 UI 终态：停止 helper 等待“已取消”，pending bootstrap 用例等待“已完成”。

**自动化覆盖**

- `productized friend chatbot renders local host output as one consistent Agent message`
  - 断言朋友页请求 `format=ag-ui`。
  - 断言从 `RUN_STARTED` 恢复 `Run local reasoning and explain the result`。
  - 断言两段本地 Host 输出合并为一条 Agent message。
  - 断言不会泄露 cost、budget、tokenHash、deviceKey、bootstrap 或模型价格文案。
- 既有真实浏览器回归继续覆盖快速连发、多 Session 并行、异常友好展示、停止、响应式布局。

**命令结果**

- `node scripts/test.mjs apps/share-gateway/test/productization/httpServer.test.ts`：32 pass / 0 fail。
- `npm run test:contract`：28 pass / 0 fail。
- `npm run test:integration`：81 pass / 0 fail。
- `npm run test:e2e`：7 pass / 0 fail。
- `npm run lint`：exit 0。
- `npm run typecheck`：exit 0。
- `npm run build`：exit 0。
- `npm run test:security`：50 pass / 0 fail。
- `npm run test:smoke:real-adapter`：24 pass / 0 fail。
- `npm test`：170 pass / 0 fail。
- `git diff --check`：exit 0。

## 2026-05-25 本轮 assistant-ui ExternalStore 转换层验证记录

**完成标准**

- `apps/share-web` 必须有独立 runtime adapter，把 AG-UI events 转成 assistant-ui ExternalStore 可消费的 message state。
- 输出 message 必须包含稳定 `id`、`role`、`content: [{ type: "text", text }]`、`status` 和 `metadata.source/threadId/runId`。
- `RUN_STARTED.input.messages` 必须生成用户/系统/助手输入消息。
- `TEXT_MESSAGE_START/CONTENT/END` 必须按 `messageId` 合并 assistant text。
- 未完成 run 必须 `isRunning=true` 且 assistant message status 为 `{ type: "running" }`；`RUN_FINISHED` 必须转为完成或取消；`RUN_ERROR` 必须转为失败。
- `CUSTOM` 事件可作为 side-channel runtime data 保留，但不得携带 tokenHash、deviceKey、bootstrap、cost、budget 等敏感或成本字段。
- `createSharePageModel()` 必须能消费该 external store，证明后续替换成 assistant-ui `useExternalStoreRuntime` 时有稳定数据边界。

**TDD 红绿记录**

- RED：新增 `apps/share-web/test/ag-ui-external-store.test.ts` 后，`node scripts/test.mjs apps/share-web/test/ag-ui-external-store.test.ts` 失败，原因是 `apps/share-web/src/runtime/agUiExternalStore.ts` 不存在。
- GREEN：新增 `createAssistantUiExternalStoreFromAgUiEvents()` 并接入 `createSharePageModel()` 后，同一命令 4 pass / 0 fail。

**自动化覆盖**

- `AG-UI events convert to assistant-ui external store text messages`
- `AG-UI external store keeps streaming assistant message running until terminal event`
- `AG-UI external store preserves safe custom events and drops secret-like fields`
- `friend share page model can render AG-UI external store messages`

**命令结果**

- `node scripts/test.mjs apps/share-web/test/ag-ui-external-store.test.ts`：4 pass / 0 fail。
- `node scripts/test.mjs apps/share-web/test`：13 pass / 0 fail。
- `npm run test:contract`：28 pass / 0 fail。
- `npm run test:integration`：81 pass / 0 fail。
- `npm run test:e2e`：7 pass / 0 fail。
- `npm run test:security`：50 pass / 0 fail。
- `npm run test:smoke:real-adapter`：24 pass / 0 fail。
- `npm run lint`：exit 0。
- `npm run typecheck`：exit 0。
- `npm run build`：exit 0。
- `npm test`：174 pass / 0 fail。
- `git diff --check`：exit 0。

## 2026-05-25 本轮 assistant-ui ExternalStore transport client 验证记录

**完成标准**

- `apps/share-web` 必须有独立 transport client，能对接未来 assistant-ui ExternalStoreRuntime 的 `onNew`、`onCancel` 和 `loadEvents` callback。
- `onNew` 必须只接受文本消息，把 `{ sessionId, prompt }` 提交到 `/v1/share/:token/tasks`，并用真实 `task.id` 重新请求 `format=ag-ui` events。
- `onCancel` 必须只取消当前 active task，把 `{ taskId }` 提交到 `/v1/share/:token/sessions/:sessionId/cancel`，随后刷新同一 task 的取消事件。
- `loadEvents` 必须固定请求 `format=ag-ui` 并复用 AG-UI → ExternalStore 转换层。
- 非文本、空文本、无 active task cancel 必须在发出网络请求前失败。
- transport 请求不得携带成本、预算、tokenHash、deviceKey、bootstrap、host auth 或创建者内部策略字段。
- 朋友页事件监听器必须可被测试 harness 等待完整异步链路；不能在 UI 文案先变成终态后留下后台 fetch，导致全量测试结束后出现 unhandled rejection。

**TDD 红绿记录**

- RED：新增 `apps/share-web/test/friend-ag-ui-runtime-client.test.ts` 后，`node scripts/test.mjs apps/share-web/test/friend-ag-ui-runtime-client.test.ts` 失败，原因是 `apps/share-web/src/runtime/friendAgUiRuntimeClient.ts` 不存在。
- GREEN：新增 `createFriendAgUiRuntimeClient()` 后，同一命令 3 pass / 0 fail。
- 回归修复：首次全量 `npm test` 暴露 `productized friend chatbot reuses the pending bootstrap session for the first quick submit` 在用例结束后仍产生 `TypeError: fetch failed` unhandled rejection。根因是朋友页事件监听器使用 `void submitChatMessage(...)` 丢掉 Promise，测试只能等到状态文案，不能等待 `refreshPreview/refreshTaskEvents/refreshConfirmations` 完成。修复为 `runFriendAction()` 返回带 catch 的 Promise，让 fake DOM 能等待完整异步链路，真实浏览器也不会留下未处理 rejection。

**自动化覆盖**

- `friend AG-UI runtime onNew submits text and reloads format=ag-ui events`
- `friend AG-UI runtime onCancel cancels active task and refreshes cancellation events`
- `friend AG-UI runtime rejects non-text or blank sends before transport`
- `productized friend chatbot reuses the pending bootstrap session for the first quick submit`

**命令结果**

- `node scripts/test.mjs apps/share-web/test/friend-ag-ui-runtime-client.test.ts`：3 pass / 0 fail。
- `node scripts/test.mjs apps/share-web/test`：16 pass / 0 fail。
- `node scripts/test.mjs apps/share-gateway/test/productization/httpServer.test.ts`：32 pass / 0 fail。
- `npm run lint`：exit 0。
- `npm run typecheck`：exit 0。
- `npm run build`：exit 0。
- `npm run test:contract`：28 pass / 0 fail。
- `npm run test:integration`：81 pass / 0 fail。
- `npm run test:e2e`：7 pass / 0 fail。
- `npm run test:security`：50 pass / 0 fail。
- `npm run test:smoke:real-adapter`：24 pass / 0 fail。
- `npm test`：177 pass / 0 fail。
- `git diff --check`：exit 0。

## 2026-05-25 本轮 assistant-ui 多 Session runtime store 验证记录

**完成标准**

- `apps/share-web` 必须提供独立 runtime store，能把 Ralphloop 多个后端 Session 映射为 assistant-ui ExternalStoreRuntime 可消费的多 thread adapter shape。
- Ralphloop `sessionId` 必须直接作为 assistant-ui `threadId`，避免新增前端 id 导致消息、取消或事件刷新串线。
- runtime store 必须输出当前 thread 的 `messages/isRunning/status`，并输出 `threads/archivedThreads/currentThreadId`。
- `onSwitchToNewThread` 必须通过 `/v1/share/:token/sessions` 创建真实后端 Session，再切换到新 thread。
- `onNew` 必须路由到当前选中 Session，并复用 `format=ag-ui` 事件刷新；新会话首条消息可用于生成默认标题。
- `onCancel` 必须只取消当前选中 Session 的当前 task，不能影响其他 Session 的消息。
- transport 请求不得携带成本、预算、tokenHash、deviceKey、bootstrap、host auth 或创建者内部策略字段。

**TDD 红绿记录**

- RED：新增 `apps/share-web/test/friend-ag-ui-runtime-store.test.ts` 后，`node scripts/test.mjs apps/share-web/test/friend-ag-ui-runtime-store.test.ts` 失败，原因是 `apps/share-web/src/runtime/friendAgUiRuntimeStore.ts` 不存在。
- GREEN：新增 `createFriendAgUiRuntimeStore()` 后，同一命令 3 pass / 0 fail。

**自动化覆盖**

- `friend AG-UI runtime store exposes assistant-ui thread list adapter with current session messages`
- `friend AG-UI runtime store creates a thread and routes onNew through the active session`
- `friend AG-UI runtime store cancels only the selected thread task`

**命令结果**

- `node scripts/test.mjs apps/share-web/test/friend-ag-ui-runtime-store.test.ts`：3 pass / 0 fail。
- `node scripts/test.mjs apps/share-web/test`：19 pass / 0 fail。
- `npm run lint`：exit 0。
- `npm run typecheck`：exit 0。
- `npm run build`：exit 0。
- `npm run test:contract`：28 pass / 0 fail。
- `npm run test:integration`：81 pass / 0 fail。
- `npm run test:e2e`：7 pass / 0 fail。
- `npm run test:security`：50 pass / 0 fail。
- `npm run test:smoke:real-adapter`：24 pass / 0 fail。
- `npm test`：180 pass / 0 fail。
- `git diff --check`：exit 0。

## 2026-05-25 本轮真实 assistant-ui runtime binding 验证记录

**完成标准**

- 项目必须声明真实 `@assistant-ui/react`、`react`、`react-dom` 依赖，并提交 lockfile；不得只在文档中“参考”成熟 UI 框架。
- 测试必须能从真实 `@assistant-ui/react` package 导入 `useExternalStoreRuntime`、`AssistantRuntimeProvider`、`ThreadPrimitive.Root` 和 `ThreadListPrimitive.Root`。
- `apps/share-web` 必须提供最小 runtime binding，把 `createFriendAgUiRuntimeStore()` 的输出转成 assistant-ui ExternalStoreRuntime options shape：`messages/isRunning/onNew/onCancel/adapters.threadList`。
- binding 的 `onNew` 必须继续路由到 active Ralphloop Session，并请求 `format=ag-ui` 事件；不得携带成本、预算、deviceKey、bootstrap 或 host auth 材料。
- package smoke 不能让 Node test 进程挂住；若真实包导入会留下活动句柄，必须在隔离子进程中验证导出并显式退出。

**TDD 红绿记录**

- RED：新增 `apps/share-web/test/assistant-ui-runtime-binding.test.ts` 后，`node scripts/test.mjs apps/share-web/test/assistant-ui-runtime-binding.test.ts` 失败，原因是 `@assistant-ui/react` 未安装。
- GREEN：安装 `@assistant-ui/react@0.14.7`、React 19、React DOM 19 和类型包，新增 `createAssistantUiRuntimeOptions()` 后，同一命令 2 pass / 0 fail。
- 修正：首次 GREEN 运行发现直接在 test 进程导入 assistant-ui 会留下活动句柄，且 primitive root 导出类型为 object 不是 function；测试改为隔离子进程 package smoke，并按真实导出类型断言。

**自动化覆盖**

- `assistant-ui package exposes the runtime and thread primitives Ralphloop needs`
- `assistant-ui runtime binding exposes external store options backed by Ralphloop sessions`

**命令结果**

- `node scripts/test.mjs apps/share-web/test/assistant-ui-runtime-binding.test.ts`：2 pass / 0 fail。
- `node scripts/test.mjs apps/share-web/test`：21 pass / 0 fail。
- `npm run lint`：exit 0。
- `npm run typecheck`：exit 0。
- `npm run build`：exit 0。
- `npm run test:contract`：28 pass / 0 fail。
- `npm run test:integration`：81 pass / 0 fail。
- `npm run test:e2e`：7 pass / 0 fail。
- `npm run test:security`：50 pass / 0 fail。
- `npm run test:smoke:real-adapter`：24 pass / 0 fail。
- `npm test`：182 pass / 0 fail。
- `git diff --check`：exit 0。

## 2026-05-25 本轮 assistant-ui React shell SSR 验证记录

**完成标准**

- `apps/share-web` 必须提供一个最小可渲染 React shell，证明 Ralphloop runtime store 不只是生成 options，而是可以进入真实 assistant-ui React runtime context。
- shell 必须在 React 组件中调用 `useExternalStoreRuntime(createAssistantUiRuntimeOptions(store))`。
- shell 必须用 `AssistantRuntimeProvider` 包住 `ThreadListPrimitive.Root` 和 `ThreadPrimitive.Root`。
- SSR smoke 必须输出当前 `threadId`、message count、thread count，并证明不泄露成本、预算、tokenHash、deviceKey 或 bootstrap。
- 由于真实 assistant-ui import/render 在 Node test 进程中会留下活动句柄，SSR smoke 必须在隔离子进程中执行并显式退出，避免测试套件挂住。

**TDD 红绿记录**

- RED：新增 `apps/share-web/test/assistant-ui-react-shell.test.ts` 后，`node scripts/test.mjs apps/share-web/test/assistant-ui-react-shell.test.ts` 失败，原因是 `apps/share-web/src/runtime/assistantUiReactShell.ts` 不存在。
- GREEN：新增 `renderAssistantUiReactShellToString()` 后，SSR 断言通过。
- 修正：首次 GREEN 发现直接在 Node test 进程中 SSR 会留下活动句柄；测试改为隔离子进程 smoke 后同一命令稳定 1 pass / 0 fail。

**自动化覆盖**

- `assistant-ui React shell renders provider, thread, and thread list from Ralphloop store`

**命令结果**

- `node scripts/test.mjs apps/share-web/test/assistant-ui-react-shell.test.ts`：1 pass / 0 fail。
- `node scripts/test.mjs apps/share-web/test`：22 pass / 0 fail。
- `npm run lint`：exit 0。
- `npm run typecheck`：exit 0。
- `npm run build`：exit 0。
- `npm run test:contract`：28 pass / 0 fail。
- `npm run test:integration`：81 pass / 0 fail。
- `npm run test:e2e`：7 pass / 0 fail。
- `npm run test:security`：50 pass / 0 fail。
- `npm run test:smoke:real-adapter`：24 pass / 0 fail。
- `npm test`：183 pass / 0 fail。
- `git diff --check`：exit 0。

## 2026-05-25 本轮 assistant-ui 浏览器分享入口验证记录

**完成标准**

- Ralphloop 必须提供可通过 HTTP 打开的 `/app/share/:token/assistant-ui` 入口，不能只停留在 share-web SSR 单元测试。
- 入口必须通过真实 share token、Session 和 task 查询 `format=ag-ui` 事件，并把当前 Ralphloop Session 作为 assistant-ui `threadId`。
- 页面必须渲染真实 `@assistant-ui/react` shell：`AssistantRuntimeProvider`、`ThreadListPrimitive.Root`、`ThreadPrimitive.Root`。
- 页面必须可见展示用户 prompt 和 Host 输出，不能只输出隐藏 data attribute。
- 页面不得泄露成本、预算、tokenHash、deviceKey、bootstrap、host auth 或创建者内部策略字段。
- 因真实 assistant-ui import/render 会留下活动句柄，HTTP SSR 入口必须用隔离子进程渲染 shell，避免 productized HTTP 测试挂住。

**TDD 红绿记录**

- RED：新增 `productized assistant-ui share page renders a session shell from local host AG-UI events` 后，`node scripts/test.mjs apps/share-gateway/test/productization/httpServer.test.ts --test-name-pattern ...` 失败在 `404 !== 200`，证明浏览器入口不存在。
- GREEN：新增 `/app/share/:token/assistant-ui` route、隔离子进程 SSR 渲染和 `renderAssistantUiSharePage()` 后，同一测试通过，HTTP 页面可恢复 `threadId/messageCount/threadCount`。
- 二次 RED：把测试升级为必须含 `data-assistant-ui-message-list`、用户 prompt 和 Host 输出后，`node scripts/test.mjs apps/share-web/test/assistant-ui-react-shell.test.ts apps/share-gateway/test/productization/httpServer.test.ts` 失败，原因是 shell 只渲染 provider/thread 标记，没有可见消息。
- 二次 GREEN：`assistantUiReactShell.ts` 从 ExternalStore snapshot 渲染可见 message list 后，同一命令 34 pass / 0 fail。

**自动化覆盖**

- `productized assistant-ui share page renders a session shell from local host AG-UI events`
- `assistant-ui React shell renders provider, thread, and thread list from Ralphloop store`

**浏览器 QA**

- 启动 `PORT=5197 npm run dev:productized:outbound`。
- 通过真实 HTTP API 创建朋友 Session、提交 task，并等待 outbound Host demo adapter 回写 AG-UI 事件。
- 使用 Codex in-app browser 打开 `/app/share/local-friend/assistant-ui?sessionId=c4221f8e-cb5d-4728-bb20-a73c369de642&taskId=f9431681-40b6-419e-8900-599297f97410`。
- 浏览器断言结果：title 为 `Ralphloop Assistant UI`，`shell=true`，`hasThread=true`，`hasThreadList=true`，`hasMessageList=true`，`messageCount=2`，`threadCount=1`，用户 prompt 可见，Agent 输出 `Ralphloop opencode demo adapter completed the task.` 可见，`leaks=false`。
- 截图证据：`tmp/ralphloop-assistant-ui-visible-browser-qa.png`。

**命令结果**

- `node scripts/test.mjs apps/share-gateway/test/productization/httpServer.test.ts --test-name-pattern "productized assistant-ui share page renders a session shell from local host AG-UI events"`：RED 失败为 404；GREEN 后 33 pass / 0 fail。
- `node scripts/test.mjs apps/share-web/test/assistant-ui-react-shell.test.ts apps/share-gateway/test/productization/httpServer.test.ts`：二次 RED 失败为缺少可见 message list；GREEN 后 34 pass / 0 fail。
- `npm run lint`：exit 0。
- `npm run typecheck`：exit 0。
- `npm run build`：exit 0。
- `npm run test:contract`：28 pass / 0 fail。
- `npm run test:integration`：82 pass / 0 fail。
- `npm run test:e2e`：7 pass / 0 fail。
- `npm run test:security`：50 pass / 0 fail。
- `npm run test:smoke:real-adapter`：24 pass / 0 fail。
- `npm test`：184 pass / 0 fail。
- `git diff --check`：exit 0。

## 2026-05-25 本轮 assistant-ui Chatbot 视觉结构验证记录

**完成标准**

- assistant-ui 分享入口不能只输出原始 SSR smoke DOM；必须有可测试的 Chatbot 产品结构。
- shell 必须带 `data-assistant-ui-layout="chatbot"`，并保留当前 `threadId/messageCount/threadCount` 验证标记。
- 页面必须包含左侧 thread rail、主 thread panel、message list、用户消息气泡、Agent 消息气泡和 thread 状态标记。
- 桌面 `1440x1000` 与移动 `390x844` viewport 下不得出现 document 级横向滚动，rail、panel、message list 必须在 viewport 内。
- 页面仍必须可见展示用户 prompt 和 Host 输出，并且不泄露成本、预算、tokenHash、deviceKey、bootstrap 或模型价格字段。

**TDD 红绿记录**

- RED：把 `apps/share-web/test/assistant-ui-react-shell.test.ts` 和 `apps/share-gateway/test/productization/httpServer.test.ts` 升级为断言 `data-assistant-ui-layout="chatbot"`、`assistant-ui-thread-rail`、`assistant-ui-thread-panel`、用户/Agent 消息气泡和 `data-assistant-ui-thread-status="completed"` 后，`node scripts/test.mjs apps/share-web/test/assistant-ui-react-shell.test.ts apps/share-gateway/test/productization/httpServer.test.ts` 失败，原因是现有 shell 仍是原始 provider/thread/message list DOM。
- GREEN：为 `assistantUiReactShell.ts` 增加 Chatbot DOM 结构，为 `httpServer.ts` 增加对应 CSS 和移动端布局约束后，同一命令 34 pass / 0 fail。

**自动化覆盖**

- `assistant-ui React shell renders provider, thread, and thread list from Ralphloop store`
- `productized assistant-ui share page renders a session shell from local host AG-UI events`
- `assistant-ui share entry renders a productized chatbot layout in browser`

**浏览器 QA**

- 启动 `PORT=5198 npm run dev:productized:outbound`。
- 通过真实 HTTP API 创建朋友 Session、提交 task，并等待 outbound Host demo adapter 回写 AG-UI 事件。
- 使用 Codex in-app browser 打开 `/app/share/local-friend/assistant-ui?sessionId=46409559-cdb8-4045-8227-bf8c1f812a9e&taskId=07b23b87-b607-4495-ad84-0fd061c9f428`。
- 浏览器断言结果：`layout=chatbot`，`shellClass=assistant-ui-runtime-shell`，`hasRail=true`，`hasPanel=true`，`hasUserBubble=true`，`hasAssistantBubble=true`，`messageCount=2`，`threadCount=1`，`status=completed`，用户 prompt 可见，Agent 输出可见，`horizontalOverflow=false`，`leaks=false`。

**命令结果**

- `node scripts/test.mjs apps/share-web/test/assistant-ui-react-shell.test.ts apps/share-gateway/test/productization/httpServer.test.ts`：RED 失败为缺少 Chatbot 布局标记；GREEN 后 34 pass / 0 fail。
- `node scripts/test.mjs apps/share-web/e2e/assistant-ui-share-entry-browser.test.ts`：1 pass / 0 fail。
- `node scripts/test.mjs apps/share-web/test/assistant-ui-react-shell.test.ts apps/share-gateway/test/productization/httpServer.test.ts apps/share-web/e2e/assistant-ui-share-entry-browser.test.ts`：35 pass / 0 fail。
- `npm run lint`：exit 0。
- `npm run typecheck`：exit 0。
- `npm run build`：exit 0。
- `npm run test:contract`：28 pass / 0 fail。
- `npm run test:integration`：82 pass / 0 fail。
- `npm run test:e2e`：8 pass / 0 fail。
- `npm run test:security`：50 pass / 0 fail。
- `npm run test:smoke:real-adapter`：24 pass / 0 fail。
- `npm test`：185 pass / 0 fail。
- `git diff --check`：exit 0。

## 2026-05-25 本轮 assistant-ui 入口 follow-up 验证记录

### 完成标准

- `/app/share/:token/assistant-ui` 不能只是 SSR 展示页；朋友必须能在该入口继续向同一个 Ralphloop Session 发送消息。
- 第二轮消息必须通过真实 `/v1/share/:token/tasks` 进入 outbound Host command 队列，由本地 Host adapter 回写 runtime events，再以 AG-UI 格式恢复到页面。
- 页面轮询必须绑定新提交的 `taskId`，不能被同一 Session 里旧任务的 `RUN_FINISHED` 提前结束。
- 新任务 events 回来之前，朋友刚输入的 follow-up 消息不能被旧事件刷新覆盖。
- 验收必须检查最终同一 thread 有 4 条可见消息：第一轮用户、第一轮 Agent、第二轮用户、第二轮 Agent，并且没有成本、预算、tokenHash、deviceKey、bootstrap 泄露。

### TDD 记录

- RED：新增 `assistant-ui share entry can send a follow-up message through the host runtime` 后，`node scripts/test.mjs apps/share-web/e2e/assistant-ui-share-entry-browser.test.ts --test-name-pattern "assistant-ui share entry can send a follow-up message through the host runtime"` 失败，原因是页面缺少 `#assistant-ui-composer-input`。
- GREEN 第一阶段：补 assistant-ui composer、client state 和 `/tasks` 提交流程后，同一命令继续失败，原因是页面等待不到 `assistant-ui follow-up output: Continue from assistant-ui page`；定位为轮询读取整个 Session 时被旧任务 completed 事件提前停止。
- GREEN 第二阶段：把轮询终态绑定到当前 `activeTaskId` 后，同一命令继续失败，原因是旧事件刷新覆盖了本地 optimistic follow-up 用户消息。
- GREEN 第三阶段：在当前 `activeTaskId` 尚未出现在 AG-UI 事件流时保留现有 message list，只更新运行态；Host 输出回写后再用完整事件流替换，目标命令通过。

### 覆盖用例

- `assistant-ui share entry renders a productized chatbot layout in browser`
- `assistant-ui share entry can send a follow-up message through the host runtime`

### 本轮验证结果

- `node scripts/test.mjs apps/share-web/e2e/assistant-ui-share-entry-browser.test.ts --test-name-pattern "assistant-ui share entry can send a follow-up message through the host runtime"`：2 pass / 0 fail。
- `node scripts/test.mjs apps/share-web/test/assistant-ui-react-shell.test.ts apps/share-gateway/test/productization/httpServer.test.ts apps/share-web/e2e/assistant-ui-share-entry-browser.test.ts`：36 pass / 0 fail。
- `npm run lint`：exit 0。
- `npm run typecheck`：exit 0。
- `npm run build`：exit 0。
- `npm run test:contract`：28 pass / 0 fail。
- `npm run test:integration`：82 pass / 0 fail。
- `npm run test:e2e`：9 pass / 0 fail。
- `npm run test:security`：50 pass / 0 fail。
- `npm run test:smoke:real-adapter`：24 pass / 0 fail。
- `npm test`：186 pass / 0 fail。

## 2026-05-25 本轮 assistant-ui 入口停止运行验证记录

### 完成标准

- assistant-ui 分享入口必须能停止正在运行的 follow-up，不只是在普通朋友页支持停止。
- 点击停止必须调用朋友侧 cancel API，并通过 outbound Host command 触发 active adapter `stop(..., friend_cancelled)` 与 `AbortSignal`。
- 取消后的 AG-UI 事件恢复必须在对话流中展示友好“任务已取消。”消息。
- Relay 取消当前 Session 时只能取消 waiting/running task，不能把历史 completed/failed task 改写成 cancelled；否则同一 Session 历史消息会出现错误取消态。
- 页面最终必须保持 `cancelled`，停止按钮禁用，发送按钮恢复可用，不展示取消后的 completed 输出，也不泄露成本、预算、tokenHash、deviceKey、bootstrap。

### TDD 记录

- RED：新增 `assistant-ui share entry can stop a running follow-up through the host runtime` 后，目标命令失败；第一次失败暴露取消后发送按钮还未恢复时测试过早读取，补充等待后继续验证真实终态。
- RED 第二阶段：同一命令失败为 `messageCount` 从期望 4 变为 3，原因是 AG-UI cancel events 重建 message list 时丢掉了本地“任务已取消。”提示。
- GREEN 第一阶段：把 `ralphloop.run.cancelled` / `RUN_FINISHED(status=cancelled)` 转成 assistant 取消消息后，同一命令失败为 `messageCount` 变成 5；进一步定位为 Relay 把同 Session 历史 completed task 也改成 cancelled。
- GREEN 第二阶段：修复 `cancelTasksForSession()`，只取消非终态任务，并补 `cancelTasksForSession preserves terminal task history` 单元测试；目标命令通过。

### 覆盖用例

- `assistant-ui share entry can stop a running follow-up through the host runtime`
- `cancelTasksForSession preserves terminal task history`

### 本轮验证结果

- `node scripts/test.mjs apps/share-gateway/test/productization/relayStore.test.ts apps/share-web/e2e/assistant-ui-share-entry-browser.test.ts --test-name-pattern "cancelTasksForSession|assistant-ui share entry can stop a running follow-up through the host runtime"`：6 pass / 0 fail。
- `node scripts/test.mjs apps/share-web/test/assistant-ui-react-shell.test.ts apps/share-gateway/test/productization/httpServer.test.ts apps/share-gateway/test/productization/relayStore.test.ts apps/share-web/e2e/assistant-ui-share-entry-browser.test.ts`：40 pass / 0 fail。
- `npm run lint`：exit 0。
- `npm run typecheck`：exit 0。
- `npm run build`：exit 0。
- `npm run test:contract`：28 pass / 0 fail。
- `npm run test:integration`：83 pass / 0 fail。
- `npm run test:e2e`：10 pass / 0 fail。
- `npm run test:security`：50 pass / 0 fail。
- `npm run test:smoke:real-adapter`：24 pass / 0 fail。
- `npm test`：188 pass / 0 fail。

## 2026-05-25 本轮 assistant-ui 入口多 Session 验证记录

### 完成标准

- assistant-ui 分享入口的 New Thread 必须创建真实 Ralphloop 后端 Session，而不是只更新前端文案或视觉状态。
- 新 Session 的 `threadId` 必须等于后端 `sessionId`，并作为后续 `/tasks`、`/events`、Host command 的绑定来源。
- 新 Session 中发送消息必须走 outbound Host 链路并显示 Host 输出。
- 切回旧 Session 必须恢复旧用户消息和旧 Agent 输出，且不展示新 Session 的消息。
- DOM 仍不得泄露成本、预算、tokenHash、deviceKey、bootstrap 或模型价格字段。

### TDD 记录

- RED：新增 `assistant-ui share entry can create and switch real friend sessions` 后，目标命令失败在等待 `data-thread-count === "2"` 超时，证明 New Thread 只是静态按钮，没有创建真实 Session。
- GREEN：在 assistant-ui 分享入口渐进增强脚本中加入最小 thread store：初始化当前 Session，New Thread 调用 `/sessions` 创建后端 Session，切换前保存当前 message list/status/taskId，切换后恢复目标 Session 快照；目标命令通过。

### 覆盖用例

- `assistant-ui share entry can create and switch real friend sessions`

### 本轮验证结果

- `node scripts/test.mjs apps/share-web/e2e/assistant-ui-share-entry-browser.test.ts --test-name-pattern "assistant-ui share entry can create and switch real friend sessions"`：4 pass / 0 fail。
- `node scripts/test.mjs apps/share-web/test/assistant-ui-react-shell.test.ts apps/share-gateway/test/productization/httpServer.test.ts apps/share-gateway/test/productization/relayStore.test.ts apps/share-web/e2e/assistant-ui-share-entry-browser.test.ts`：41 pass / 0 fail。
- `npm run lint`：exit 0。
- `npm run typecheck`：exit 0。
- `npm run build`：exit 0。
- `npm run test:contract`：28 pass / 0 fail。
- `npm run test:integration`：83 pass / 0 fail。
- `npm run test:e2e`：11 pass / 0 fail。
- `npm run test:security`：50 pass / 0 fail。
- `npm run test:smoke:real-adapter`：24 pass / 0 fail。
- `npm test`：189 pass / 0 fail。

## 2026-05-25 本轮 assistant-ui 入口刷新恢复验证记录

### 完成标准

- assistant-ui 分享入口的多 Session rail 不能只存在于单次页面生命周期；同一浏览器刷新当前 Session URL 后必须恢复本地已知的真实后端 Session 列表。
- 持久化内容只能保存公开 thread 摘要：`sessionId`、标题、状态、active task 和 message count；不能把 host auth、device key、bootstrap secret、成本、预算或创建者内部策略写入朋友侧状态。
- 刷新后当前 Session 必须继续展示自己的用户消息和 Host 输出，状态为 completed。
- 刷新后切回旧 Session 时，页面必须通过 `GET /v1/share/:token/events?sessionId=...&format=ag-ui` 恢复旧用户消息和旧 Agent 输出，不能混入新 Session 的消息。
- 验收必须包含真实浏览器刷新流程、无 console error / runtime exception，以及 DOM 泄露检查。

### TDD 记录

- RED：新增 `assistant-ui share entry restores local thread list after reload` 后，目标命令失败在刷新后等待 `data-thread-count === "2"` 超时，证明当前页面只从 URL/SSR 恢复当前 Session，没有恢复本地 thread list。
- GREEN：在 assistant-ui 分享入口渐进增强脚本中加入 per-share-token 本地 thread index；每次保存/切换/提交/轮询后持久化 thread 摘要，初始化时恢复已知 Session，并为非当前 Session 读取 `format=ag-ui` events 重建消息；目标命令通过。

### 覆盖用例

- `assistant-ui share entry restores local thread list after reload`

### 本轮验证结果

- `node scripts/test.mjs apps/share-web/e2e/assistant-ui-share-entry-browser.test.ts --test-name-pattern "assistant-ui share entry restores local thread list after reload"`：5 pass / 0 fail。
- `node scripts/test.mjs apps/share-web/test/assistant-ui-react-shell.test.ts apps/share-gateway/test/productization/httpServer.test.ts apps/share-gateway/test/productization/relayStore.test.ts apps/share-web/e2e/assistant-ui-share-entry-browser.test.ts`：42 pass / 0 fail。
- `npm run lint`：exit 0。
- `npm run typecheck`：exit 0。
- `npm run build`：exit 0。
- `npm run test:contract`：28 pass / 0 fail。
- `npm run test:integration`：83 pass / 0 fail。
- `npm run test:e2e`：12 pass / 0 fail。
- `npm run test:security`：50 pass / 0 fail。
- `npm run test:smoke:real-adapter`：24 pass / 0 fail。
- `npm test`：190 pass / 0 fail。
- `git diff --check`：exit 0。

## 2026-05-25 本轮 assistant-ui 入口任务提交异常验证记录

### 完成标准

- assistant-ui 分享入口在朋友发送 follow-up 后，如果 `/tasks` 请求发生网络异常，必须保留朋友刚输入的用户消息。
- 页面必须追加友好失败消息“任务提交失败，请稍后重试。”，把当前 thread 状态置为 failed，并恢复发送按钮。
- 页面文本和 DOM 不能泄露 `TypeError`、网络内部错误、异常栈、成本、预算、tokenHash、deviceKey、bootstrap 或 host auth。
- 浏览器控制台不能出现 application console error 或 runtime exception；失败必须作为产品状态展示。

### TDD 记录

- RED：新增 `assistant-ui share entry preserves the user message on task request failure` 后，目标命令失败在等待 `data-assistant-ui-thread-status === "failed"` 超时，证明网络异常会让 assistant-ui 入口停在 running 或未处理 promise 状态。
- GREEN：为 assistant-ui 提交流程捕获 fetch 抛错，并把 HTTP 非 2xx 与网络异常统一收敛为 failed 状态和友好失败消息；目标命令通过。

### 覆盖用例

- `assistant-ui share entry preserves the user message on task request failure`

### 本轮验证结果

- `node scripts/test.mjs apps/share-web/e2e/assistant-ui-share-entry-browser.test.ts --test-name-pattern "assistant-ui share entry preserves the user message on task request failure"`：6 pass / 0 fail。
- `node scripts/test.mjs apps/share-web/test/assistant-ui-react-shell.test.ts apps/share-gateway/test/productization/httpServer.test.ts apps/share-gateway/test/productization/relayStore.test.ts apps/share-web/e2e/assistant-ui-share-entry-browser.test.ts`：43 pass / 0 fail。
- `npm run lint`：exit 0。
- `npm run typecheck`：exit 0。
- `npm run build`：exit 0。
- `npm run test:contract`：28 pass / 0 fail。
- `npm run test:integration`：83 pass / 0 fail。
- `npm run test:e2e`：13 pass / 0 fail。
- `npm run test:security`：50 pass / 0 fail。
- `npm run test:smoke:real-adapter`：24 pass / 0 fail。
- `npm test`：191 pass / 0 fail。
- `git diff --check`：exit 0。

## 2026-05-25 本轮 assistant-ui 入口 Escape 取消验证记录

### 完成标准

- assistant-ui 分享入口运行中时，朋友按 Escape 必须触发与“停止”按钮相同的取消路径。
- Escape 取消必须调用朋友侧 session cancel API，页面进入 cancelled，消息流追加“任务已取消。”。
- 取消后停止按钮禁用，发送按钮恢复可用，历史 completed 消息和当前用户消息保留。
- 页面不得出现 console error / runtime exception，也不得泄露成本、预算、tokenHash、deviceKey、bootstrap 或模型价格字段。

### TDD 记录

- RED：新增 `assistant-ui share entry can cancel a running follow-up with Escape` 后，目标命令失败在等待 `data-assistant-ui-thread-status === "cancelled"` 超时，证明 running 状态按 Escape 没有触发取消。
- GREEN：抽出 `cancelCurrentThread()`，让停止按钮和 `document` Escape keydown 复用同一取消路径；目标命令通过。

### 覆盖用例

- `assistant-ui share entry can cancel a running follow-up with Escape`

### 本轮验证结果

- `node scripts/test.mjs apps/share-web/e2e/assistant-ui-share-entry-browser.test.ts --test-name-pattern "assistant-ui share entry can cancel a running follow-up with Escape"`：7 pass / 0 fail。
- `node scripts/test.mjs apps/share-web/test/assistant-ui-react-shell.test.ts apps/share-gateway/test/productization/httpServer.test.ts apps/share-gateway/test/productization/relayStore.test.ts apps/share-web/e2e/assistant-ui-share-entry-browser.test.ts`：44 pass / 0 fail。
- `npm run lint`：exit 0。
- `npm run typecheck`：exit 0。
- `npm run build`：exit 0。
- `npm run test:contract`：28 pass / 0 fail。
- `npm run test:integration`：83 pass / 0 fail。
- `npm run test:e2e`：14 pass / 0 fail。
- `npm run test:security`：50 pass / 0 fail。
- `npm run test:smoke:real-adapter`：24 pass / 0 fail。
- `npm test`：192 pass / 0 fail。
- `git diff --check`：exit 0。

## 2026-05-25 本轮 assistant-ui 入口运行中加载态验证记录

### 完成标准

- assistant-ui 分享入口发送 follow-up 后，在 Host 尚未回写真实输出前，主消息流必须出现可见的 Agent 处理中消息。
- 运行中必须保持停止按钮可用、发送按钮禁用，避免朋友误以为没有响应或重复发送。
- 真实 Host 输出回来后，处理中消息必须被真实 Agent 输出替换；取消或失败时必须被对应终态消息替换，不能残留。
- 页面不得出现 console error / runtime exception，也不得泄露成本、预算、tokenHash、deviceKey、bootstrap 或模型价格字段。

### TDD 记录

- RED：新增 `assistant-ui share entry shows an Agent loading message while a follow-up is running` 后，目标命令失败在 `messageCount` 为 `3` 而不是 `4`，证明运行中只显示了历史两条消息和当前用户消息，没有 Agent loading turn。
- GREEN：在 assistant-ui 分享入口中，任务被 `/tasks` 接受并拿到真实 `taskId` 后追加 `.assistant-ui-message-loading` Agent 消息“Agent 正在处理...”；真实 AG-UI 事件回来后沿用原有替换逻辑移除 loading，占位消息在失败和取消路径中也会被清理。
- 二次校准：初版 GREEN 断言使用 `document.body.textContent`，会误读内联脚本源码中的 loading 文案；已把断言收窄到 `.assistant-ui-message` 列表，避免把不可见脚本内容当成用户可见内容。

### 覆盖用例

- `assistant-ui share entry shows an Agent loading message while a follow-up is running`

### 本轮验证结果

- `node scripts/test.mjs apps/share-web/e2e/assistant-ui-share-entry-browser.test.ts --test-name-pattern "assistant-ui share entry shows an Agent loading message while a follow-up is running"`：RED 时 7 pass / 1 fail；GREEN 后 8 pass / 0 fail。
- `node scripts/test.mjs apps/share-web/test/assistant-ui-react-shell.test.ts apps/share-gateway/test/productization/httpServer.test.ts apps/share-gateway/test/productization/relayStore.test.ts apps/share-web/e2e/assistant-ui-share-entry-browser.test.ts`：45 pass / 0 fail。
- `npm run lint`：exit 0。
- `npm run typecheck`：exit 0。
- `npm run build`：exit 0。
- `npm run test:contract`：28 pass / 0 fail。
- `npm run test:integration`：83 pass / 0 fail。
- `npm run test:e2e`：15 pass / 0 fail。
- `npm run test:security`：50 pass / 0 fail。
- `npm run test:smoke:real-adapter`：24 pass / 0 fail。
- `npm test`：193 pass / 0 fail。
- `git diff --check`：exit 0。

## 2026-05-25 本轮 assistant-ui 入口旧任务失效恢复验证记录

### 完成标准

- 当朋友页面处于 running follow-up，但事件接口返回 `events_unavailable` 时，页面不能无限保持 running。
- 页面必须保留朋友刚输入的消息，清理 Agent loading，占位为友好失败消息“当前会话已失效，请新建会话后重试。”。
- 发送按钮必须恢复可用，停止按钮必须禁用。
- 可见消息不得泄露 `events_unavailable`、HTTP 状态码、`not_found`、成本、预算、tokenHash、deviceKey、bootstrap 或模型价格字段。

### TDD 记录

- RED：新增 `assistant-ui share entry recovers when running follow-up events become unavailable` 后，目标命令超时等待 `data-assistant-ui-thread-status === "failed"`，证明页面会停留在 running。
- GREEN：在 `refreshEvents()` 中识别 `events_unavailable`，调用统一的 `failCurrentThread()` 清理 loading、恢复 task 绑定、追加友好失败消息并将 thread 置为 failed。
- 二次校准：断言从 `document.body.textContent` 收窄到 `.assistant-ui-message`，避免把测试注入的 fetch mock 脚本内容误判成用户可见泄露。
- 补充 RED：新增 `assistant-ui share entry explains stale session URLs after reload` 后，直接打开旧 `sessionId/taskId` URL 超时等待 failed，证明刷新旧 URL 时页面只会停在 idle/空消息。
- 补充 GREEN：在 `loadThreadEvents()` 中复用 `events_unavailable` 处理，把旧 URL 初始化恢复也收敛为 failed，并清理 URL 中的 stale `taskId`。

### 覆盖用例

- `assistant-ui share entry recovers when running follow-up events become unavailable`
- `assistant-ui share entry explains stale session URLs after reload`

### 本轮验证结果

- `node scripts/test.mjs apps/share-web/e2e/assistant-ui-share-entry-browser.test.ts --test-name-pattern "assistant-ui share entry recovers when running follow-up events become unavailable"`：RED 时 8 pass / 1 fail；GREEN 后 9 pass / 0 fail。
- `node scripts/test.mjs apps/share-web/e2e/assistant-ui-share-entry-browser.test.ts --test-name-pattern "assistant-ui share entry explains stale session URLs after reload"`：RED 时 9 pass / 1 fail；GREEN 后 10 pass / 0 fail。
- `node scripts/test.mjs apps/share-web/test/assistant-ui-react-shell.test.ts apps/share-gateway/test/productization/httpServer.test.ts apps/share-gateway/test/productization/relayStore.test.ts apps/share-web/e2e/assistant-ui-share-entry-browser.test.ts`：47 pass / 0 fail。
- `npm run lint`：exit 0。
- `npm run typecheck`：exit 0。
- `npm run build`：exit 0。
- `npm run test:e2e`：17 pass / 0 fail。
- `npm test`：195 pass / 0 fail。
- `npm run test:contract`：28 pass / 0 fail。
- `npm run test:integration`：83 pass / 0 fail。
- `npm run test:security`：50 pass / 0 fail。
- `npm run test:smoke:real-adapter`：24 pass / 0 fail。
- `git diff --check`：exit 0。

## 2026-05-25 本轮真实本地 Agent 输出链路验证记录

### 完成标准

- 真实 `RALPHLOOP_ADAPTER_MODE=real` 体验不能再依赖 demo adapter 固定文案。
- OpenCode adapter 必须保存 `opencode run --format json` stdout，并映射为朋友页可见的 Agent 输出。
- OpenCode adapter 必须给真实 CLI 运行设置超时，并继续把取消信号传给命令 runner，避免朋友页无限 pending。
- 创建者默认分享链接和本地 dev friend URL 必须指向 `/app/share/:token/assistant-ui`。
- Owner 历史链接列表不能伪造 raw token URL，不能出现 `undefined/assistant-ui`。
- 真实本机 Codex 链路必须能把本地 Agent 输出展示到 assistant-ui Agent bubble，并且页面不泄露成本、预算、tokenHash、deviceKey、bootstrap 或 host auth。

### TDD / 调试记录

- RED 1：临时还原 Owner 列表旧逻辑后，`productized owner page script manages existing share links from the list` 失败，并暴露 `http://127.0.0.1:.../app/share/undefined/assistant-ui`，证明新增用例能抓住坏链接。
- GREEN 1：Owner 页面只使用后端返回的 `shareLink.url` 或当前页面会话内保存的新建链接 URL；历史链接显示“链接仅创建时显示”，不再拼不存在的 token。
- RED 2：新增 OpenCode adapter 测试后，`submitTask uses opencode run attached to the runtime endpoint`、`streamEvents maps OpenCode JSON output into runtime events`、`streamEvents maps failed OpenCode execution into task.failed` 三条失败，证明旧实现缺少超时、丢弃 stdout、失败文案不友好。
- GREEN 2：OpenCode adapter 保存 command result，JSON stdout 映射为 `task.output`，失败 stderr/JSON error 映射为 `task.failed`，`opencode run` 传入 120 秒超时和 `AbortSignal`。
- 真实 dogfood：重启 `RALPHLOOP_ADAPTER_MODE=real PORT=5207 npm run dev:productized:outbound`，创建仅允许 `codex` 的 `local-friend-2` 分享链接，提交“只输出字符串 RALPHLOOP_QA_REAL_OK，不要解释。”，AG-UI events 返回 `TEXT_MESSAGE_CONTENT`，assistant-ui SSR 页面渲染用户消息和 Agent 输出。

### 覆盖用例

- `productized owner page script manages existing share links from the list`
- `submitTask uses opencode run attached to the runtime endpoint`
- `streamEvents maps OpenCode JSON output into runtime events`
- `streamEvents maps failed OpenCode execution into task.failed`
- 真实 HTTP dogfood：`POST /v1/owner/share-links`、`POST /v1/share/local-friend-2/tasks`、`GET /v1/share/local-friend-2/events?format=ag-ui`、`GET /app/share/local-friend-2/assistant-ui?...`
- 真实浏览器截图 dogfood：`ralphloop-real-codex-assistant-ui-5207.png`

### 本轮验证结果

- `node scripts/test.mjs apps/share-gateway/test/productization/httpServer.test.ts`：RED 时 32 pass / 1 fail。
- `node scripts/test.mjs apps/share-gateway/test/productization/httpServer.test.ts apps/share-gateway/test/productization/routes.test.ts apps/share-gateway/test/productization/devOutbound.test.ts`：48 pass / 0 fail。
- `node scripts/test.mjs apps/share-gateway/test/adapters/opencode.test.ts`：RED 时 5 pass / 3 fail；GREEN 后 8 pass / 0 fail。
- `curl -fsS http://127.0.0.1:5207/app/share/local-friend-2/assistant-ui?sessionId=5daadb12-d05f-4644-a702-c3589197af3b\\&taskId=b26c8800-659a-4fda-a5a4-bc1baf943864 | rg 'RALPHLOOP_QA_REAL_OK|assistant-ui-runtime-shell'`：命中真实 Agent 输出和 assistant-ui shell。
- 浏览器 CDP dogfood：截图保存到 `.gstack/qa-reports/browser-screenshots/ralphloop-real-codex-assistant-ui-5207.png`，`scrollWidth=1440/clientWidth=1440`，无 console error / runtime exception。
- `npm run typecheck`：exit 0。
- `npm run lint`：exit 0。
- `npm run build`：exit 0。
- `npm run test:e2e`：17 pass / 0 fail。
- `npm run test:smoke:real-adapter`：26 pass / 0 fail。
- `npm test`：198 pass / 0 fail。
- `git diff --check`：exit 0。

## 当前覆盖缺口

1. 朋友页已有固定响应式浏览器布局、行为场景和截图归档；仍缺像素级 golden diff。
2. 已有 AG-UI 事件格式 contract、HTTP `format=ag-ui` 输出、朋友页 server-rendered 客户端消费、share-web ExternalStore 转换层、transport client、多 Session runtime store、真实 `@assistant-ui/react` runtime binding、React SSR shell、可通过浏览器打开的 assistant-ui share 入口、assistant-ui 入口桌面/移动布局 e2e、assistant-ui 入口 follow-up 到 outbound Host 的真实浏览器 e2e、assistant-ui 入口运行中 loading e2e、assistant-ui 入口旧任务失效恢复 e2e、assistant-ui 入口停止运行到 Host abort 的真实浏览器 e2e、assistant-ui 入口新建/切换真实 Session 的浏览器 e2e、assistant-ui 入口刷新恢复 Session 列表的浏览器 e2e、assistant-ui 入口任务提交异常友好展示的浏览器 e2e、assistant-ui 入口 Escape 取消的浏览器 e2e，以及真实本机 Codex 输出到 Agent bubble 的 dogfood；仍缺完整 React hydration 后的截图级视觉 diff。
3. 缺少跨浏览器测试：目前 dogfood 使用 Chrome。
4. 缺少长时间运行稳定性测试：心跳已覆盖，但没有 30 分钟以上的浏览器 session soak。
5. 缺少真实远程朋友环境测试：当前是本机 localhost 链路。
6. 朋友侧多轮 UI 已有脚本级自动化、固定 running cancel e2e、固定响应式布局/截图断言、快速连发/并行 Session/异常态真实浏览器截图归档；仍缺更长时间多轮 soak 和真实远程朋友环境验证。
7. 创建者侧已有链接管理已有脚本级自动化和固定浏览器布局/交互/非空截图断言；仍缺截图归档、像素级 diff 和真实远程 Host 环境下的 owner 页面验证。
8. Host client 已能中断 running task，朋友页真实点击停止也已有固定浏览器 e2e，并覆盖真实长运行子进程 `SIGTERM` 退出和后到提交响应竞态；仍缺真实供应商 CLI（Codex / Claude Code / OpenCode）长运行命令的 UI 停止端到端验证。OpenCode 已补 stdout 映射和命令超时，但真实 OpenCode 供应商链路仍需要在稳定凭据/模型环境下单独 dogfood。

## 对齐建议

下一轮验收可以先对齐三类用例是否足够：

1. MVP 必过：TC-1、TC-2、TC-3、TC-4、TC-7。
2. 产品体验必过：TC-2.2、TC-2.3、TC-3.1、TC-3.2、TC-4.2、TC-4.3、TC-B1、TC-B2、TC-B3。
3. 安全上线必过：TC-5.2、TC-6、TC-7 全部。

如果我们准备进入真正产品化前端阶段，应优先补齐真实浏览器自动化、响应式截图、AG-UI 事件契约、远程朋友环境测试，以及两个以上分享链接的管理体验。

## 2026-05-25 本轮旧朋友入口兼容桥验证记录

### 完成标准

- 误入旧 `/app/share/:token` 的朋友不能被困在旧体验里；首屏必须提供明确的新版 assistant-ui 入口。
- 新版入口必须指向 `/app/share/:token/assistant-ui`，点击后渲染 assistant-ui shell。
- 旧入口仍保留现有回归价值，停止、多 Session、异常态等旧页测试不应被破坏。
- 页面不得泄露成本、预算、tokenHash、deviceKey、bootstrap 或 host auth。

### TDD 记录

- RED：在 `productized web pages expose owner and friend flows without friend cost fields` 中新增 `friend-assistant-ui-link` 和 `/app/share/local-friend/assistant-ui` 断言后，测试失败，证明旧页面没有新版入口。
- GREEN：在旧 friend page header 的 status cluster 增加“新版对话”链接，并把 `.secondary-button` 扩展为可用于 `<a>` 的按钮样式。
- 浏览器补充：新增 `legacy friend browser page links into assistant-ui chat`，真实 Chrome 打开旧链接、点击新版入口、等待 URL 进入 `/assistant-ui` 并断言 assistant-ui shell。

### 本轮验证结果

- `node scripts/test.mjs apps/share-gateway/test/productization/httpServer.test.ts --test-name-pattern "productized web pages expose owner and friend flows without friend cost fields"`：RED 时 32 pass / 1 fail；GREEN 后 33 pass / 0 fail。
- `node scripts/test.mjs apps/share-web/e2e/friend-session-browser.test.ts --test-name-pattern "legacy friend browser page links into assistant-ui chat"`：4 pass / 0 fail。
- `node scripts/test.mjs apps/share-gateway/test/productization/httpServer.test.ts apps/share-web/e2e/friend-session-browser.test.ts`：37 pass / 0 fail。
- `npm run typecheck`：exit 0。
- `npm run lint`：exit 0。
- `npm run build`：exit 0。
- `npm run test:e2e`：18 pass / 0 fail。
- `npm test`：199 pass / 0 fail。

## 2026-05-25 本轮裸分享 URL 默认重定向验证记录

### 完成标准

- 朋友打开裸 `/app/share/:token` 时必须直接进入 `/app/share/:token/assistant-ui`，不能再看到旧 friend page。
- 显式 `/app/share/:token/classic` 必须继续渲染旧 friend page，保留停止、多 Session、异常态等回归对象。
- classic 页面首屏仍必须提供 `friend-assistant-ui-link`，可回到 `/assistant-ui`。
- assistant-ui 页面返回入口必须指向 `/classic`，不能把用户带回裸 URL 后再次重定向。
- 默认入口和 classic 入口都不得泄露成本、预算、tokenHash、deviceKey、bootstrap 或 host auth。

### TDD 记录

- RED：在 `productized web pages expose owner and friend flows without friend cost fields` 中新增裸 `/app/share/local-friend` 的 302 断言后，目标命令失败为 `200 !== 302`，证明旧实现仍渲染 classic 页面。
- GREEN：新增显式 `/app/share/:token/classic` route，把裸 `/app/share/:token` 改为 302 到 `/app/share/:token/assistant-ui`，并把旧页相关脚本级测试迁到 `/classic`。
- 浏览器补充：新增 `default friend browser link opens assistant-ui chat`，真实 Chrome 打开裸 URL、等待 pathname 进入 `/assistant-ui`，并断言 assistant-ui shell 渲染且不泄露内部字段。

### 覆盖用例

- `productized web pages expose owner and friend flows without friend cost fields`
- `default friend browser link opens assistant-ui chat`
- `legacy friend browser page links into assistant-ui chat`
- classic 旧页停止、响应式、快速连发、并行 Session、异常态浏览器回归继续执行在 `/app/share/:token/classic`。

### 本轮验证结果

- `node scripts/test.mjs apps/share-gateway/test/productization/httpServer.test.ts --test-name-pattern "productized web pages expose owner and friend flows without friend cost fields"`：RED 时 32 pass / 1 fail；GREEN 后 33 pass / 0 fail。
- `node scripts/test.mjs apps/share-web/e2e/friend-session-browser.test.ts --test-name-pattern "default friend browser link opens assistant-ui chat|legacy friend browser page links into assistant-ui chat"`：5 pass / 0 fail。
- `node scripts/test.mjs apps/share-gateway/test/productization/httpServer.test.ts apps/share-web/e2e/friend-session-browser.test.ts apps/share-web/e2e/friend-running-cancel-browser.test.ts`：40 pass / 0 fail。
- `npm run typecheck`：exit 0。
- `npm run lint`：exit 0。
- `npm run build`：exit 0。
- `npm run test:contract`：28 pass / 0 fail。
- `npm run test:security`：50 pass / 0 fail。
- `npm run test:e2e`：19 pass / 0 fail。
- `npm run test:integration`：83 pass / 0 fail。
- `npm run test:smoke:real-adapter`：26 pass / 0 fail。
- `npm test`：200 pass / 0 fail。
- `git diff --check`：exit 0。
- 本地体验服务 smoke：重启 `RALPHLOOP_ADAPTER_MODE=real PORT=5199 npm run dev:productized:outbound`，创建 `local-friend-2`，`GET /app/share/local-friend-2` 返回 `302 Location: /app/share/local-friend-2/assistant-ui`；`GET /app/share/local-friend-2/assistant-ui` 命中 `Ralphloop Codex QA`、`assistant-ui-runtime-shell` 和 composer；`GET /app/share/local-friend-2/classic` 命中 `friend-chat-shell`、`friend-assistant-ui-link` 和 `/app/share/local-friend-2/assistant-ui`。

## 2026-05-25 本轮默认入口首条消息真实 Session 验证记录

### 完成标准

- 朋友从裸 `/app/share/:token` 进入新版 `/assistant-ui` 后，即使 URL 不带 `sessionId/taskId`，也可以直接发送第一条消息。
- 第一条消息必须先创建真实后端 Session，再提交到 Host runtime，并展示 Host 返回的 Agent 输出。
- 首条消息成功后，URL 必须写入真实 `sessionId/taskId`。
- 左侧 rail 只能有一个真实 thread，不能保留 `assistant-ui-preview` 占位 thread。
- 本地 `localStorage` thread index 不得持久化 `assistant-ui-preview`。
- 页面不得泄露成本、预算、tokenHash、deviceKey、bootstrap 或 host auth。

### TDD 记录

- RED：新增 `assistant-ui default share link can send the first message without keeping a preview thread` 后，目标浏览器 e2e 失败在 `data-thread-count`，实际 `2`、期望 `1`，证明默认入口首条消息后保留了 preview 占位 thread。
- GREEN：在 assistant-ui 客户端 runtime 中加入 `isPreviewThread()` 和 `discardPreviewThread()`；`ensureThread()` 和 `createNewThread()` 从 `assistant-ui-preview` 创建真实 Session 时都会删除占位 thread，随后重新渲染 thread list 并持久化真实 Session。

### 覆盖用例

- `assistant-ui default share link can send the first message without keeping a preview thread`

### 本轮验证结果

- `node scripts/test.mjs apps/share-web/e2e/assistant-ui-share-entry-browser.test.ts --test-name-pattern "assistant-ui default share link can send the first message without keeping a preview thread"`：RED 时 10 pass / 1 fail；GREEN 后 11 pass / 0 fail。
- `node scripts/test.mjs apps/share-web/e2e/assistant-ui-share-entry-browser.test.ts`：11 pass / 0 fail。
- `node scripts/test.mjs apps/share-web/test/assistant-ui-client-script.test.ts apps/share-web/test/assistant-ui-react-shell.test.ts`：2 pass / 0 fail。
- `npm run typecheck`：exit 0。
- `npm run lint`：exit 0。
- `npm run build`：exit 0。
- `npm run test:e2e`：20 pass / 0 fail。
- `npm run test:integration`：83 pass / 0 fail。
- `npm test`：201 pass / 0 fail。
- `git diff --check`：exit 0。
- 本地体验服务 smoke：重启 `RALPHLOOP_ADAPTER_MODE=real PORT=5199 npm run dev:productized:outbound`，创建 `local-friend-2`，`GET /app/share/local-friend-2` 返回 `302 Location: /app/share/local-friend-2/assistant-ui`；`GET /app/share/local-friend-2/assistant-ui` 命中 `Ralphloop Codex QA`、`data-ralphloop-assistant-ui-shell`、composer 和最新客户端脚本中的 `discardPreviewThread()`。
