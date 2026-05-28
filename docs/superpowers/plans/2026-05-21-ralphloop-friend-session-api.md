# Ralphloop 朋友显式会话 API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐 Friend 最小 API 的 `POST /share/:token/sessions`，让朋友打开链接后可以显式创建 session，并让后续任务复用该 session。

**Architecture:** 在 route 层新增 friend-scoped `createFriendSessionV1`，复用现有 share link/host 可用性检查和 `RelayStore.createSession`。`submitFriendTaskV1` 接收可选 `sessionId`，校验 session 属于当前 token 和 friend 后复用，不再额外创建第二个 session。HTTP 层暴露 `/v1/share/:token/sessions`，Friend Web 在提交任务前创建 session 并把 `sessionId` 随任务提交。

**Tech Stack:** TypeScript, Node HTTP server, `node:test`, Ralphloop productization Friend API.

---

## 文件结构

- 修改：`apps/share-gateway/src/productization/routes.ts`
  - 新增 `createFriendSessionV1`。
  - `submitFriendTaskV1` 新增可选 `sessionId`，并校验复用。
  - 新增 friend-safe session response。
- 修改：`apps/share-gateway/src/productization/httpServer.ts`
  - 新增 `POST /v1/share/:token/sessions`。
  - Friend 页面增加 `sessionEndpoint`、`currentSessionId`、`ensureSession()`，提交任务时带上 session。
- 修改：`apps/share-gateway/test/productization/taskFlow.test.ts`
  - Route 层测试显式 session 创建、任务复用同一 session、无成本字段泄露。
- 修改：`apps/share-gateway/test/productization/httpServer.test.ts`
  - HTTP 层测试 session endpoint、任务复用 session、Friend HTML hook。

## Task 1: Route Contract

**Files:**
- Modify: `apps/share-gateway/test/productization/taskFlow.test.ts`
- Modify: `apps/share-gateway/src/productization/routes.ts`

- [ ] **Step 1: Write failing route tests**

新增测试：
- `createFriendSessionV1` 对 active link 返回 `201` 和 friend-safe session。
- 响应不包含 `tokenHash`、`hostId`、`shareLinkId`、`cost`、`budget`。
- `submitFriendTaskV1({ sessionId })` 复用该 session，`store.snapshot().sessions.length === 1`。
- task 记录的 `sessionId` 等于显式 session id。

- [ ] **Step 2: Run test to verify red**

Run: `npm test apps/share-gateway/test/productization/taskFlow.test.ts`

Expected: FAIL because `createFriendSessionV1` is not exported.

- [ ] **Step 3: Implement route session API**

Add friend-safe type:

```ts
type FriendSession = Pick<SessionRecord, "id" | "adapterId" | "status" | "startedAt" | "lastEventAt"> & {
  previewMode: SharePolicyRecord["previewMode"];
};
```

Rules:
- invalid/revoked token -> `404 { available: false, error: "share_link_unavailable" }`
- paused -> `423 { available: false, error: "share_link_paused" }`
- expired -> `410 { available: false, error: "share_link_expired" }`
- offline/missing host -> `503 { available: false, error: "shared_agent_unavailable" }`
- max concurrent sessions exceeded -> `429 { available: false, error: "shared_agent_unavailable" }` and audit `session.rejected`
- success -> `201 { session }` and audit `session.created`

`submitFriendTaskV1`:
- Add optional `sessionId`.
- If present, find session and require same `shareLinkId` and `friendActorId`.
- Reject missing/mismatched session with `404 { events: [], available: false, error: "session_unavailable" }`.
- Reject non-`waiting` session with `409 { events: [], available: false, error: "session_unavailable" }`.
- Reuse session instead of creating a second session.

- [ ] **Step 4: Run route test to verify green**

Run: `npm test apps/share-gateway/test/productization/taskFlow.test.ts`

Expected: PASS.

## Task 2: HTTP And Friend Web

**Files:**
- Modify: `apps/share-gateway/test/productization/httpServer.test.ts`
- Modify: `apps/share-gateway/src/productization/httpServer.ts`

- [ ] **Step 1: Write failing HTTP tests**

新增测试：
- `POST /v1/share/:token/sessions` returns `201` session.
- `POST /v1/share/:token/tasks` with that `sessionId` returns `202` and owner session list has only one session.
- wrong token or paused link returns neutral friend errors.
- Friend HTML contains `/v1/share/:token/sessions`, `currentSessionId`, and `ensureSession`.

- [ ] **Step 2: Run HTTP test to verify red**

Run: `npm test apps/share-gateway/test/productization/httpServer.test.ts`

Expected: FAIL because sessions endpoint returns 404 and Friend HTML lacks hooks.

- [ ] **Step 3: Implement HTTP endpoint and web hooks**

Add `POST /v1/share/:token/sessions` near other Friend API handlers.

Friend page:
- define `sessionEndpoint`
- define `currentSessionId`
- add `ensureSession()`
- call `ensureSession()` before task submission
- include `sessionId` in task submit body
- clear `currentSessionId` after terminal task status.

- [ ] **Step 4: Run HTTP test to verify green**

Run: `npm test apps/share-gateway/test/productization/httpServer.test.ts`

Expected: PASS.

## Task 3: Browser Smoke, Full Verification, Commit

- [ ] **Step 1: Browser smoke**

Run `PORT=5180 npm run dev:productized`, open Owner page, create share link, open Friend page, submit a task, verify Owner session list contains one completed session and console has no errors.

- [ ] **Step 2: Full validation**

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
```

Expected: every command exits 0.

- [ ] **Step 3: Commit**

Run:

```bash
git add apps/share-gateway/src/productization/routes.ts \
  apps/share-gateway/src/productization/httpServer.ts \
  apps/share-gateway/test/productization/taskFlow.test.ts \
  apps/share-gateway/test/productization/httpServer.test.ts \
  docs/superpowers/plans/2026-05-21-ralphloop-friend-session-api.md
git commit -m "Add Ralphloop friend session API"
```

Expected: commit succeeds; `agora-demo/` remains untracked and unstaged.
