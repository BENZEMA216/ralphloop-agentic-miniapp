# Ralphloop 朋友侧 Agent 控制台产品化 Spec

> 状态：已被 `docs/superpowers/specs/2026-05-24-ralphloop-friend-chat-session-spec.zh.md` 替代。
>
> 原因：朋友页产品方向已从“Agent 控制台”调整为“多 Session Chatbot”。后续验收以新 spec 为准。

## 背景

Ralphloop 的第一版链路已经可以让创建者启动本地桌面 Agent Host，并把私密链接分享给朋友。当前问题是朋友打开链接后看到的是一个工程验证页：表单、预览、输出和确认队列都存在，但缺少成熟 Agent 产品应有的信息架构、运行反馈和视觉质量。用户会感觉它不像“我正在使用朋友分享的 Agent”，而像一个临时调试页面。

本阶段目标不是一次性迁移完整前端栈，而是把朋友侧页面重构成一个可用的 Agent 控制台，并为后续接入 React + assistant-ui + AG-UI 留出清晰边界。

## 外部参考与前端基础设施方向

- assistant-ui：React/TypeScript AI Chat UI 底座，提供 Thread、Message、Composer、ActionBar、附件、markdown、工具调用、审批和多后端 runtime 适配。适合作为 Ralphloop 后续正式 Web 前端的组件基础。
- AG-UI：Agent-User Interaction Protocol，定义 Agent 后端与用户界面之间的事件协议。适合 Ralphloop 统一 Codex、Claude Code、OpenCode、Hermes 等不同 Agent 框架的前端事件层。
- LangChain Agent Chat UI：成熟的 LangGraph Agent 聊天参考，可借鉴线程、HITL 和生产代理思路，但不作为 Ralphloop 核心底座，因为它强绑定 LangGraph。
- Open WebUI：完整自托管 LLM 聊天平台，不适合作为本阶段直接 fork 基座，因为产品边界更重，且和“分享桌面 Agent 运行时给朋友”不完全一致。

本阶段采用“协议先行、界面先产品化”的路径：当前 Node 服务继续 server-rendered HTML，页面结构对齐 assistant-ui/AG-UI 的概念模型；后续再把 `apps/share-web` 升级为 React/assistant-ui 实现。

## 第一版产品目标

朋友点开分享链接后，应看到一个完整的 Agent 使用控制台，而不是任务表单。页面必须让朋友马上理解：

1. 这是朋友分享给我的 Agent。
2. 当前可用的 Agent 框架是什么。
3. 我可以直接输入任务并提交。
4. Agent 运行时会显示明确状态、事件输出和桌面预览。
5. 高风险动作会进入确认队列。
6. 页面不显示成本、预算、计费、token 价格等创建者侧信息。

## 范围

### 本阶段包含

- 重构朋友侧 `/app/share/:token` 页面。
- 引入 Agent 控制台布局：左侧任务/会话，右侧桌面预览与权限确认，底部或主区域显示事件流。
- 将“任务表单”重命名为更自然的“给 Agent 一个任务”。
- 增加启动说明、运行状态、空状态、错误状态、输出事件流和只读桌面预览的产品化呈现。
- 保留现有 API：session、tasks、events、preview、confirmations。
- 增加 HTML 合约测试，确保页面包含 Agent 控制台结构和不泄露成本字段。
- 增加浏览器级验证，覆盖打开朋友链接、输入任务、提交、看到输出。

### 本阶段不包含

- 不引入完整 React 构建链。
- 不安装 assistant-ui 包。
- 不实现多线程历史、附件上传、语音输入或 markdown 渲染。
- 不把 Open WebUI/LangChain Agent Chat UI 直接 fork 到仓库。
- 不改变现有 Host 运行时协议或权限策略。

## 体验设计

朋友侧首屏采用工作台布局：

- 顶部：Ralphloop 标识、Agent 名称、运行模式标签、连接状态。
- 主任务区：任务输入框、提交按钮、当前任务状态、最近运行事件。
- 预览区：只读桌面预览，有清晰的空状态和图片/文本预览容器。
- 确认区：需要朋友确认的动作以操作卡出现，包含批准/拒绝按钮。
- 事件区：按时间顺序展示 Agent 输出，区分用户任务、运行中、完成、失败、系统事件。

视觉原则：

- 不做营销页，不做 hero；进入页面就是可操作控制台。
- 使用克制的工作台风格，避免过度装饰。
- 页面必须在桌面和移动端无重叠、无横向溢出。
- 控件尺寸稳定，提交按钮、状态标签、预览框不因动态内容发生明显跳动。
- 不出现成本提示。

## 技术设计

### 当前实现

`apps/share-gateway/src/productization/httpServer.ts` 继续负责 server-rendered owner/friend 页面。朋友侧页面会使用现有 endpoint：

- `POST /v1/share/:token/sessions`
- `POST /v1/share/:token/tasks`
- `GET /v1/share/:token/events`
- `GET /v1/share/:token/preview`
- `GET /v1/share/:token/confirmations`
- `POST /v1/share/:token/confirmations/:requestId/:action`

### 后续迁移边界

页面语义会向 assistant-ui/AG-UI 靠拢：

- Thread：当前 session/task 的事件流。
- Composer：任务输入与提交。
- Message：用户任务、Agent 输出、状态事件。
- Tool/HITL：确认请求卡片。
- Preview：桌面预览 panel。

当前 HTML class 和 `data-testid` 使用这些语义命名，后续 React 化时可以直接迁移组件边界。

## 验收标准

### 功能验收

- AC1：朋友页面包含 `agent-console-shell`、`agent-composer`、`agent-thread`、`agent-preview-panel`、`agent-confirmation-panel` 结构。
- AC2：朋友页面显示 Agent 名称、运行模式、只读预览状态和“给 Agent 一个任务”的输入区域。
- AC3：朋友提交任务后，页面显示运行状态，并渲染返回的事件输出。
- AC4：朋友确认队列仍可刷新、批准和拒绝。
- AC5：朋友页面不包含 `cost`、`budget`、`tokenHash`、`模型价格` 等成本或内部字段。
- AC6：页面移动端布局降为单列，桌面端为清晰的控制台布局。

### 测试验收

- T1：`apps/share-gateway/test/productization/httpServer.test.ts` 覆盖朋友页 HTML 合约。
- T2：`apps/share-web/test/share-page.test.ts` 覆盖朋友页产品模型不泄露成本信息。
- T3：`npm test` 全量通过。
- T4：`npm run lint`、`npm run typecheck`、`npm run build` 通过。
- T5：`npm run test:contract`、`npm run test:integration`、`npm run test:security`、`npm run test:e2e`、`npm run test:smoke:real-adapter` 通过。
- T6：浏览器打开 `http://127.0.0.1:5181/app/share/local-friend`，提交任务后可以看到输出，且页面无成本提示。

## 完成定义

只有当 spec、实现、自动化测试、浏览器验证和 git diff 检查都完成后，本阶段才算完成。如果任何验收项失败，必须继续修复，不能以“应该可以”结束。
