# 个人 Agent 分享产品化规格

日期：2026-05-21

## 1. 文档目的

本文档定义“个人 Agent 分享运行时”从本地 MVP 走向产品化 V1 的产品规格、系统边界和验收标准。

本地 MVP 已经证明：

- 创建者可以在本机打开分享入口。
- 系统可以通过 adapter 管理 OpenCode、Codex、Claude Code 等 Agent 框架。
- 创建者可以生成分享链接。
- 朋友可以打开网页提交任务。
- 朋友端不展示成本信息。
- 高风险动作策略可以在网关层建模。

产品化 V1 的目标不是做公开 marketplace，也不是做企业协作平台，而是把这个能力变成个人可以安全分享给朋友使用的真实产品：

> 创建者在自己的电脑上启动一个桌面 Agent Host，Host 连接云端 Share Relay。朋友打开私密链接，在网页里使用创建者配置好的 Agent 能力，看到任务进度、完整输出和必要的只读预览。创建者承担成本并保留撤销、审批、预算和审计控制。朋友默认使用自己的账号和身份权限，不默认继承创建者真实电脑和私人账号权限。

## 2. 术语

- 创建者：拥有并分享 Agent 能力的人。
- 朋友：通过分享链接使用 Agent 的人。
- Desktop Agent Host：创建者电脑上的本地应用或后台进程，负责启动和管理 Agent 框架、连接本地工具、采集预览、执行本地策略。
- Share Relay：云端中继和控制面，负责分享链接、身份、会话路由、策略、审计、限流和事件流。
- Friend Web：朋友打开的网页端产品。
- Owner Console：创建者管理分享链接、会话、审批和预算的界面。
- Agent Adapter：统一封装 Codex、Claude Code、OpenCode、Hermes、Agent Zero 等框架的启动、任务提交、事件流和停止能力。
- 使用者身份：朋友自己的 OAuth、浏览器会话、文件授权或业务账号。
- 创建者委托权限：创建者明确授权给某个链接或会话使用的账号、文件、浏览器状态或主机能力。

## 3. 产品化决策

### 3.1 采用混合架构

V1 采用：

```text
创建者本机 Desktop Agent Host
        |
        | outbound secure tunnel / websocket
        v
云端 Share Relay
        |
        v
朋友 Friend Web
```

选择原因：

- 纯本地分享：权限边界清楚，但朋友访问、NAT、证书、可用性和更新都很差。
- 纯云托管 Agent：体验最顺，但第一天就要承担模型成本、云沙箱、浏览器登录态、隐私和权限迁移问题。
- 混合模式：创建者保留本地 Agent 能力和已有配置，云端只做分享、路由、风控和产品体验，是个人用户最短可用路径。

### 3.2 默认不暴露创建者真实电脑

产品化 V1 不允许把创建者真实个人电脑裸露到公网。

必须满足：

- 本地 Host 只主动连接 Share Relay，不开放公网入站端口。
- 朋友不能直接访问本地 Host 的管理接口。
- 朋友不能直接操作创建者真实桌面。
- 桌面或浏览器预览默认只读。
- 交互模式必须由创建者对单个链接或会话显式打开。

### 3.3 朋友使用完整 Agent 能力，但不默认继承完整权限

朋友应该能正常使用创建者分享出来的 Agent 能力，包括框架、模型、工具链、工作流和运行上下文。

但权限来源必须拆开：

- 创建者提供：Agent 框架、模型配置、工具链、运行时、成本承担。
- 朋友提供：外部服务账号、OAuth、浏览器登录态、上传文件、任务输入。
- 创建者委托：仅在创建者明确开启时可用，且必须审批、审计、可撤销。

### 3.4 朋友端不展示成本

朋友端不得展示：

- token cost。
- dollar cost。
- 预算余额。
- 模型价格。
- 创建者付费计划。

额度耗尽、限流或风控触发时，朋友端只展示中性状态。

创建者端必须展示成本和限制。

## 4. V1 产品目标

V1 必须完成以下端到端闭环：

1. 创建者安装或启动 Desktop Agent Host。
2. Host 检测本机可用 Agent 框架，例如 OpenCode、Codex、Claude Code、Hermes。
3. 创建者在 Owner Console 中一键生成私密分享链接。
4. Share Relay 创建链接、默认策略、预算限制和会话入口。
5. 朋友打开链接，无需本地安装即可进入 Friend Web。
6. 朋友输入自然语言任务。
7. Share Relay 把任务路由到创建者的 Host。
8. Host 通过选定 Agent Adapter 启动或复用 Agent 运行时。
9. Agent 真实执行任务，并把计划、进度、输出和必要预览事件回传。
10. Friend Web 展示可理解的任务流和完整结果。
11. 高风险动作进入阻止、朋友确认或创建者审批。
12. 创建者可以暂停链接、撤销链接或终止会话。
13. 系统记录必要审计日志。

## 5. V1 非目标

V1 不做：

- 公开 Agent marketplace。
- 团队或企业 workspace。
- 让任意陌生人搜索和使用公开 Agent。
- 创作者结算平台。
- 朋友侧模型计费或充值。
- 完整企业 SSO、SCIM、合规报表。
- 默认远控创建者真实电脑。
- 默认继承创建者邮箱、浏览器登录态、私人文件或系统权限。
- 对所有 Agent 框架做深度功能等价支持。
- 移动端原生 App。

## 6. 目标用户和场景

### 6.1 创建者

创建者画像：

- 已经在本机使用 Codex、Claude Code、OpenCode、Hermes 或同类桌面 Agent。
- 愿意让熟悉的朋友临时使用自己的 Agent 能力。
- 愿意承担一部分模型或运行成本。
- 需要随时撤销、停止、审批和查看发生了什么。

创建者核心场景：

- 把自己配置好的研究 Agent 分享给朋友，让朋友完成一次调研。
- 把自己的代码 Agent 分享给合作者，让对方在隔离上下文中提需求。
- 把浏览器 Agent 分享给朋友，让朋友用自己的账号完成资料整理。
- 临时给朋友一个可用 Agent，而不是指导朋友安装一套复杂环境。

### 6.2 朋友

朋友画像：

- 不想安装 Agent CLI。
- 不懂模型、API key、provider 和运行时配置。
- 只想打开网页，输入任务，拿到结果。
- 在需要访问私人服务时，愿意登录自己的账号或授权自己的权限。

朋友核心场景：

- 打开链接。
- 输入任务。
- 看 Agent 如何工作。
- 必要时补充信息或确认动作。
- 获得完整输出。

## 7. 产品体验

### 7.1 创建者默认流程

创建者默认流程必须少于 4 个动作：

1. 打开 Desktop Agent Host 或 Owner Console。
2. 确认默认 Agent 框架。
3. 点击“生成分享链接”。
4. 复制并发送链接。

高级设置可以存在，但不得阻塞默认分享链路。

默认策略：

- 有效期：24 小时。
- 并发会话：1。
- 预览：只读。
- 权限模式：使用者身份。
- 高风险动作：阻止或审批。
- 朋友端成本：隐藏。

### 7.2 朋友默认流程

朋友默认流程：

1. 打开链接。
2. 看到 Agent 名称、状态、任务输入框。
3. 输入任务并提交。
4. 看到“已接收”“运行中”“需要确认”“已完成”等状态。
5. 展开只读预览，观察浏览器或桌面执行过程。
6. 在需要访问外部服务时连接自己的账号。
7. 在高风险动作前确认或等待创建者审批。
8. 获取完整输出。

朋友不需要看到：

- 创建者的模型配置。
- 创建者的 API key。
- token 和美元成本。
- 底层 Agent 框架完整管理 UI。

### 7.3 创建者控制面

Owner Console 必须提供：

- 分享链接列表。
- 链接状态：启用、暂停、撤销、过期。
- 当前活跃会话。
- 任务历史。
- 预算和用量。
- 审批队列。
- 高风险动作记录。
- 一键终止会话。
- 一键撤销链接。

## 8. 系统架构

### 8.1 模块边界

产品化 V1 包含五个核心模块：

1. Desktop Agent Host
2. Share Relay
3. Friend Web
4. Owner Console
5. Agent Adapter SDK

### 8.2 Desktop Agent Host

Desktop Agent Host 职责：

- 检测本机 Agent 框架。
- 启动、停止和复用 Agent runtime。
- 执行 Agent Adapter。
- 采集任务事件。
- 采集只读桌面或浏览器预览。
- 连接 Share Relay。
- 本地执行策略下发。
- 拒绝越权调用。
- 在断线时终止或挂起不安全会话。

Host 不应：

- 对公网开放入站 HTTP 管理端口。
- 让朋友直接连接本地服务。
- 默认读取创建者私人文件、浏览器 cookie 或系统凭证。
- 把本地原始日志无过滤透传给朋友。

### 8.3 Share Relay

Share Relay 职责：

- 创建和验证分享链接。
- 管理会话。
- 路由朋友任务到对应 Host。
- 路由 Host 事件到 Friend Web。
- 执行策略判断。
- 管理预算、限流和滥用防护。
- 管理朋友身份授权状态。
- 管理创建者审批。
- 写入审计日志。
- 在 Host 离线时给朋友返回可理解状态。

Relay 不应：

- 长期保存明文凭证。
- 让朋友绕过策略直连 Host。
- 把成本字段透传给 Friend Web。
- 把 owner-only 调试日志透传给朋友。

### 8.4 Friend Web

Friend Web 职责：

- 展示任务输入。
- 展示任务流、计划、进度、结果。
- 展示只读预览。
- 展示确认请求。
- 处理朋友身份授权入口。
- 展示链接不可用、Host 离线、任务失败等状态。

Friend Web 不应：

- 展示成本。
- 展示模型 key、provider 配置或创建者账号信息。
- 暴露底层 Agent 框架管理页面。
- 允许朋友直接修改创建者 Host 配置。

### 8.5 Owner Console

Owner Console 职责：

- 创建分享链接。
- 设置有效期、预算、并发、预览模式、权限模式。
- 查看任务和会话。
- 审批高风险动作。
- 暂停、撤销、终止。
- 查看审计和用量。

### 8.6 Agent Adapter SDK

Agent Adapter SDK 必须继续使用统一 contract，至少覆盖：

- `detect`
- `start`
- `submitTask`
- `streamEvents`
- `requestPreview`
- `stop`
- `classifyActionRisk`

第一批目标 adapter：

- OpenCode：优先作为 server/headless runtime。
- Codex：适合非交互任务和结构化事件。
- Claude Code：适合非交互任务和工具权限策略验证。
- Hermes：作为待安装和待验证 adapter。
- Agent Zero：作为桌面/浏览器预览参考适配。

## 9. 数据模型

### 9.1 Owner

字段：

- `id`
- `display_name`
- `plan`
- `created_at`
- `status`

### 9.2 Host

字段：

- `id`
- `owner_id`
- `device_name`
- `host_version`
- `status`: `online`、`offline`、`updating`、`blocked`
- `last_seen_at`
- `supported_adapters`
- `capabilities`

### 9.3 ShareLink

字段：

- `id`
- `owner_id`
- `host_id`
- `token_hash`
- `name`
- `status`: `active`、`paused`、`revoked`、`expired`
- `created_at`
- `expires_at`
- `revoked_at`
- `policy_id`

### 9.4 SharePolicy

字段：

- `id`
- `max_total_budget`
- `max_task_budget`
- `max_concurrent_sessions`
- `allowed_adapter_ids`
- `preview_mode`: `none`、`read_only`、`interactive`
- `permission_mode`: `user_identity`、`owner_delegated_explicit`
- `high_risk_action_mode`: `block`、`user_confirm`、`owner_approve`
- `blocked_actions`
- `approval_required_actions`
- `allowed_domains`
- `created_at`

### 9.5 Session

字段：

- `id`
- `share_link_id`
- `friend_actor_id`
- `host_id`
- `adapter_id`
- `runtime_id`
- `status`: `waiting`、`starting`、`running`、`needs_input`、`needs_user_auth`、`needs_user_confirm`、`needs_owner_approval`、`completed`、`failed`、`cancelled`
- `started_at`
- `ended_at`
- `last_event_at`

### 9.6 Task

字段：

- `id`
- `session_id`
- `prompt`
- `status`
- `created_at`
- `started_at`
- `completed_at`
- `result_ref`
- `failure_reason`

### 9.7 RuntimeEvent

事件类型：

- `session.started`
- `task.accepted`
- `task.plan`
- `task.progress`
- `task.output_delta`
- `task.result`
- `task.failed`
- `preview.frame`
- `permission.user_auth_required`
- `permission.user_confirm_required`
- `permission.owner_approval_required`
- `permission.blocked`
- `session.cancelled`
- `session.ended`

朋友端事件必须经过过滤，不得包含成本、凭证、owner-only 日志或敏感本机路径。

### 9.8 ApprovalRequest

字段：

- `id`
- `session_id`
- `task_id`
- `action_type`
- `permission_source`
- `summary`
- `risk_level`
- `status`: `pending`、`approved`、`denied`、`expired`
- `requested_at`
- `resolved_at`
- `resolved_by`

### 9.9 AuditLog

字段：

- `id`
- `owner_id`
- `share_link_id`
- `session_id`
- `actor_type`: `owner`、`friend`、`host`、`system`
- `event_type`
- `summary`
- `metadata`
- `created_at`

审计日志不得保存明文凭证。

## 10. 权限和风控

### 10.1 权限来源

系统必须能解释每一次敏感动作的权限来源：

- 使用者身份。
- 创建者委托权限。
- 运行时内部能力。
- 被策略禁止。

### 10.2 使用者身份模式

默认模式是使用者身份。

规则：

- 朋友需要访问邮箱、文档、日历、云盘、业务系统时，系统请求朋友授权自己的账号。
- 授权 scope 必须可解释。
- 高风险外部动作必须朋友确认。
- 创建者不能在朋友不知情的情况下借用朋友权限。

### 10.3 创建者委托权限模式

创建者委托权限是高风险增强，不是默认 V1 主路径。

如果 V1 提供，必须满足：

- 创建者对单个链接或会话显式开启。
- 权限范围可见。
- 可随时撤销。
- 所有敏感动作强制审批。
- 朋友端必须知道该任务可能使用分享者授权能力，但不展示敏感细节。

### 10.4 高风险动作

以下动作必须默认阻止、朋友确认或创建者审批：

- 发送邮件、消息、评论。
- 下单、付款、订阅、产生外部费用。
- 删除、覆盖、移动持久文件。
- 读取凭证、密钥、cookie。
- 访问创建者私人账号。
- 修改系统配置。
- 安装软件。
- 执行破坏性 shell 命令。
- 绕过预算、限流或策略。

不得只靠 prompt 约束高风险动作。策略必须在 Relay、Host 和 Adapter 层执行。

### 10.5 滥用防护

V1 必须具备：

- 链接有效期。
- 单链接并发限制。
- 单任务预算限制。
- 总预算限制。
- 请求频率限制。
- 会话超时。
- 创建者 kill switch。
- Host 离线熔断。
- 异常任务阻断。

## 11. API 和事件接口

### 11.1 Owner API

最小 API：

- `GET /owner/hosts`
- `GET /owner/adapters`
- `POST /owner/share-links`
- `PATCH /owner/share-links/:id`
- `POST /owner/share-links/:id/pause`
- `POST /owner/share-links/:id/revoke`
- `GET /owner/sessions`
- `POST /owner/sessions/:id/cancel`
- `GET /owner/approvals`
- `POST /owner/approvals/:id/approve`
- `POST /owner/approvals/:id/deny`

### 11.2 Friend API

最小 API：

- `GET /share/:token`
- `POST /share/:token/sessions`
- `POST /share/:token/tasks`
- `GET /share/:token/events`
- `POST /share/:token/confirmations/:id/approve`
- `POST /share/:token/confirmations/:id/deny`
- `POST /share/:token/auth/:provider/start`
- `GET /share/:token/preview`

Friend API 响应不得包含成本字段。

### 11.3 Host Relay Protocol

Host 与 Relay 使用出站长连接。

最小消息：

- `host.hello`
- `host.heartbeat`
- `host.capabilities`
- `runtime.start`
- `runtime.started`
- `task.submit`
- `runtime.event`
- `preview.frame`
- `approval.request`
- `approval.result`
- `session.cancel`
- `runtime.stop`

Host 必须能处理 Relay 下发的撤销、暂停、终止和策略更新。

## 12. 状态机

### 12.1 ShareLink 状态

```text
active -> paused -> active
active -> revoked
active -> expired
paused -> revoked
paused -> expired
```

规则：

- `revoked` 不可恢复。
- `expired` 不可恢复，只能重新创建链接。
- `paused` 不允许创建新任务。

### 12.2 Session 状态

```text
waiting -> starting -> running -> completed
waiting -> cancelled
starting -> failed
starting -> cancelled
running -> needs_input -> running
running -> needs_user_auth -> running
running -> needs_user_confirm -> running
running -> needs_owner_approval -> running
running -> failed
running -> cancelled
```

规则：

- 创建者撤销链接后，不允许新建 session。
- 创建者 kill session 后，Host 必须停止 runtime 或隔离任务。
- 朋友关闭页面不等于 session 自动结束；系统按策略超时回收。

## 13. 可观测性

产品化 V1 必须记录：

- Host 上下线。
- 分享链接创建、暂停、撤销、过期。
- Session 创建、运行、失败、取消、结束。
- Task 提交、完成、失败。
- 高风险动作请求和处理结果。
- 预算触发、限流触发。
- Host 断线和重连。

创建者可见：

- 任务摘要。
- 会话状态。
- 高风险动作记录。
- 用量和预算。

朋友可见：

- 当前任务状态。
- 可理解错误。
- 必要的确认请求。
- 完整输出。

## 14. 错误处理

### 14.1 Host 离线

朋友端展示：

```text
这个共享 Agent 暂时不可用，请稍后联系分享者。
```

创建者端展示 Host 离线原因、最近在线时间和重连建议。

### 14.2 链接不可用

朋友端对过期、撤销、暂停链接展示中性状态，不泄露 owner/runtime 信息。

### 14.3 任务失败

朋友端展示可理解失败原因，例如：

- Agent 启动失败。
- 运行时断开。
- 任务被策略阻止。
- 需要分享者处理。

不得展示敏感堆栈、密钥、绝对路径或 owner-only 日志。

### 14.4 预算或限流

朋友端只展示中性不可用状态。

创建者端展示具体预算、限流和用量原因。

## 15. 安全要求

V1 必须满足：

- 分享 token 只存 hash。
- Host 认证使用设备密钥或短期证书。
- Host 连接只能由本机主动发起。
- Relay 到 Host 的指令必须绑定 owner、host、session 和 policy。
- Friend API 必须校验 token、link 状态、session 状态和策略。
- Preview stream 必须与 session 绑定。
- 日志不得保存明文凭证。
- 朋友端不得看到 owner-only 日志、成本、密钥、模型配置。
- 高风险动作必须有结构化 policy gate。
- 所有撤销和 kill 操作必须优先级高于普通任务。

## 16. 产品化验收标准

### AC-001 Host 安装和连接

给定创建者已经安装 Desktop Agent Host；

当创建者登录 Owner Console；

则系统必须显示 Host 在线，并展示本机可用 adapter 清单。

### AC-002 一键生成私密分享链接

给定 Host 在线且至少一个 adapter 可用；

当创建者点击生成分享链接；

则系统必须创建一个 active 链接，应用默认策略，并返回可复制 URL。

### AC-003 朋友免安装访问

给定 active 分享链接；

当朋友在另一台设备或浏览器打开链接；

则朋友必须看到任务输入页，不需要安装本地运行时、配置模型或输入 API key。

### AC-004 真实任务执行

给定 Host 在线且选定 adapter 可用；

当朋友提交一个只读任务；

则任务必须被路由到 Host，并通过真实 Agent Adapter 执行，而不是 fake adapter。

### AC-005 任务进度和完整输出

给定任务正在执行；

当 Agent 产生事件或输出；

则 Friend Web 必须展示可理解的进度和最终完整结果。

### AC-006 只读预览

给定任务运行时有浏览器或桌面预览能力；

当朋友展开预览；

则系统必须展示只读预览，并禁止默认交互控制。

### AC-007 朋友端成本隐藏

给定朋友访问分享页、提交任务、查看事件和最终结果；

当检查页面、网络响应和事件流；

则不得出现 token cost、dollar cost、预算余额、模型价格或创建者付费计划。

### AC-008 创建者预算控制

给定创建者设置了单任务和总预算；

当任务用量达到限制；

则系统必须停止或拒绝继续执行，并在创建者端展示具体原因。

朋友端只显示中性不可用或任务停止状态。

### AC-009 高风险动作 gate

给定 Agent 尝试执行发送消息、支付、删除文件、读取凭证或破坏性 shell；

当策略要求确认、审批或阻止；

则系统必须进入对应状态，不得静默执行。

### AC-010 创建者撤销和终止

给定链接或会话正在使用；

当创建者撤销链接或终止会话；

则新任务必须立即被拒绝，运行中会话必须进入 cancelled 或 stopped，Host 必须停止对应 runtime。

### AC-011 Host 离线处理

给定 Host 断线；

当朋友打开链接或提交任务；

则朋友端必须展示中性不可用状态，Relay 不得泄露 Host 内部信息。

### AC-012 审计日志

给定完成一次任务；

当创建者查看审计日志；

则必须看到链接、会话、任务、状态变化、高风险动作、审批结果和失败原因的记录。

### AC-013 多 adapter 可演进

给定已实现一个 adapter；

当新增第二个 adapter；

则不应重写 Friend Web 的任务流、权限确认和结果展示核心逻辑。

### AC-014 断线重连

给定 Friend Web 或 Host 短暂断线；

当连接恢复；

则系统应该能恢复任务状态或展示明确的不可恢复状态。

## 17. 测试与验收绑定

产品化 V1 不允许只凭功能描述或人工判断完成验收。每条验收标准必须绑定必要测试用例，并在任务结束前提供新鲜验证证据。

验收通过必须同时满足：

1. 对应功能已经实现。
2. 对应自动化测试或明确的手工验证用例已经执行。
3. 测试输出显示通过，失败数为 0。
4. 如果某项暂时无法自动化，必须记录手工验证步骤、输入、观察结果和剩余风险。
5. 安全、成本隐藏、权限、撤销、审计类验收不得只依赖 UI 观察，必须检查 API 响应、事件流或日志。

### 17.1 测试分层

V1 必须至少包含以下测试层：

- 单元测试：策略判断、风险动作分类、token hash、状态机、事件过滤、成本字段脱敏。
- Contract 测试：Host Relay Protocol、Agent Adapter SDK、Friend API、Owner API 的请求和响应结构。
- 集成测试：Relay 到 Host、Host 到 Adapter、任务事件回传、撤销和终止、预算耗尽、Host 离线。
- 端到端测试：创建者生成链接、朋友打开链接、提交真实任务、看到进度和结果、创建者撤销。
- 安全测试：成本泄露扫描、owner-only 日志泄露扫描、越权 API 调用、预览只读限制、高风险动作阻断。
- 可观测性测试：审计日志、状态变化、审批记录、失败原因是否被正确记录。
- 兼容性测试：至少两个 adapter 通过同一套 adapter contract 测试，证明 Friend Web 不依赖单一框架。

### 17.2 验收标准到测试用例映射

| 验收标准 | 必要测试用例 | 通过条件 |
| --- | --- | --- |
| AC-001 Host 安装和连接 | Host 注册、心跳、adapter 上报集成测试；Owner Console 读取 Host 状态测试 | Owner Console 显示 Host 在线，adapter 清单来自真实 Host 心跳 |
| AC-002 一键生成私密分享链接 | Owner E2E；ShareLink 持久化测试；默认策略快照测试 | 点击一次生成 active 链接，重启后链接仍存在，默认策略完整 |
| AC-003 朋友免安装访问 | 无登录或轻登录浏览器 E2E；页面表单扫描 | 朋友端可打开任务页，页面不要求安装 runtime、模型配置或 API key |
| AC-004 真实任务执行 | Relay 到 Host 到真实 Adapter 集成测试；fake adapter 禁用测试 | 任务进入真实 adapter，测试能证明没有走 fake adapter |
| AC-005 任务进度和完整输出 | 事件流集成测试；Friend Web E2E；最终结果断言 | 朋友端收到 plan、progress、result 或明确失败状态 |
| AC-006 只读预览 | Preview stream E2E；交互事件拒绝测试 | 朋友能看到预览，默认点击、键盘、远控输入被拒绝 |
| AC-007 朋友端成本隐藏 | 页面、API 响应、SSE/WebSocket 事件、错误响应的敏感词扫描 | 不出现 token cost、dollar cost、预算余额、模型价格、创建者付费计划 |
| AC-008 创建者预算控制 | 预算状态机单元测试；预算耗尽集成测试；朋友端中性文案测试 | 达到限制后任务停止或拒绝，创建者看到原因，朋友看不到成本细节 |
| AC-009 高风险动作 gate | 风险动作策略表测试；发送消息、删除文件、读凭证、破坏性 shell 模拟测试 | 高风险动作进入确认、审批或阻止；没有静默副作用 |
| AC-010 创建者撤销和终止 | 撤销链接 E2E；运行中 session kill 集成测试；runtime stop 断言 | 新任务被拒绝，运行中任务停止，Host runtime 被停止或隔离 |
| AC-011 Host 离线处理 | Host 断线集成测试；朋友端错误响应扫描 | 朋友端显示中性不可用状态，不泄露 Host 内部错误或路径 |
| AC-012 审计日志 | 审计日志集成测试；审批记录测试；失败任务记录测试 | 创建者可看到链接、会话、任务、高风险动作、审批、失败原因 |
| AC-013 多 adapter 可演进 | Adapter contract 测试套件；第二 adapter 接入回归测试 | 新增 adapter 不需要改 Friend Web 任务流核心逻辑 |
| AC-014 断线重连 | Friend Web 重连 E2E；Host 重连集成测试；不可恢复状态测试 | 可恢复时恢复状态，不可恢复时展示明确状态 |

### 17.3 最小回归命令

当前本地 MVP 已有基础验证命令：

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

产品化 V1 实施过程中必须逐步补齐以下脚本或等价验证命令：

```bash
npm run test:contract
npm run test:integration
npm run test:e2e
npm run test:security
npm run test:smoke:real-adapter
```

如果某个脚本尚未存在，实施计划必须明确：

- 哪个阶段新增该脚本。
- 覆盖哪些 AC。
- 当前用什么等价命令或手工步骤替代。
- 什么时候不再允许手工替代。

### 17.4 安全和成本隐藏的强制验证

以下检查必须进入自动化测试，不能只靠人工验收：

- Friend Web HTML 不包含成本字段。
- Friend API JSON 不包含成本字段。
- SSE/WebSocket 事件不包含成本字段。
- 错误响应不包含 owner-only 堆栈、绝对路径、密钥、模型配置。
- Preview 默认只读，交互输入默认被拒绝。
- 撤销链接后旧 token 不能继续提交任务。
- 高风险动作不会在没有确认或审批时产生外部副作用。

### 17.5 阶段验收门槛

Phase 1 结束前必须通过：

- ShareLink、SharePolicy、Session、Task、AuditLog 的单元测试。
- Owner/Friend API contract 测试。
- 持久化重启测试。

Phase 2 结束前必须通过：

- Host 注册和心跳集成测试。
- Relay 到 Host 到真实 Adapter 的 smoke test。
- 真实 adapter 输出事件过滤测试。

Phase 3 结束前必须通过：

- 高风险动作策略表测试。
- 朋友确认和创建者审批 E2E。
- 审计日志测试。

Phase 4 结束前必须通过：

- 只读预览 E2E。
- 预览交互输入拒绝测试。
- Preview stream 与 session 绑定测试。

Phase 5 结束前必须通过：

- 预算、限流、超时、Host 离线、kill switch 集成测试。
- 一条真实朋友分享链路的端到端演示。
- 成本隐藏全链路扫描。

## 18. V1 实施阶段建议

### Phase 1：产品化协议和持久化

目标：

- 建立 Share Relay 数据模型。
- 建立 Host Relay Protocol。
- 把内存 share link 迁移到持久化。
- 增加 owner/friend API 边界。

完成标准：

- 重启服务后分享链接仍存在。
- Host 可以注册、心跳、上报 adapter。
- Friend Web 通过 Relay 读取链接状态。

### Phase 2：真实 Host 到 Relay 链路

目标：

- Desktop Agent Host 主动连接 Relay。
- Relay 可以把朋友任务发给 Host。
- Host 可以把 runtime event 回传 Relay。

完成标准：

- 朋友在网页提交任务。
- 任务在创建者本机真实 adapter 执行。
- 朋友看到真实事件和最终结果。

### Phase 3：权限和高风险动作闭环

目标：

- 高风险动作结构化识别。
- 朋友确认。
- 创建者审批。
- 审计日志。

完成标准：

- 发送消息、删除文件、读取凭证、破坏性 shell 均不会静默执行。

### Phase 4：只读预览

目标：

- Host 采集浏览器或桌面只读预览。
- Relay 传输预览。
- Friend Web 展示预览。

完成标准：

- 朋友能看到只读预览。
- 默认不能远控创建者电脑。

### Phase 5：可用性和风控

目标：

- 预算。
- 限流。
- 超时。
- Host 离线处理。
- kill switch。
- 错误文案。

完成标准：

- 可以给真实朋友使用一条链接完成一个只读任务。
- 创建者可以随时停止。
- 朋友端无成本泄露。

## 19. 当前本地 MVP 与产品化差距

已完成：

- 本地 HTTP 分享运行时。
- 创建者 `/owner` 页面。
- 朋友 `/share/local-friend` 页面。
- fake adapter 链路。
- Adapter registry。
- OpenCode、Codex、Claude Code adapter MVP。
- 高风险动作策略模型。
- 成本隐藏测试。
- MVP smoke test。

产品化待补：

- 云端 Share Relay。
- Desktop Agent Host 注册、心跳和出站隧道。
- 真实 adapter 接入 HTTP demo。
- 持久化数据模型。
- 创建者登录。
- 朋友身份或匿名会话模型。
- 朋友 OAuth / 使用者身份授权。
- 只读桌面或浏览器预览流。
- 预算、限流和滥用防护。
- 审计日志。
- 创建者审批 UI。
- Host 离线和断线重连。

## 20. 开放问题

以下问题不阻塞 V1 spec，但需要在实施计划前收敛：

1. 创建者登录第一版使用邮箱 magic link、GitHub 登录，还是本地-only token？
2. 朋友第一版是否完全匿名，还是需要输入昵称或邮箱？
3. 第一个真实 adapter 是 OpenCode server，还是 Codex/Claude Code 非交互任务？
4. 只读预览优先做浏览器页面截图流，还是完整桌面流？
5. 朋友身份授权第一批支持 Google、GitHub，还是先只做上传文件和手动输入？
6. V1 是否提供创建者委托权限，还是只在文档中保留为后续高风险模式？

## 21. 推荐默认答案

为降低 V1 风险，建议默认选择：

- 创建者登录：GitHub 或邮箱 magic link。
- 朋友访问：匿名链接 + 可选昵称。
- 首个真实 adapter：OpenCode server。
- 预览：先做浏览器或桌面截图流，只读。
- 朋友身份：第一版先支持文件上传和手动输入，OAuth 放到 V1.1。
- 创建者委托权限：V1 不开放，只做内部协议预留。

这个组合能最快证明产品化核心价值：

```text
创建者打开 Host -> 生成链接 -> 朋友网页提交任务 -> 本机真实 Agent 执行 -> 朋友看到进度和完整结果 -> 创建者可撤销和审批
```

## 22. 实施状态回写（2026-05-22）

本仓库的产品化推进以验证闭环为准；最新实施状态、Work Block 对应 commit hash、AC-001 到 AC-014 覆盖情况与验证命令结果，记录在：

- `docs/superpowers/plans/2026-05-22-ralphloop-overnight-validation-report.zh.md`
