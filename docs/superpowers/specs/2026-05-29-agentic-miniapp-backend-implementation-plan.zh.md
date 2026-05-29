# Agentic Miniapp 后端落地方案

**日期:** 2026-05-29
**状态:** 实施指南草案（review-driven），用于指导后端首批 PR
**关联文档:**
- `docs/superpowers/specs/2026-05-28-agentic-miniapp-code-architecture.zh.md`（主架构稿，本文不重复其内容，只在分歧处显式标注）
- `docs/superpowers/specs/2026-05-28-agentic-miniapp-conversation-handoff.zh.md`
- `docs/superpowers/specs/2026-05-28-agentic-miniapp-builder-mvp-io-contract.zh.md`

**目标:** 基于已有架构稿，对照 share runtime 现有代码（`apps/share-gateway/src/productization/*`），给后端实现者一份"先做什么、不做什么、踩哪里"的落地方案。

**适用范围:** 后端首批 4 个 PR（Phase 1 ~ Phase 4）。前端 React runner、真实云端 extraction、Auto Eval 等不在本文范围。

---

## 1. 核心判断

读了主架构稿 + 比对 share runtime 现有代码（`hostClient.ts:161-203`、`routes.ts:1106-1430`、`routes.ts:325-440`）后的核心判断：

> **Miniapp 不是 share runtime 的扩展，而是两条独立链路 + 一个共享契约 + 一个短接点。** 在架构层面，消费链路确实只是 share runtime 上的一层 wrapper，工作量可控；真正的复杂度在生产链路（owner 侧的 pipeline）和 `AgenticSkillSpec` 的契约设计。

```text
                        AgenticSkillSpec
                       (★shared 契约)
                              ▲
                              │ 两侧都依赖
                              │
        ┌─────────────────────┴─────────────────────┐
        │                                           │
   [生产链路]                                   [消费链路]
   owner 侧 pipeline                            wrap share runtime
        │                                           │
        ▼                                           │
   Publish ──────────► ShareLink ◄────────────── token 解析
                  (★唯一短接点)
```

三个事实：

1. **消费链路在数据流上就是"包一层"**：前置 `promptCompiler`（intake → runtimePrompt），后置 `artifactExtractor`（task.output → ArtifactRecord）。底座（host pull / event batch / RelayStore / 4 道闸 / policyVersion 绑定）一行不动。
2. **生产链路完全独立**：从 `RawInputPackage` 到 `MiniappBuildSpec` 再到 `EvaluationReport`，**对 share runtime 底座的所有调用只有 publish 那一刻的 `RelayStore.createShareLink`**。这意味着 Phase 1 ~ Phase 4 可以全程不接 host、不接真实 RelayStore，用 fixture 跑通整条生产链路。
3. **`AgenticSkillSpec` 是整个系统的根**：所有阶段（extraction hints / skill drafting / build spec / eval / consumption promptCompiler / artifactExtractor）都靠它通信。它看起来是松耦合（七个模块各引用各的字段），实际上是契约耦合，schema 一改全员改。

---

## 2. 推荐代码结构

现有方案（主架构稿 §4）把 11 个子目录平铺在 `miniapp/` 下，生产/消费/共享混在 `domain/` 和单体 `MiniappStore` 里。本文推荐改成 **shared / production / consumption 三层**，让两条链路在目录上就能看出来。

```text
apps/share-gateway/src/miniapp/
  shared/                          ← 两侧都依赖的契约
    skill.ts                       AgenticSkillSpec
    buildSpec.ts                   MiniappBuildSpec（生产产物 + 消费输入）
    publish.ts                     PublishedMiniappRecord（唯一两侧都写）
    ids.ts
    errors.ts

  production/                      ← 生产链路；不依赖 share runtime（除 publish 一处）
    domain/
      rawInput.ts
      candidate.ts                 CapabilityCandidate / ExtractionResult
      skillDraft.ts                AgenticSkillDraftRecord
      evaluation.ts                EvaluationReport
      uiPlan.ts                    GeneratedUiPlan
    store/
      productionStore.ts           独立 JSON snapshot + JSONL journal
      productionData.ts
    extraction/
      analysisHarness.ts           interface（未来兼容本地 harness）
      cloudExtractionHarness.ts    MVP 实现（云端 Agent）
      extractionPrompts.ts         hardcoded，跟代码一起 commit
      evidenceMapper.ts
    skill/
      skillDrafting.ts
      skillValidator.ts
      skillMarkdown.ts
    builder/
      buildCompiler.ts             组合下面三个子编译器
      runtimePolicyCompiler.ts
      uiPlanCompiler.ts
      promptTemplateBuilder.ts     ★build-time 产模板（含 intake 占位符）
    eval/
      evalRunner.ts
      evalCaseGenerator.ts
      mockConsumption.ts           ★借消费侧 mock 跑 eval（显式跨层依赖单点）
      checks.ts
    routes/
      ownerMiniapps.ts
      miniappEvaluations.ts

  consumption/                     ← 消费链路；wrap share runtime
    domain/
      miniappRun.ts                MiniappRunRecord
      artifact.ts                  ArtifactRecord
    store/
      consumptionStore.ts          独立 journal，只存 run + artifact + intake
      consumptionData.ts
    runtime/
      miniappRunEngine.ts
      inputResolver.ts             校验 intake 对 skill.inputsNeeded
      promptCompiler.ts            ★run-time 把 intake 填进 template
      runtimeEventIngest.ts
      artifactExtractor.ts
      runEventMapper.ts
    routes/
      friendMiniapps.ts
```

### 2.1 与主架构稿 §4 的关键差异

| # | 差异点 | 主架构稿 | 本文推荐 | 为什么 |
|---|---|---|---|---|
| 1 | `domain/` 组织 | 11 个文件平铺一个目录 | 按 shared/prod/consume 三段拆 | 生产改 `RawInputPackage` 不应触发消费侧重编译 |
| 2 | `MiniappStore` | 单体，8 类记录混在一个 journal | 拆 `ProductionStore` + `ConsumptionStore`，各自 journal | 生产/消费可独立崩溃恢复；消费侧不需要把 RawInput chunks 加载进内存 |
| 3 | `promptCompiler` 位置 | 放 builder/（生产侧） | **拆两半**：build 时产 template（生产侧）+ run 时填 intake（消费侧） | template 可 snapshot 测、可缓存；run-time 逻辑薄到只剩字符串替换 |
| 4 | `eval/mockShareRuntime.ts` 命名 | 含糊 | 改名 `mockConsumption.ts` | eval 是生产侧但要借消费侧接口跑 mock，跨层依赖必须显式 |
| 5 | publish 流程交点 | 没显式标 | shared/ 里只放 `PublishedMiniappRecord`；这是两侧都写的唯一类型 | 让"唯一短接"在类型层面就能看到 |

### 2.2 依赖方向

```text
shared ← production
shared ← consumption
production → mockConsumption → consumption  （eval 一处显式跨层）
production → RelayStore.createShareLink     （publish 一处显式跨层）
consumption → RelayStore + submitShareRuntime + RuntimeEvent  （消费侧持续依赖底座）
```

禁止：
- `consumption/` 直接引 `production/` 的任何模块。
- `production/` 直接引 `consumption/` 除了 eval 的 mockConsumption。
- `shared/` 引任何业务模块。

---

## 3. 共享契约 shared/

### 3.1 `AgenticSkillSpec` 字段稳定性是 P0

整个 miniapp 系统的 7 个模块都依赖这个 schema。字段一改就是七处同步。第一版必须确保：

- `name / description / whenToUse / targetUser / jobToBeDone`：稳定，几乎不会变。
- `inputsNeeded[]`：稳定，每条 `{ key, label, type, required, description }`。
- `workflowSteps[]`：字符串数组，第一版只供 prompt 编译；不要给它加结构（一加结构后面所有 prompt 模板都得改）。
- `constraints[] / failureModes[] / examples[]`：稳定，字符串数组即可。
- `expectedOutput`：**这是稳定性最低的字段**。MVP 建议只保留 `{ type, jsonSchema }`，强制 JSON。不要做 markdown fallback、不要做多种 type 共存（见 §4.3 问题 4）。
- `evalCases[]`：来源单一化，见 §5.4 问题 P3。
- `tags[]`：自由。

字段加法策略：
- 加非必填字段：兼容，直接加。
- 加必填字段：必须配套写 migration（老 skill 怎么补 default）。
- 改字段语义：禁止；新建字段，老字段标 deprecated。

**版本号**：第一版固定 `version: "0.1"`。改 schema 之前先想清楚 promptTemplate、artifactExtractor、uiPlanCompiler 三处怎么改。

### 3.2 `MiniappBuildSpec` 是跨层产物

生产侧 `buildCompiler` 产出，消费侧 `MiniappRunEngine` 消费。建议字段：

```ts
type MiniappBuildSpec = {
  id: string;
  ownerId: string;
  skillDraftId: string;
  skill: AgenticSkillSpec;            // 内嵌（不指引用），保证 build 后 skill 不可变
  runtimePolicy: RuntimePolicy;
  uiPlan: GeneratedUiPlan;
  evalPlan: EvalPlan;                 // 引用 skill.evalCases，不独立存
  promptTemplate: CompiledPromptTemplate;  // ★build 时预编译
  createdAt: string;
};

type CompiledPromptTemplate = {
  text: string;                       // 含 {{intake.fieldKey}} 占位符
  placeholders: string[];             // 占位符列表，供 promptCompiler 校验
  expectedArtifact: {
    jsonSchema: object;               // 强 schema
  };
};
```

**关键设计**：build 后 skill 内嵌进 buildSpec、不可变。这样消费链路只依赖 buildSpec，与 skill draft 后续编辑解耦。Owner 改 skill 等于新建 build，老 build 不受影响。

### 3.3 `PublishedMiniappRecord` 是唯一短接记录

```ts
type PublishedMiniappRecord = {
  id: string;
  ownerId: string;
  buildSpecId: string;                // → ProductionStore
  shareLinkId: string;                // → RelayStore
  tokenHash: string;                  // 冗余，避免每次 publish 查询都跨 store
  hostId: string;                     // 冗余，理由同上
  baseAdapterId: string;
  status: "published_private" | "published" | "revoked";
  latestEvaluationId: string;
  createdAt: string;
  updatedAt: string;
};
```

冗余 `tokenHash` 和 `hostId` 是有意的：消费链路按 token 查 PublishedMiniappRecord 是高频热路径，不能每次跨 store 查。

---

## 4. 消费链路 consumption/

### 4.1 模块组成与流程

```text
POST /v1/share/:token/miniapp-runs
  → consumption/routes/friendMiniapps.ts
  → MiniappRunEngine.createAndStartRun(token, intake)

createAndStartRun:
  1. ProductionStore.findPublishedByTokenHash(hash(token))  // 跨 store 只读
  2. inputResolver.validate(intake, buildSpec.skill.inputsNeeded)
  3. promptCompiler.fill(buildSpec.promptTemplate, intake)  // → { displayPrompt, runtimePrompt }
  4. ConsumptionStore.createMiniappRun({ status: "queued", intake, displayPrompt })
  5. submitShareRuntime({ store, runtimes, token, displayPrompt, runtimePrompt, ... })
     → 返回 sessionId, taskId
  6. ConsumptionStore.updateMiniappRun({ runId, sessionId, taskId })
  7. 返回 { runId, status: "queued" }
```

事件回传分支：

```text
POST /v1/hosts/:hostId/events （现有路由）
  → recordHostCommandEventsV1（现有，不改）
  → appendRuntimeEvent loop（现有）
  → ★新增 hook：miniappRuntimeEventIngest.ingestIfMiniappTask(sessionId, taskId, events)
    → 检查 sessionId 是否属于 MiniappRunRecord
    → 是 → 推导终态 → artifactExtractor.extract(events, skill.expectedOutput)
       → ConsumptionStore.appendArtifact + updateMiniappRun({ status: terminal })
```

### 4.2 7 个工程问题 + MVP 决策

| # | 问题 | MVP 决策 | 代码位置 |
|---|---|---|---|
| 1 | host 批量回传 vs. 状态机中间态（`hostClient.ts:161-203` 是 batch-then-POST，不流式） | **削状态机**：`MiniappRunRecord.status` 只保留 `intake_required / queued / completed / failed / cancelled`；删 `running / needs_user_confirm / needs_owner_approval`。文档明示 MVP 不展示运行中进度。 | `consumption/domain/miniappRun.ts` |
| 2 | `submitFriendTaskV1`（`routes.ts:1106`，~330 行）含 4 道闸（heartbeat / rate-limit / budget / concurrency） + 双路径（出站/在进程），抽 `submitShareRuntime` 容易开洞 | 抽象时**逐行盘点 4 道闸**，每条要么搬进抽象、要么显式声明 miniapp 不走。`displayPrompt` 仅用于 audit log；`runtimePrompt` 走 hostCommand。**这次改动放在 `productization/routes.ts`，不在 miniapp/ 下**，因为它是底座能力。 | `apps/share-gateway/src/productization/routes.ts`（新增 `submitShareRuntime` 内部函数）；`submitFriendTaskV1` 改写为 `submitShareRuntime` 的薄包装 |
| 3 | mid-run approval 在 outbound 模式接不上（host 跑完才回传，approval 卡不住） | MVP **明确不支持** mid-run approval；高风险动作只能在 build 时 `runtimePolicy.blockedActions` **静态拦截** | `production/builder/runtimePolicyCompiler.ts` |
| 4 | artifactExtractor 从不可控 CLI 文本抠 JSON 脆 | **强制 fenced JSON**；解析失败 → run 状态置 `failed`，错误信息进 audit log；**不做 markdown fallback**（fallback 会让 owner 永远不知道 prompt 写错了） | `consumption/runtime/artifactExtractor.ts` |
| 5 | 双 store 跨事务孤儿（publish 写 RelayStore + ProductionStore；run 写 ConsumptionStore + RelayStore） | 启动跑 `reconcileMiniappStores(productionStore, consumptionStore, relayStore)`：扫孤儿 `PublishedMiniappRecord`（指向不存在的 ShareLink）→ 标 `revoked`；扫孤儿 `MiniappRunRecord`（指向不存在的 session）→ 标 `failed` | 启动入口 `apps/share-gateway/src/index.ts` |
| 6 | follow-up `POST /miniapp-runs/:runId/messages` 语义不清（要不要过 promptCompiler？预算怎么算？） | **MVP 不做** follow-up；run 完成即终态；重跑就新建 run | 砍掉这条路由 |
| 7 | `EvaluationReport.publishGate === 'manual_review'` 流程未定 | **MVP 只保留 `allow / block`** | `production/eval/evalRunner.ts` |

### 4.3 关于强制 JSON artifact 的额外说明（问题 4 展开）

这是消费链路里**最关键的工程取舍**。它影响：

- `promptTemplate.expectedArtifact.jsonSchema` 必须在 build 时就定义。
- `promptTemplateBuilder` 必须把 JSON schema 注入 prompt 末尾（`Return format: <schema>`）。
- `artifactExtractor` 用 `ajv` 或类似库做严格 schema 校验。
- 校验失败时 `run.status = 'failed'`、错误信息进 audit。
- Owner 在 build / eval 阶段就能从 `mockConsumption` 试跑结果里看到"模型有没有输出符合 schema 的 JSON"，避免 publish 后才发现。

如果第一版就接受 markdown fallback，会发生：
- 大部分 miniapp 实际产出是松散文本，没有结构化 artifact。
- Owner 在 owner console 看不到失败信号，以为 miniapp 工作正常。
- React `ArtifactPanel` 只能展示 markdown，跟普通 chat 没区别，miniapp 价值丢失。
- 后期想加严格 schema，发现要改所有 published miniapp，迁移成本巨大。

### 4.4 集成点（3 个，全部显式）

| # | 位置 | 性质 | 备注 |
|---|---|---|---|
| 1 | `productization/routes.ts` 抽 `submitShareRuntime(displayPrompt, runtimePrompt)` | 底座改造 | 普通聊天和 miniapp 共用；4 道闸 100% 复用 |
| 2 | `recordHostCommandEventsV1`（`routes.ts:325`）在 `appendRuntimeEvent` loop 之后挂 `miniappRuntimeEventIngest.ingestIfMiniappTask(sessionId, taskId, events)` | 底座挂 hook | hook 内部只读 ConsumptionStore 判断是否属于 miniapp run |
| 3 | `httpServer.ts` 路由分发：`/v1/share/:token/miniapp*` 走 miniapp routes，`/v1/share/:token/tasks` 等老路由不变 | 路由扩展 | 同一个 token 既能开普通聊天也能开 miniapp run，由 PublishedMiniappRecord 是否存在决定 |

---

## 5. 生产链路 production/

### 5.1 七阶段流程

```text
[1] Raw Input Packaging
    POST /v1/miniapps/raw-input-packages
    输入: 异构材料（chat / document / agent_session / web_page / task_history / manual_note / code_or_project_file）
    产物: RawInputPackage { sources, chunks, sourceMap, warnings }
    责任: 工程标准化；不做隐私、不做语义判断

[2] Candidate Extraction
    POST /v1/miniapps/extractions  → ★异步 job
    输入: RawInputPackage + CandidateExtractionPolicy
    产物: ExtractionResult { candidates[], rejectedIdeas[], harness, warnings }
    实现: CloudExtractionHarness（云端 Agent；MVP 唯一实现）

[3] Candidate Selection
    POST /v1/miniapps/skill-drafts { candidateId }
    输入: ExtractionResult.candidates[]
    产物: SelectedCapabilityCandidate（在 skillDrafting 内部隐式存在，不单独持久化）

[4] Skill Drafting + Owner Review
    POST /v1/miniapps/skill-drafts          → 起草
    GET  /v1/miniapps/skill-drafts/:id      → 看
    PATCH /v1/miniapps/skill-drafts/:id     → owner 编辑
    输入: candidate + evidence
    产物: AgenticSkillDraft { skill, draftStatus, reviewFocus[], evalCaseDrafts[], warnings[] }

[5] Build Compilation
    POST /v1/miniapps/skill-drafts/:id/builds
    输入: ReviewedAgenticSkill
    产物: MiniappBuildSpec { skill, runtimePolicy, uiPlan, evalPlan, promptTemplate }
    内部: buildCompiler 并行调 runtimePolicyCompiler / uiPlanCompiler / promptTemplateBuilder

[6] Auto Eval
    POST /v1/miniapps/builds/:id/evaluations
    输入: MiniappBuildSpec + skill.evalCases
    产物: EvaluationReport { status, publishGate, checks[] }
    内部 checks:
      - skillSchema 校验
      - uiPlan 在受控注册表里能降级渲染
      - promptTemplate 用 mock intake 编译能产出合法 prompt
      - mockConsumption 跑一次 run（借消费侧的 inputResolver / promptCompiler / artifactExtractor）
      - policy 静态检查

[7] Publish
    POST /v1/miniapps/builds/:id/publish
    输入: 通过 eval 的 buildSpecId + hostBinding
    操作:
      1. 校验 latestEvaluation.publishGate === 'allow'
      2. RelayStore.createShareLink(owner, host, baseAdapter, policy)  ← ★唯一短接
      3. ProductionStore.savePublishedMiniappRecord({ buildSpecId, shareLinkId, ... })
      4. audit log
```

### 5.2 7 个工程问题 + MVP 决策

| # | 问题 | MVP 决策 | 代码位置 |
|---|---|---|---|
| P1 | Extraction harness 的失败/延时/成本控制完全没设计（云端 Agent 调用可能 30s-2min） | `POST /extractions` 立即返回 `{ extractionId, status: 'pending' }`；后台 worker 跑；owner 轮询 `GET /extractions/:id`。失败 retry 上限 3 次；超时 5min 标 `failed`。 | `production/extraction/cloudExtractionHarness.ts` + 启动入口跑 worker |
| P2 | Skill Drafting 的 owner review loop 跟 Creator UI 强耦合，但 UI 在 P5 才做 | **P1-P4 阶段把 `skillDrafting` 的输出直接标 `reviewed`，跳过 patch 流程**；`PATCH /skill-drafts/:id` 路由 P5 之前不暴露。fixture 直接构造完整 skill 即可。 | `production/skill/skillDrafting.ts` |
| P3 | `evalCases` 来源链路断了（extraction hints / skill / build 三处都有） | **固定单一来源**：`AgenticSkillSpec.evalCases` 是唯一真实来源。extraction hints 只在 skillDrafting 时初始化用，之后只读；`EvalPlan.evalCases` 直接引用 `skill.evalCases`，不独立持久化。 | `production/skill/skillDrafting.ts` + `production/builder/buildCompiler.ts` |
| P4 | `MiniappBuildSpec.uiPlan` 是静态产物，UI 微调强制重 eval | **接受**：MVP 文档明示"UI 改 = 重 build = 重 eval"。等需求多了再做 uiPlan 独立版本化。 | 文档约定，无代码改动 |
| P5 | Publish 后的版本管理（owner 改 skill 怎么办） | **publish 不可改**：owner 改了就新建 miniapp（新 ShareLink + 新 token + 新 PublishedMiniappRecord）；老的可 revoke。`status` 字段只走 `published_private → published → revoked` 单向。 | `production/routes/ownerMiniapps.ts` |
| P6 | RawInputPackage 体积大（聊天/transcript 可能 GB），全塞 ProductionStore JSON snapshot 不现实 | `RawInputPackage` 只存 `sources / sourceMap / warnings` 元数据进 ProductionStore；`chunks` 单独走 blob 存储（P1 hardcode 本地路径，先不抽象 storage layer）；store 里只保留 `chunkRef`。 | `production/store/productionStore.ts` schema 设计时定 |
| P7 | Extraction prompt 的版本化管理 | `extractionPrompts.ts` 跟代码一起 commit，hardcode；`CloudAnalysisHarnessDescriptor.promptVersion` 跟 git sha 绑；replay 时按版本号 fork 出对应 prompt（先不做 replay，留接口）。 | `production/extraction/extractionPrompts.ts` |

### 5.3 短接点（1 个）

`publishMiniapp` 内部调 `RelayStore.createShareLink`。这是**生产链路对底座的唯一依赖**。在代码上要做到：

- `production/` 下除了 `routes/ownerMiniapps.ts` 的 publish handler，**不允许**任何其他文件 import RelayStore。
- handler 内部按事务顺序写：先 RelayStore，后 ProductionStore（如果中间崩溃，孤儿 ShareLink 由 reconcile 处理，见消费侧问题 5）。

---

## 6. 落地顺序

### 6.1 与主架构稿 §16 的关系

主架构稿的 Phase 1-6 顺序方向正确，本文不重画轮子，只补三处：

1. **Phase 1 必须先定 shared/ 契约**：在写任何 store 之前先把 `AgenticSkillSpec / MiniappBuildSpec / PublishedMiniappRecord` 三个类型敲定并加单测（schema validator + roundtrip）。这三个改动一次代价最高。
2. **Phase 1 + Phase 2 之间插入 promptTemplate 设计验证**：跑 5-10 个手写 skill fixture 过 `promptTemplateBuilder + promptCompiler + 强 JSON schema artifactExtractor` 端到端（adapter 用 mock 返回预设 JSON），确认 schema-first 路线在小样本上跑得通，再继续。如果跑不通，第一时间砍 schema 严格度或重新评估强制 JSON 决策。
3. **Phase 4 之前必须先做 `submitShareRuntime` 抽象**：消费链路问题 2 是最高安全风险，先把这个抽象落进 `productization/routes.ts` 并写完测试（普通聊天回归测 + 4 道闸 100% 复用验证），再写 MiniappRunEngine。

### 6.2 修订后的 P1 ~ P4 详细任务

```text
Phase 1: Shared 契约 + Store roundtrip
  - apps/share-gateway/src/miniapp/shared/skill.ts
  - apps/share-gateway/src/miniapp/shared/buildSpec.ts
  - apps/share-gateway/src/miniapp/shared/publish.ts
  - apps/share-gateway/src/miniapp/production/store/productionStore.ts
  - apps/share-gateway/src/miniapp/consumption/store/consumptionStore.ts
  - 测试: 三个类型的 schema validator；两个 store 的 roundtrip + journal recovery
  验收: 启动 → 写一条 RawInputPackage / SkillDraft / BuildSpec / MiniappRun / Artifact → 重启 → 全部能从 journal 恢复

Phase 1.5: promptTemplate 端到端冒烟（新增）
  - apps/share-gateway/src/miniapp/production/builder/promptTemplateBuilder.ts
  - apps/share-gateway/src/miniapp/consumption/runtime/promptCompiler.ts
  - apps/share-gateway/src/miniapp/consumption/runtime/artifactExtractor.ts（强 JSON schema 版）
  - 5-10 个手写 AgenticSkillSpec fixture（覆盖典型 inputsNeeded / expectedOutput 组合）
  - mock adapter 返回预设 JSON
  验收: fixture 跑通 template → fill intake → mock run → extract artifact → schema 校验通过
  风险闸: 如果发现 5 个 fixture 里 ≥ 2 个跑不通，停下来重新评估强制 JSON 决策

Phase 2: Builder 管线（mock extraction）
  - apps/share-gateway/src/miniapp/production/extraction/cloudExtractionHarness.ts（mock 实现：从 fixture 返回 ExtractionResult）
  - apps/share-gateway/src/miniapp/production/skill/skillDrafting.ts（直接标 reviewed，跳过 patch）
  - apps/share-gateway/src/miniapp/production/builder/buildCompiler.ts（组合三个子编译器）
  - apps/share-gateway/src/miniapp/production/builder/runtimePolicyCompiler.ts
  - apps/share-gateway/src/miniapp/production/builder/uiPlanCompiler.ts
  - 测试: 一份 fixture raw input → 完整 buildSpec；buildSpec snapshot 测试
  验收: fixture → ExtractionResult → AgenticSkillSpec → MiniappBuildSpec 全链路通；promptTemplate 输出稳定

Phase 3: Publish + Share Link
  - 先在 productization/routes.ts 抽 submitShareRuntime（消费链路问题 2）；普通聊天回归测必须 100% 通过
  - apps/share-gateway/src/miniapp/production/eval/evalRunner.ts（mock checks，evalCases 走 skill.evalCases）
  - apps/share-gateway/src/miniapp/production/eval/mockConsumption.ts
  - apps/share-gateway/src/miniapp/production/routes/ownerMiniapps.ts 的 publish handler
  - apps/share-gateway/src/miniapp/consumption/routes/friendMiniapps.ts 的 GET /miniapp（landing）
  验收: fixture → buildSpec → evalReport.publishGate='allow' → publish → ShareLink + PublishedMiniappRecord 都创建；token 能解析到 miniapp landing

Phase 4: MiniappRunEngine
  - apps/share-gateway/src/miniapp/consumption/runtime/miniappRunEngine.ts
  - apps/share-gateway/src/miniapp/consumption/runtime/inputResolver.ts
  - apps/share-gateway/src/miniapp/consumption/runtime/runtimeEventIngest.ts
  - recordHostCommandEventsV1 挂 ingestIfMiniappTask hook
  - apps/share-gateway/src/miniapp/consumption/routes/friendMiniapps.ts 的 POST /miniapp-runs + GET /miniapp-runs/:runId
  - 启动入口加 reconcileMiniappStores
  验收: mock runtime 下 fixture → POST /miniapp-runs → run completed → artifact 提取成功；RelayStore 有 task/events；ConsumptionStore 有 run/artifact
```

### 6.3 每个 Phase 的"何时停下来"

Phase 1 停止条件：
- shared 三个类型的 schema 改了三次以上 → 停下来重新讨论字段，别继续往下推。

Phase 1.5 停止条件：
- 5 个 fixture 里超过 1 个跑不通 → 重新评估强 JSON 决策（消费链路问题 4）。

Phase 2 停止条件：
- buildCompiler 跑出来的 promptTemplate 在 Phase 1.5 fixture 上回归失败 → 停下来对齐两边的 prompt 结构假设。

Phase 3 停止条件：
- `submitShareRuntime` 抽完之后，普通聊天的 share runtime 现有测试有任何一条挂 → 立即回滚抽象，重做。

Phase 4 停止条件：
- ingest hook 挂上之后，share runtime 现有的非 miniapp task 处理有任何回归 → 立即把 hook 摘掉，重做条件判断逻辑。

---

## 7. 设计决策汇总（共 14 条 + 3 条新增）

| 来源 | # | 决策 |
|---|---|---|
| 消费 1 | 削 `MiniappRunRecord` 状态机至 5 态 |
| 消费 2 | 抽 `submitShareRuntime`，4 道闸 100% 复用 |
| 消费 3 | MVP 不支持 mid-run approval；高风险动作 build 时静态拦截 |
| 消费 4 | 强制 fenced JSON artifact，失败 fail-fast |
| 消费 5 | 启动跑 `reconcileMiniappStores` |
| 消费 6 | 砍掉 follow-up `POST /messages` |
| 消费 7 | publishGate 只保留 allow/block |
| 生产 P1 | Extraction 异步 job + 轮询 |
| 生产 P2 | P1-P4 跳过 skill draft patch；UI 后置 |
| 生产 P3 | evalCases 唯一来源 = `skill.evalCases` |
| 生产 P4 | UI 改 = 重 build；接受不完美 |
| 生产 P5 | publish 不可改；改 = 新建 miniapp |
| 生产 P6 | RawInputPackage chunks 走 blob，store 只存 ref |
| 生产 P7 | Extraction prompt 跟代码 commit，promptVersion 绑 git sha |
| 结构 1 | 代码按 shared / production / consumption 三层拆 |
| 结构 2 | `MiniappStore` 拆成 ProductionStore + ConsumptionStore |
| 结构 3 | `promptCompiler` 拆 build-time + run-time 两半 |

---

## 8. 第一个 PR 的建议范围

不要一上来把这 17 条决策全部落代码。第一个 PR 建议范围限定为：

- shared/ 三个类型 + schema validator
- production/ 和 consumption/ 两个 Store 的 roundtrip + journal recovery
- `apps/share-gateway/src/miniapp/index.ts` 导出
- 配套测试（store roundtrip / type validation）
- **不**包含 routes、不包含 builder、不包含 runtime

理由：
- 17 条决策里，shared 契约和 Store schema 是后期改动代价最高的两块，必须先冻结。
- 后续 4-6 个 PR 一个 Phase 一个 PR，逐步推进。
- 每个 PR 都附"何时停下来"对应章节，避免越界。

---

## 9. 已有方案没说但本文建议补的事

1. **Reconciliation worker**：双 store 跨事务的孤儿对账。启动跑一次，运行时不需要（journal 已经保证单 store 一致性）。
2. **Extraction harness async pattern**：job table + 轮询 + retry 上限 + 超时。
3. **AgenticSkillSpec schema 版本化策略**：加字段 / 改字段 / 删字段的规则；migration 何时写。
4. **promptTemplate 的 placeholder 校验**：`promptCompiler` 必须校验所有 placeholder 都被 intake 填满，否则 run 立刻 failed（不要让模型看到未填的 `{{intake.xxx}}` 字面量）。
5. **RawInputPackage 的 blob 存储抽象**：P6 决策里说 hardcode 本地路径，但 store schema 要预留 `chunkRef: { kind, location }`，将来换 S3 不用迁移老数据。

---

## 10. 不在本文范围

- Creator UI 的 React 实现（P5）
- 真实云端 Agent extraction harness（P6）
- Auto Eval 真实 checks（P6）
- AG-UI 事件协议改造（消费侧问题 1 削状态机后这部分可能要重新评估）
- A2UI / GeneratedUiPlan 受控组件注册表的字段约定（uiPlanCompiler 出来后再确定）
- 多 owner / 多 tenancy 隔离（MVP 单 owner 假设）

---

## 11. 后端实现者读完本文之后

如果以上 17 条决策都同意，下一步：

1. 给本文 PR 评论 +1。
2. 开 Phase 1 的 issue：拆成 5-7 个小 task（shared 三类型 + 两 store + 测试 + index export）。
3. 第一个实现 PR 严格按 §8 范围；不要捎带任何 runtime / builder 代码。
4. Phase 1 合并后立刻进 Phase 1.5（promptTemplate 冒烟），这一步是整条路线最大的不确定性来源，越早暴露问题越好。
