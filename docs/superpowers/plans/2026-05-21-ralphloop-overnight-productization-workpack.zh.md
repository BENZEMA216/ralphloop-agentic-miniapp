# Ralphloop Overnight Productization Workpack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not use subagents unless the user explicitly authorizes delegation.

**Goal:** 给 Ralphloop 准备一个可跑 8 小时以上的产品化夜间工作包，让实现按安全边界、Host 运行时、朋友体验和验收证据持续推进。

**Architecture:** 继续采用 Desktop Agent Host + Share Relay + Friend Web 的混合架构。每个任务块都必须在现有 productization API、RelayStore、HostRuntimeRegistry 和 HTTP server 上做小步扩展，并把验收标准绑定到自动化测试。

**Tech Stack:** TypeScript, Node HTTP server, `node:test`, Ralphloop productization RelayStore/routes/httpServer, existing adapter registry, existing `npm` validation scripts.

---

## 0. 结论

单独的 **Host 认证与心跳鉴权** 不需要跑 8 小时，合理工作量约 1.5 到 2 小时。

但如果目标是把 Ralphloop 往“朋友可真实使用创建者桌面 Agent Host”的产品化方向推进，今晚应该跑一个更大的工作包。这个工作包预计 8 到 10 小时，按块提交，跑到明天早上停在哪个绿色提交都可以。

推荐今晚执行顺序：

1. Host 认证与心跳鉴权。
2. Relay 到 Host 指令绑定。
3. 创建者撤销和 kill 传播到 runtime。
4. Host 离线与重连硬化。
5. 朋友匿名身份 v0。
6. 朋友授权入口 stub。
7. 只读预览流硬化。
8. 真实 adapter smoke 加固。
9. 文档、验收矩阵和状态回写。

## 0.1 完成状态（2026-05-22）

- 状态：Work Block 0～9 已完成并合入 `main`。
- 证据：见 `docs/superpowers/plans/2026-05-22-ralphloop-overnight-validation-report.zh.md`（含 commit 列表、AC-001～AC-014 覆盖点与新鲜验证证据）。

## 1. 当前基线

### 已完成能力

- 多 adapter 清单和本地 adapter MVP。
- 产品化 RelayStore、Host 注册、Host heartbeat、Owner/Friend/Host HTTP API 基础合同。
- Host runtime registry 与 friend task 到 adapter 的路由。
- 分享链接创建、patch、撤销、朋友 session、朋友 task、事件读取、预览 HTTP API。
- 高风险动作 gate、审批和确认 API。
- Owner Console 的 link/history/usage/audit/control 基础视图。
- 限流、session TTL、预算控制、朋友端成本隐藏。

### 关键缺口

- Host 注册和心跳仍需要强鉴权。
- Relay 下发给 Host/runtime 的指令还需要 owner、host、session、policy 绑定的命令合同。
- 创建者 cancel/revoke 后，需要证明正在运行的 runtime 被停止或隔离。
- Host offline、heartbeat timeout 和 reconnect 的状态还需要更严格的产品语义。
- 朋友 identity 需要 v0 模型，避免所有确认、授权和审计都只是裸匿名。
- 朋友自己的授权入口需要先有最小 gateway，即使 OAuth 先不完整实现。
- Preview stream 需要更明确的 session 绑定、体积限制、过期处理和泄露扫描。
- 真实 adapter smoke 还需要证明至少一个非 fake adapter 可通过产品化路径被调用。
- 产品化 spec、实施计划和验收状态需要回写，否则自动化任务容易重复跑同一类工作。

## 2. 夜间执行原则

- 每个任务块结束必须运行该块的聚焦测试和必要全量验证。
- 每个任务块通过后单独 commit；如果验证失败，先修复，不带失败状态进入下一块。
- 如果一个块卡住超过 30 分钟，记录阻塞原因，回滚未完成思路到可验证状态，转入下一个独立块。
- 不碰无关未跟踪目录，例如 `agora-demo/`。
- 不引入生产 OAuth、mTLS、云端部署、公开 marketplace 或企业权限系统。
- 朋友端继续不展示成本、密钥、模型配置、owner-only audit 和内部失败细节。
- 安全类验收必须检查 API 响应、事件流或 audit log，不能只看 UI。

## 3. 全局验收门槛

夜间任务结束时，最终报告必须包含：

- 已完成任务块列表。
- 每个任务块对应 commit hash。
- 每个任务块运行过的聚焦验证命令。
- 最后一轮全量验证命令和结果。
- 未完成任务块和阻塞原因。
- 产品化 AC 覆盖矩阵更新状态。

每次准备声明完成前，至少运行：

```bash
npm test
npm run lint
npm run typecheck
npm run build
npm run test:contract
npm run test:integration
npm run test:security
npm run test:e2e
npm run test:smoke:real-adapter
git diff --check
```

如果时间紧张，任务块内可以先跑聚焦测试；但最终收口必须跑上面的全量命令。

## 4. Work Block 0: Baseline Sanity

**Estimate:** 15 到 20 分钟。

**Purpose:** 开始长跑前确认工作区、测试脚本、spec 缺口和最近提交状态。

**Files:**

- Read: `docs/superpowers/specs/2026-05-21-personal-agent-share-productization-spec.zh.md`
- Read: `docs/superpowers/plans/2026-05-21-ralphloop-host-auth-acceptance.zh.md`
- Read: `package.json`
- No code changes.

**Acceptance:**

- 记录当前 `git status --short`。
- 记录最近 5 个 commit。
- 记录产品化 AC-001 到 AC-014 的当前缺口。
- 确认今晚第一块从 Host auth 开始。

**Steps:**

- [x] **Step 1: Check git baseline**

  Run:

  ```bash
  git status --short
  git log -5 --oneline
  ```

  Expected: only unrelated untracked files may appear; do not modify them.

- [x] **Step 2: Re-read core productization ACs**

  Run:

  ```bash
  sed -n '680,830p' docs/superpowers/specs/2026-05-21-personal-agent-share-productization-spec.zh.md
  ```

  Expected: security and AC-001 to AC-014 are visible.

- [x] **Step 3: Re-read next acceptance doc**

  Run:

  ```bash
  sed -n '1,260p' docs/superpowers/plans/2026-05-21-ralphloop-host-auth-acceptance.zh.md
  ```

  Expected: Host auth acceptance criteria are clear.

- [x] **Step 4: Run current smoke validation**

  Run:

  ```bash
  npm run test:contract
  npm run test:security
  git diff --check
  ```

  Expected: all exit 0 before implementation begins.

## 5. Work Block 1: Host 认证与心跳鉴权

**Estimate:** 1.5 到 2 小时。

**Purpose:** 把 Host 入口从裸请求升级为最小可信设备身份。

**Files:**

- Modify: `apps/share-gateway/src/productization/types.ts`
- Modify: `apps/share-gateway/src/productization/token.ts`
- Modify: `apps/share-gateway/src/productization/relayStore.ts`
- Modify: `apps/share-gateway/src/productization/routes.ts`
- Modify: `apps/share-gateway/src/productization/httpServer.ts`
- Modify: `apps/share-gateway/src/productization/dev.ts`
- Test: `apps/share-gateway/test/productization/security.test.ts`
- Test: `apps/share-gateway/test/productization/routes.test.ts`
- Test: `apps/share-gateway/test/productization/httpServer.test.ts`

**Acceptance:**

- `POST /v1/hosts/register` 缺少 `x-ralphloop-bootstrap-secret` 返回 `401 { "error": "host_auth_required" }`。
- 注册成功返回公共 Host 信息和只返回一次的 `deviceKey`。
- 存储层只保存 `deviceKeyHash`，不保存明文 `deviceKey` 或 bootstrap secret。
- `POST /v1/hosts/:hostId/heartbeat` 必须带 `x-ralphloop-device-key`。
- 错误 key 或跨 Host key 返回 `403 { "error": "host_auth_invalid" }`。
- 认证失败写 audit，但 audit 不含明文 key。
- Owner/Friend API 响应不包含 `deviceKey`、`deviceKeyHash`、`bootstrapSecret`、明文 auth header。
- `npm run dev:productized` 仍可使用本地 demo 默认 secret 启动。

**Steps:**

- [x] **Step 1: Write failing security tests**

  Add tests in `apps/share-gateway/test/productization/security.test.ts` for missing bootstrap secret, no plaintext key persistence, and owner/friend response leak scan.

  Run:

  ```bash
  node scripts/test.mjs apps/share-gateway/test/productization/security.test.ts
  ```

  Expected: FAIL on missing host auth enforcement.

- [x] **Step 2: Write failing route tests**

  Add tests in `apps/share-gateway/test/productization/routes.test.ts` for successful registration, missing heartbeat key, wrong heartbeat key, and cross-host key rejection.

  Run:

  ```bash
  node scripts/test.mjs apps/share-gateway/test/productization/routes.test.ts
  ```

  Expected: FAIL on missing route-level auth logic.

- [x] **Step 3: Write failing HTTP tests**

  Add tests in `apps/share-gateway/test/productization/httpServer.test.ts` for header contract and sanitized error bodies.

  Run:

  ```bash
  node scripts/test.mjs apps/share-gateway/test/productization/httpServer.test.ts
  ```

  Expected: FAIL on missing HTTP auth extraction.

- [x] **Step 4: Implement token helpers**

  Add or reuse helpers in `apps/share-gateway/src/productization/token.ts` for random device key creation and one-way hashing.

- [x] **Step 5: Extend Host model**

  Add `deviceKeyHash` and `registeredAt` to Host storage types in `types.ts` and `relayStore.ts`. Public serializers must omit hash and secret fields.

- [x] **Step 6: Enforce register auth**

  Update `registerHostV1` or equivalent route in `routes.ts` to require bootstrap secret and emit sanitized audit logs.

- [x] **Step 7: Enforce heartbeat auth**

  Update heartbeat route and HTTP handler to require and validate `x-ralphloop-device-key`.

- [x] **Step 8: Preserve local demo**

  Update `apps/share-gateway/src/productization/dev.ts` to set a local-only bootstrap secret and use returned `deviceKey` for demo heartbeat.

- [x] **Step 9: Run focused validation**

  Run:

  ```bash
  node scripts/test.mjs apps/share-gateway/test/productization/security.test.ts
  node scripts/test.mjs apps/share-gateway/test/productization/routes.test.ts
  node scripts/test.mjs apps/share-gateway/test/productization/httpServer.test.ts
  npm run test:contract
  npm run test:security
  git diff --check
  ```

  Expected: all exit 0, 0 failures.

- [x] **Step 10: Commit**

  ```bash
  git add apps/share-gateway/src/productization apps/share-gateway/test/productization
  git diff --cached --check
  git commit -m "Add Ralphloop host auth enforcement"
  ```

## 6. Work Block 2: Relay 到 Host 指令绑定

**Estimate:** 1 到 1.5 小时。

**Purpose:** 给 Relay 下发到 Host/runtime 的动作建立结构化 command envelope，避免朋友 task 或 owner control 绕过 owner、host、session、policy 绑定。

**Files:**

- Create: `apps/share-gateway/src/productization/hostCommands.ts`
- Modify: `apps/share-gateway/src/productization/types.ts`
- Modify: `apps/share-gateway/src/productization/hostRuntime.ts`
- Modify: `apps/share-gateway/src/productization/routes.ts`
- Test: `apps/share-gateway/test/productization/hostCommands.test.ts`
- Test: `apps/share-gateway/test/productization/hostRuntime.test.ts`
- Test: `apps/share-gateway/test/productization/routes.test.ts`

**Acceptance:**

- 所有 Host command 都包含 `ownerId`、`hostId`、`sessionId`、`shareLinkId`、`policyVersion`、`commandType`。
- 支持最小命令：`runtime.start`、`task.submit`、`session.cancel`、`runtime.stop`、`policy.update`。
- owner、host、session 或 share link 不匹配时拒绝执行。
- policy snapshot 或 policy version 缺失时拒绝执行。
- 拒绝路径写 audit，朋友端继续收到中性错误。

**Steps:**

- [x] **Step 1: Write failing command contract tests**

  Run:

  ```bash
  node scripts/test.mjs apps/share-gateway/test/productization/hostCommands.test.ts
  ```

  Expected: FAIL because `hostCommands.ts` does not exist.

- [x] **Step 2: Implement command envelope types**

  Add `HostCommand`, `HostCommandType`, `buildHostCommand`, and `validateHostCommandBinding` in `hostCommands.ts`.

- [x] **Step 3: Bind friend task submission**

  In `routes.ts`, create a command before invoking `HostRuntimeRegistry` for task execution. The command must be derived from the resolved owner, host, link, session and policy.

- [x] **Step 4: Bind owner cancel controls**

  In owner cancel/revoke flows, create a `session.cancel` or `runtime.stop` command before touching runtime state.

- [x] **Step 5: Run focused validation**

  Run:

  ```bash
  node scripts/test.mjs apps/share-gateway/test/productization/hostCommands.test.ts
  node scripts/test.mjs apps/share-gateway/test/productization/hostRuntime.test.ts
  node scripts/test.mjs apps/share-gateway/test/productization/routes.test.ts
  npm run test:contract
  npm run test:security
  git diff --check
  ```

  Expected: all exit 0.

- [x] **Step 6: Commit**

  ```bash
  git add apps/share-gateway/src/productization apps/share-gateway/test/productization
  git diff --cached --check
  git commit -m "Add Ralphloop host command binding"
  ```

## 7. Work Block 3: 创建者撤销和 Kill 传播到 Runtime

**Estimate:** 1 到 1.5 小时。

**Purpose:** 让 AC-010 真的成立：创建者撤销 link 或 cancel session 后，不只是数据库状态变化，Host runtime 也必须停止或隔离对应任务。

**Files:**

- Modify: `apps/share-gateway/src/productization/hostRuntime.ts`
- Modify: `apps/share-gateway/src/productization/relayStore.ts`
- Modify: `apps/share-gateway/src/productization/routes.ts`
- Modify: `apps/share-gateway/src/productization/httpServer.ts`
- Test: `apps/share-gateway/test/productization/controls.test.ts`
- Test: `apps/share-gateway/test/productization/taskFlow.test.ts`
- Test: `apps/share-gateway/test/productization/hostRuntime.test.ts`

**Acceptance:**

- owner cancel session 调用 runtime stop/cancel，并记录调用参数。
- owner revoke active link 后，新任务立即拒绝，已运行 session 被 cancelled/stopped。
- runtime stop 失败时，session 进入 `stopping_failed` 或等价 owner-visible 状态，朋友端不泄露内部错误。
- kill/revoke 优先级高于普通 task submit。
- audit 记录 link、session、task、actor、reason、runtime result。

**Steps:**

- [x] **Step 1: Write failing runtime stop tests**

  Add test adapter with observable `stop` calls in `hostRuntime.test.ts`.

  Run:

  ```bash
  node scripts/test.mjs apps/share-gateway/test/productization/hostRuntime.test.ts
  ```

  Expected: FAIL until runtime stop propagation exists.

- [x] **Step 2: Write failing owner control tests**

  Add route and HTTP tests in `controls.test.ts` for cancel and revoke propagation.

  Run:

  ```bash
  node scripts/test.mjs apps/share-gateway/test/productization/controls.test.ts
  ```

  Expected: FAIL until owner controls call runtime stop.

- [x] **Step 3: Implement stop contract in HostRuntimeRegistry**

  Add a registry method that can stop by `hostId`, `sessionId`, `taskId`, and `adapterId`, using existing adapter capabilities where available.

- [x] **Step 4: Wire owner controls**

  Update owner cancel/revoke route functions to call runtime stop before or during state transition, and persist the outcome.

- [x] **Step 5: Enforce kill priority**

  Ensure task submission checks link/session status again immediately before runtime call.

- [x] **Step 6: Run focused validation**

  Run:

  ```bash
  node scripts/test.mjs apps/share-gateway/test/productization/controls.test.ts
  node scripts/test.mjs apps/share-gateway/test/productization/taskFlow.test.ts
  node scripts/test.mjs apps/share-gateway/test/productization/hostRuntime.test.ts
  npm run test:integration
  npm run test:security
  git diff --check
  ```

  Expected: all exit 0.

- [x] **Step 7: Commit**

  ```bash
  git add apps/share-gateway/src/productization apps/share-gateway/test/productization
  git diff --cached --check
  git commit -m "Propagate Ralphloop owner kill to runtime"
  ```

## 8. Work Block 4: Host 离线、Heartbeat Timeout 与重连

**Estimate:** 45 到 75 分钟。

**Purpose:** 补齐 AC-011 和 AC-014 的基础状态机，避免 Host 假在线、朋友看到内部错误、创建者不知道为什么不可用。

**Files:**

- Modify: `apps/share-gateway/src/productization/relayStore.ts`
- Modify: `apps/share-gateway/src/productization/hostRuntime.ts`
- Modify: `apps/share-gateway/src/productization/routes.ts`
- Modify: `apps/share-gateway/src/productization/httpServer.ts`
- Test: `apps/share-gateway/test/productization/hostRuntime.test.ts`
- Test: `apps/share-gateway/test/productization/routes.test.ts`
- Test: `apps/share-gateway/test/productization/httpServer.test.ts`

**Acceptance:**

- heartbeat 超时后 Host 标记为 offline。
- Host offline 时朋友打开 link 或提交 task 得到中性 unavailable 状态。
- owner hosts/adapters API 展示 `status`、`lastSeenAt`、`offlineReason` 或等价字段。
- Host reconnect 后可以恢复 online，并更新 adapter list。
- offline/reconnect 写 audit。

**Steps:**

- [x] **Step 1: Write failing timeout tests**

  Use mutable clock in RelayStore tests or routes tests.

  Run:

  ```bash
  node scripts/test.mjs apps/share-gateway/test/productization/routes.test.ts
  ```

  Expected: FAIL until timeout is enforced.

- [x] **Step 2: Implement heartbeat timeout helper**

  Add a store or route helper to mark stale hosts offline based on configured timeout.

- [x] **Step 3: Sanitize friend offline responses**

  Update friend share/task routes so offline response never includes internal Host details.

- [x] **Step 4: Add reconnect behavior**

  Heartbeat with valid device key should transition offline Host back to online and refresh adapters.

- [x] **Step 5: Run focused validation**

  Run:

  ```bash
  node scripts/test.mjs apps/share-gateway/test/productization/routes.test.ts
  node scripts/test.mjs apps/share-gateway/test/productization/httpServer.test.ts
  npm run test:integration
  npm run test:security
  git diff --check
  ```

  Expected: all exit 0.

- [x] **Step 6: Commit**

  ```bash
  git add apps/share-gateway/src/productization apps/share-gateway/test/productization
  git diff --cached --check
  git commit -m "Harden Ralphloop host offline handling"
  ```

## 9. Work Block 5: 朋友身份 v0

**Estimate:** 45 到 75 分钟。

**Purpose:** 在不引入完整登录系统的情况下，让朋友 session 有最小 identity profile，支撑确认、授权和审计。

**Files:**

- Modify: `apps/share-gateway/src/productization/types.ts`
- Modify: `apps/share-gateway/src/productization/relayStore.ts`
- Modify: `apps/share-gateway/src/productization/routes.ts`
- Modify: `apps/share-gateway/src/productization/httpServer.ts`
- Test: `apps/share-gateway/test/productization/routes.test.ts`
- Test: `apps/share-gateway/test/productization/httpServer.test.ts`
- Test: `apps/share-gateway/test/productization/security.test.ts`

**Acceptance:**

- friend session 默认创建 `friendActorId`，例如 `anon_<opaque-id>`。
- 允许可选 `displayName`，但必须限制长度并做输出转义或结构化返回。
- friend confirmation、approval request、task audit 都绑定 `friendActorId`。
- 同一个 share token 下不同 friend session 不能互相确认或读取彼此 task/events/preview。
- 朋友端仍不需要注册账号。

**Steps:**

- [x] **Step 1: Write failing session identity tests**

  Run:

  ```bash
  node scripts/test.mjs apps/share-gateway/test/productization/routes.test.ts
  ```

  Expected: FAIL until friend identity model is explicit.

- [x] **Step 2: Extend session model**

  Add friend identity fields to session records and public friend response.

- [x] **Step 3: Bind confirmations and audit**

  Update confirmation and approval flows to record `friendActorId`.

- [x] **Step 4: Add cross-session denial tests**

  Ensure events, preview, and confirmations require the matching session.

- [x] **Step 5: Run focused validation**

  Run:

  ```bash
  node scripts/test.mjs apps/share-gateway/test/productization/routes.test.ts
  node scripts/test.mjs apps/share-gateway/test/productization/httpServer.test.ts
  node scripts/test.mjs apps/share-gateway/test/productization/security.test.ts
  npm run test:integration
  npm run test:security
  git diff --check
  ```

  Expected: all exit 0.

- [x] **Step 6: Commit**

  ```bash
  git add apps/share-gateway/src/productization apps/share-gateway/test/productization
  git diff --cached --check
  git commit -m "Add Ralphloop friend identity v0"
  ```

## 10. Work Block 6: 朋友授权入口 Stub

**Estimate:** 45 到 75 分钟。

**Purpose:** 给“朋友使用自己的权限”建立产品入口。OAuth 不在今晚完整实现，但 API 必须先有 session-bound gateway 和安全响应。

**Files:**

- Create: `apps/share-gateway/src/productization/friendAuth.ts`
- Modify: `apps/share-gateway/src/productization/types.ts`
- Modify: `apps/share-gateway/src/productization/relayStore.ts`
- Modify: `apps/share-gateway/src/productization/routes.ts`
- Modify: `apps/share-gateway/src/productization/httpServer.ts`
- Test: `apps/share-gateway/test/productization/friendAuth.test.ts`
- Test: `apps/share-gateway/test/productization/httpServer.test.ts`
- Test: `apps/share-gateway/test/productization/security.test.ts`

**Acceptance:**

- 新增 `POST /v1/share/:token/auth/:provider/start` 或等价 route。
- V0 支持 `manual`、`file` provider 的结构化 pending 状态。
- 未配置的 OAuth provider 返回 `auth_not_configured`，不泄露 provider secret。
- auth request 必须绑定 token、link、session、friendActorId 和 policy。
- auth request 写 audit。
- friend auth response 不包含 owner credential、provider secret 或成本字段。

**Steps:**

- [x] **Step 1: Write failing friend auth tests**

  Run:

  ```bash
  node scripts/test.mjs apps/share-gateway/test/productization/friendAuth.test.ts
  ```

  Expected: FAIL because friend auth gateway does not exist.

- [x] **Step 2: Implement friend auth request model**

  Add request state and store helpers for auth start.

- [x] **Step 3: Implement route contract**

  Add route function that validates token, active link, active session, provider allowlist and policy.

- [x] **Step 4: Expose HTTP endpoint**

  Add HTTP handler and sanitized error responses.

- [x] **Step 5: Add security leak scan**

  Extend `security.test.ts` to scan auth responses and audit logs for secret leakage.

- [x] **Step 6: Run focused validation**

  Run:

  ```bash
  node scripts/test.mjs apps/share-gateway/test/productization/friendAuth.test.ts
  node scripts/test.mjs apps/share-gateway/test/productization/httpServer.test.ts
  node scripts/test.mjs apps/share-gateway/test/productization/security.test.ts
  npm run test:contract
  npm run test:security
  git diff --check
  ```

  Expected: all exit 0.

- [x] **Step 7: Commit**

  ```bash
  git add apps/share-gateway/src/productization apps/share-gateway/test/productization
  git diff --cached --check
  git commit -m "Add Ralphloop friend auth gateway"
  ```

## 11. Work Block 7: 只读预览流硬化

**Estimate:** 1 到 1.5 小时。

**Purpose:** 让 AC-006 的 preview 从“能读到画面”升级为 session-bound、安全限流、不会泄露 owner 内部状态的只读预览能力。

**Files:**

- Modify: `apps/share-gateway/src/productization/types.ts`
- Modify: `apps/share-gateway/src/productization/relayStore.ts`
- Modify: `apps/share-gateway/src/productization/routes.ts`
- Modify: `apps/share-gateway/src/productization/httpServer.ts`
- Modify: `apps/share-web/src/components/PreviewPanel.ts`
- Modify: `apps/share-web/src/pages/share/[token].ts`
- Test: `apps/share-gateway/test/productization/preview.test.ts`
- Test: `apps/share-gateway/test/productization/security.test.ts`
- Test: `apps/share-gateway/test/productization/httpServer.test.ts`
- Test: `apps/share-web/test/share-page.test.ts`

**Acceptance:**

- Preview frame 必须绑定 link、session、task。
- 非当前 session 不能读取 preview。
- frame content type allowlist，例如 `image/png`、`image/jpeg`、`text/plain` metadata，不接受任意 HTML/script。
- frame size 超限返回中性错误并写 owner audit。
- stale preview 返回明确 stale/unavailable，不返回内部 Host 错误。
- Friend Web 只展示只读预览控件，不出现远控按钮。

**Steps:**

- [x] **Step 1: Write failing preview security tests**

  Run:

  ```bash
  node scripts/test.mjs apps/share-gateway/test/productization/preview.test.ts
  ```

  Expected: FAIL until size/content/session binding is enforced.

- [x] **Step 2: Harden preview store model**

  Add metadata fields for `taskId`, `contentType`, `byteLength`, `createdAt`, and stale threshold.

- [x] **Step 3: Harden route and HTTP validation**

  Validate session ownership, content type, size, and stale state.

- [x] **Step 4: Update Friend Web PreviewPanel**

  Ensure only read-only preview states render; no cost, no owner internals, no remote-control affordances.

- [x] **Step 5: Run focused validation**

  Run:

  ```bash
  node scripts/test.mjs apps/share-gateway/test/productization/preview.test.ts
  node scripts/test.mjs apps/share-gateway/test/productization/httpServer.test.ts
  node scripts/test.mjs apps/share-gateway/test/productization/security.test.ts
  node scripts/test.mjs apps/share-web/test/share-page.test.ts
  npm run test:integration
  npm run test:security
  git diff --check
  ```

  Expected: all exit 0.

- [x] **Step 6: Commit**

  ```bash
  git add apps/share-gateway/src/productization apps/share-gateway/test/productization apps/share-web/src apps/share-web/test
  git diff --cached --check
  git commit -m "Harden Ralphloop friend preview stream"
  ```

## 12. Work Block 8: 真实 Adapter Smoke 加固

**Estimate:** 1 到 1.5 小时。

**Purpose:** 让 AC-004 和 AC-013 更接近真实产品路径：至少一个真实 adapter contract 能在安全 smoke 中被调用，而不是只跑 fake adapter。

**Files:**

- Modify: `apps/share-gateway/src/productization/devRuntime.ts`
- Modify: `apps/share-gateway/src/adapters/registry.ts`
- Modify: `apps/share-gateway/test/adapters/opencode.test.ts`
- Modify: `apps/share-gateway/test/adapters/codex.test.ts`
- Modify: `apps/share-gateway/test/adapters/claude.test.ts`
- Create or modify: `apps/share-gateway/test/productization/realAdapterSmoke.test.ts`
- Modify: `package.json` only if script target needs the new smoke file.

**Acceptance:**

- `npm run test:smoke:real-adapter` proves Codex、Claude Code、OpenCode adapter contract still works through adapter tests.
- Productization smoke can connect at least one safe adapter through `HostRuntimeRegistry` and submit a read-only task.
- If no real CLI is configured in the environment, test must assert a structured `not_installed` or `not_configured` result, not silently pass.
- Friend Web and productized routes must not depend on a single adapter id.

**Steps:**

- [x] **Step 1: Write productized real adapter smoke test**

  Run:

  ```bash
  node scripts/test.mjs apps/share-gateway/test/productization/realAdapterSmoke.test.ts
  ```

  Expected: FAIL until productized runtime smoke helper exists.

- [x] **Step 2: Add safe read-only smoke helper**

  Use existing adapter registry and avoid destructive shell or real account actions.

- [x] **Step 3: Make unavailable adapter results explicit**

  Ensure adapter tests distinguish `available`, `not_installed`, and `not_configured`.

- [x] **Step 4: Run focused validation**

  Run:

  ```bash
  node scripts/test.mjs apps/share-gateway/test/productization/realAdapterSmoke.test.ts
  npm run test:smoke:real-adapter
  npm run test:contract
  git diff --check
  ```

  Expected: all exit 0.

- [x] **Step 5: Commit**

  ```bash
  git add apps/share-gateway/src apps/share-gateway/test package.json
  git diff --cached --check
  git commit -m "Add Ralphloop productized adapter smoke"
  ```

## 13. Work Block 9: Owner Console 状态与验收文档回写

**Estimate:** 45 到 60 分钟。

**Purpose:** 把夜间完成状态沉淀到产品文档和界面状态中，避免明早无法判断“完成到哪里”。

**Files:**

- Modify: `apps/share-web/src/pages/owner/index.ts`
- Modify: `apps/share-web/test/owner-page.test.ts`
- Modify: `docs/superpowers/specs/2026-05-21-personal-agent-share-productization-spec.zh.md`
- Create: `docs/superpowers/plans/2026-05-22-ralphloop-overnight-validation-report.zh.md`

**Acceptance:**

- Owner Console 展示 Host auth/online/offline/reconnect 状态，不展示 device key。
- Owner Console 展示最新 audit 和 kill/revoke 状态。
- 产品化 spec 或验证报告记录 AC-001 到 AC-014 的最新覆盖状态。
- 验证报告包含已完成 commit hash、命令、结果、未完成项。

**Steps:**

- [x] **Step 1: Write owner page expectations**

  Run:

  ```bash
  node scripts/test.mjs apps/share-web/test/owner-page.test.ts
  ```

  Expected: FAIL until UI exposes the new status hooks.

- [x] **Step 2: Update owner page**

  Add stable `data-testid` hooks for Host auth status, offline/reconnect state, and kill result.

- [x] **Step 3: Update validation report**

  Create `docs/superpowers/plans/2026-05-22-ralphloop-overnight-validation-report.zh.md` with completed blocks, commit hashes, command outputs summary, and remaining gaps.

- [x] **Step 4: Run documentation and UI validation**

  Run:

  ```bash
  node scripts/test.mjs apps/share-web/test/owner-page.test.ts
  npm run test:e2e
  git diff --check
  ```

  Expected: all exit 0.

- [x] **Step 5: Commit**

  ```bash
  git add apps/share-web docs/superpowers
  git diff --cached --check
  git commit -m "Document Ralphloop overnight validation status"
  ```

## 14. Final Full Verification

**Estimate:** 30 到 45 分钟。

Run:

```bash
npm test
npm run lint
npm run typecheck
npm run build
npm run test:contract
npm run test:integration
npm run test:security
npm run test:e2e
npm run test:smoke:real-adapter
git diff --check
git status --short
```

Expected:

- All commands exit 0.
- Test output shows 0 failures.
- `git status --short` has no unexpected modified files from the Ralphloop work.
- Unrelated untracked files are explicitly called out and left untouched.

## 15. 明早交付格式

明早最终回复应该使用这个结构：

```markdown
实际完成：
- Block 1: Host 认证与心跳鉴权，commit <hash>
- Block 2: Relay 到 Host 指令绑定，commit <hash>

验证命令：
- `npm test`：通过，0 fail
- `npm run test:security`：通过，0 fail

未完成：
- Block 7: 只读预览流硬化，原因：时间不足，尚未开始

风险：
- OAuth 仍是 stub，尚未接入真实 provider
```

## 16. 如果 8 小时跑不完

优先停在最后一个通过全量或聚焦验证的 commit。不要为了“多做一点”留下半完成状态。

优先级：

1. Host auth、command binding、kill propagation。
2. Host offline/reconnect、friend identity、friend auth stub。
3. Preview hardening、real adapter smoke。
4. Owner Console polish、docs status report。

如果只能完成前三项，也已经是产品化上非常关键的一步；如果完成到第七项，Ralphloop 就接近一个可继续真实 dogfood 的朋友分享闭环。
