# 多框架 Agent 运行时 Adapter MVP 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 做出第一版可分享的多框架桌面 Agent 运行时 MVP，让创建者打开分享器后可以选择可用 Agent 框架、一键生成链接，朋友打开链接提交任务并看到任务流输出。

**架构：** 分享网关不直接绑定某个 Agent 框架，而是通过 adapter registry 调用 OpenCode、Codex、Claude Code 等 adapter。第一版以 OpenCode headless server 作为首选 runtime，Codex 和 Claude Code 作为非交互任务 fallback；朋友端只通过分享网关访问任务流，不直接接触底层 Agent UI、密钥或成本信息。

**技术栈：** TypeScript/Node.js、HTTP/SSE 或 WebSocket、OpenCode CLI/server、Codex CLI、Claude Code CLI、Docker/Colima 作为后续 sandbox 基础。

---

## 1. 前置输入

必须先阅读：

- [中文需求规格](/Users/benzema/Documents/使用/docs/superpowers/specs/2026-05-20-personal-agent-share-runtime-requirements.zh.md)
- [多框架 Agent Adapter 盘点](/Users/benzema/Documents/使用/docs/superpowers/research/agent-framework-adapter-inventory.zh.md)

当前本机已验证：

- `codex` 已安装，版本 `codex-cli 0.130.0`。
- `claude` 已安装，版本 `2.1.145 (Claude Code)`。
- `opencode` 已安装，版本 `1.2.27`。
- `hermes` 未安装。
- Docker、Docker Compose、Colima 已安装。

## 2. 文件边界

建议新增或修改以下文件。具体路径可以根据最终项目结构调整，但必须保持责任边界一致。

### 后端/网关

- Create: `apps/share-gateway/src/adapters/types.ts`
  - 定义 adapter contract、runtime handle、task handle、event model。
- Create: `apps/share-gateway/src/adapters/registry.ts`
  - 检测本机可用 adapter，返回 adapter 清单。
- Create: `apps/share-gateway/src/adapters/opencode.ts`
  - 启动 `opencode serve`，提交任务，解析输出。
- Create: `apps/share-gateway/src/adapters/codex.ts`
  - 调用 `codex exec --json`，解析 JSONL 事件。
- Create: `apps/share-gateway/src/adapters/claude.ts`
  - 调用 `claude --bare -p --output-format stream-json`，解析事件。
- Create: `apps/share-gateway/src/policy/highRiskActions.ts`
  - 第一版高风险动作分类和模拟拦截。
- Create: `apps/share-gateway/src/routes/shareLinks.ts`
  - 分享链接创建、读取、暂停、撤销。
- Create: `apps/share-gateway/src/routes/tasks.ts`
  - 朋友端提交任务、订阅任务事件、取消任务。
- Create: `apps/share-gateway/src/routes/adapters.ts`
  - 创建者端获取 adapter 清单。

### 前端/朋友端

- Create: `apps/share-web/src/pages/share/[token].ts`
  - 朋友端任务页。
- Create: `apps/share-web/src/components/TaskComposer.ts`
  - 任务输入和提交。
- Create: `apps/share-web/src/components/TaskTimeline.ts`
  - 任务流状态展示。
- Create: `apps/share-web/src/components/PreviewPanel.ts`
  - 可展开预览区域，第一版只读占位。
- Create: `apps/share-web/src/components/PermissionPrompt.ts`
  - 使用者授权/确认和创建者审批状态展示。

### 创建者端

- Create: `apps/share-web/src/pages/owner/index.ts`
  - 创建者打开后看到可用框架和一键分享。
- Create: `apps/share-web/src/components/AdapterPicker.ts`
  - 可用 Agent 框架列表；只有一个可用框架时默认选中。
- Create: `apps/share-web/src/components/ShareLinkPanel.ts`
  - 生成、复制、暂停、撤销分享链接。

### 测试

- Create: `apps/share-gateway/test/adapters/registry.test.ts`
- Create: `apps/share-gateway/test/adapters/opencode.test.ts`
- Create: `apps/share-gateway/test/adapters/codex.test.ts`
- Create: `apps/share-gateway/test/adapters/claude.test.ts`
- Create: `apps/share-gateway/test/policy/highRiskActions.test.ts`
- Create: `apps/share-gateway/test/routes/shareLinks.test.ts`
- Create: `apps/share-gateway/test/routes/tasks.test.ts`
- Create: `apps/share-web/test/share-page.test.ts`
- Create: `apps/share-web/test/owner-page.test.ts`

## 3. Adapter Contract

必须实现统一接口：

```ts
export type AdapterStatus =
  | "available"
  | "not_installed"
  | "not_configured"
  | "unsupported";

export type AgentAdapterInfo = {
  id: string;
  displayName: string;
  status: AdapterStatus;
  version?: string;
  startCapability: "none" | "process" | "server";
  taskCapability: "cli_once" | "server_api";
  eventCapability: "stdout_text" | "jsonl" | "stream_json" | "http_events";
  desktopPreviewCapability: "none" | "web" | "vnc" | "browser";
};

export type RuntimeEvent =
  | { type: "task.accepted"; taskId: string }
  | { type: "task.plan"; taskId: string; text: string }
  | { type: "task.progress"; taskId: string; text: string }
  | { type: "task.needs_user_auth"; taskId: string; provider: string; scopeSummary: string }
  | { type: "task.needs_user_confirm"; taskId: string; actionSummary: string }
  | { type: "task.needs_owner_approval"; taskId: string; actionSummary: string }
  | { type: "task.output"; taskId: string; text: string }
  | { type: "task.completed"; taskId: string }
  | { type: "task.failed"; taskId: string; message: string }
  | { type: "task.cancelled"; taskId: string };

export interface AgentAdapter {
  detect(): Promise<AgentAdapterInfo>;
  start(input: StartRuntimeInput): Promise<RuntimeHandle>;
  submitTask(input: SubmitTaskInput): Promise<TaskHandle>;
  streamEvents(input: StreamEventsInput): AsyncIterable<RuntimeEvent>;
  stop(input: StopRuntimeInput): Promise<void>;
}
```

## 4. 任务分解

### Task 1: 建立 adapter 类型和 registry

**Files:**

- Create: `apps/share-gateway/src/adapters/types.ts`
- Create: `apps/share-gateway/src/adapters/registry.ts`
- Test: `apps/share-gateway/test/adapters/registry.test.ts`

- [x] **Step 1: 写失败测试**

测试 registry 返回 Codex、Claude Code、OpenCode、Hermes、Agent Zero 五类 adapter，并能表达 `available` / `not_installed`。

- [x] **Step 2: 运行测试并确认失败**

Run:

```bash
npm test -- apps/share-gateway/test/adapters/registry.test.ts
```

Expected: FAIL，原因是 adapter 类型和 registry 尚不存在。

- [x] **Step 3: 实现类型和 registry**

实现 `AgentAdapterInfo`、`RuntimeEvent`、`AgentAdapter` 和 `AdapterRegistry`。

- [x] **Step 4: 运行测试并确认通过**

Run:

```bash
npm test -- apps/share-gateway/test/adapters/registry.test.ts
```

Expected: PASS。

- [x] **Step 5: 提交**

```bash
git add apps/share-gateway/src/adapters apps/share-gateway/test/adapters/registry.test.ts
git commit -m "Add agent adapter registry"
```

### Task 2: 实现 OpenCode adapter

**Files:**

- Create: `apps/share-gateway/src/adapters/opencode.ts`
- Test: `apps/share-gateway/test/adapters/opencode.test.ts`

- [x] **Step 1: 写失败测试**

测试内容：

- `detect()` 能读取 `opencode --version`。
- `start()` 会构造 `opencode serve --hostname 127.0.0.1 --port <port>`。
- `submitTask()` 会构造 `opencode run --attach <url> --format json <prompt>`。
- `stop()` 会终止 server 子进程。

- [x] **Step 2: 运行测试并确认失败**

Run:

```bash
npm test -- apps/share-gateway/test/adapters/opencode.test.ts
```

Expected: FAIL。

- [x] **Step 3: 实现 adapter**

先用 mock child process 测试命令构造和事件解析，不在单元测试中调用真实模型。

- [x] **Step 4: 运行测试并确认通过**

Run:

```bash
npm test -- apps/share-gateway/test/adapters/opencode.test.ts
```

Expected: PASS。

- [x] **Step 5: 手动 smoke test**

只验证 server 能启动，不提交真实模型任务：

```bash
opencode serve --hostname 127.0.0.1 --port 4096
```

Expected: 本机端口可访问；结束后关闭进程。

- [x] **Step 6: 提交**

```bash
git add apps/share-gateway/src/adapters/opencode.ts apps/share-gateway/test/adapters/opencode.test.ts
git commit -m "Add OpenCode runtime adapter"
```

### Task 3: 实现 Codex adapter

**Files:**

- Create: `apps/share-gateway/src/adapters/codex.ts`
- Test: `apps/share-gateway/test/adapters/codex.test.ts`

- [x] **Step 1: 写失败测试**

测试内容：

- `detect()` 能读取 `codex --version`。
- `submitTask()` 使用 `codex exec --json --sandbox read-only`。
- JSONL 事件能映射到统一 `RuntimeEvent`。
- 错误事件能映射为 `task.failed`。

- [x] **Step 2: 运行测试并确认失败**

Run:

```bash
npm test -- apps/share-gateway/test/adapters/codex.test.ts
```

Expected: FAIL。

- [x] **Step 3: 实现 adapter**

不要默认使用 `danger-full-access`。真实任务测试必须使用 `read-only` 或外部 sandbox。

- [x] **Step 4: 运行测试并确认通过**

Run:

```bash
npm test -- apps/share-gateway/test/adapters/codex.test.ts
```

Expected: PASS。

- [x] **Step 5: 提交**

```bash
git add apps/share-gateway/src/adapters/codex.ts apps/share-gateway/test/adapters/codex.test.ts
git commit -m "Add Codex exec adapter"
```

### Task 4: 实现 Claude Code adapter

**Files:**

- Create: `apps/share-gateway/src/adapters/claude.ts`
- Test: `apps/share-gateway/test/adapters/claude.test.ts`

- [x] **Step 1: 写失败测试**

测试内容：

- `detect()` 能读取 `claude --version`。
- `submitTask()` 使用 `claude --bare -p --output-format stream-json`。
- 可以传入 `--permission-mode` 和 allow/deny tools。
- stream-json 事件能映射到统一 `RuntimeEvent`。

- [x] **Step 2: 运行测试并确认失败**

Run:

```bash
npm test -- apps/share-gateway/test/adapters/claude.test.ts
```

Expected: FAIL。

- [x] **Step 3: 实现 adapter**

默认使用保守权限模式；不得默认开启 `--dangerously-skip-permissions`。

- [x] **Step 4: 运行测试并确认通过**

Run:

```bash
npm test -- apps/share-gateway/test/adapters/claude.test.ts
```

Expected: PASS。

- [x] **Step 5: 提交**

```bash
git add apps/share-gateway/src/adapters/claude.ts apps/share-gateway/test/adapters/claude.test.ts
git commit -m "Add Claude Code print adapter"
```

### Task 5: 实现分享链接和任务 API

**Files:**

- Create: `apps/share-gateway/src/routes/adapters.ts`
- Create: `apps/share-gateway/src/routes/shareLinks.ts`
- Create: `apps/share-gateway/src/routes/tasks.ts`
- Test: `apps/share-gateway/test/routes/shareLinks.test.ts`
- Test: `apps/share-gateway/test/routes/tasks.test.ts`

- [x] **Step 1: 写失败测试**

测试内容：

- `GET /owner/adapters` 返回 adapter 清单。
- `POST /owner/share-links` 不需要高级配置即可生成链接。
- `GET /share/:token` 对有效链接返回可用状态。
- `POST /share/:token/tasks` 可以提交任务。
- 无效、暂停、撤销链接不能提交任务。

- [x] **Step 2: 运行测试并确认失败**

Run:

```bash
npm test -- apps/share-gateway/test/routes
```

Expected: FAIL。

- [x] **Step 3: 实现 API**

第一版可以使用内存存储，但接口必须保留后续持久化空间。

- [x] **Step 4: 运行测试并确认通过**

Run:

```bash
npm test -- apps/share-gateway/test/routes
```

Expected: PASS。

- [x] **Step 5: 提交**

```bash
git add apps/share-gateway/src/routes apps/share-gateway/test/routes
git commit -m "Add share link and task APIs"
```

### Task 6: 实现高风险动作策略层

**Files:**

- Create: `apps/share-gateway/src/policy/highRiskActions.ts`
- Test: `apps/share-gateway/test/policy/highRiskActions.test.ts`

- [x] **Step 1: 写失败测试**

测试高风险分类：

- 发送邮件、评论、消息。
- 支付、下单、产生外部费用。
- 删除、覆盖、移动持久文件。
- 访问创建者私人账号。
- 访问朋友授权的私人账号。
- 读取敏感凭证。
- 破坏性 shell 命令。

- [x] **Step 2: 运行测试并确认失败**

Run:

```bash
npm test -- apps/share-gateway/test/policy/highRiskActions.test.ts
```

Expected: FAIL。

- [x] **Step 3: 实现策略层**

输出必须是 `block`、`user_confirm` 或 `owner_approve`。

- [x] **Step 4: 运行测试并确认通过**

Run:

```bash
npm test -- apps/share-gateway/test/policy/highRiskActions.test.ts
```

Expected: PASS。

- [x] **Step 5: 提交**

```bash
git add apps/share-gateway/src/policy apps/share-gateway/test/policy
git commit -m "Add high risk action policy"
```

### Task 7: 实现创建者一键分享页面

**Files:**

- Create: `apps/share-web/src/pages/owner/index.ts`
- Create: `apps/share-web/src/components/AdapterPicker.ts`
- Create: `apps/share-web/src/components/ShareLinkPanel.ts`
- Test: `apps/share-web/test/owner-page.test.ts`

- [x] **Step 1: 写失败测试**

测试内容：

- 页面展示可用 Agent 框架。
- 只有一个可用框架时默认选中。
- 点击生成链接后展示可复制链接。
- 高级设置不阻塞生成链接。

- [x] **Step 2: 运行测试并确认失败**

Run:

```bash
npm test -- apps/share-web/test/owner-page.test.ts
```

Expected: FAIL。

- [x] **Step 3: 实现页面**

界面必须安静、工作台风格；不要做营销页。

- [x] **Step 4: 运行测试并确认通过**

Run:

```bash
npm test -- apps/share-web/test/owner-page.test.ts
```

Expected: PASS。

- [x] **Step 5: 提交**

```bash
git add apps/share-web/src/pages/owner apps/share-web/src/components apps/share-web/test/owner-page.test.ts
git commit -m "Add owner one-click share page"
```

### Task 8: 实现朋友端任务页

**Files:**

- Create: `apps/share-web/src/pages/share/[token].ts`
- Create: `apps/share-web/src/components/TaskComposer.ts`
- Create: `apps/share-web/src/components/TaskTimeline.ts`
- Create: `apps/share-web/src/components/PreviewPanel.ts`
- Create: `apps/share-web/src/components/PermissionPrompt.ts`
- Test: `apps/share-web/test/share-page.test.ts`

- [x] **Step 1: 写失败测试**

测试内容：

- 页面展示 agent 名称、输入框、提交按钮、状态区、预览区。
- 页面不展示 token cost、dollar cost、预算余额、模型价格。
- 提交任务后展示 `运行中` 状态。
- 高风险动作事件展示确认或审批状态。
- 预览区默认只读。

- [x] **Step 2: 运行测试并确认失败**

Run:

```bash
npm test -- apps/share-web/test/share-page.test.ts
```

Expected: FAIL。

- [x] **Step 3: 实现页面**

朋友端必须以任务流为主，不直接暴露底层 Agent 框架 UI。

- [x] **Step 4: 运行测试并确认通过**

Run:

```bash
npm test -- apps/share-web/test/share-page.test.ts
```

Expected: PASS。

- [x] **Step 5: 提交**

```bash
git add apps/share-web/src/pages/share apps/share-web/src/components apps/share-web/test/share-page.test.ts
git commit -m "Add friend task page"
```

### Task 9: 端到端 smoke test

**Files:**

- Modify: project test scripts or create `apps/share-web/e2e/share-flow.test.ts`

- [x] **Step 1: 建立内存端到端 smoke test**

Run:

```bash
npm test -- apps/share-web/e2e/share-flow.test.ts
```

Expected: 端到端流程测试启动并通过，不依赖真实模型调用。

- [x] **Step 2: 创建分享链接**

Expected: smoke test 返回 adapter 清单和分享 token。

- [x] **Step 3: 访问朋友页**

Expected: 朋友页 view-model 可生成，不展示成本信息。

- [x] **Step 4: 提交只读测试任务**

提交任务：

```text
请用一句话说明这个共享 Agent 当前连接的是哪个运行时。
```

Expected:

- 任务进入运行中。
- 页面展示状态变化。
- 页面展示最终输出或可理解错误。
- 页面不展示成本信息。

- [x] **Step 5: 高风险动作模拟**

触发模拟事件：

```text
请发送一封邮件给测试对象。
```

Expected:

- 系统进入使用者确认或创建者审批状态。
- 不静默执行发送动作。

## 5. 验收标准

### AC-001 Adapter 清单

创建者端必须展示 Codex、Claude Code、OpenCode、Hermes、Agent Zero 五类 adapter，并正确标识本机状态。

### AC-002 一键分享

创建者必须可以不进入高级设置生成分享链接。

### AC-003 任务提交

朋友端必须可以提交自然语言任务，并看到任务已接收、运行中、完成或失败状态。

### AC-004 成本隐藏

朋友端页面、任务事件和网络响应不得展示 token cost、dollar cost、预算余额、模型价格。

### AC-005 权限模式

默认权限模式必须是使用者身份。创建者私人账号、浏览器登录态、真实文件系统和真实主机权限不得默认暴露。

### AC-006 高风险动作

发送消息、支付、删除文件、读取敏感凭证、破坏性 shell 等动作必须进入阻止、使用者确认或创建者审批。

### AC-007 可撤销

创建者暂停或撤销链接后，朋友端不能继续提交新任务。

### AC-008 可替换运行时

新增 adapter 不应要求重写朋友端任务页。

## 6. 验证命令

完成实现后必须运行：

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

如果项目没有这些脚本，必须先记录实际可用脚本，再运行等价验证命令。

还必须运行本地环境验证：

```bash
codex --version
claude --version
opencode --version
opencode serve --help
codex exec --help
claude --help
```

## 7. 风险和处理

- OpenCode provider 未配置：adapter 返回 `not_configured`，不阻塞 Codex/Claude fallback。
- 真实模型任务产生成本：默认 smoke test 使用最短只读任务，并记录不要在朋友端展示成本。
- 底层事件泄露敏感信息：adapter 必须先清洗事件再推送给朋友端。
- 创建者电脑暴露风险：所有远程访问必须经分享网关，不能直接暴露底层 server。
- 高风险动作识别不完整：第一版先做保守策略，无法判断时进入审批或阻止。

## 8. 当前执行建议

先实现 OpenCode adapter 和 adapter registry。

理由：

- 本机已有 `opencode`。
- OpenCode 具备 headless server。
- OpenCode server 天然适合分享网关代理。
- Codex 和 Claude Code 可作为第二层非交互 fallback。
