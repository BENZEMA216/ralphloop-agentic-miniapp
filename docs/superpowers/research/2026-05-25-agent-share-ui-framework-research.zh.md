# Ralphloop Agent Share 前端基座研究

## 研究目的

本轮研究聚焦朋友侧 Agent Share 页面：它应该像成熟 Agent Chat，而不是一次性表单。关键能力包括多 Session、运行态、停止态、快捷键、事件流、桌面预览抽屉、异常态和后续 React 化迁移路径。

补充说明：GitHub 深度竞品与架构调研已单独沉淀在 `docs/superpowers/research/2026-05-25-agent-share-github-deep-research.zh.md`。该文档确认 Happy、Happier、HAPI、Yep Anywhere、Paseo、Kanna、ACP UI、CloudCLI / Claude Code UI、AionUi 等项目已经覆盖本地 Agent 远程控制、跨设备 session、relay、ACP、多 provider、终端和成熟 Chat UI 等关键方向，因此 Ralphloop 后续应转向 React Chat + Host daemon + Relay event store + ACP-compatible adapter，而不是继续扩大当前 server-rendered friend page。

## 参考项目与结论

### assistant-ui

- 链接：https://www.assistant-ui.com/docs/ui/thread
- 定位：React AI Chat UI primitives。
- 可借鉴点：Thread、Viewport、Messages、Composer、Send/Cancel 条件渲染、自动滚动、错误消息和可组合运行时。
- 对 Ralphloop 的判断：最适合做长期朋友侧 Chat 基座。下一阶段如果把 server-rendered HTML 迁移到 React，优先以 assistant-ui 的 Thread/Composer 模型重做朋友页。

### AG-UI

- 链接：https://docs.ag-ui.com/sdk/js/core/overview
- GitHub：https://github.com/ag-ui-protocol/ag-ui
- 定位：Agent 与用户界面的事件协议。
- 可借鉴点：标准化 streaming events、state update、tool call、message lifecycle。
- 对 Ralphloop 的判断：不一定直接替换当前 API，但应作为事件规范方向。Ralphloop 现有 `task.output`、`task.completed`、`task.failed`、`task.cancelled` 可以逐步映射到 AG-UI 风格事件，避免未来前端强绑定自定义 REST 轮询。

### OpenCode Web

- 链接：https://opencode.ai/docs/web/
- GitHub：https://github.com/opencode-ai/opencode
- 定位：OpenCode 自带浏览器体验。
- 可借鉴点：本地 server、随机端口、本地浏览器打开、会话式 coding agent 体验。
- 对 Ralphloop 的判断：更适合作为 Agent 框架适配目标和交互参照，不适合作为直接嵌入的朋友侧通用 UI，因为它和 OpenCode 自身 runtime/API 绑定较深。

### OpenHands

- 链接：https://docs.openhands.dev/usage/key-features
- GitHub：https://github.com/OpenHands/OpenHands
- 定位：完整软件工程 Agent 工作台。
- 可借鉴点：Chat Panel、Workspace、文件/终端/浏览器观察面板、任务审阅。
- 对 Ralphloop 的判断：适合作为“桌面预览抽屉 + Agent Chat 主线”的产品形态参考；不适合作为 MVP 的轻量 UI 基座。

## 本轮产品决策

当前仓库仍是 productized server-rendered HTML，直接引入 React/assistant-ui 会带来构建系统和迁移成本。因此本轮先在现有朋友页补齐成熟 Chat 必备行为：

- Enter 发送，Shift+Enter 保留换行草稿。
- 运行中的 Session 显示可用停止按钮。
- 朋友可以停止当前 outbound Session，并在 UI 中看到 `已取消`。
- `task.accepted` 等内部事件不再以“事件 task.accepted”形式显示给朋友。
- 继续保留同 Session 队列、多 Session 隔离、异常友好展示和桌面预览抽屉。

## 下一阶段建议

1. 把朋友侧前端从内联脚本迁移到 React 页面，并引入 assistant-ui 作为 Chat primitives。
2. 设计 Ralphloop event adapter，把当前 RuntimeEvent 映射为 AG-UI 兼容事件。
3. 增加固定浏览器 e2e：运行态、停止态、快捷键、多 Session、并行消息、异常态、桌面预览抽屉。
4. 让 outbound Host 真实消费 `session.cancel` 命令，做到朋友点击停止后 Host 侧也能中断正在执行的 CLI/agent。

## 2026-05-25 取消链路补充研究

本轮继续查了取消/停止在成熟 Agent UI 里的形态：

- assistant-ui 的 Composer primitive 支持 `Cancel`，Input 支持 `submitMode: "enter"`，其默认语义就是 Enter 提交、Shift+Enter 换行，取消按钮和运行态绑定。
- assistant-ui 的 AG-UI runtime options 暴露 `onCancel` 回调，说明 UI 取消不应只停留在前端状态，必须进入 runtime/transport。
- AG-UI 把 cancel/resume 作为多轮 streaming session 的 building block，事件层用 run lifecycle 和 typed events 承载状态。

因此 Ralphloop 的最小实现原则是：

- Friend UI 点“停止”先让 Relay Session/Task 进入 `cancelled`，立即反馈给朋友。
- 对 outbound Host，Relay 必须排入 `session.cancel` 命令。
- Host 下一轮 poll 不能再执行已经取消的旧 `task.submit`；应跳过 stale submit，并回传 cancel ack。
- 这还不是完整进程级中断：如果 Host 已经启动 CLI 子进程，后续还需要在 Host client 维护运行中进程表并杀掉对应 runtime。

## 2026-05-25 运行中 CLI 中断补充研究

本轮继续补齐上一个缺口：`session.cancel` 已经能处理 queued command，但如果 Host 已经启动 Codex / Claude Code / OpenCode CLI，仍需要进程级中断。

参考 Node.js 官方 `child_process` 文档：

- `spawn()` 是异步启动子进程，不阻塞 Node event loop。
- `exec()` / `execFile()` 支持 `signal: AbortSignal`。
- 启用 `signal` 后，调用对应 `AbortController.abort()` 的语义接近杀掉子进程，只是回调错误会是 `AbortError`。
- `execFile()` 不通过 shell 直接启动命令，适合作为 CLI adapter 的默认执行方式。

对 Ralphloop 的实现结论：

- Host client 需要一个跨 poll tick 共享的运行态表，记录 `sessionId -> active task`。
- 处理 `task.submit` 时创建 `AbortController`，把 `signal` 传给 adapter 的 `submitTask` / `streamEvents`。
- 处理并发到达的 `session.cancel` command 时，先 `abort()` 正在执行的 task，再调用 adapter `stop()` 清理 runtime。
- 已 abort 的 task 不应继续回传 `task.completed` 或 `task.failed`，最终事件应收敛为 `task.cancelled`。
- Relay 写入 runtime event 时需要避免重复 `task.cancelled`，因为 friend cancel command 和 running task command 都可能上报取消终态。

参考链接：https://nodejs.org/api/child_process.html

## 2026-05-25 固定浏览器 E2E 补充研究

本轮继续复核成熟 Agent Chat UI 对“停止”的处理方式：

- assistant-ui `Thread` 组件在 `thread.isRunning` 时从发送按钮切换为取消按钮，说明停止态应是主 composer 的一等状态，而不是附属链接。
- assistant-ui `ComposerPrimitive.Input` 的默认 `submitMode="enter"` 语义是 Enter 发送、Shift+Enter 换行、Escape 触发取消，这和 Ralphloop 当前朋友侧快捷键方向一致。
- assistant-ui 的 AG-UI runtime options 提供 `onCancel`，AG-UI runtime 也把 `RUN_CANCELLED` 映射为取消中的 assistant message；这进一步确认取消必须穿透到 runtime，而不是只更新 UI 文案。
- AG-UI 官方介绍强调实时多轮 session、cancel/resume 和事件流，这和 Ralphloop “朋友使用创建者 Host runtime”的方向一致。

对 Ralphloop 的测试结论：

- 只靠 fake DOM 脚本测试不足以证明朋友端真实交互可用；必须有仓库内固定 headless Chrome 用例覆盖真实页面事件。
- 本轮新增固定 e2e：打开真实朋友页，输入任务，提交后让 Host adapter 保持 running，再点击 UI 停止；断言 Host 收到 `stop(..., reason: "friend_cancelled")`，adapter 的 `AbortSignal` 触发，朋友页只显示 `任务已取消`，不出现 completed 输出。
- 该用例覆盖真实浏览器 UI 到 Host running task 的链路；随后应把 adapter 从“等待 signal”升级成真实长运行子进程，证明取消链路能终止 OS process。

## 2026-05-25 子进程级取消 E2E 补充研究

本轮继续补齐“停止是否真的能杀掉运行时进程”的验证深度。Node.js 官方 `child_process` 文档明确两点：`execFile()` 可以通过 `AbortSignal` 中止子进程；`subprocess.kill()` 默认发送 `SIGTERM`，并且 child process 的 close/exit 事件会带回结束 signal。

对 Ralphloop 的测试结论：

- 朋友页的固定浏览器 e2e 不能只证明 adapter 收到了一个 JS signal；它还需要证明实际子进程会退出。
- 本轮把该 e2e 的测试 adapter 改成真实 `node -e "setInterval(...)"` 长运行子进程；朋友点击“停止”后，Host cancel 触发 `AbortController.abort()`，adapter 把 signal 转成 `child.kill("SIGTERM")`，测试断言子进程以 `SIGTERM` 退出。
- 这条用例证明了 UI → Relay `session.cancel` → Host runtime state → AbortSignal → OS child process termination 的完整可重复链路。
- 验证中还暴露了一个前端竞态：朋友点停止后，后到的提交响应可能把 Session 从 `cancelled` 覆盖回 `running`。修复原则是把 `cancelled` 当作本地终态，迟到响应只能绑定真实 taskId，不能重启轮询或覆盖取消状态。
- 仍不把真实 Codex / Claude Code / OpenCode 长运行命令放进默认 e2e，因为它们的真实长任务耗时、模型环境和本地授权不稳定；供应商 CLI 的默认命令执行层继续由 adapter smoke 测试覆盖 `AbortSignal` 注入。

参考链接：

- https://www.assistant-ui.com/docs/ui/thread
- https://www.assistant-ui.com/docs/api-reference/primitives/composer
- https://www.assistant-ui.com/docs/runtimes/ag-ui/runtime-options
- https://docs.ag-ui.com/
- https://nodejs.org/api/child_process.html

## 2026-05-25 assistant-ui 运行中加载态补充研究

本轮针对用户指出的“运行中但没有加载态”继续复核 assistant-ui 的运行态模型。assistant-ui 的 `Thread` 组件是完整 chat container，包含 message list、composer、auto-scroll 和条件状态；官方示例在 `thread.isRunning` 时把 composer action 从发送按钮切换成取消按钮。`ExternalStoreRuntime` 文档也把 `isRunning` 定义为 assistant 正在生成响应，并说明该状态会进入 `thread.isRunning`，用于 optimistic assistant message；`isLoading` 则是更强的 adapter loading 状态，会显示 loading indicator 取代 composer。

对 Ralphloop 的产品判断：

- 朋友侧不能只在 header pill 显示“运行中”；Agent Chat 的主消息流必须有一条可见的 assistant loading/processing turn。
- Ralphloop 当前仍是 server-rendered assistant-ui shell，因此本轮先以 `.assistant-ui-message-loading` 插入可见 Agent 占位消息，行为上对齐 assistant-ui 的 optimistic assistant message。
- 该占位消息只能存在于“任务已被 Relay 接收、Host 尚未回写真实 AG-UI output”的间隙；一旦真实 `TEXT_MESSAGE_*`、失败或取消事件回来，必须被真实输出或终态消息替换，避免用户误以为仍在推理。
- 后续 React 化迁移时，应把这条行为落到 `useExternalStoreRuntime({ isRunning })` 和 composer cancel primitive 上，而不是继续维护内联 DOM 状态。

参考链接：

- https://www.assistant-ui.com/docs/ui/thread
- https://www.assistant-ui.com/docs/runtimes/custom/external-store
- https://www.assistant-ui.com/docs/api-reference/primitives/thread

## 2026-05-25 响应式浏览器验收补充研究

本轮继续处理朋友页“看起来像可用 Chatbot，而不是粗糙控制台”的质量门槛。Chrome DevTools Protocol 提供两类适合固定化 QA 的能力：`Emulation.setDeviceMetricsOverride` 可以在 headless Chrome 中切换桌面/移动 viewport，`Page.captureScreenshot` 可以捕获页面截图数据。因此 Ralphloop 不需要先引入 Playwright/Puppeteer，就可以把响应式布局检查沉淀进现有 Node test harness。

对 Ralphloop 的测试结论：

- 只检查 HTML 合约和 fake DOM 不足以发现真实移动端 viewport 溢出、preview sheet 遮挡、composer 与 thread 顺序问题。
- 本轮固定浏览器 e2e 增加 `1440x1000` 桌面和 `390x844` 移动 viewport。断言 document 没有横向滚动，shell/sidebar/chat/thread/composer 不越出 viewport，桌面 sidebar 在 chat 左侧，thread 在 composer 上方。
- 移动端同时覆盖 preview drawer 关闭态和打开态：关闭态必须 `visibility:hidden` 且不可点击，打开态必须在 viewport 内并占满可视高度。
- e2e 会捕获桌面与移动截图数据并断言非空；这不是像素级 golden diff，但已经把“真实浏览器能截图且布局可测”纳入默认回归。

参考链接：

- https://chromedevtools.github.io/devtools-protocol/tot/Emulation/
- https://chromedevtools.github.io/devtools-protocol/tot/Page/

## 2026-05-25 创建者页浏览器验收补充研究

本轮把同一套 Chrome DevTools Protocol harness 抽成可复用模块，用于朋友页和创建者页。Chrome DevTools Protocol 官方说明它可用于 instrument、inspect、debug Chromium/Chrome；`Emulation.setDeviceMetricsOverride` 可以覆盖 `window.innerWidth`、`window.innerHeight` 和 CSS media query 相关尺寸，`Page.captureScreenshot` 返回 base64 截图数据。这正好适合把“分享链接管理页是否真的可用”从脚本 API 测试提升为真实浏览器回归。

对 Ralphloop 的测试结论：

- 创建者页不能只测 `/v1/owner/share-links` API。MVP 中创建者要能在浏览器里看到已有链接、编辑名称、调整允许框架、暂停和重新启用链接。
- 本轮新增固定浏览器 e2e：注册本机 Host，创建两个已有分享链接，打开 `/app/owner`，在真实页面中保存链接名称、暂停链接、重新启用链接。
- 同一用例覆盖桌面 `1440x1000` 和移动 `390x844` viewport，断言 owner shell、topbar、workspace、链接列表、编辑表单、输入框、框架选择和按钮不越出 viewport，且 document 没有横向滚动。
- 该用例也捕获桌面和移动非空截图数据，并检查 console error / runtime exception 为 0；后续若要进一步产品化，应把截图落盘并加入视觉 diff。

参考链接：

- https://chromedevtools.github.io/devtools-protocol/index.html
- https://chromedevtools.github.io/devtools-protocol/tot/Emulation/
- https://chromedevtools.github.io/devtools-protocol/tot/Page/

## 2026-05-25 朋友侧真实浏览器行为回归补充研究

本轮继续复核成熟 Agent Chat UI 的运行时模型。assistant-ui 的 `Thread` 组件把 message list、composer、auto-scroll、thread switch 和运行态 send/cancel 作为同一个可组合界面；AG-UI 的事件模型把 run lifecycle 绑定到 `threadId` 和 `runId`，并用 `RUN_STARTED`、`RUN_FINISHED`、`RUN_ERROR`、`TEXT_MESSAGE_*` 等事件表达前端与 Agent 的交互。这说明 Ralphloop 的朋友侧不能只测“页面能打开”，还必须验证多个运行中的任务不会互相覆盖、不同 Session 的输出不会串线。

对 Ralphloop 的测试结论：

- 同一 Session 快速连发不能共用单个全局轮询 timer；否则第二条消息可能清掉第一条任务的轮询，造成第一条 Agent 输出在真实浏览器里偶发丢失。
- 同一 Session 中旧任务的终态事件可以追加到消息流，但不能覆盖该 Session 较新的 `currentTaskId`。
- 固定浏览器 e2e 新增三类场景：快速连发顺序、多 Session 并行输出隔离、任务请求异常友好展示。
- 浏览器 harness 新增截图归档能力，默认写入 `.gstack/qa-reports/browser-screenshots`；本轮归档 `friend-rapid-same-session.png`、`friend-parallel-session-second.png`、`friend-parallel-session-first.png`、`friend-friendly-failure.png`。

参考链接：

- https://www.assistant-ui.com/docs/ui/thread
- https://docs.ag-ui.com/sdk/js/core/events

## 2026-05-25 AG-UI Runtime Contract 补充研究

本轮把“语义参考 AG-UI / assistant-ui”推进为可执行契约。AG-UI 官方事件文档列出的核心事件包括 `RUN_STARTED`、`RUN_FINISHED`、`RUN_ERROR`、`TEXT_MESSAGE_START`、`TEXT_MESSAGE_CONTENT`、`TEXT_MESSAGE_END`、`CUSTOM`；其中 Text Message 事件通过相同 `messageId` 串起一条 assistant message，前端按 `delta` 顺序拼接内容。assistant-ui 的自定义 runtime 文档强调外部 store 需要把业务消息转换为 UI runtime 可消费的 message/thread 状态，因此 Ralphloop 需要一个独立的事件适配层，而不是把当前 `task.output` 直接绑死在页面脚本里。

对 Ralphloop 的实现结论：

- 新增 `runtimeEventsToAgUiEvents()` 作为产品化 runtime adapter 边界，把内部 `RuntimeEvent` 映射为 AG-UI event stream。
- `task.output` 映射为 `TEXT_MESSAGE_START` + 多个 `TEXT_MESSAGE_CONTENT` + `TEXT_MESSAGE_END`；多段输出用换行 delta 保持当前朋友页合并语义。
- `task.completed` 映射为 `RUN_FINISHED`，`task.failed` 映射为 `RUN_ERROR`，`task.cancelled` 映射为 Ralphloop `CUSTOM` 取消事件加 `RUN_FINISHED(status=cancelled)`。
- `task.accepted` 继续隐藏，不进入 AG-UI 输出，避免朋友侧看到内部排队事件。
- Friend events API 新增 `format=ag-ui` 查询参数，保留默认 runtime events 格式，避免破坏当前前端。

参考链接：

- https://docs.ag-ui.com/sdk/js/core/events
- https://docs.ag-ui.com/concepts/messages
- https://www.assistant-ui.com/docs/runtimes/custom/external-store

## 2026-05-25 朋友页 AG-UI 客户端接入补充研究

本轮继续把 AG-UI contract 往前端消费侧推进。assistant-ui 的 ExternalStoreRuntime 文档说明，当应用已经有自己的 store 时，应由业务层提供 messages、callbacks 和 message conversion；message conversion 文档进一步把外部消息转换为 `ThreadMessageLike` 作为独立边界。AG-UI 事件文档则把 assistant text 拆成 `TEXT_MESSAGE_START`、`TEXT_MESSAGE_CONTENT`、`TEXT_MESSAGE_END`，并以 `RUN_STARTED/RUN_FINISHED/RUN_ERROR` 表达 run lifecycle。

对 Ralphloop 的实现结论：

- 当前朋友页仍是 server-rendered HTML，不直接引入 React runtime；但客户端事件消费必须先对齐 AG-UI，否则后续迁移 assistant-ui 时仍会绑在内部 `task.output` 上。
- `refreshTaskEvents()` 改为请求 `format=ag-ui`，只在服务端返回旧格式时保留 runtime fallback，避免破坏兼容性。
- 客户端用 `RUN_STARTED.input.messages` 恢复用户消息，解决“刷新已有 Session 只看到 Agent 输出、看不到用户原始 prompt”的问题。
- 客户端把同一个 `messageId` 的 `TEXT_MESSAGE_CONTENT.delta` 合并成单条 `task.output` message，并用 upsert 方式避免即时任务响应和轮询恢复重复追加。
- `RUN_FINISHED`、`RUN_ERROR` 和 Ralphloop `CUSTOM` 事件进入状态机，保证完成、失败、取消和确认类事件仍能驱动 UI。

参考链接：

- https://www.assistant-ui.com/docs/runtimes/custom/external-store
- https://www.assistant-ui.com/docs/api-reference/external-store/message-conversion
- https://www.assistant-ui.com/docs/runtimes/custom/overview
- https://docs.ag-ui.com/sdk/js/core/events

## 2026-05-25 assistant-ui 浏览器入口补充研究

本轮重新复核了成熟 Chat UI 与 Agent UI 协议的当前方向。assistant-ui 的 External Store Runtime 文档把“已有业务 state/store 接入 React Chat UI”定义为正式路径：应用提供 `messages`、`isRunning`、`onNew`、`onCancel` 和 thread list adapter，UI runtime 负责把这些状态变成 Thread/Composer/ThreadList 交互。AG-UI 官方仓库和文档继续强调事件协议应该覆盖 agent 后端到用户界面的实时事件流，而不是让前端直接绑定某个内部 runtime event。

对 Ralphloop 的实现结论：

- 继续选择 assistant-ui 作为朋友侧长期 React Chat 基座，而不是自研完整 Chat 组件体系。
- 当前最小增量不直接替换现有朋友页，而是新增 `/app/share/:token/assistant-ui` 浏览器入口，证明真实 share token、Session、task 和 Host 输出可以进入 assistant-ui runtime shell。
- HTTP 入口从 `/v1/share/:token/events?format=ag-ui` 恢复事件，再交给 `createFriendAgUiRuntimeStore()`，保持 AG-UI 作为后端到 UI 的标准边界。
- 页面必须可见渲染用户 prompt 和 Agent 输出；仅有 data attribute 的 SSR shell 不满足“朋友能使用”的产品要求。
- 因真实 assistant-ui SSR 在 Node test 进程中存在活动句柄风险，浏览器入口仍采用隔离子进程渲染。后续迁移到独立 React app/hydration 后，再把该隔离策略替换为正常前端 bundle。

参考链接：

- https://www.assistant-ui.com/docs/api-reference/external-store/runtime
- https://www.assistant-ui.com/docs/runtimes/custom/external-store
- https://github.com/ag-ui-protocol/ag-ui
- https://github.com/CopilotKit/CopilotKit

## 2026-05-25 assistant-ui Chatbot 页面结构补充研究

本轮继续复核 assistant-ui 和 AG-UI 的产品化边界。assistant-ui 的 ExternalStoreRuntime 文档强调 thread id 应集中在业务 store/context 中，避免 component-local state 导致 thread 切换后消息错位；Assistant Cloud 文档也把 thread list、thread switching、message persistence 视为 AI chat 应用的一等能力。AG-UI 事件文档继续用 `RUN_STARTED`、`TEXT_MESSAGE_*`、`RUN_FINISHED` 等事件表达同一个 run 的生命周期和可流式文本。

对 Ralphloop 的实现结论：

- assistant-ui 分享入口不应只证明 provider 能渲染，还必须像一个可演进的 Chatbot 页面：左侧会话 rail、主对话 panel、thread header、状态标记、消息气泡。
- `sessionId` 继续作为 `threadId`，页面结构只消费 `createFriendAgUiRuntimeStore()` 的 snapshot，不再引入第二套前端 thread id。
- 用户消息与 Agent 输出需要有明确 role class，方便后续 hydration 后复用同一个 DOM/CSS 结构接入 composer、send、cancel。
- 桌面和移动视口必须作为验收面：rail 在桌面左侧、移动端堆叠在 panel 之上，document 不应横向溢出。

参考链接：

- https://www.assistant-ui.com/docs/runtimes/custom/external-store
- https://www.assistant-ui.com/docs/cloud
- https://docs.ag-ui.com/sdk/js/core/events

## 2026-05-25 真实 assistant-ui React package binding 补充研究

本轮把“未来迁移 assistant-ui”推进到真实依赖层。npm 当前 `@assistant-ui/react` 版本为 `0.14.7`，peer dependency 要求 React `^18 || ^19`、React DOM `^18 || ^19`。assistant-ui 的 ExternalStoreRuntime 文档说明，如果应用已经有自己的 state/store，可以把 `messages`、`isRunning`、`onNew`、`onCancel` 和 adapters 传给 `useExternalStoreRuntime`。Threads 文档说明 ExternalStoreRuntime 的多线程入口是 `ExternalStoreThreadListAdapter`，这正好对应上一轮的 `createFriendAgUiRuntimeStore()`。

对 Ralphloop 的实现结论：

- 项目正式声明 `@assistant-ui/react`、`react`、`react-dom` 依赖，并加入 lockfile，避免后续“参考了 UI 框架但没有真实可导入 package”的空转。
- 新增 `createAssistantUiRuntimeOptions()`，作为 React hook 之外的最小 binding：它从 Ralphloop runtime store 取出 `messages/isRunning/onNew/onCancel/adapters.threadList`，这些字段就是 `useExternalStoreRuntime` 需要的核心 options。
- 测试通过真实 package import 验证 `useExternalStoreRuntime`、`AssistantRuntimeProvider`、`ThreadPrimitive.Root`、`ThreadListPrimitive.Root` 可用；因为直接在 Node test 进程导入 assistant-ui 会留下活动句柄，所以 package smoke 在隔离子进程中执行并显式退出。
- 这仍不是完整 React 页面迁移：下一步应引入实际 React/Vite/Next 渲染链，把 `createAssistantUiRuntimeOptions()` 接到 `useExternalStoreRuntime()`，再用 `Thread` / `ThreadList` 做浏览器 E2E。

参考链接：

- https://www.assistant-ui.com/docs/runtimes/custom/external-store
- https://www.assistant-ui.com/docs/runtimes/concepts/threads
- https://www.assistant-ui.com/docs/ui/thread
- https://www.assistant-ui.com/docs/ui/thread-list

## 2026-05-25 assistant-ui React shell SSR 补充研究

本轮继续把真实 assistant-ui 接入从“options binding”推进到“可渲染 shell”。assistant-ui 的 ThreadPrimitive 文档说明，`ThreadPrimitive.Root` 是对话 thread 的根容器，`ThreadPrimitive.Viewport` 和 `ThreadPrimitive.Messages` 负责消息列表；ThreadListPrimitive 文档说明 `ThreadListPrimitive.Root`、`New`、`Items` 和 ThreadListItem primitives 需要 runtime context，必须放在 `AssistantRuntimeProvider` 下。ExternalStoreRuntime 文档则要求在 React 组件中调用 `useExternalStoreRuntime(...)` 创建 runtime。

对 Ralphloop 的实现结论：

- 新增 `renderAssistantUiReactShellToString()`，用 React SSR smoke 证明 Ralphloop store 可以进入真实 `useExternalStoreRuntime` → `AssistantRuntimeProvider` → `ThreadListPrimitive.Root` / `ThreadPrimitive.Root` 渲染链。
- SSR shell 不是最终朋友页 UI，也不替代当前 server-rendered 页面；它是迁移安全带，避免后续真正做 React 页面时才发现 runtime/provider/primitives 无法组合。
- 因为直接在 Node test 进程里渲染 assistant-ui 会留下活动句柄，SSR smoke 与 package smoke 一样放在隔离子进程中执行并显式 `process.exit(0)`。
- shell 输出当前 `threadId`、message count 和 thread count，并断言不包含成本、预算、tokenHash、deviceKey、bootstrap，延续朋友侧安全边界。

参考链接：

- https://www.assistant-ui.com/docs/api-reference/primitives/thread
- https://www.assistant-ui.com/docs/primitives/thread-list
- https://www.assistant-ui.com/docs/runtimes/custom/external-store

## 2026-05-25 assistant-ui 多 Thread runtime store 补充研究

本轮继续聚焦“朋友也是需要 Session”的产品要求。assistant-ui 官方 ExternalStoreRuntime 文档说明，外部 store 需要提供 `messages`、`isRunning`、`onNew`、`onCancel` 等能力；它的 Threads 文档进一步说明，多线程在 ExternalStoreRuntime 下通过 `ExternalStoreThreadListAdapter` 接入，adapter 需要暴露 `threadId`、`threads`、`archivedThreads`、`onSwitchToNewThread`、`onSwitchToThread`、`onRename`、`onArchive`、`onUnarchive`、`onDelete`。文档还明确提醒：runtime 的 `currentThreadId` 必须和应用 store 的选中 thread 保持同步，否则消息会出现在错误 thread 或消失。

对 Ralphloop 的实现结论：

- Ralphloop 的后端 `sessionId` 应该直接作为 assistant-ui `threadId`，不要再引入一层前端生成的 thread id；这样 `onNew`、`onCancel`、`loadEvents` 都能用同一个 session/task 绑定。
- 新增 `createFriendAgUiRuntimeStore()`，在 `apps/share-web` 中把多个 session 聚合成一个 assistant-ui ExternalStore adapter shape：`messages/isRunning/onNew/onCancel/adapters.threadList`。
- `onSwitchToNewThread()` 通过 `/v1/share/:token/sessions` 创建真实后端 session，再切换当前 thread；后续第一条 `onNew()` 自动把默认标题替换为朋友输入的任务摘要。
- `onNew()` 和 `onCancel()` 复用上一轮的 `createFriendAgUiRuntimeClient()`，因此仍固定请求 `format=ag-ui`，不会退回内部 runtime event。
- runtime store 继续禁止在朋友侧 transport 中携带成本、预算、host auth、device key、bootstrap secret 或创建者内部策略字段。

参考链接：

- https://www.assistant-ui.com/docs/runtimes/custom/external-store
- https://www.assistant-ui.com/docs/runtimes/concepts/threads
- https://www.assistant-ui.com/docs/runtimes/concepts/adapters
- https://www.assistant-ui.com/docs/ui/thread-list

## 2026-05-25 assistant-ui ExternalStore 迁移边界补充研究

本轮继续研究“如何从当前 server-rendered 朋友页平滑迁移到成熟 Chat UI 框架”。assistant-ui 的 ExternalStoreRuntime 明确要求应用提供自己的 messages、`onNew`、`isRunning` 和 `convertMessage`；`ThreadMessageLike` 支持稳定 `id`、`role`、text content、message `status` 和 metadata。Message Conversion 文档也把外部消息转换成 runtime message 作为独立 API，而不是要求业务后端直接长成 assistant-ui 内部状态。AG-UI 的事件模型则继续承担 agent-to-ui 事件协议层。

对 Ralphloop 的实现结论：

- 不在这一轮直接安装 React / assistant-ui 包，避免扩大构建系统和页面迁移范围。
- 在 `apps/share-web/src/runtime/agUiExternalStore.ts` 先沉淀纯函数 adapter：AG-UI event stream → assistant-ui ExternalStore 可消费的 text messages。
- `RUN_STARTED.input.messages` 变成 user/system/assistant message；`TEXT_MESSAGE_*` 按 `messageId` 合并为 assistant message；未终止 run 标记 `{ type: "running" }`，完成标记 `{ type: "complete" }`，错误或取消标记 `{ type: "incomplete" }`。
- `CUSTOM` 事件保留为 side-channel runtime data，但会移除 `tokenHash`、`deviceKey`、`bootstrap`、`cost`、`budget` 等字段，保证未来 React runtime 不把敏感材料带进前端 state。
- `createSharePageModel()` 已能消费该 external store，这为后续把页面替换成 `useExternalStoreRuntime` + `Thread` 留出直接迁移路径。

参考链接：

- https://www.assistant-ui.com/docs/runtimes/custom/external-store
- https://www.assistant-ui.com/docs/api-reference/external-store/message-conversion
- https://docs.ag-ui.com/sdk/js/core/events

## 2026-05-25 assistant-ui ExternalStore transport callbacks 补充研究

本轮继续把迁移边界从“消息转换”推进到“运行时回调”。assistant-ui 的 ExternalStoreRuntime 文档把自有 store 集成拆成三部分：`messages`、`isRunning` 和 callbacks，其中新增消息由 `onNew` 交给业务 transport，取消由 `onCancel` 交给业务 runtime。Message Conversion 文档则说明外部消息需要转换为 `ThreadMessageLike`，这和上一轮的 `createAssistantUiExternalStoreFromAgUiEvents()` 正好衔接。AG-UI 事件模型继续作为 transport 返回的标准输出格式，前端不应该直接消费 Ralphloop 内部 `task.output`。

对 Ralphloop 的实现结论：

- 新增 `createFriendAgUiRuntimeClient()`，把未来 assistant-ui `useExternalStoreRuntime` 需要的 transport callbacks 先做成纯 TypeScript 边界。
- `onNew()` 只接受文本 message，把 `{ sessionId, prompt }` 发送到 `/v1/share/:token/tasks`，随后用真实 `task.id` 请求 `format=ag-ui` events 并转换成 ExternalStore state。
- `onCancel()` 只取消当前 active task，调用 `/v1/share/:token/sessions/:sessionId/cancel` 后再读取同一 task 的 AG-UI 取消事件。
- `loadEvents()` 是恢复当前 task 的单独入口，固定请求 `format=ag-ui`，确保未来 React runtime、当前 server-rendered 页面和测试都共享同一个事件语义。
- transport 请求体不能包含成本、预算、host auth、device key、bootstrap secret 或创建者内部策略字段；朋友侧只提供 session、prompt 和当前 taskId。

参考链接：

- https://www.assistant-ui.com/docs/runtimes/custom/external-store
- https://www.assistant-ui.com/docs/api-reference/external-store/message-conversion
- https://www.assistant-ui.com/docs/runtimes/custom/overview
- https://docs.ag-ui.com/sdk/js/core/events

## 2026-05-25 assistant-ui 分享入口 follow-up 补充研究

本轮继续复核成熟 Chat UI 的交互契约。assistant-ui 的 ExternalStoreRuntime 文档把 `onNew` 和 `onCancel` 放在 runtime callbacks 中，说明“用户发消息”和“用户停止运行”都应该进入业务 transport，而不是只改前端状态。ComposerPrimitive 文档把 Enter 提交、Shift+Enter 换行作为标准输入体验；AG-UI 事件文档则用 `RUN_STARTED`、`TEXT_MESSAGE_*`、`RUN_FINISHED` 绑定同一个 `runId` 的生命周期。

对 Ralphloop 的实现结论：

- assistant-ui 分享入口的 MVP 不能停在只读 SSR；朋友必须能在同一页面继续发送 follow-up。
- follow-up 提交时必须先拿到真实后端 `taskId`，页面轮询终态必须绑定这个 task/run，而不是只看整个 Session 是否存在任何 completed run。
- 同一 Session 的旧任务 events 可以用于恢复历史消息，但不能覆盖正在发送的新消息，也不能让新任务停止轮询。
- AG-UI 事件仍是 UI 恢复的唯一语义层：新任务输出回来后，用完整 Session 的 `format=ag-ui` events 重建 message list，保证第一轮和第二轮消息一致展示。
- 这一轮仍是 server-rendered 页面上的渐进增强；后续 React hydration 时应把同一逻辑收敛到 `createFriendAgUiRuntimeStore()` 的 `onNew/onCancel`，避免出现两套提交状态机。

参考链接：

- https://www.assistant-ui.com/docs/runtimes/custom/external-store
- https://www.assistant-ui.com/docs/api-reference/primitives/composer
- https://docs.ag-ui.com/sdk/js/core/events

## 2026-05-25 assistant-ui 分享入口停止态补充研究

本轮继续聚焦用户直接可感知的运行态控制。assistant-ui 的 ExternalStoreRuntime 文档明确指出 `onCancel` 是“生成中取消按钮”的能力开关；ComposerPrimitive 文档也把 Cancel 作为标准 primitive。AG-UI runtime options 同样提供 `onCancel`，说明取消必须穿透到运行时，而不是只隐藏按钮或改前端文案。

对 Ralphloop 的实现结论：

- assistant-ui 分享入口的停止按钮必须和普通朋友页一样进入 `/v1/share/:token/sessions/:sessionId/cancel`，并通过 Relay 排入 outbound `session.cancel` command。
- UI 事件流重建时要把 AG-UI `ralphloop.run.cancelled` / `RUN_FINISHED(status=cancelled)` 转成可读的 “任务已取消。” assistant message，否则朋友只能看到状态变了，看不到对话内终态。
- Relay 的 `cancelTasksForSession()` 不能把同一 Session 中已经 completed/failed 的历史任务改成 cancelled；否则 AG-UI 恢复会在旧消息后插入错误的取消消息，破坏多轮上下文可信度。
- 当前 server-rendered assistant-ui 入口已经具备最小 `onNew/onCancel` 行为；后续 React hydration 时应把这两条路径迁移到同一个 ExternalStoreRuntime transport，避免 server-rendered 脚本和 React runtime 状态机分叉。

参考链接：

- https://www.assistant-ui.com/docs/runtimes/custom/external-store
- https://www.assistant-ui.com/docs/api-reference/primitives/composer
- https://www.assistant-ui.com/docs/runtimes/ag-ui/runtime-options

## 2026-05-25 assistant-ui 分享入口多 Session 补充研究

本轮继续对齐“朋友也是需要 Session”的产品要求。assistant-ui 的 ThreadListPrimitive 文档把 `ThreadListPrimitive.New` 和 `ThreadListPrimitive.Items` 定义为多对话列表的基础组件；ExternalStoreRuntime 文档提醒 `currentThreadId` 必须和业务 store 的当前 thread 保持同步，否则消息会进入错误 thread。AG-UI runtime options 也把 `onSwitchToNewThread` 作为创建新 thread 的回调边界。

对 Ralphloop 的实现结论：

- assistant-ui 分享入口不能只把左侧 rail 做成静态装饰；New Thread 必须创建真实 Ralphloop 后端 Session。
- Ralphloop 的 `sessionId` 继续直接作为 assistant-ui `threadId`，避免前端自造 id 造成 `/tasks`、`/events` 和 Host command 绑定错位。
- 当前 server-rendered 渐进增强层需要维护一个最小 thread store：每个 thread 保存 `sessionId`、`activeTaskId`、状态、message HTML 和 message count；切换 thread 时先保存当前快照，再恢复目标 Session。
- 新 Session 发送消息后仍走同一 Host outbound 链路，Host 输出通过 AG-UI events 回填；切回旧 Session 时旧消息必须独立恢复，不能混入新 Session 的 prompt 或 Agent 输出。
- 后续 React hydration 应把这套临时 thread store 收敛到 `ExternalStoreThreadListAdapter`，并保留同样的浏览器 e2e 防止 session 串线。

参考链接：

- https://www.assistant-ui.com/docs/api-reference/primitives/thread-list
- https://www.assistant-ui.com/docs/runtimes/custom/external-store
- https://www.assistant-ui.com/docs/runtimes/ag-ui/runtime-options

## 2026-05-25 assistant-ui 分享入口刷新恢复补充研究

本轮继续补齐 Chatbot 产品最容易被忽略的“会话连续性”。assistant-ui Threads 文档说明 runtime 初始只有一个内存 thread；如果使用 ExternalStoreRuntime，多 thread 历史必须由业务 store 提供，并且 runtime 的 `currentThreadId` 必须和应用选中的 thread 同步。AG-UI runtime 文档说明事件流会把 `RUN_STARTED`、`TEXT_MESSAGE_START/CONTENT/END`、`RUN_FINISHED` 映射成 assistant-ui state，因此 Ralphloop 不需要在本地持久化完整消息 HTML，也可以用后端 `format=ag-ui` events 恢复非当前 Session 的对话。

对 Ralphloop 的实现结论：

- 当前 server-rendered assistant-ui 入口先采用“本地 thread index + 后端事件恢复”的混合方案：`localStorage` 只保存同一 share token 下朋友浏览器已见过的 `sessionId`、标题、状态、active task 和 message count。
- 刷新当前 URL 时，页面先从 SSR 恢复当前 Session，再读取本地 thread index 恢复左侧 rail；对有 active task 的非当前 Session，调用 `GET /events?format=ag-ui` 重建用户消息、Agent 输出和终态。
- 这种方式不会枚举整个 share link 下的所有朋友 Session，也不会把 host auth、device key、bootstrap secret、成本、预算或创建者策略写入朋友端。
- 长期 React 迁移时，这个本地 index 应收敛到 `ExternalStoreThreadListAdapter` 或云端朋友身份；但这一轮先用浏览器 e2e 固定刷新不丢 Session 的产品底线。

参考链接：

- https://www.assistant-ui.com/docs/runtimes/concepts/threads
- https://www.assistant-ui.com/docs/runtimes/custom/external-store
- https://www.assistant-ui.com/docs/runtimes/ag-ui/runtime-options

## 2026-05-25 assistant-ui 分享入口异常态补充研究

本轮继续补齐“朋友侧体验和 QA 流程要严谨”的要求。assistant-ui 的 ExternalStoreRuntime 文档把 `onNew` 定义为用户新消息进入业务 transport 的异步边界，并在常见问题里明确提到 broken async handling 会导致状态不更新。assistant-ui 还提供 ErrorPrimitive 作为渲染 runtime/thread/message 失败的 UI 边界。AG-UI 事件模型也把 `RUN_ERROR` 作为标准终态事件，说明失败应该以用户可理解的 UI 状态进入对话，而不是让网络异常或内部错误冒泡到页面。

对 Ralphloop 的实现结论：

- assistant-ui 分享入口提交任务时，用户消息必须先进入 thread；后续 `/tasks` 请求失败只能追加友好 assistant 失败消息，不能删除用户刚输入的内容。
- fetch 抛错和 HTTP 非 2xx 都收敛成同一产品语义：状态 `failed`、发送按钮恢复可用、消息为“任务提交失败，请稍后重试。”。
- 前端不能把 `TypeError`、网络内部细节、host auth、device key、bootstrap secret、成本或预算字段写入 DOM，也不能留下 unhandled rejection。
- 后续 React hydration 时，这条逻辑应进入 ExternalStoreRuntime 的 `onNew` transport callback，并使用 ErrorPrimitive 或等价 UI 呈现，而不是散落在组件层。

参考链接：

- https://www.assistant-ui.com/docs/runtimes/custom/external-store
- https://www.assistant-ui.com/docs/api-reference/primitives/error
- https://docs.ag-ui.com/sdk/js/core/events

## 2026-05-25 assistant-ui 分享入口键盘取消补充研究

本轮继续对齐成熟 Chat UI 的键盘交互。assistant-ui ComposerPrimitive 文档说明 `ComposerPrimitive.Input` 默认 `submitMode="enter"`，键盘语义是 Enter 发送、Shift+Enter 换行、Escape 发送取消动作；同页 `ComposerPrimitive.Cancel` 也把取消作为 composer 的一等 action。AG-UI runtime options 继续把 `onCancel` 作为运行时回调边界，说明 Escape 不能只改前端状态，必须进入 Ralphloop 的 cancel transport。

对 Ralphloop 的实现结论：

- 当前 server-rendered assistant-ui 入口需要把 Escape 绑定到与停止按钮相同的 `cancelCurrentThread()`，避免按钮取消和键盘取消形成两套行为。
- Escape 仅在当前 thread `running` 时生效；触发后调用 `/v1/share/:token/sessions/:sessionId/cancel`，并复用现有取消消息和 AG-UI 事件刷新路径。
- 这保持了 assistant-ui 默认 composer 语义，也让朋友在输入框禁用的 running 状态下仍能用键盘停止当前任务。
- 后续 React hydration 时应把该行为收敛到 `ComposerPrimitive.Input` 的默认 `cancelOnEscape` 和 runtime `onCancel`，浏览器 e2e 继续防止回归。

参考链接：

- https://www.assistant-ui.com/docs/api-reference/primitives/composer
- https://www.assistant-ui.com/docs/runtimes/ag-ui/runtime-options
- https://www.assistant-ui.com/docs/runtimes/custom/external-store

## 2026-05-25 assistant-ui 浏览器运行时边界补充研究

本轮继续处理“朋友页不能继续靠 gateway 里的大段内联脚本扩展”的工程边界。assistant-ui 的 ExternalStoreRuntime 适合放在前端应用层，AG-UI 事件转换也已经沉淀在 `apps/share-web/src/runtime`；因此浏览器运行时代码继续留在 `apps/share-gateway/src/productization/httpServer.ts` 会让 HTTP gateway 同时承担页面服务、DOM 状态机、thread store 和 transport adapter，后续 React 化会更难迁移。

对 Ralphloop 的实现结论：

- 新增 `apps/share-web/src/pages/share/assistantUiClientScript.ts`，由 `createAssistantUiShareClientScript()` 统一导出当前 assistant-ui 分享入口的浏览器运行时代码。
- `apps/share-gateway/src/productization/httpServer.ts` 只负责渲染 HTML、注入 state 和引入 `share-web` 导出的 client script，不再定义 `assistantUiShareClientScript()`。
- 新增边界测试锁定该结构：脚本必须保留 `assistant-ui-state`、本地 thread index、`format=ag-ui`、运行中加载态、stale session、任务提交失败和取消文案；同时 gateway 不能重新出现旧的内联函数。
- 这仍不是最终 React hydration，但已经把可迁移的朋友侧浏览器逻辑移入 `share-web` ownership，为后续引入 Vite/React bundle 或 assistant-ui primitives 留出清晰入口。

验收记录：

- `node scripts/test.mjs apps/share-web/test/assistant-ui-client-script.test.ts`：通过，验证 client script ownership 与安全字段不泄漏。
- `node scripts/test.mjs apps/share-web/e2e/assistant-ui-share-entry-browser.test.ts`：隔离重跑通过 10 条真实浏览器用例，覆盖桌面/移动布局、follow-up、加载态、异常态、停止、Escape、多 Session 和刷新恢复。

## 2026-05-25 assistant-ui 桌面预览 Drawer 补充研究

本轮继续补齐“桌面 Agent 运行时包裹成网页”的核心体验。成熟 Agent Chat 页面不应该把预览常驻压缩主对话区，但朋友在需要观察 Host 行为时必须能从对话中打开只读预览。Ralphloop 已有 `/v1/share/:token/preview` 的安全边界和普通朋友页 drawer，因此 assistant-ui 分享入口也应复用同一产品语义，而不是只提供纯聊天区。

对 Ralphloop 的实现结论：

- assistant-ui React shell 新增 `assistant-ui-preview-toggle`、`assistant-ui-preview-drawer`、`assistant-ui-preview-close` 和 `assistant-ui-preview-frame`，默认关闭，不占用主对话宽度。
- `createAssistantUiShareClientScript()` 复用当前 token、`sessionId` 和 active `taskId` 请求 `/v1/share/:token/preview`；无预览、预览过期或请求失败时只显示“只读预览”，不泄露内部错误。
- 打开/关闭 drawer 不改变当前 thread、message count 或 session list；切换 thread 时如果 drawer 已打开，会按新 thread 的 active task 刷新预览。
- 固定浏览器 e2e 现在覆盖 assistant-ui 桌面 viewport 下预览 drawer 默认隐藏、点击后进入 viewport、关闭后恢复隐藏，避免把“预览按钮存在”误验收成“预览真的可用”。

验收记录：

- `node scripts/test.mjs apps/share-web/test/assistant-ui-react-shell.test.ts apps/share-web/test/assistant-ui-client-script.test.ts`：通过，验证 SSR shell 和 client script 都包含预览运行时边界。
- `node scripts/test.mjs apps/share-web/e2e/assistant-ui-share-entry-browser.test.ts`：通过 10 条真实浏览器用例，新增覆盖 assistant-ui 预览 drawer 打开/关闭。

## 2026-05-25 默认分享 URL 指向 assistant-ui 补充研究

本轮继续处理“朋友真正点击创建者发出的链接时看到什么”的交付问题。此前 `/app/share/:token/assistant-ui` 已经具备更完整的 Agent Chat 行为，但创建者创建链接和 dev outbound 输出的默认 URL 仍是 `/app/share/:token`，这会让朋友继续进入旧体验，削弱前面所有 assistant-ui 产品化工作的价值。

对 Ralphloop 的实现结论：

- `createOwnerShareLinkV1()` 返回的 `shareLink.url` 改为 `/app/share/:token/assistant-ui`，让创建者复制出去的链接默认进入新版对话页。
- `dev:productized:outbound` 输出的 `friendUrl` 同步改为 assistant-ui URL，方便本地 dogfood 时直接体验新版入口。
- 旧的 `/app/share/:token` 仍保留，作为兼容入口和已有脚本级 friend page 测试对象；本轮不做破坏性跳转。
- Owner 页面创建链接后优先使用后端返回的 `shareLink.url`，并在当前页面会话内把刚创建的链接同步到列表里的“打开对话页”。历史链接不伪造 URL，因为 Relay 不持久化 raw token。

验收记录：

- `node scripts/test.mjs apps/share-gateway/test/productization/routes.test.ts apps/share-gateway/test/productization/httpServer.test.ts apps/share-gateway/test/productization/devOutbound.test.ts`：通过 48 条，验证 API、Owner 页面和本地 dev loop 都输出 assistant-ui 分享 URL。

## 2026-05-25 浏览器 QA Harness 稳定性补充研究

本轮全量回归暴露了一个会影响交付判断的问题：多个 e2e 文件并发启动 headless Chrome 时，Chrome 进程已经存在，但 5 秒内未必能从 `/json/list` 看到 page target；旧 harness 会直接失败，并且在连接失败后没有清理 Chrome 进程和临时 profile，导致后续测试挂住。这类假失败会破坏“QA — 迭代 — QA”闭环。

对 Ralphloop 的实现结论：

- `launchChrome()` 在 `connectToFirstPage()` 失败时必须杀掉 Chrome 并删除临时 `userDataDir`，避免失败后遗留进程。
- `connectToFirstPage()` 等待窗口从 5 秒提高到 15 秒，并在 `/json/list` 暂无 page target 时调用 `/json/new?about:blank` 创建 target。
- 这个修复不改变产品行为，但提升了固定浏览器 QA 在并发全量回归下的可信度。

验收记录：

- `npm run test:e2e`：通过 17/17，验证所有浏览器 e2e 文件可并发完成。
- `npm test`：通过 196/196，验证浏览器 harness 修复后全量回归不再因 Chrome target 竞态挂住。

## 2026-05-25 真实 OpenCode 输出链路补充研究

本轮真实 dogfood 暴露了一个比页面样式更关键的问题：`RALPHLOOP_ADAPTER_MODE=real` 下，OpenCode adapter 会启动 `opencode run --attach ... --format json`，但旧实现没有给该命令传超时，也没有保存 stdout。结果是两类失败都会被朋友感知为“没有后续”：CLI 长时间不返回时 Host command 一直 pending；即使 CLI 成功返回，`streamEvents()` 也只能发 completed，朋友页拿不到真实模型输出。

对 Ralphloop 的实现结论：

- OpenCode adapter 与 Codex adapter 对齐：`submitTask()` 保存命令结果，`streamEvents()` 从 JSONL stdout 提取文本，映射为 `task.output` 后再发 `task.completed`。
- OpenCode 失败输出优先使用 stderr 或 JSON error message，映射为 `task.failed`，朋友页继续通过现有 AG-UI 转换展示友好失败态。
- `opencode run` 增加 120 秒超时并继续传入 `AbortSignal`；朋友主动停止时仍可中断 active task，真实 CLI 长时间不返回时也不会无限等待。
- 本轮真实 Codex dogfood 创建了只允许 `codex` 的分享链接，任务输出 `RALPHLOOP_QA_REAL_OK` 已通过 `/v1/share/:token/events?format=ag-ui` 和 assistant-ui 页面 SSR 验证，说明“本地 Agent output -> Relay -> 朋友页 Agent bubble”链路已打通。

验收记录：

- `node scripts/test.mjs apps/share-gateway/test/adapters/opencode.test.ts`：RED 时 5 pass / 3 fail；GREEN 后 8 pass / 0 fail。
- 真实本机链路：`RALPHLOOP_ADAPTER_MODE=real PORT=5207 npm run dev:productized:outbound`，创建 `local-friend-2` Codex 分享链接，提交“只输出字符串 RALPHLOOP_QA_REAL_OK”，AG-UI events 返回 `TEXT_MESSAGE_CONTENT: RALPHLOOP_QA_REAL_OK`，assistant-ui 页面 SSR 渲染 2 条消息。
- 浏览器截图证据：`.gstack/qa-reports/browser-screenshots/ralphloop-real-codex-assistant-ui-5207.png`，桌面视口 `scrollWidth=1440/clientWidth=1440`，无 console error。

## 2026-05-25 旧朋友入口兼容桥补充研究

本轮继续处理实际 dogfood 中暴露的入口问题：用户浏览器可能仍停在旧的 `/app/share/:token`，而默认分享 URL 已经切到 `/assistant-ui`。直接删除旧页会破坏现有停止、多 Session、异常态等回归测试；但让误入旧链接的朋友继续停留在旧体验，也会让产品观感不一致。

对 Ralphloop 的实现结论：

- 旧 `/app/share/:token` 保留为兼容页和回归测试面，但首屏 header 增加“新版对话”入口，直接指向 `/app/share/:token/assistant-ui`。
- 该入口使用 `data-testid="friend-assistant-ui-link"` 固定，便于浏览器 e2e 验收；链接不携带成本、预算、tokenHash、deviceKey、bootstrap 或 host auth。
- 新增固定浏览器 e2e：打开旧入口、点击“新版对话”、等待 URL 进入 `/assistant-ui`，并断言 assistant-ui shell 渲染。
- 下一步若确认旧 friend 页已无测试价值，可以把旧入口升级为 server-side redirect；当前先采用兼容桥，降低回归风险。

验收记录：

- `node scripts/test.mjs apps/share-gateway/test/productization/httpServer.test.ts --test-name-pattern "productized web pages expose owner and friend flows without friend cost fields"`：RED 时 32 pass / 1 fail；GREEN 后 33 pass / 0 fail。
- `node scripts/test.mjs apps/share-web/e2e/friend-session-browser.test.ts --test-name-pattern "legacy friend browser page links into assistant-ui chat"`：4 pass / 0 fail。

## 2026-05-25 裸分享 URL 默认重定向补充研究

本轮继续复核 assistant-ui、AG-UI 和 Vercel `ai-chatbot` 的当前形态：成熟 Agent Chat 的默认入口应直接进入 thread/session 体验，而不是先落到一个过渡控制台。assistant-ui 的 ExternalStoreRuntime 明确支持外部 thread store、`onCancel` 和 `isRunning`；AG-UI 的事件模型也以 `RUN_STARTED`、`TEXT_MESSAGE_*`、`RUN_FINISHED/RUN_ERROR` 这类 run lifecycle 驱动前端。因此 Ralphloop 的朋友链接默认进入 assistant-ui shell，才能让多轮 Session、运行态、取消态和真实 Agent output 成为第一屏体验。

对 Ralphloop 的实现结论：

- 裸 `/app/share/:token` 不再渲染旧 friend page，而是服务端 302 到 `/app/share/:token/assistant-ui`，并保留 query string，避免朋友点击旧格式链接时看到旧体验。
- 旧 friend page 迁到显式 `/app/share/:token/classic`，只作为回归、对比和迁移期 fallback 使用。
- assistant-ui 页面顶部的返回入口改为“打开经典页”，防止新版页面再把用户带回裸 URL 后循环重定向。
- 旧页仍保留 `friend-assistant-ui-link`，用于验证迁移期 fallback 可以回到新版对话页。

参考来源：

- assistant-ui ExternalStoreRuntime：https://www.assistant-ui.com/docs/runtimes/custom/external-store
- assistant-ui Threads：https://www.assistant-ui.com/docs/runtimes/concepts/threads
- AG-UI Events：https://docs.ag-ui.com/sdk/js/core/events
- Vercel ai-chatbot：https://github.com/vercel/ai-chatbot

验收记录：

- RED：把 `productized web pages expose owner and friend flows without friend cost fields` 改为要求裸 `/app/share/local-friend` 返回 302 后，测试失败为 `200 !== 302`，证明旧实现仍渲染 classic 页面。
- GREEN：新增 `/app/share/:token/classic` 显式兼容路由，并把裸 `/app/share/:token` 改为 302 到 `/assistant-ui`；固定浏览器新增默认链接重定向用例。

## 2026-05-25 默认入口首条消息补充研究

本轮继续检查“朋友拿到链接后的第一步”是否真的顺滑。assistant-ui 和 Vercel `ai-chatbot` 这类产品都把首次输入当成创建 thread 的自然动作：用户不应该先理解内部 `sessionId`，也不应该在左侧看到系统占位 thread。Ralphloop 的默认入口此前虽然会进入 `/assistant-ui`，但没有 `sessionId` 时会用 `assistant-ui-preview` 渲染空 shell；朋友发送第一条消息后，客户端创建了真实后端 Session，却没有移除 preview 占位，导致 rail 里同时出现一个假 thread 和一个真 thread。

对 Ralphloop 的实现结论：

- `assistant-ui-preview` 只能是 SSR 空壳占位，不是用户可管理的 thread。
- 当默认入口通过首条消息或 New Thread 创建真实 Session 时，客户端必须删除 preview 占位，再渲染真实 thread list。
- 本地 `localStorage` 持久化也必须过滤该占位 id，避免刷新后把假 thread 恢复出来。
- 首条消息提交成功后，URL 必须带真实 `sessionId/taskId`，后续刷新、切换和事件恢复都沿用真实 Session。

验收记录：

- RED：新增 `assistant-ui default share link can send the first message without keeping a preview thread` 后，浏览器 e2e 失败在 `data-thread-count`，实际 `2`、期望 `1`，证明 preview thread 泄露到 rail。
- GREEN：在 assistant-ui 客户端 runtime 中加入 preview thread 清理，`ensureThread()` 和 `createNewThread()` 从占位状态创建真实 Session 时都会删除 `assistant-ui-preview`；目标 e2e 通过。
