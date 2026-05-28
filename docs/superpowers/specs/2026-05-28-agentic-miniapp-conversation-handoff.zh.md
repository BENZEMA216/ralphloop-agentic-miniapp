# Agentic Miniapp 会话交接记录

**日期:** 2026-05-28  
**用途:** 给后端同学快速理解本轮讨论背景、已定方向、被否方案和后续切入点。  
**说明:** 本文是整理后的交接记录，不是逐字聊天记录；已去除无关执行细节和本地临时噪音。

---

## 1. 原始问题

我们最初讨论的是一张流程图里红框部分：

```text
用户本地上下文一键导入
  -> 敏感信息过滤
  -> miniapp 预提取
  -> 一个有不错交互的 Agent
     - 基础 metadata
     - 交互组件
     - 提取后可用性测试
     - Pi Agent / Gen UI / Auto Eval
  -> miniapp 发布
  -> 平台处理
```

目标是把用户真实上下文中重复出现的工作流，沉淀成一个可分享、可运行、带交互体验的 miniapp。

---

## 2. 讨论过的核心问题

### 2.1 隐私与 MVP 效果验证

一开始讨论过本地 privacy pass、脱敏摘要、云端分析、本地分析等模式。最终收敛为：

- MVP 先从效果验证出发。
- 产品上只保留一个主路径：云端 Agent 分析用户提供的 Raw Input。
- 暂不做本地 privacy path、多模式选择器、balanced/local-only/boost 三模式。
- 架构上保留 `AnalysisHarness` 接口，未来可以把云端 Agent extraction 换成本地用户自己的 Agent 能力。

对应文档：

- `docs/superpowers/specs/2026-05-28-agentic-miniapp-builder-mvp-io-contract.zh.md`

### 2.2 Raw Input 的定义

讨论中澄清了一个重要点：Raw Input 不应该“输出 raw context bundle”。更准确的说法是：

> 用户提交的异构原始材料会被标准化成 `RawInputPackage`，作为 Candidate Extraction 的统一输入。

`RawInputPackage` 的作用不是隐私处理，而是工程标准化：

- 统一聊天记录、文档、任务历史、网页、手工备注等来源。
- 建立 source/chunk/ref 映射。
- 支持 extraction 回放和调试。
- 支持未来云端/本地 harness 复用同一 I/O。

### 2.3 Candidate Extraction 的边界

我们明确了 Candidate Extraction 的输出不应该直接是 manifest 或 miniapp。

它应该输出：

- `ExtractionResult`
- `CapabilityCandidate[]`
- evidence refs
- rejected ideas
- warnings
- generation hints

它可以使用 GenAI，但不应该在这个阶段直接完成 UI、runtime policy 或发布契约。

### 2.4 Manifest 是否太独特

讨论中对 `AgenticAppManifest` 产生了明显质疑：

- 它看起来像自创协议，和主流 agentic harness 不够贴近。
- 它混合了 skill、runtime policy、UI profile、eval、publish metadata 等多种职责。
- `interaction.ui_profile.components` 尤其不自然，像是把 UI schema 放进了能力契约。

我们调研了 OpenAI Apps/Agents/Skills、Claude Skills、Agent Skills spec、MCP、Microsoft Copilot declarative agents、Dify、LangGraph 等实践后，结论是：

> 核心交接物不应该是一个大一统 manifest，而应该更像通用的 `AgenticSkillSpec`。Manifest 或 build spec 可以存在，但应降级为平台内部编译产物。

### 2.5 Miniapp 不是独立代码工程

一版设计曾把 miniapp 描述成一组 `skill.md`、`ui-plan.json`、`evaluation-report.json` 文件。但这个结构不足以实现功能。

后来重新定性：

> miniapp 不是一个独立代码工程，而是 share-gateway/share-web-react 平台中的一个可运行对象。

miniapp 自身是数据化的：

- `AgenticSkillSpec`
- `MiniappBuildSpec`
- `GeneratedUiPlan`
- `EvaluationReport`
- `PublishedMiniappRecord`

真正让它跑起来的是平台模块：

- `MiniappStore`
- `MiniappRunEngine`
- `promptCompiler`
- `runtimeEventIngest`
- `artifactExtractor`
- routes
- React runner UI

---

## 3. 当前推荐架构

### 3.1 主链路

```text
RawInputPackage
  -> ExtractionResult
  -> AgenticSkillDraft
  -> ReviewedAgenticSkill
  -> MiniappBuildSpec
  -> GeneratedUiPlan
  -> EvaluationReport
  -> PublishedMiniappRecord
  -> MiniappRunEngine
  -> Existing share task flow
  -> Owner host base adapter
  -> RuntimeEvent
  -> ArtifactRecord
  -> React MiniappRunShell
```

### 3.2 MVP 运行策略

MVP 不新增 host-side miniapp adapter，也不新增 `HostCommand` 类型。

现有 owner host 只知道：

```text
task.submit(adapterId, prompt)
```

因此 MVP 策略是：

1. Gateway 读取 miniapp skill/build spec。
2. 消费者提交 intake。
3. Gateway 编译 `runtimePrompt`。
4. 现有 share task flow 把 prompt 发给 owner host。
5. owner host 用 Codex/Claude/OpenCode 等 base adapter 执行。
6. Gateway ingest `RuntimeEvent`。
7. Gateway 提取 artifact 并更新 miniapp run。

后续如果要升级，可以让 owner host 安装 miniapp harness，再引入 `MiniappProviderAdapter`。

### 3.3 核心代码模块

后端新增：

```text
apps/share-gateway/src/miniapp/
  domain/
  store/
  extraction/
  skill/
  builder/
  runtime/
  eval/
  routes/
```

前端新增：

```text
apps/share-web-react/src/miniapp/
  api/
  creator/
  runner/
  a2ui/
  state/
```

最重要的后端模块：

- `MiniappStore`: 保存 miniapp 产品对象。
- `MiniappRunEngine`: 执行消费者的一次 miniapp run。
- `promptCompiler`: 把 skill + intake 编译成 runtime prompt。
- `runtimeEventIngest`: 把现有 RuntimeEvent 同步到 miniapp run。
- `artifactExtractor`: 把 agent 输出变成 artifact。
- `evalRunner`: 生成 EvaluationReport 并作为 publish gate。

---

## 4. 关键文档阅读顺序

建议后端同学按这个顺序读：

1. `docs/superpowers/specs/2026-05-28-agentic-miniapp-conversation-handoff.zh.md`
   - 先理解讨论脉络和最终收敛方向。

2. `docs/superpowers/specs/2026-05-28-agentic-miniapp-code-architecture.zh.md`
   - 重点文档，讲真正的代码结构、模块图、调用路径、store、routes、run engine、artifact、eval 和落地顺序。

3. `docs/superpowers/specs/2026-05-28-agentic-miniapp-builder-mvp-io-contract.zh.md`
   - 理解 Raw Input、ExtractionResult、SkillDraft、GeneratedUiPlan、EvaluationReport 的 I/O。

4. `docs/superpowers/specs/2026-05-28-agentic-miniapp-builder-requirements-architecture.zh.md`
   - 早期需求与架构讨论稿，部分内容已被后续文档修正。

5. `docs/superpowers/specs/2026-05-28-agentic-app-manifest-a2ui-bridge-spec.zh.md`
   - 早期 manifest 方案参考。注意：这里的 manifest 作为权威交接物的方向后来被弱化，建议只作为历史背景和字段素材参考。

---

## 5. 已定方向

- MVP 只有一个产品模式：云端 Agent 分析。
- Raw Input 标准化为 `RawInputPackage`。
- Candidate Extraction 输出 `ExtractionResult`，不是 miniapp。
- 核心能力表达应改为 `AgenticSkillSpec`，而不是大一统 `AgenticAppManifest`。
- UI plan 是平台内部推导产物，不是核心通用协议。
- MVP 不新增 host command，也不要求 owner host 理解 miniapp package。
- Gateway 负责编译 runtime prompt。
- Existing share task flow 继续负责把 prompt 送到 owner host/base adapter。
- Artifact 是 miniapp 的关键用户价值，不能只展示聊天文本。
- Publish 必须经过 EvaluationReport gate。

---

## 6. 仍待后端确认的问题

1. `submitFriendTaskV1` 是否抽出内部 `submitShareRuntime(displayPrompt, runtimePrompt)`，以支持普通聊天和 miniapp 共用链路？
2. `MiniappStore` 是否完全独立于 `RelayStore`，还是先扩展 `RelayData`？
3. `runtimeEventIngest` 应该挂在 host events 接收处，还是由 polling/worker 异步同步？
4. Artifact MVP 用 markdown fallback，还是第一版强制 structured JSON？
5. Creator UI 是否在第一阶段实现，还是先用 API/test fixture 生成 miniapp？
6. Auto Eval 第一版是否只用 mock provider，还是接一个真实 base adapter smoke？
7. `AgenticSkillSpec` 是否要直接兼容 Claude Skills / Agent Skills 风格的 Markdown skill？

---

## 7. 建议后端第一步

不要从 UI 或 extraction harness 开始。

建议第一步做：

```text
Miniapp domain types
  + MiniappStore
  + buildSpec fixture
  + promptCompiler
  + artifactExtractor
  + MiniappRunEngine mock runtime test
```

原因：

- 这能最快验证“miniapp 能不能作为平台对象跑起来”。
- Extraction 和 Creator UI 都可以后置。
- 先把 run engine 跑通，后面才知道 skill/output/eval 字段是否够用。

---

## 8. 当前仓库状态

本轮主要产物是架构和交接文档，还没有实现 miniapp 代码。

已存在可复用基础：

- `apps/share-gateway/src/adapters/provider.ts`
- `apps/share-gateway/src/adapters/providerRegistry.ts`
- `apps/share-gateway/src/adapters/types.ts`
- `apps/share-gateway/src/productization/routes.ts`
- `apps/share-gateway/src/productization/hostCommands.ts`
- `apps/share-gateway/src/productization/hostClient.ts`
- `apps/share-gateway/src/productization/relayStore.ts`
- `apps/share-web-react/src/App.ts`

主要新增实现位置应从：

- `apps/share-gateway/src/miniapp/`
- `apps/share-web-react/src/miniapp/`

开始。
