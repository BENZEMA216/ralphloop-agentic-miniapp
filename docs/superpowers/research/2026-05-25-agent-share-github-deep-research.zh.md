# Ralphloop Agent Share GitHub 深度调研

日期：2026-05-25

## 1. 本轮问题

用户反馈当前朋友侧体验仍然像临时 demo：页面简陋、加载态弱、输出真实性不可信、Session 和消息一致性不扎实。用户明确要求继续在 GitHub 上深挖已有项目和实现，判断是否应该基于成熟框架重做 Agent Share 的前端与 runtime 链路。

本轮完成标准：

- 找到同类或相邻的开源项目，而不是只看通用 Chatbot UI。
- 区分产品形态、runtime 架构、前端能力、许可风险和可复用程度。
- 给出 Ralphloop 下一阶段的明确技术路线。
- 将测试/QA 验收继续绑定到“真实 Agent 输出、多 Session、异常、停止、刷新恢复、移动端”这些用户指出的关键失败点。

## 2. 调研方法

本轮使用两类证据：

- 在线 GitHub / Web 搜索：围绕 `Claude Code web UI`、`Codex remote control`、`OpenCode web UI`、`ACP UI`、`mobile agent client`、`tmux session WebUI`、`E2E encrypted relay` 等关键词检索。
- 本地浅克隆代码阅读：将重点项目 clone 到 `/tmp/ralphloop-github-research`，读取 README、package、license、workspace、关键协议和测试结构。

已重点读取的项目：

- [Happy](https://github.com/slopus/happy)
- [Happier](https://github.com/happier-dev/happier)
- [HAPI](https://github.com/tiann/hapi)
- [Yep Anywhere](https://github.com/kzahel/yepanywhere)
- [Paseo](https://github.com/getpaseo/paseo)
- [Kanna](https://github.com/jakemor/kanna)
- [ACP UI](https://github.com/formulahendry/acp-ui)
- [CloudCLI / Claude Code UI](https://github.com/siteboon/claudecodeui)
- [AionUi](https://github.com/iOfficeAI/AionUi)

同时补充参考：

- [assistant-ui](https://github.com/assistant-ui/assistant-ui)
- [LangGraph Agent Chat UI](https://github.com/langchain-ai/agent-chat-ui)
- [OpenACP](https://github.com/Open-ACP/OpenACP)
- [acpx](https://github.com/openclaw/acpx)
- [Codeman](https://github.com/Ark0N/Codeman)
- [Harnss](https://github.com/OpenSource03/harnss)

## 3. 核心结论

确实有大量相关项目，Ralphloop 不能继续把朋友侧页面当作 server-rendered 表单和少量内联脚本来迭代。这个方向已经形成了几个成熟范式：

1. 本地 daemon/CLI wrapper + 移动/Web 客户端 + relay：Happy、Happier、HAPI、Yep Anywhere、Paseo。
2. ACP 统一协议客户端：ACP UI、OpenACP、acpx、Harnss。
3. Claude/Codex 本地会话 Web UI：Kanna、CloudCLI / Claude Code UI。
4. PTY/tmux 终端会话管理：Codeman、CloudCLI、部分 Claude remote wrapper。
5. 通用 Chat UI primitives：assistant-ui、agent-chat-ui。

对 Ralphloop 来说，最佳路线不是直接 fork 某个完整产品，而是采用组合式架构：

- 产品 UX：对标 Happy/Happier/Yep Anywhere/Paseo 的“手机/网页继续本机 Agent”的体验。
- Runtime 边界：优先引入 ACP-compatible adapter，避免每个 Agent 都做私有消息协议。
- 前端基座：用 React + assistant-ui 或 Kanna 风格的成熟 Chat shell，放弃当前手写 DOM。
- 远程链路：保留 Ralphloop 的分享/权限/审计能力，但必须做成 host daemon + relay + session event store。

## 4. 项目矩阵

| 项目 | 相关度 | 产品形态 | 关键能力 | 许可/复用判断 | 对 Ralphloop 的建议 |
| --- | --- | --- | --- | --- | --- |
| Happy | 极高 | Mobile/Web client + local CLI wrapper + encrypted sync server | Claude/Codex 远程控制、端到端加密、推送、跨设备接管 | MIT，可认真研究代码复用 | 第一优先参考整体产品链路 |
| Happier | 极高 | Mobile/Web/Desktop + daemon/server + 多 provider | Claude/Codex/OpenCode/Gemini，协作 session、队列、handoff、嵌入终端、企业 auth | 根目录未见清晰 LICENSE，直接复用需谨慎 | 参考高级产品路线，不默认复制代码 |
| HAPI | 极高 | Local-first hub + Web/PWA/Telegram Mini App | Claude/Codex/Gemini/OpenCode、本地 native first、relay、terminal anywhere、workspace browser | AGPL-3.0，商业复用需非常谨慎 | 参考 host/hub/runner 分层和本地优先理念 |
| Yep Anywhere | 极高 | Self-hosted mobile-first Web UI | CLI session resume、文件上传、推送、E2E relay、tiered inbox、device streaming | README 标 MIT，但本地未见 root LICENSE，复制前需复核 | 参考朋友侧 inbox/session/approval 体验 |
| Paseo | 极高 | Daemon + Expo app + desktop + CLI + relay | 多 provider、本机 daemon、WebSocket API、Agent/Terminal/Relay、worktree、subagent | AGPL-3.0 | 参考 daemon 数据模型和多端架构 |
| Kanna | 高 | React Web UI + Bun server | Claude/Codex、多 provider input、EventStore、CQRS、WebSocket、session resume、tool rendering、terminal | package 标 MIT，但 LICENSE 有命名排除条款，需法务复核 | 最适合参考 React Chat UI 和 event store 结构 |
| ACP UI | 高 | Vue/Tauri/Web ACP client | ACP agent 配置、WebSocket remote agent、session/load、permissions、traffic monitor | MIT | 最适合参考多 Agent 协议边界 |
| CloudCLI / Claude Code UI | 高 | React Web IDE + server | Claude/Cursor/Codex/Gemini，会话、文件、Git、终端、插件、工具权限 | AGPL-3.0 | 参考完整 Web IDE 能力，不直接 fork |
| AionUi | 中高 | Electron/WebUI cowork app | 20+ agents、auto detect、team mode、MCP、远程入口、cron | Apache-2.0 | 参考多 Agent catalog、团队和 MCP 管理 |
| assistant-ui | 高 | React Chat primitives | Thread、Composer、Tool UI、ExternalStoreRuntime、AG-UI runtime | MIT | Ralphloop 朋友侧 React 基座首选 |
| agent-chat-ui | 中 | LangGraph Chat UI | 成熟 chat shell、streaming、thread | MIT | 可作为普通 agent chat UI 参考 |
| Codeman | 中 | tmux session WebUI | Claude/OpenCode in tmux，xterm.js，持久 session | MIT | 参考 PTY/tmux 终端承载 |
| Harnss | 中 | Desktop ACP/client UI | Claude/Codex/ACP agents、tool visualization、terminal、git、browser | MIT | 参考桌面工作台，不作为 friend MVP 基座 |

## 5. 对当前 Ralphloop 的诊断

当前实现的问题不只是样式丑，而是架构层级不够：

- friend 页面还在用 server-rendered HTML + 内联 JS 维护复杂 Chat runtime，状态机会越来越脆。
- Host 输出还没有足够强的真实 Agent 语义，用户看到 demo adapter 文案时会自然怀疑没有推理。
- Session 和 task 的边界仍偏“提交任务”，不是成熟 Agent Chat 的 `thread/run/event` 模型。
- 停止、加载、错误、刷新恢复、多 Session 并行，本质上都需要 event store 和 runtime store，而不是继续补 DOM patch。
- 桌面预览、终端、文件、Git 这些能力不能都塞进一个页面主区，应采用 Chat 主线 + 右侧 drawer / bottom panel 的模式。

## 6. 推荐架构

### 6.1 Host Daemon

创建者本机运行 Ralphloop Host Daemon。它负责：

- 发现并启动 Claude Code、Codex、OpenCode、Hermes、Gemini、ACP-compatible CLI。
- 管理本机 workspace、Agent provider、运行中 session、运行中 process。
- 提供本机 WebSocket / HTTP endpoint 给 relay 或本地网页。
- 把每个 Agent 的原始事件转换成统一 `AgentRuntimeEvent`。
- 支持 cancel、interrupt、resume、approval、permission mode、terminal attach。

这对应 Happy/HAPI/Paseo/Kanna 的共同模式：Agent 真正在本机跑，Web/手机只是控制面。

### 6.2 Relay / Share Gateway

Relay 不应只是转发任务，它要成为安全共享边界：

- 维护 share link、朋友 session、task/run、event store、审计日志。
- 对 friend token 做最小授权，不把创建者真实设备密钥、host auth、成本、内部策略下发。
- Host 和 friend 都通过 relay 交换 event，relay 可做断线恢复。
- 后续可加入 E2E encryption，但 MVP 至少要有 session-scoped event persistence。

### 6.3 Protocol Adapter

推荐新增一个协议适配层：

```text
Claude Code / Codex / OpenCode / Hermes / ACP CLI
        |
Provider Adapter
        |
Ralphloop AgentRuntimeEvent
        |
AG-UI / assistant-ui ExternalStoreRuntime
        |
Friend React Chat UI
```

其中：

- 对支持 ACP 的 Agent，优先走 ACP，而不是 PTY scraping。
- 对 Codex/Claude 等已有 SDK 或 app-server 的 Agent，保留 direct provider。
- 对只能 TUI 的工具，最后才使用 PTY/tmux/xterm.js 兜底。

### 6.4 Friend Frontend

朋友侧应重建为 React app，而不是继续维护内联脚本：

- 左侧 thread list / session rail。
- 中间 assistant-ui `Thread` + `Composer`。
- 右侧 desktop/terminal/file preview drawer。
- composer 必须内置 Enter 发送、Shift+Enter 换行、Escape 停止。
- 每个 run 必须有真实 loading bubble、streaming output、failed/cancelled/approval card。
- 所有输出从 AG-UI / ExternalStoreRuntime 进入，不直接读取内部 runtime event。

### 6.5 Owner Frontend

创建者侧至少要补齐：

- 当前在线 Host 列表。
- 分享链接列表、启停、权限、provider scope、session 数。
- 活跃朋友 session 观察。
- 审计日志。
- 可撤销链接、踢出 session、紧急停止所有运行中任务。

## 7. 代码复用策略

推荐分三类处理：

### 可考虑直接学习/复用的 MIT/Apache 项目

- Happy：MIT，产品链路高度吻合。
- ACP UI：MIT，协议边界很清晰。
- assistant-ui：MIT，朋友侧 Chat primitives。
- agent-chat-ui：MIT，可参考普通 Chat shell。
- AionUi：Apache-2.0，可参考多 Agent catalog 和 extension 管理。
- Codeman / Harnss：MIT，可参考终端/ACP/会话管理。

### 只能借鉴架构，不建议直接复制的项目

- HAPI：AGPL-3.0。
- Paseo：AGPL-3.0。
- CloudCLI / Claude Code UI：AGPL-3.0。

这些项目非常值得研究，但如果 Ralphloop 未来要做商业产品，直接复制代码会把许可证问题带进核心代码。

### 需要进一步确认许可证的项目

- Happier：根目录未见清晰 LICENSE，README 功能非常强，但直接复用前必须确认授权。
- Yep Anywhere：README 写 MIT，本地浅克隆未见 root LICENSE 文件，需要在复用前复核发布包和仓库许可。
- Kanna：package 标 MIT，但 LICENSE 中存在命名排除条款，不能按普通 MIT 直接处理。

## 8. 下一阶段实施计划

### Phase A：停止继续扩大 server-rendered friend page

目标：保住现有功能，但新能力不再往内联 JS 堆。

验收：

- 现有 `/app/share/:token/assistant-ui` 仍可运行。
- 新增 friend React app 目录和 build/dev harness。
- 现有 API 通过 adapter 被 React app 消费。

### Phase B：React + assistant-ui 朋友侧重建

目标：把朋友侧主体验换成成熟 Chatbot。

必须实现：

- thread list。
- thread switch。
- streaming / loading bubble。
- cancel / Escape。
- follow-up 多轮。
- failed friendly message。
- mobile responsive。
- preview drawer。

测试：

- 单元测试覆盖 AG-UI 到 assistant-ui message conversion。
- 浏览器 e2e 覆盖首次打开、follow-up、停止、失败、多 Session、刷新恢复、移动端。

### Phase C：真实 Host Daemon / Provider Adapter

目标：让朋友看到的输出来自真实本地 Agent，而不是 demo adapter。

必须实现：

- provider registry：Codex、Claude Code、OpenCode、Hermes、ACP generic。
- `submit/run/cancel/resume` provider contract。
- per-session process table。
- stdout/stderr/structured event 转 AG-UI。
- provider smoke test：真实本地可用时跑真实 adapter，不可用时跳过并给出原因。

测试：

- fake provider 覆盖并行、异常、取消。
- real provider smoke 覆盖用户本机已安装的 Agent。
- browser QA 必须断言 Agent bubble 中出现本地 adapter 真实输出，不允许只出现固定 demo 文案。

### Phase D：Relay 持久化与断线恢复

目标：服务重启、刷新、Host 短暂离线后，friend session 不直接失效。

必须实现：

- share/session/task/event store 持久化。
- task/run 状态机：queued/running/completed/failed/cancelled/stale。
- Host reconnect 后恢复 pending commands。
- friend URL 旧 `sessionId/taskId` 的友好恢复或明确失效提示。

测试：

- 服务重启后刷新恢复。
- Host offline/online。
- stale task 不覆盖新 run。
- cancelled 不能被 completed 迟到事件覆盖。

## 9. QA 验收升级

后续每轮功能迭代必须继续按“QA - 研究 - 迭代 - QA”闭环，但 QA 不应只跑脚本测试。至少需要四层：

1. Contract tests：runtime event、AG-UI event、assistant-ui store conversion。
2. Provider tests：fake provider + real provider smoke。
3. Browser e2e：桌面/移动真实页面交互、截图、console error 检查。
4. Product flow QA：创建者建链接、朋友打开、发多轮、停止、异常、刷新、并行 session、owner 撤销。

下一版最低测试清单：

- 朋友首次打开分享链接，自动获得 thread。
- 朋友发送第一条消息，页面出现 user bubble、loading bubble、真实 Agent output。
- 朋友发送 follow-up，历史消息保留，新的输出追加到同 thread。
- 朋友在 running 时点击停止和按 Escape，Host 收到 cancel，页面不出现取消后的 completed。
- 同一 thread 快速发送多个消息，按队列或明确 busy 策略处理，不丢、不串、不乱。
- 两个 thread 并行运行，输出按 sessionId/taskId 归属。
- 任务提交网络异常，保留用户消息，展示友好失败。
- 刷新页面，thread list 和历史事件恢复。
- 移动端无横向滚动，composer 不遮挡消息。
- Owner 页面能管理已有链接并看到活跃 session。

## 10. 最终建议

Ralphloop 的产品目标是“把我的桌面 Agent 运行时包裹成网页，分享给朋友安全使用”。从 GitHub 调研看，这不是空白问题，社区已经验证了需求和实现路径。当前 Ralphloop 应立即转向以下路线：

1. 用 Happy/Happier/Yep Anywhere/Paseo 作为产品标杆。
2. 用 ACP UI/OpenACP/acpx 作为多 Agent 协议参考。
3. 用 assistant-ui/Kanna 风格重做朋友侧 React Chat。
4. 用 Ralphloop 自己的 share link、权限、审计、session 隔离形成差异化。
5. 暂停继续在当前 server-rendered friend page 上堆复杂交互，只做兼容保底。

一句话：不是“没有现成项目”，而是现成项目已经足够多，下一步应该做架构换轨，而不是继续修补 demo 页面。
