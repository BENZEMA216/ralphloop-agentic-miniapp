# Agentic App Manifest ↔ Ralphloop A2UI 桥接 Spec

**日期:** 2026-05-28
**阶段:** 跨仓库契约对齐（spec only，未实现）
**关联仓库:**
- 创作者侧：`~/Documents/创作者经济研究/apps/session-mini-app-demo`（FastAPI + SQLite，session → miniApp 抽取与生成）
- 运行侧：`~/Documents/使用`（Ralphloop share-gateway + share-web，miniApp 的执行与分发）

---

## 1. 目的与边界

两个仓库各自独立演进，但共享**一个**交接物：创作者侧 `build_agentic_app()` 产出的 `agentic_app` manifest（JSON）。

- 创作者侧负责：上传 session → LLM 抽取 `work_segments` → 生成 `workflow_candidates` → 用户审核确认 → 产出并 publish `agentic_app` manifest。
- Ralphloop 侧负责：消费 manifest → (a) 把它注册成一个可执行 provider；(b) 把它的 UI 契约渲染成 A2UI / generative UI。

**本 spec 锁定的不是实现，而是接缝**：manifest 的权威字段定义，加上 Ralphloop 侧消费它的两条路径和最小改动清单。任何一侧改 manifest 字段，必须同步改本文件并 bump `manifestVersion`。

**非目标（本轮不覆盖）**：marketplace 排名/搜索、收益分账、消费者购买流程、多人协作审核、E2E 加密。

---

## 2. 权威 manifest 契约（v0.1）

字段直接来自 `apps/session-mini-app-demo/backend/app/services.py` 的 `build_agentic_app()`（services.py:369）与 `_normalize_app_runtime()`（services.py:578）。下面是 Ralphloop 侧应当落地的 TypeScript 类型（建议放 `apps/share-gateway/src/miniapp/manifest.ts`）：

```ts
/** 一个 published miniApp 的完整契约。创作者侧产出，Ralphloop 侧消费。 */
export interface AgenticAppManifest {
  manifestVersion: "0.1"; // 新增字段（见 §6）；当前 demo 尚未输出，消费方默认 "0.1"
  manifest: {
    mini_app_id: string;
    name: string;
    version: string;            // app 自身版本，如 "0.1.0"
    creator_user_id: string;
    source_candidate_id: string;
    status: "draft" | "published_private" | "published";
  };
  agent: {
    role: string;
    goal: string;
    boundaries: string[];       // 行为边界（自然语言）
    tools: string[];            // 当前 demo 只产出 ["readonly_context"]
  };
  capability_basis: {
    name: string;
    repeated_workflow: string;
    target_user: string;
    recommended_form: "agentic_app" | "skill_set" | "automation" | "extend_existing" | "skip";
    confidence: "low" | "medium" | "high" | "unknown";
    frequency?: string;
    risk_level: "low" | "medium" | "high";
    evidence_refs: string[];    // 指回原始 session message/segment id
    why: string;
    stable_inputs?: string[];
    clear_output?: string;
  };
  skill_set: Array<{
    name: string;
    steps: string[];
    stopping_condition: string;
  }>;
  interaction: {
    ui_profile: {
      type: string;             // 如 "diagnostic_matrix" | "guided_intake" ...
      label: string;
      summary: string;
      components: string[];     // ★ A2UI 组件清单，见 §4
    };
    starter_prompts: string[];
    required_context: string[];
    review_questions: string[];
  };
  context_contract: {
    connectors: Array<{
      id: string;
      label: string;
      access: "read" | "presence_only" | "write";
      activation: string;       // "auto_import" | "explicit_user_opt_in" | "manual_confirmation" | ...
    }>;
    privacy: string[];
  };
  launch_contract: {
    modes: Array<{ id: string; label: string; description: string }>;
    default_mode: string;
  };
  llm_boundary: {
    allowed: string[];
    disallowed: string[];
    requires_confirmation_before: string[]; // ★ 映射成 task.needs_user_confirm
    risk_level: "low" | "medium" | "high";
    handoff: string;
  };
  runbook: { steps: string[]; checkpoints: string[] };
  examples: unknown[];
  safety: { risk_level: "low" | "medium" | "high"; disclaimer: string };
  provenance: {
    evidence_refs: string[];
    source_session_id: string;
    approved_by: string;
  };
}
```

这份类型是 Ralphloop 侧的**唯一入口**。manifest 进来先 `parseManifest()` 校验，再分流到两条消费路径。

---

## 3. 消费路径 A：manifest → 可执行 provider

### 执行位置（已决策 2026-05-28）：miniApp 跑在创作者 Host

miniApp agent 在**创作者的本机 Host** 上执行，消费者（朋友）不带 key、只发请求——这正好复用 Ralphloop 现有的 outbound-Host 共享模型，无需新链路。具体落法：

- 一个 published miniApp 绑定到创作者的某个在线 Host，等价于一条"adapter 被替换成 `ManifestAgentAdapter`"的 share-link。
- 朋友打开 miniApp = 在创作者 Host 上开一个 friend session，task 走现有 `/v1/share/:token/tasks` → outbound Host command → 创作者本机执行。
- **计费/配额沿用现有边界**：消费成本（创作者 Host 算力 + 创作者模型额度）对朋友完全隐藏，复用现有"不向朋友暴露 cost/budget/deviceKey"的安全边界。配额上限挂在创作者侧（每个 miniApp 的并发/速率），与现有 abuse guard 一致。
- **baseAdapter 来源因此收敛**：从创作者 Host 当前可用的 adapter 里选（`detectAll` 结果），manifest 可选 `runtime_hint.preferred_adapter` 做偏好提示；Host 上没有该 adapter 时降级到任一可用 adapter 或返回中性不可用。

### 核心判断：不要一个 miniApp 一个 adapter

创作者侧的 `post_run_message()`（services.py:464）目前是确定性 mock（`_render_artifact`）。真实产品里，miniApp agent 由 Ralphloop 现有的 outbound Host + `ProviderAdapter` 驱动（执行位置见上）。

所以 Ralphloop 侧只需要**一个** `ManifestAgentAdapter`，它把 manifest 当成"策略层"，底层复用已有的 Codex/Claude/OpenCode adapter 当"执行引擎"：

```ts
// apps/share-gateway/src/miniapp/manifestAgentAdapter.ts （新文件）
import type { ProviderAdapter } from "../adapters/provider.ts";
import type { AgenticAppManifest } from "./manifest.ts";

export class ManifestAgentAdapter implements ProviderAdapter {
  constructor(
    private readonly manifest: AgenticAppManifest,
    private readonly baseAdapter: ProviderAdapter, // codex / claude / opencode
  ) {}

  // detect/start/stop 透传给 baseAdapter
  // submitTask: 把 manifest.agent + skill_set + llm_boundary 编译成 system policy，
  //   拼到用户 prompt 前，再交给 baseAdapter.submitTask
  // streamEvents: 透传 baseAdapter 的 RuntimeEvent 流，但额外注入策略守卫（见下）
}
```

注册时一个 published miniApp = 一个 registry 条目（复用 Phase C 刚落地的 `ProviderRegistry.register`，providerRegistry.ts:42）：

```ts
providerRegistry.register({
  id: manifest.manifest.mini_app_id,
  factory: () => new ManifestAgentAdapter(manifest, providerRegistry.get(baseAdapterId)),
});
```

### manifest → RuntimeEvent 守卫映射

Ralphloop 的 `RuntimeEvent`（types.ts:27）已经有现成的确认/审批事件，manifest 的安全字段直接映射：

| manifest 字段 | Ralphloop 运行时行为 |
|---|---|
| `llm_boundary.requires_confirmation_before` 命中 | 发 `task.needs_user_confirm`，等朋友确认再继续 |
| `safety.risk_level: "high"` | 高风险动作升级为 `task.needs_owner_approval`（走创作者审批） |
| `context_contract.connectors[].access: "write"` | 写操作前强制 `task.needs_user_confirm` |
| `context_contract.connectors[].access: "presence_only"` | 只校验凭证"是否具备"，原文绝不进 prompt（与现有"不泄露 deviceKey/bootstrap"边界一致） |
| `llm_boundary.disallowed` | 注入 system policy；越界输出在 `streamEvents` 里拦截 |
| `safety.disclaimer` | 首条 assistant 消息或 UI banner 必须展示 |

### run 生命周期对齐

创作者侧 demo 的 run 循环（`create_run` → `post_run_message` → `needs_user_input` → artifact）映射到 Ralphloop 的 task 事件流：

```
create_run                     → 新建 share session + task.accepted
post_run_message (轮次<2)      → task.needs_user_confirm / task.progress（补齐 required_context）
post_run_message (产出 artifact)→ task.output（artifact markdown）+ task.completed
```

`interaction.required_context` 决定开场要补齐哪些上下文，等价于 `launch_contract.default_mode = context_launch` 时的预填项。

---

## 4. 消费路径 B：ui_profile.components → A2UI / generative UI

`interaction.ui_profile.components` 是 A2UI 的组件清单。demo 里已经出现的组件名（services.py:641 `_ui_profile`）：

```
diagnostic_matrix, context_checklist, artifact_builder,
credential_inventory, callback_flow, deployment_checklist,
evidence_board, scorecard, intake_form, checklist
```

Ralphloop 的 assistant-ui 层需要一个**组件注册表**，把组件名映射到 React 组件，并对未知组件降级：

```ts
// apps/share-web-react/src/a2ui/componentRegistry.ts （新文件，挂在 Phase A 的 React app 下）
const A2UI_COMPONENTS: Record<string, React.ComponentType<A2UIComponentProps>> = {
  intake_form: IntakeForm,
  checklist: Checklist,
  artifact_builder: ArtifactBuilder,
  diagnostic_matrix: DiagnosticMatrix,
  scorecard: Scorecard,
  // ...
};
// 未知组件 → 降级为 [intake_form, artifact_builder]，保证任何 manifest 都能渲染
export function resolveComponents(names: string[]): React.ComponentType<A2UIComponentProps>[] { /* ... */ }
```

数据流：manifest 经 share-gateway 注入页面 `__RALPHLOOP_STATE__`（Phase A 已有的注入机制）→ React app 读 `interaction.ui_profile.components` → `resolveComponents()` → 渲染在 assistant-ui `Thread` 的右侧/上方。组件的数据来自同一条 AG-UI 事件流（`task.output` / `task.progress`）。

**为什么挂在 Phase A 的 `apps/share-web-react/`**：A2UI 是真正的 React 组件，需要 hydration，不适合塞进现有 server-rendered 内联脚本。这也给了 Phase A 的 `/v2` 入口一个明确的存在理由——它就是 A2UI 的承载页。

---

## 5. Ralphloop 侧最小改动清单

纯增量，不破坏现有 share-link / host / adapter：

1. `apps/share-gateway/src/miniapp/manifest.ts` — `AgenticAppManifest` 类型 + `parseManifest()` 校验（拒绝缺字段、未知 `manifestVersion`）。
2. `apps/share-gateway/src/miniapp/manifestAgentAdapter.ts` — `ManifestAgentAdapter implements ProviderAdapter`，把 manifest 策略编译进 baseAdapter 调用。
3. `apps/share-gateway/src/miniapp/manifestRegistry.ts` — 加载 published manifests，逐个 `providerRegistry.register()`；提供 `mini_app_id → manifest` 查询；**记录 manifest↔创作者 Host 绑定**（决策 #1：每个 miniApp 绑定到一个在线 Host，run 时路由到该 Host 的 outbound 队列）。
4. `httpServer.ts` — 新增 `POST /v1/miniapps/import`（接收 manifest，参数带 `ownerId` + 目标 `hostId`，校验该 Host 在线且支持选定 baseAdapter）+ 在 `/v2` 注入 manifest 的 `interaction` 到 `__RALPHLOOP_STATE__`。打开 miniApp 复用现有 friend-session/task 链路在绑定 Host 上执行。
5. `apps/share-web-react/src/a2ui/` — 组件注册表 + 首批组件（`intake_form` / `checklist` / `artifact_builder` 三件套打底，其余降级）。
6. 守卫映射（§3 表）落到 `ManifestAgentAdapter.streamEvents`。

每一步都按现有仓库的 TDD red→green→commit + 完整验证 loop（见 `AGENTS.md`）。

---

## 6. 版本与开放问题

### 版本
- manifest 当前**没有** `manifestVersion` 字段。**第一个跨仓库 action**：创作者侧 `build_agentic_app()` 加上 `"manifestVersion": "0.1"`，Ralphloop 侧 `parseManifest()` 对缺失值默认 `"0.1"` 但发 deprecation 警告。
- 任何字段增删 → bump version + 同步本文件 + 两侧各加一个迁移测试。

### 已决策
1. **执行位置（2026-05-28）：miniApp 跑在创作者 Host**，朋友不带 key、共享创作者算力，复用现有 outbound-Host 共享模型。详见 §3"执行位置"。连带确定：计费/配额挂创作者侧并对朋友隐藏；baseAdapter 从创作者 Host 可用 adapter 里选（见下 #2）。

### 待定（需要决策）
2. **baseAdapter 绑定时机**：已收敛为"从创作者 Host 可用 adapter 里选"（决策 #1 的结果）。剩下的子问题——是 publish 时由创作者锁定一个，还是每次 run 时按 Host 当前可用动态选？建议 manifest 新增可选 `runtime_hint.preferred_adapter` 做偏好，运行时按 Host `detectAll` 实际可用情况兜底。
3. **A2UI 组件契约**：`components` 现在只是字符串名。是否需要让 manifest 携带每个组件的 props schema（创作者侧定义数据形状），还是 Ralphloop 侧组件自己从 AG-UI 事件推导？建议先走后者（轻），组件复杂化后再让 manifest 带 schema。
4. **证据可见性**：`provenance.evidence_refs` 指回原始 session message——这些在消费侧能看到多少？默认全部隐藏（朋友不该看到创作者原始对话），只暴露 `capability_basis.why`。
5. **registry 持久化**：published manifests 存哪？建议复用 Phase D 刚落地的 JSONL relay store 模式，新增一张 `mini_app_manifests` 表/journal op。绑定的创作者 Host id 一并持久化（决策 #1 要求 manifest↔Host 绑定）。

---

## 7. 一句话总结

接缝是 `agentic_app` manifest 这一个 JSON。Ralphloop 侧用**一个** `ManifestAgentAdapter`（而非每 app 一个 adapter）+ **一个** A2UI 组件注册表消费它，两者都挂在 Phase A 的 `/v2` React 入口和 Phase C 的 `ProviderRegistry` 上——昨晚刚落地的两块基建正好是这条产品线的承载点。
