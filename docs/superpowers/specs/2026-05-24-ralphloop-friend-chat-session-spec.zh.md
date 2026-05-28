# Ralphloop 朋友侧多 Session Chatbot Spec

日期：2026-05-24

## 1. 状态

本文档替代 `docs/superpowers/specs/2026-05-22-ralphloop-friend-agent-console-spec.zh.md` 中的“Agent 控制台”方向。

产品判断更新为：

- 朋友打开分享链接后，应该进入类似 OpenCloud、ChatGPT、PinchChat 的对话产品。
- 页面主体验是 Session 对话流，不是任务表单、运行记录和预览面板拼在一起的控制台。
- 桌面预览是辅助能力，默认从右侧 drawer 拉出，不常驻压缩对话空间。
- 确认请求应该进入对话流，作为 action card，而不是页面底部的独立队列。

## 2. GitHub 参考

本阶段不直接 fork 完整项目，但采用以下信息架构参考：

- `assistant-ui`：参考 `Thread`、`Message`、`Composer`、`ActionBar`、tool call 和 HITL 组件边界。长期适合作为 Ralphloop React 前端基座。https://github.com/assistant-ui/assistant-ui
- Vercel `ai-chatbot`：参考 ChatGPT 式会话布局、底部输入框、message list 和 session history。它绑定 Next/Auth/DB，短期只参考结构。https://github.com/vercel/ai-chatbot
- `CopilotKit`：参考 agent-native chat、tool call、generative UI、human-in-the-loop 的呈现方式。https://github.com/CopilotKit/CopilotKit
- `LobeChat`、`Open WebUI`、`Chatbot UI`：参考成熟聊天产品的信息层级和状态处理，不直接引入，因为平台边界过重。
- `clawui` / `PinchChat`：参考 session-based agent chat、工具调用可见性和侧边栏会话列表。https://clawui.app/

## 3. 产品目标

朋友侧 V1 的目标是：

1. 朋友打开链接后看到一个可直接使用的 Chatbot。
2. 朋友可以在同一个分享链接下拥有多个 Session。
3. 每个 Session 都有独立对话历史、任务状态、预览上下文和确认请求。
4. 朋友可以新建 Session、切换 Session，并继续当前 Session 多轮对话。
5. 桌面预览不抢占主对话空间，只在朋友需要观察 Agent 行为时从右侧拉出。
6. 高风险动作确认以内联消息卡呈现。
7. 朋友侧始终隐藏成本、预算、token hash、设备密钥、bootstrap secret 和创建者内部策略字段。
8. 朋友可以在运行中停止当前 Session，停止动作必须进入 Relay/Host runtime，而不是只改前端文案。

## 4. 非目标

本阶段不做：

- 完整 React 迁移。
- 直接安装或重写为 assistant-ui。
- 朋友账号系统、跨设备云端会话同步。
- 文件上传、语音输入、团队协作、多用户共享会话。
- 公开 Agent marketplace。
- 让朋友直接远控创建者真实桌面。

## 5. 体验设计

### 5.1 桌面布局

桌面首屏由三层组成：

1. 左侧 Session sidebar。
   - 显示当前分享链接下的本地 Session 列表。
   - 顶部有“新会话”按钮。
   - 每个 Session 显示标题、最近状态、最近更新时间。
   - 当前 Session 高亮。
2. 中间 Chat thread。
   - 顶部显示 Agent 名称、Host 状态、当前 Session 状态、预览按钮。
   - 中间显示消息流。
   - 底部固定 composer。
3. 右侧 Preview drawer。
   - 默认收起。
   - 点击“预览”后从右侧拉出。
   - drawer 内显示只读桌面/浏览器预览、当前任务状态和最近帧。
   - drawer 可以关闭，不影响对话继续。

### 5.2 移动端布局

- Session sidebar 折叠为顶部或底部 session menu。
- Chat thread 占满主屏。
- Composer 固定在底部。
- Preview drawer 变成全屏 sheet。
- 不出现横向滚动。
- 真实浏览器验收必须覆盖移动端关闭/打开 preview sheet 两种状态，确认关键 UI 元素不横向溢出、composer 不遮挡消息流。

### 5.3 消息模型

消息流按 assistant-ui / AG-UI 的概念组织：

- `user`：朋友输入的任务。
- `assistant`：Agent 输出。
- `status`：排队、运行中、完成、失败、取消。
- `tool`：工具调用、预览帧、授权请求。
- `approval`：需要朋友确认或等待创建者审批的操作卡。

消息不再用黑色日志框展示。每条消息应该是可读的 chat bubble 或 event card。

### 5.4 Session 语义

第一版采用“浏览器本地身份 + 后端真实 session”的混合方式：

- 页面为每个 share token 在 `localStorage` 中维护一个 session index。
- 每个列表项保存后端 `sessionId`、标题、状态、最近更新时间。
- 新建 Session 时调用 `POST /v1/share/:token/sessions`，得到真实后端 session。
- 切换 Session 时，页面用已有 `sessionId` 读取该 session 的事件。
- 当前已有 `GET /v1/share/:token/events?sessionId=...` 能返回该 session 的全部 runtime events；实现时可用它恢复 Agent 输出。
- 如果本地 session index 为空，页面自动创建第一个 Session。
- 如果 localStorage 被清空，朋友只丢失本地列表入口，不影响安全边界；后续版本再做朋友账号和云端历史。

## 6. 技术设计

### 6.1 当前实现边界

短期仍在 `apps/share-gateway/src/productization/httpServer.ts` 中实现 server-rendered HTML、CSS 和 vanilla JS。

需要替换旧朋友页结构：

- 旧：`agent-console-shell`
- 新：`friend-chat-shell`
- 旧：常驻 `agent-preview-panel`
- 新：`preview-drawer`
- 旧：底部或主区 `confirmation-panel`
- 新：chat thread 中的 `approval-message-card`
- 旧：单个 `currentSessionId`
- 新：`sessionStore` + `activeSessionId` + session sidebar

### 6.2 DOM / 测试边界

新页面必须提供稳定选择器：

- `data-testid="friend-chat-shell"`
- `data-testid="friend-session-sidebar"`
- `data-testid="friend-new-session"`
- `data-testid="friend-session-item"`
- `data-testid="friend-chat-thread"`
- `data-testid="friend-chat-message"`
- `data-testid="friend-chat-composer"`
- `data-testid="friend-chat-submit"`
- `data-testid="friend-chat-stop"`
- `data-testid="friend-preview-toggle"`
- `data-testid="friend-preview-drawer"`
- `data-testid="friend-preview-close"`
- `data-testid="friend-approval-card"`

### 6.3 API 使用

保留现有 endpoint：

- `POST /v1/share/:token/sessions`
- `POST /v1/share/:token/tasks`
- `GET /v1/share/:token/events`
- `GET /v1/share/:token/preview`
- `GET /v1/share/:token/confirmations`
- `POST /v1/share/:token/confirmations/:requestId/:action`
- `POST /v1/share/:token/sessions/:sessionId/cancel`

本阶段优先不新增后端接口。若实现中发现仅靠 localStorage session index 无法可靠恢复 UI，才新增最小 API：

- `GET /v1/share/:token/sessions?sessionIds=a,b,c`

该 API 只能返回请求者已持有的 session id 对应的公开 session 摘要，不能枚举整个 share link 下所有朋友 session。

## 7. 验收标准

### 7.1 功能验收

- AC1：朋友页首屏是 Chatbot，不再是控制台表单布局。
- AC2：页面包含 Session sidebar、新会话按钮、Chat thread、底部 composer、预览 drawer。
- AC3：朋友打开链接时，如果没有本地 Session，自动创建第一个 Session 并展示在 sidebar。
- AC4：朋友可以点击“新会话”创建第二个 Session，两个 Session 都在 sidebar 中可见。
- AC5：朋友在 Session A 提交任务后，切换到 Session B，再切回 Session A，Session A 的消息仍可见。
- AC6：同一 Session 内连续提交两轮任务时，第一轮和第二轮消息都保留在同一 thread。
- AC7：预览 drawer 默认关闭；点击预览按钮后从右侧打开；点击关闭后收起。
- AC8：确认请求以 chat message/action card 出现在当前 Session thread 中，并可批准或拒绝。
- AC9：朋友页不包含 `cost`、`budget`、`tokenHash`、`deviceKey`、`bootstrap`、`模型价格`。
- AC10：移动端无横向滚动，preview drawer 以全屏 sheet 形式打开。
- AC11：同一 Session 中快速连续发送多个消息时，用户消息按发送顺序立即进入 thread，后台按该 Session 的队列提交，不丢消息、不乱序、不展示裸内部错误。
- AC12：任务提交异常时，朋友刚输入的消息必须保留在 thread 中，并显示友好失败消息；页面不能泄露网络异常栈、内部错误码、成本、预算或 token 信息。
- AC13：多个 Session 并行运行时，任务输出、轮询结果、预览和状态更新必须绑定提交时的 `sessionId/taskId`，不能因为朋友切换当前 Session 而写入错误会话。
- AC14：Composer 支持 Enter 发送、Shift+Enter 保留换行草稿；发送成功后输入框清空。
- AC15：运行中 Session 展示可点击的停止按钮；朋友点击停止后，页面显示取消终态，并且 Relay 对 outbound Host 排入 `session.cancel` command。
- AC16：Host 尚未领取 `task.submit` 时如果 Session 已取消，Host poll 必须跳过 stale submit；Host client ack `session.cancel` 时不能启动 adapter。
- AC17：Host 已经领取并正在执行 `task.submit` 时，如果并发收到同一 Session 的 `session.cancel`，Host client 必须中断 adapter 命令并回传 `task.cancelled`，不能继续展示 `task.completed` 或后续输出。
- AC18：朋友侧停止后，即使提交请求或轮询响应晚到，也不能把已取消 Session 恢复为运行中；只能保留取消终态并绑定真实 taskId。
- AC19：朋友页在桌面和移动端真实浏览器 viewport 下不能产生 document 级横向滚动；桌面 sidebar/chat/composer 必须按预期排列，移动端 preview sheet 打开/关闭都不能遮出 viewport。
- AC20：创建者页必须能在真实浏览器中查看和管理已有分享链接；桌面和移动端 viewport 下不能产生 document 级横向滚动，链接编辑表单、框架选择、保存、暂停、启用等控件不能越出 viewport。
- AC21：朋友页真实浏览器回归必须覆盖同一 Session 快速连发、多 Session 并行输出隔离、任务请求异常友好展示，并归档对应截图证据。
- AC22：朋友侧事件 API 必须提供 AG-UI 兼容输出格式；`format=ag-ui` 下同一任务必须映射为 `RUN_STARTED`、`TEXT_MESSAGE_START/CONTENT/END`、`RUN_FINISHED` 或 `RUN_ERROR`，且不暴露 `task.accepted`、成本、预算、tokenHash、deviceKey、bootstrap。
- AC23：朋友页客户端必须优先消费 `format=ag-ui` 事件流；从 `RUN_STARTED.input.messages` 恢复用户输入，从 `TEXT_MESSAGE_*` 合并 Agent 输出，并用 `RUN_FINISHED/RUN_ERROR/CUSTOM` 维持状态、取消和确认类消息，不得退回展示内部 runtime event。
- AC24：`apps/share-web` 必须提供可独立测试的 AG-UI → assistant-ui ExternalStore message conversion 层；输出 message 必须包含稳定 `id`、`role`、text content part、运行状态和 `threadId/runId` metadata，且自定义事件不得携带 token、device key、bootstrap、成本或预算类字段。
- AC25：`apps/share-web` 必须提供可独立测试的 assistant-ui ExternalStore transport client；`onNew` 只能把朋友文本消息提交到 `/tasks`，`onCancel` 只能取消当前 task，`loadEvents` 必须请求 `format=ag-ui`，所有请求不得携带成本、预算、tokenHash、deviceKey、bootstrap、host auth 或创建者内部策略字段。
- AC26：`apps/share-web` 必须提供可独立测试的多 Session runtime store；它必须把 Ralphloop `sessionId` 作为 assistant-ui `threadId`，输出 `threads/archivedThreads/currentThreadId/messages/isRunning`，并保证 `onNew/onCancel` 只作用于当前选中 Session，不得把并行 Session 的输出或取消写入错误 thread。
- AC27：项目必须声明并验证真实 `@assistant-ui/react` 依赖；`apps/share-web` 必须提供一个最小 runtime binding，把 Ralphloop 多 Session store 转成 `useExternalStoreRuntime` 可接收的 options，并验证 `ThreadPrimitive` / `ThreadListPrimitive` 可从真实包导入。
- AC28：`apps/share-web` 必须提供最小可渲染的 assistant-ui React shell；该 shell 必须在 React render 中调用 `useExternalStoreRuntime`，用 `AssistantRuntimeProvider` 包住 `ThreadPrimitive.Root` 和 `ThreadListPrimitive.Root`，并在 SSR smoke 中证明当前 Ralphloop Session 可以渲染为 assistant-ui runtime context。
- AC29：必须提供一个可通过浏览器打开的 assistant-ui 分享入口 `/app/share/:token/assistant-ui`；该入口必须从真实 share token、Session 和 task 的 `format=ag-ui` 事件恢复当前 thread，显示用户输入与 Host 输出，输出 `threadId/messageCount/threadCount` 验证标记，并且不泄露成本、预算、tokenHash、deviceKey、bootstrap 或 host auth。
- AC29a：创建者创建分享链接和本地 `dev:productized:outbound` 输出的默认朋友 URL 必须指向 `/app/share/:token/assistant-ui`；Owner 页面可在当前会话内为刚创建的链接提供“打开对话页”。裸 `/app/share/:token` 必须服务端重定向到 `/app/share/:token/assistant-ui`，不能再把朋友带入旧体验。
- AC30：assistant-ui 分享入口必须具备 Chatbot 化的产品结构：左侧会话 rail、主对话 panel、thread header、状态标记、用户/Agent 消息气泡；桌面和移动视口都不得出现 document 级横向滚动。
- AC31：assistant-ui 分享入口必须支持朋友继续发送同一 Session 的 follow-up 消息；composer 支持 Enter 发送、Shift+Enter 换行，发送中禁用输入和发送按钮，轮询状态必须绑定新提交的 `taskId`，不能被旧任务的 completed 事件提前结束；Host 输出回来后，同一 thread 中必须同时保留原始消息、follow-up 用户消息和 follow-up Agent 输出，并继续隐藏成本、预算、tokenHash、deviceKey、bootstrap 或 host auth。
- AC32：assistant-ui 分享入口必须支持停止正在运行的 follow-up；点击停止后必须调用朋友侧 cancel API，Relay 只取消 waiting/running task、保留历史 completed/failed task，outbound Host 必须收到 `session.cancel` 并中断 active adapter，页面最终保持 cancelled、展示“任务已取消。”，不得展示取消后的 completed 输出。
- AC33：assistant-ui 分享入口必须支持创建和切换真实朋友 Session；点击 New Thread 必须调用 `POST /v1/share/:token/sessions` 创建后端 Session，左侧 rail 展示两个 thread，当前 `threadId` 与后端 `sessionId` 同步；在新 Session 发送消息和接收 Host 输出后，切回旧 Session 时旧消息仍独立可见，新旧 Session 消息不得串线。
- AC34：assistant-ui 分享入口必须在同一浏览器中持久化本地 thread list；朋友刷新当前 Session URL 后，左侧 rail 仍能恢复已创建的后端 Session 列表，并用 `format=ag-ui` events 恢复非当前 Session 的用户消息、Agent 输出和终态，不得只保留当前 URL 中的一个 Session。
- AC35：assistant-ui 分享入口必须在任务提交网络异常或业务失败时保留朋友刚输入的用户消息，追加友好失败消息，把当前 thread 状态置为 failed，恢复发送按钮；页面不得泄露 `TypeError`、网络内部错误、成本、预算、tokenHash、deviceKey、bootstrap 或 host auth。
- AC36：assistant-ui 分享入口必须支持运行态键盘取消；当前 thread 处于 running 时按 Escape 必须触发与停止按钮相同的朋友侧 cancel API，页面展示 cancelled 终态和“任务已取消。”，停止按钮禁用，发送按钮恢复可用，不得展示取消后的 completed 输出。
- AC37：assistant-ui 分享入口在 follow-up 已成功提交、真实 Host/Agent 输出尚未回来时，thread 中必须出现可见的 Agent 处理中消息，并保持停止按钮可用、发送按钮禁用；真实 AG-UI 输出、失败或取消终态回来后，该处理中消息必须被真实 Agent 输出或终态消息替换，不能长期残留。
- AC38：assistant-ui 分享入口在 running follow-up 轮询中遇到 `events_unavailable`、旧 `sessionId/taskId`、服务重启后的内存态丢失或其他不可恢复事件历史时，不能无限停留在 running；必须清理 Agent 处理中消息，展示友好失败消息“当前会话已失效，请新建会话后重试。”，恢复发送按钮并禁用停止按钮，且不能泄露 `events_unavailable`、HTTP 状态码或内部错误字段。
- AC39：真实 OpenCode adapter 必须把 `opencode run --format json` 的 stdout 映射为 `task.output`，让朋友页展示真实本地 Agent 输出；非 0 退出必须映射为友好 `task.failed`；`opencode run` 必须有明确超时，不能让 Host command 和朋友页长期停留在 waiting/running。
- AC40：旧朋友页只能作为显式兼容页 `/app/share/:token/classic` 存在，且首屏必须提供明确的新版 assistant-ui 入口，链接到 `/app/share/:token/assistant-ui`；裸 `/app/share/:token` 必须重定向到新版 assistant-ui，所有入口不得展示成本、预算、tokenHash、deviceKey、bootstrap 或 host auth。
- AC41：朋友从裸分享链接进入 `/assistant-ui` 且 URL 不带 `sessionId` 时，发送第一条消息必须先创建真实后端 Session，再把消息提交到 Host runtime；左侧 rail 只能保留这个真实 Session，不得继续展示 `assistant-ui-preview` 占位 thread，本地持久化也不得写入该占位 id。

### 7.2 测试验收

- T1：`apps/share-gateway/test/productization/httpServer.test.ts` 覆盖新 HTML 合约，确认新 data-testid 存在，旧常驻控制台结构不再作为主布局。
- T2：脚本级 UI harness 覆盖 Session sidebar：自动创建 Session、新建第二个 Session、切换回第一 Session 后消息保留。
- T3：脚本级 UI harness 覆盖同一 Session 多轮对话，不覆盖上一轮消息。
- T4：脚本级 UI harness 覆盖 preview drawer 打开/关闭状态。
- T5：脚本级 UI harness 覆盖确认请求以内联 action card 呈现，并能调用 approve/deny endpoint。
- T6：`apps/share-web/test/share-page.test.ts` 更新为 Chatbot 产品模型，不再要求旧控制台结构。
- T7：浏览器 QA 覆盖桌面视口：新建 Session、切换 Session、提交两轮任务、打开/关闭预览 drawer、无 console error。
- T8：浏览器 QA 覆盖移动视口：无横向滚动，composer 不遮挡消息，preview sheet 可开关。
- T9：脚本级 UI harness 覆盖同一 Session 快速连发、任务提交异常、多 Session 并行返回三类消息可靠性场景。
- T10：浏览器 QA 覆盖同一 Session 快速连发、业务失败友好展示、多 Session 并行隔离、移动端无横向溢出，且无应用 console error。
- T11：脚本级和 contract 测试覆盖 Enter/Shift+Enter、停止按钮、隐藏内部 `task.accepted`、同一任务多段 `task.output` 合并、queued cancel 传播到 outbound Host。
- T12：真实浏览器 QA 覆盖朋友侧提交到本机真实 Codex adapter，断言 Agent bubble 展示真实输出且无 console error。
- T13：Host client 测试覆盖并发 cancel 中断 active task；adapter 测试覆盖 Codex、Claude Code、OpenCode 接收 `AbortSignal`。
- T14：固定浏览器 e2e 覆盖朋友页真实点击停止，并断言 Host running task 收到 `friend_cancelled` stop、adapter abort 触发、真实长运行子进程以 `SIGTERM` 退出、UI 保持取消终态且不展示完成态输出。
- T15：固定浏览器 e2e 覆盖桌面 `1440x1000` 和移动 `390x844` viewport，断言无 document 横向溢出、关键区域不越界、桌面 thread/composer 纵向顺序正确、移动 preview sheet 打开/关闭状态正确，并捕获非空截图。
- T16：固定浏览器 e2e 覆盖创建者页桌面 `1440x1000` 和移动 `390x844` viewport，断言已有链接列表、编辑表单、框架选择、保存、暂停、启用控件可见且不越界，并捕获非空截图。
- T17：固定浏览器 e2e 覆盖朋友侧快速连发、多 Session 并行隔离、任务请求异常友好展示；每个场景必须保存 `.gstack/qa-reports/browser-screenshots/*.png` 截图，且无 console error / runtime exception。
- T18：contract 测试覆盖 RuntimeEvent 到 AG-UI lifecycle/text/custom/error 事件的映射，并覆盖 HTTP `/v1/share/:token/events?format=ag-ui`。
- T19：脚本级 UI harness 覆盖朋友页恢复已有 Session 时必须请求 `format=ag-ui`，并能把 `RUN_STARTED` 用户消息和 `TEXT_MESSAGE_*` Agent 输出渲染成同一条多轮对话。
- T20：share-web 单元测试覆盖 AG-UI events 到 assistant-ui ExternalStore text messages 的转换、streaming running 状态、custom event 脱敏，以及 `createSharePageModel()` 使用 AG-UI external store messages。
- T21：share-web 单元测试覆盖 assistant-ui ExternalStore transport client：`onNew` 提交文本并刷新 `format=ag-ui` events，`onCancel` 取消当前 task 并刷新取消事件，非文本、空文本和无 active task cancel 必须在发出网络请求前失败。
- T22：share-web 单元测试覆盖多 Session runtime store：thread list adapter 必须区分 regular/archived thread，创建新 thread 必须调用 `/sessions`，`onNew` 必须路由到 active session，`onCancel` 必须只取消 active session 的 active task，切换回其他 thread 后消息必须保持隔离。
- T23：share-web 单元测试覆盖真实 `@assistant-ui/react` package smoke 和 runtime binding：必须能导入 `useExternalStoreRuntime`、`AssistantRuntimeProvider`、`ThreadPrimitive.Root`、`ThreadListPrimitive.Root`，并验证 Ralphloop store options 能驱动 `onNew` 写入 active session。
- T24：share-web 单元测试覆盖 assistant-ui React shell SSR：必须能渲染 `AssistantRuntimeProvider` + `ThreadListPrimitive.Root` + `ThreadPrimitive.Root`，输出当前 thread id、message count、thread count，且不泄露成本、预算、tokenHash、deviceKey 或 bootstrap。
- T25：HTTP/browser 测试覆盖 `/app/share/:token/assistant-ui?sessionId=...&taskId=...`：先经 Host outbound 链路产生 AG-UI events，再断言页面含真实 assistant-ui shell、可见用户输入、可见 Agent 输出、Session thread 标记，并且不泄露成本、预算、tokenHash、deviceKey、bootstrap。
- T25a：contract / HTTP 测试覆盖创建者创建分享链接和 `dev:productized:outbound` 输出的默认朋友 URL 都指向 `/app/share/:token/assistant-ui`；Owner 页面脚本不得为历史链接伪造 raw token URL。
- T26：固定浏览器 e2e 覆盖 assistant-ui 分享入口桌面 `1440x1000` 和移动 `390x844` viewport：断言 shell layout 为 `chatbot`，rail/panel/message list 均在 viewport 内，无横向溢出，用户输入和 Agent 输出可见，无 console error / runtime exception。
- T27：固定浏览器 e2e 覆盖 assistant-ui 分享入口 follow-up 发送：朋友在 assistant-ui 入口输入第二轮消息，页面必须通过真实 `/tasks` 提交到 outbound Host command，Host 回写 AG-UI events 后，页面展示 4 条消息、状态为 completed、发送按钮恢复可用，并且无 console error / runtime exception。
- T28：固定浏览器 e2e 覆盖 assistant-ui 分享入口停止运行：朋友发送长运行 follow-up 后点击停止，Host client 必须触发 adapter `stop(..., friend_cancelled)` 和 `AbortSignal`，页面必须展示历史 completed 消息、当前用户消息和取消消息共 4 条，状态为 cancelled，发送按钮恢复可用，且不展示取消后的 completed 输出。
- T29：RelayStore 单元测试覆盖 `cancelTasksForSession()` 只取消非终态任务；completed/failed/cancelled 历史任务必须保留原状态，避免取消当前 run 时污染同一 Session 的历史消息。
- T30：固定浏览器 e2e 覆盖 assistant-ui 分享入口新建 Session 和切换：点击 New Thread 后必须创建第二个真实 Session，新 Session 发送消息并收到 Host 输出，rail 展示两个 thread；切回旧 Session 后必须恢复旧 prompt 和旧 Host 输出，并且不展示新 Session 消息。
- T31：固定浏览器 e2e 覆盖 assistant-ui 分享入口刷新恢复：创建第二个真实 Session 并完成一轮 Host 输出后刷新当前 URL，页面必须恢复两个 thread；当前新 Session 继续展示自己的 prompt/output，切回旧 Session 后必须通过 AG-UI events 恢复旧 prompt/output，且无 console error / runtime exception。
- T32：固定浏览器 e2e 覆盖 assistant-ui 分享入口任务提交失败：拦截 `/tasks` 请求为网络异常后，页面必须保留用户消息、展示“任务提交失败，请稍后重试。”、状态为 failed、发送按钮恢复可用，并且无 console error / runtime exception。
- T33：固定浏览器 e2e 覆盖 assistant-ui 分享入口 Escape 取消：朋友发送长运行 follow-up 后按 Escape，页面必须进入 cancelled、展示取消消息、发送按钮恢复可用，且无 console error / runtime exception。
- T34：固定浏览器 e2e 覆盖 assistant-ui 分享入口运行中加载态：朋友发送 follow-up 后，在 Host 尚未处理 command 前页面必须展示 4 条消息（历史用户、历史 Agent、当前用户、Agent 处理中），状态为 running、停止按钮可用、发送按钮禁用；Host 输出回来后仍保持 4 条真实消息，并且处理中消息消失。
- T35：固定浏览器 e2e 覆盖 assistant-ui 分享入口 running 事件不可用和旧 URL 刷新恢复：朋友发送 follow-up 后模拟 `format=ag-ui` events 返回 `events_unavailable`，以及直接打开旧 `sessionId/taskId` URL 时，页面都必须进入 failed、展示“当前会话已失效，请新建会话后重试。”，清理 loading、恢复发送按钮、禁用停止按钮，并且可见消息不包含内部错误字段。
- T35a：OpenCode adapter 单元测试覆盖 `opencode run` 传入超时和 `AbortSignal`、JSON stdout 转为多条 `task.output`、失败 JSON/stderr 转为 `task.failed`，避免真实本地推理输出丢失或无限等待。
- T35b：固定浏览器 e2e 覆盖分享入口迁移：打开裸 `/app/share/:token` 后必须重定向到 `/app/share/:token/assistant-ui` 并渲染 assistant-ui shell；打开显式 `/app/share/:token/classic` 后必须看到 `friend-assistant-ui-link`，点击后进入 `/app/share/:token/assistant-ui`，页面不泄露内部字段。
- T35c：固定浏览器 e2e 覆盖默认 assistant-ui 首条消息：从裸 `/app/share/:token` 进入新版页后直接发送第一条消息，页面必须创建真实 `sessionId`、Host 返回真实输出、URL 写入 `sessionId/taskId`，`data-thread-count` 为 `1`，rail 和 localStorage 都不包含 `assistant-ui-preview`。
- T36：全量命令通过：
  - `npm test`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run build`
  - `npm run test:contract`
  - `npm run test:integration`
  - `npm run test:security`
  - `npm run test:e2e`
  - `npm run test:smoke:real-adapter`
  - `git diff --check`

## 8. QA 场景

### QA-1：首次打开朋友链接

1. 打开裸 `/app/share/:token`。
2. 浏览器被重定向到 `/app/share/:token/assistant-ui`。
3. assistant-ui shell 自动创建或恢复 active Session。
4. sidebar 至少有一个 Session。
5. Chat thread 显示空状态或当前 Session 事件。
6. Preview drawer 默认关闭。
7. 如果这是无 `sessionId` 的首次访问，朋友输入第一条消息后只能出现一个真实 Session，不能保留 preview 占位 Session。

### QA-2：同一 Session 多轮对话

1. 在当前 Session 输入第一轮任务。
2. 等待完成。
3. 输入第二轮任务。
4. 断言两轮用户消息和 Agent 输出都在 thread 中。

### QA-3：多 Session 切换

1. 新建 Session B。
2. 在 Session B 输入任务并完成。
3. 切回 Session A。
4. Session A 的历史仍可见，Session B 的消息不混入。

### QA-4：预览 drawer

1. 点击“预览”。
2. 右侧 drawer 打开。
3. 点击关闭。
4. drawer 收起，chat 布局仍可用。

### QA-5：同一 Session 快速连发

1. 在当前 Session 连续发送两条消息，不等待第一条完成。
2. 断言两条用户消息都进入 thread。
3. 断言顺序与用户发送顺序一致。
4. 断言 Agent 输出不重复、不串线，且不出现裸 `session_unavailable`。

### QA-6：任务提交异常

1. 模拟 task request 网络异常或业务失败。
2. 断言用户消息仍保留。
3. 断言失败消息为朋友可理解的友好文案。
4. 断言页面不展示异常栈、内部错误码、成本、预算或 token 信息。

### QA-7：多个 Session 并行返回

1. 在 Session A 提交任务。
2. 在 Session A 返回前新建或切换到 Session B。
3. 在 Session B 提交任务。
4. 断言 Session B 只显示自己的用户消息和 Agent 输出。
5. 切回 Session A，断言 Session A 只显示自己的用户消息和 Agent 输出。

### QA-8：运行态停止

1. 在当前 Session 提交一个任务。
2. 确认页面进入运行中，停止按钮可用。
3. 点击停止。
4. 断言页面显示取消终态，停止按钮禁用，消息流出现“任务已取消”。
5. 在 outbound Host 模式下，断言 Relay 排入并处理 `session.cancel` command。
6. 若 Host 尚未领取任务，断言 stale `task.submit` 不会启动 adapter。
7. 若 Host 已经在执行任务，断言 Host client abort 运行中的 adapter 命令，最终只回传 `task.cancelled` 终态。

### QA-9：安全与泄露

1. 检查 DOM 和页面文本。
2. 不出现成本、预算、token hash、设备密钥、bootstrap secret。
3. 切换 Session 不泄露其他朋友 session。

### QA-10：assistant-ui 浏览器入口

1. 启动 outbound Host dev server。
2. 通过朋友 API 创建 Session 并提交 task。
3. 等待 Host 回写 `format=ag-ui` 事件。
4. 打开 `/app/share/:token/assistant-ui?sessionId=...&taskId=...`。
5. 断言页面渲染真实 assistant-ui shell、当前 `threadId`、message count、thread count。
6. 断言用户 prompt 与 Agent 输出均为可见文本。
7. 断言 DOM 和页面文本不包含成本、预算、tokenHash、deviceKey、bootstrap 或 host auth。
8. 在桌面和移动 viewport 下断言 rail、thread panel、message list 不越界且无 document 级横向滚动。

### QA-11：assistant-ui 入口同 Session follow-up

1. 打开 `/app/share/:token/assistant-ui?sessionId=...&taskId=...`。
2. 在底部 composer 输入第二轮任务。
3. 按 Enter 或点击发送。
4. 断言朋友输入立即保留在 thread 中，发送中按钮禁用。
5. 让本地 outbound Host 领取新 command 并回写 Agent 输出。
6. 断言 thread 中有第一轮用户消息、第一轮 Agent 输出、第二轮用户消息、第二轮 Agent 输出。
7. 断言状态恢复 completed，发送按钮可再次点击。
8. 断言旧任务 completed 事件不会让第二轮轮询提前结束。

### QA-12：assistant-ui 入口停止运行

1. 打开已有 Session 的 `/app/share/:token/assistant-ui?sessionId=...&taskId=...`。
2. 在 composer 输入一个长运行 follow-up 并发送。
3. 等待页面进入 running 且停止按钮可点击。
4. 让 outbound Host 领取 task 并保持运行。
5. 点击停止。
6. 断言 Relay 排入 `session.cancel`，Host client 中断当前 adapter，并回传取消终态。
7. 断言页面状态为 cancelled，停止按钮禁用，发送按钮恢复可用。
8. 断言消息流保留历史 completed 输出，只为当前 follow-up 展示一条“任务已取消。”，不展示取消后的 completed 输出。

### QA-13：assistant-ui 入口新建和切换 Session

1. 打开已有 Session 的 `/app/share/:token/assistant-ui?sessionId=...&taskId=...`。
2. 点击左侧 rail 的 New Thread。
3. 断言页面创建第二个真实后端 Session，`data-thread-count` 变为 2，当前 `threadId` 变为新 `sessionId`。
4. 在新 Session 发送一条消息，让 outbound Host 回写输出。
5. 断言新 Session 只展示自己的用户消息和 Agent 输出。
6. 点击旧 Session rail item。
7. 断言旧 Session 恢复原始用户消息和原始 Agent 输出，且不混入新 Session 消息。

### QA-14：assistant-ui 入口刷新后恢复 Session 列表

1. 打开已有 Session 的 `/app/share/:token/assistant-ui?sessionId=...&taskId=...`。
2. 新建第二个真实 Session，发送消息并等待 Host 输出完成。
3. 刷新当前页面 URL。
4. 断言左侧 rail 仍有两个 thread，当前 `threadId` 仍是刷新前的新 `sessionId`。
5. 断言当前 Session 的用户消息和 Agent 输出仍可见，状态为 completed。
6. 点击旧 Session rail item。
7. 断言旧 Session 通过 `format=ag-ui` events 恢复原始用户消息和 Agent 输出，且不混入新 Session 消息。

### QA-15：assistant-ui 入口任务提交异常

1. 打开已有 Session 的 `/app/share/:token/assistant-ui?sessionId=...&taskId=...`。
2. 模拟 `/v1/share/:token/tasks` 网络异常或业务失败。
3. 在 composer 输入一条新消息并发送。
4. 断言用户消息仍保留在 thread 中。
5. 断言 thread 中追加友好失败消息“任务提交失败，请稍后重试。”。
6. 断言当前状态为 failed，发送按钮恢复可用。
7. 断言页面文本和 DOM 不包含异常栈、`TypeError`、网络内部错误、成本、预算、tokenHash、deviceKey、bootstrap 或 host auth。

### QA-16：assistant-ui 入口 Escape 取消运行

1. 打开已有 Session 的 `/app/share/:token/assistant-ui?sessionId=...&taskId=...`。
2. 在 composer 输入一个长运行 follow-up 并发送。
3. 等待页面进入 running，停止按钮可用。
4. 按 Escape。
5. 断言页面进入 cancelled，消息流追加“任务已取消。”。
6. 断言停止按钮禁用，发送按钮恢复可用。
7. 断言消息流保留历史 completed 输出和当前用户消息，不展示取消后的 completed 输出。

### QA-17：assistant-ui 入口运行中加载态

1. 打开已有 Session 的 `/app/share/:token/assistant-ui?sessionId=...&taskId=...`。
2. 在 composer 输入一条 follow-up 并发送。
3. 暂不让 Host 处理该 command，保持真实输出未返回。
4. 断言页面状态为 running，停止按钮可用，发送按钮禁用。
5. 断言消息流包含历史用户消息、历史 Agent 输出、当前用户消息和“Agent 正在处理...”共 4 条消息。
6. 让 Host 处理 command 并回写真实 AG-UI 输出。
7. 断言页面进入 completed，消息流仍是 4 条真实消息，“Agent 正在处理...”不再出现在可见消息列表中，且无 console error / runtime exception。

### QA-18：assistant-ui 入口旧任务失效恢复

1. 打开已有 Session 的 `/app/share/:token/assistant-ui?sessionId=...&taskId=...`。
2. 在 composer 输入一条 follow-up 并发送。
3. 模拟服务重启、旧 `sessionId/taskId` 丢失或 `/v1/share/:token/events?format=ag-ui` 返回 `events_unavailable`。
4. 断言页面不能继续停留在 running。
5. 断言消息流保留历史 completed 消息和当前用户消息，并展示“当前会话已失效，请新建会话后重试。”。
6. 断言 `.assistant-ui-message-loading` 已清理，发送按钮恢复可用，停止按钮禁用。
7. 断言可见消息中不包含 `events_unavailable`、HTTP 状态码、`not_found`、成本、预算、tokenHash、deviceKey、bootstrap 或 host auth。

## 9. 完成定义

只有当以下条件同时满足，本阶段才算完成：

- 新 spec 已提交。
- 实现已按 Chatbot + Session + Preview drawer 方向替换旧朋友页。
- 验收标准全部有自动化测试或浏览器 QA 证据。
- 全量验证命令通过。
- QA 报告写入 `.gstack/qa-reports/`。
- 最终回复列出完成项、验证命令和结果。
