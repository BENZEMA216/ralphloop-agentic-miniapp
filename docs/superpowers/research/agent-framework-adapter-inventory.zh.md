# 多框架 Agent Adapter 盘点

日期：2026-05-20

## 1. 目的

本文档盘点第一版“个人 Agent 分享运行时”可以接入的 Agent 框架，并判断哪个框架最适合作为 MVP 的首个 adapter。

目标是把产品方向从“包装某一个 Agent Zero 实例”推进到“分享网关通过 adapter 启动和控制多个桌面 Agent 框架”。

## 2. 结论

当前本机状态：

| 框架 | 本机命令 | 本机版本 | 状态 | MVP 判断 |
| --- | --- | --- | --- | --- |
| Codex | `/opt/homebrew/bin/codex` | `codex-cli 0.130.0` | 可用 | 适合做非交互任务 adapter |
| Claude Code | `/opt/homebrew/bin/claude` | `2.1.145 (Claude Code)` | 可用 | 适合做非交互任务 adapter |
| OpenCode | `/opt/homebrew/bin/opencode` | `1.2.27` | 可用 | 最适合作为首个 headless runtime adapter |
| Hermes Agent | 未找到 `hermes` | 无 | 未安装 | 暂不作为 MVP 阻塞项 |
| Agent Zero | Docker 镜像未完整拉取 | 无 | 参考路径受阻 | 仅保留为参考适配 |

推荐第一版 adapter 顺序：

1. OpenCode：优先验证 headless server、HTTP API、事件流和会话管理。
2. Codex：验证 `codex exec --json` 的非交互任务提交和事件解析。
3. Claude Code：验证 `claude -p --output-format stream-json` 的非交互任务提交和权限模式。
4. Hermes Agent：等安装路径确认后再接入，不阻塞 MVP。
5. Agent Zero：继续作为远程桌面/浏览器预览参考，不作为唯一基座。

## 3. 本机验证记录

已执行的本机验证命令：

```bash
command -v codex
command -v claude
command -v opencode
command -v hermes
codex --version
claude --version
opencode --version
codex --help
codex exec --help
claude --help
claude auth status --text
opencode --help
opencode run --help
opencode serve --help
npm view hermes-agent version description repository.url
```

验证结果：

- `codex` 已安装，支持 `exec` 非交互命令、`--json` 事件输出、`--sandbox` 权限控制。
- `claude` 已安装，支持 `-p/--print` 非交互命令、`--output-format`、`--permission-mode`、`--allowedTools`、`--max-budget-usd`。
- `opencode` 已安装，支持 `run` 非交互命令、`serve` headless HTTP server、`--format json`、`--attach`。
- `claude auth status --text` 显示本机已登录；输出包含个人账号信息，本文档不记录明文账号。
- `hermes` 命令不存在。
- `npm view hermes-agent ...` 未返回可用包信息，不能作为安装依据。

本次没有执行真实模型任务，原因是：

- 当前任务是 adapter 盘点和前序准备，不是消耗模型额度的运行测试。
- 真实任务调用会产生外部成本和潜在副作用。
- 后续 adapter MVP 计划会把真实任务测试作为明确验收项，并限定只读 sandbox 或无写入任务。

## 4. 框架盘点

### 4.1 Codex

本机状态：

- 命令：`/opt/homebrew/bin/codex`
- 版本：`codex-cli 0.130.0`
- 非交互入口：`codex exec`
- 事件输出：`codex exec --json`
- 权限控制：`--sandbox read-only|workspace-write|danger-full-access`

官方资料要点：

- Codex 的非交互模式使用 `codex exec`，适合脚本和 CI。
- `--json` 会把 stdout 变成 JSONL 事件流，包含线程、turn、item、错误和 usage 等事件。
- 默认安全边界是 read-only sandbox；自动化时应显式选择最小权限。

Adapter 初始能力：

| 能力 | 判断 |
| --- | --- |
| detect | 通过 `command -v codex` 和 `codex --version` |
| start | 不需要常驻服务；按任务启动 `codex exec` |
| submit_task | `codex exec --json --sandbox read-only "<prompt>"` |
| stream_events | 解析 JSONL stdout；stderr 作为运行日志 |
| stop | kill 子进程 |
| desktop_preview | 无直接桌面预览，第一版标记为 `none` |
| permission_mode | 通过 sandbox 和 approval 策略表达 |

风险：

- 真实任务会消耗 Codex 额度。
- 如果使用 `danger-full-access`，必须放在外部 sandbox 中。
- JSONL 事件里可能包含文件路径、命令和工具输出，朋友端必须过滤。

### 4.2 Claude Code

本机状态：

- 命令：`/opt/homebrew/bin/claude`
- 版本：`2.1.145 (Claude Code)`
- 非交互入口：`claude -p` 或 `claude --print`
- 事件输出：`--output-format stream-json`
- 权限控制：`--permission-mode`、`--allowedTools`、`--disallowedTools`

官方资料要点：

- Claude Code 可以通过 `-p/--print` 非交互运行。
- `--output-format` 支持结构化输出。
- `--allowedTools`、`--permission-mode`、`--permission-prompt-tool` 可用于控制工具审批。

Adapter 初始能力：

| 能力 | 判断 |
| --- | --- |
| detect | 通过 `command -v claude` 和 `claude --version` |
| start | 不需要常驻服务；按任务启动 `claude -p` |
| submit_task | `claude --bare -p "<prompt>" --output-format stream-json` |
| stream_events | 解析 stream-json 输出 |
| stop | kill 子进程 |
| desktop_preview | 可探索 Chrome 集成，但 MVP 先标记为 `none` |
| permission_mode | 通过 `--permission-mode` 和工具 allow/deny 表达 |

风险：

- 本机登录状态可用，但文档和日志不得记录账号信息。
- `--dangerously-skip-permissions` 不能作为默认策略。
- 非交互任务如果允许 Bash/Edit，必须由分享网关先做权限判断。

### 4.3 OpenCode

本机状态：

- 命令：`/opt/homebrew/bin/opencode`
- 版本：`1.2.27`
- 非交互入口：`opencode run`
- 常驻服务入口：`opencode serve`
- Web 入口：`opencode web`
- 事件输出：`opencode run --format json`

官方资料要点：

- OpenCode CLI 默认启动 TUI，但也支持 `opencode run` 进行程序化调用。
- `opencode serve` 会启动 headless HTTP server，对外提供 OpenAPI 接口。
- `opencode run --attach` 可以连接到已经运行的 `opencode serve` 实例。

Adapter 初始能力：

| 能力 | 判断 |
| --- | --- |
| detect | 通过 `command -v opencode` 和 `opencode --version` |
| start | `opencode serve --hostname 127.0.0.1 --port <port>` |
| submit_task | `opencode run --attach http://127.0.0.1:<port> --format json "<prompt>"` |
| stream_events | 解析 JSON 输出；后续可直接接 HTTP events API |
| stop | kill server 进程或调用 HTTP session stop API |
| desktop_preview | 可用 `opencode web` 探索；MVP 先以任务流为主 |
| permission_mode | 需要通过运行目录、模型配置、工具策略和外部 sandbox 补齐 |

MVP 推荐：

- OpenCode 是第一版最适合的 headless runtime adapter。
- 原因是它同时有 CLI、`run`、`serve`、`web` 和 OpenAPI server 形态，比单次 CLI 更适合接分享网关。

风险：

- 需要确认 provider/model 是否已配置。
- `opencode serve` 默认监听本机；对外暴露前必须经分享网关代理和鉴权。
- OpenCode 自身的 cost/stats 信息不能透传给朋友端。

### 4.4 Hermes Agent

本机状态：

- `hermes` 命令未安装。
- `npm view hermes-agent ...` 没有返回可用 npm 包信息。

公开资料要点：

- Hugging Face 文档将 Hermes Agent 描述为 Nous Research 的开源终端 Agent CLI。
- Hermes Agent 支持 Hugging Face Inference Providers。
- 文档示例里存在 `hermes chat --provider hf` 这类命令形态。

Adapter 初始能力：

| 能力 | 判断 |
| --- | --- |
| detect | 当前为 `not_installed` |
| start | 待安装后验证 |
| submit_task | 可能是 `hermes chat`，待验证 |
| stream_events | 待验证 |
| stop | 待验证 |
| desktop_preview | 待验证 |
| permission_mode | 待验证 |

风险：

- 当前没有本机命令，不能进入 MVP 关键路径。
- 安装来源和版本需要从 Hermes 官方文档/GitHub 再确认。

### 4.5 Agent Zero

当前状态：

- Docker、Docker Compose、Colima 已安装并验证。
- `agent0ai/agent-zero:latest` 镜像拉取停滞，未完整成功。
- 没有成功启动 Agent Zero 容器。

产品判断：

- Agent Zero 继续作为“完整 Web UI + 桌面/浏览器预览”参考。
- 它不是第一版唯一基座，也不是当前 MVP adapter 的阻塞项。

## 5. 统一 Adapter Contract 草案

第一版分享网关不直接调用具体框架命令，而是调用统一 adapter。

Adapter 元信息：

```ts
type AgentAdapterInfo = {
  id: string;
  displayName: string;
  status: "available" | "not_installed" | "not_configured" | "unsupported";
  version?: string;
  startCapability: "none" | "process" | "server";
  taskCapability: "cli_once" | "server_api";
  eventCapability: "stdout_text" | "jsonl" | "stream_json" | "http_events";
  desktopPreviewCapability: "none" | "web" | "vnc" | "browser";
};
```

Adapter 方法：

```ts
type AgentAdapter = {
  detect(): Promise<AgentAdapterInfo>;
  start(input: StartRuntimeInput): Promise<RuntimeHandle>;
  submitTask(input: SubmitTaskInput): Promise<TaskHandle>;
  streamEvents(input: StreamEventsInput): AsyncIterable<RuntimeEvent>;
  stop(input: StopRuntimeInput): Promise<void>;
};
```

事件模型：

```ts
type RuntimeEvent =
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
```

## 6. MVP 推荐路径

第一阶段只做 task adapter，不做完整桌面远控：

1. 实现 `AdapterRegistry`。
2. 实现 `OpenCodeAdapter`，以 `opencode serve` 作为 runtime。
3. 实现 `CodexExecAdapter`，以 `codex exec --json` 作为非交互 fallback。
4. 实现 `ClaudePrintAdapter`，以 `claude --bare -p --output-format stream-json` 作为非交互 fallback。
5. 朋友端只展示任务流、状态、最终输出和只读预览占位。
6. 高风险动作先通过策略模拟层拦截，再逐步接入真实工具调用事件。

第一阶段不做：

- 真实创建者电脑远控。
- 朋友直接操作创建者主机。
- 成本展示给朋友。
- Hermes 安装和深度适配。
- Agent Zero 硬依赖。

## 7. 资料来源

- Codex 非交互模式：<https://developers.openai.com/codex/noninteractive>
- Claude Code CLI reference：<https://code.claude.com/docs/en/cli-usage>
- Claude Code programmatic/headless：<https://code.claude.com/docs/en/headless>
- OpenCode CLI：<https://opencode.ai/docs/cli/>
- OpenCode Server：<https://opencode.ai/docs/server/>
- Hermes Agent Hugging Face integration：<https://huggingface.co/docs/inference-providers/integrations/hermes-agent>
