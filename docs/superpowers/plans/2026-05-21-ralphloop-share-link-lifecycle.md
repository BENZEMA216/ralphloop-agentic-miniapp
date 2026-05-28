# Ralphloop 分享链接生命周期 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让创建者可以在 Owner Console 和 HTTP API 中按分享链接 ID 暂停、恢复、撤销链接，并保证暂停中的朋友端无法继续进入页面或提交任务。

**Architecture:** 复用现有 `RelayStore.updateShareLinkStatus` 与 friend 端中立不可用响应，在 route 层新增 owner-scoped pause/resume contract，HTTP 层暴露 `/v1/owner/share-links/:id/pause` 与 `/v1/owner/share-links/:id/resume`。Owner Console 在链接列表里按当前状态显示“暂停/启用”动作，并刷新审计日志和链接列表。

**Tech Stack:** TypeScript, Node HTTP server, `node:test`, Ralphloop productization route contracts.

---

## 文件结构

- 修改：`apps/share-gateway/src/productization/routes.ts`
  - 新增 `pauseOwnerShareLinkByIdV1`、`resumeOwnerShareLinkByIdV1`。
  - 抽取 owner-scoped 状态更新 helper，统一归属校验、终态保护和审计日志。
- 修改：`apps/share-gateway/src/productization/httpServer.ts`
  - 新增 `POST /v1/owner/share-links/:id/pause`。
  - 新增 `POST /v1/owner/share-links/:id/resume`。
  - Owner Console 链接列表新增暂停/启用按钮和事件处理。
- 修改：`apps/share-gateway/test/productization/controls.test.ts`
  - Route contract 测试 owner 正确暂停/恢复、错误 owner 被拒绝、暂停时 friend 端不可用、恢复后任务可执行、撤销后不可恢复。
- 修改：`apps/share-gateway/test/productization/httpServer.test.ts`
  - HTTP contract 测试 pause/resume 端点、friend 端状态、审计日志、Owner Console hook。

## Task 1: Route Contract

**Files:**
- Modify: `apps/share-gateway/test/productization/controls.test.ts`
- Modify: `apps/share-gateway/src/productization/routes.ts`

- [ ] **Step 1: Write failing route tests**

新增测试：

```ts
test("owner can pause and resume share link by id", async () => {
  const store = fixedStore();
  const runtimes = new HostRuntimeRegistry();
  setupShare(store);
  runtimes.connectHost({ hostId: "host-1", adapters: { opencode: noOpAdapter() } });
  const link = store.findShareLinkByToken("local-friend")!;

  const deniedPause = pauseOwnerShareLinkByIdV1({ store, ownerId: "owner-2", shareLinkId: link.id });
  const paused = pauseOwnerShareLinkByIdV1({ store, ownerId: "owner-1", shareLinkId: link.id });
  const friendWhilePaused = getFriendSharePageV1({ store, token: "local-friend" });
  const taskWhilePaused = await submitFriendTaskV1({ store, runtimes, token: "local-friend", prompt: "Run", friendActorId: "friend" });
  const deniedResume = resumeOwnerShareLinkByIdV1({ store, ownerId: "owner-2", shareLinkId: link.id });
  const resumed = resumeOwnerShareLinkByIdV1({ store, ownerId: "owner-1", shareLinkId: link.id });
  const taskAfterResume = await submitFriendTaskV1({ store, runtimes, token: "local-friend", prompt: "Run", friendActorId: "friend" });

  assert.equal(deniedPause.status, 404);
  assert.equal(paused.status, 200);
  assert.equal(friendWhilePaused.status, 423);
  assert.equal(taskWhilePaused.status, 423);
  assert.equal(deniedResume.status, 404);
  assert.equal(resumed.status, 200);
  assert.equal(taskAfterResume.status, 202);
});
```

新增终态测试：

```ts
test("revoked share link cannot be resumed", () => {
  const store = fixedStore();
  setupShare(store);
  const link = store.findShareLinkByToken("local-friend")!;

  revokeOwnerShareLinkByIdV1({ store, ownerId: "owner-1", shareLinkId: link.id });
  const resumed = resumeOwnerShareLinkByIdV1({ store, ownerId: "owner-1", shareLinkId: link.id });

  assert.equal(resumed.status, 409);
  assert.deepEqual(resumed.body, { error: "share_link_final" });
});
```

- [ ] **Step 2: Run route test to verify red**

Run: `npm test apps/share-gateway/test/productization/controls.test.ts`

Expected: FAIL because `pauseOwnerShareLinkByIdV1` and `resumeOwnerShareLinkByIdV1` are not exported.

- [ ] **Step 3: Implement route lifecycle functions**

Add exported functions:

```ts
export function pauseOwnerShareLinkByIdV1(input: {
  store: RelayStore;
  ownerId: string;
  shareLinkId: string;
}): JsonResponse<{ ok: boolean } | { error: string }> {
  return updateOwnerShareLinkStatusById(input.store, input.ownerId, input.shareLinkId, "paused", "share_link.paused");
}

export function resumeOwnerShareLinkByIdV1(input: {
  store: RelayStore;
  ownerId: string;
  shareLinkId: string;
}): JsonResponse<{ ok: boolean } | { error: string }> {
  return updateOwnerShareLinkStatusById(input.store, input.ownerId, input.shareLinkId, "active", "share_link.resumed");
}
```

Helper 要求：
- 未找到或 owner 不匹配：`404 { error: "share_link_unavailable" }`
- `revoked` 或 `expired` 终态恢复/暂停：`409 { error: "share_link_final" }`
- 成功后写入 `share_link.paused` 或 `share_link.resumed` 审计日志。

- [ ] **Step 4: Run route test to verify green**

Run: `npm test apps/share-gateway/test/productization/controls.test.ts`

Expected: PASS.

## Task 2: HTTP API Contract

**Files:**
- Modify: `apps/share-gateway/test/productization/httpServer.test.ts`
- Modify: `apps/share-gateway/src/productization/httpServer.ts`

- [ ] **Step 1: Write failing HTTP tests**

新增测试覆盖：
- `POST /v1/owner/share-links/:id/pause` 错误 owner 返回 404，正确 owner 返回 200。
- pause 后 `GET /v1/share/:token` 和 `POST /v1/share/:token/tasks` 返回 423。
- `POST /v1/owner/share-links/:id/resume` 错误 owner 返回 404，正确 owner 返回 200。
- resume 后 friend 页面 200，任务 202。
- 审计日志包含 `share_link.paused` 与 `share_link.resumed`。

- [ ] **Step 2: Run HTTP test to verify red**

Run: `npm test apps/share-gateway/test/productization/httpServer.test.ts`

Expected: FAIL because pause/resume endpoints return 404.

- [ ] **Step 3: Implement HTTP endpoints**

Import route functions and add handlers near revoke handler:

```ts
const pauseShareLinkMatch = url.pathname.match(/^\/v1\/owner\/share-links\/([^/]+)\/pause$/);
const resumeShareLinkMatch = url.pathname.match(/^\/v1\/owner\/share-links\/([^/]+)\/resume$/);
```

Both handlers read `{ ownerId }`, decode `shareLinkId`, call the route function, and return JSON.

- [ ] **Step 4: Run HTTP test to verify green**

Run: `npm test apps/share-gateway/test/productization/httpServer.test.ts`

Expected: PASS.

## Task 3: Owner Console Controls

**Files:**
- Modify: `apps/share-gateway/test/productization/httpServer.test.ts`
- Modify: `apps/share-gateway/src/productization/httpServer.ts`

- [ ] **Step 1: Write failing HTML hook assertions**

在 web page 测试中断言 Owner HTML 包含：

```ts
assert.match(ownerHtml, /pause-share-link/);
assert.match(ownerHtml, /resume-share-link/);
assert.match(ownerHtml, /\/pause/);
assert.match(ownerHtml, /\/resume/);
```

- [ ] **Step 2: Run web test to verify red**

Run: `npm test apps/share-gateway/test/productization/httpServer.test.ts`

Expected: FAIL until Owner Console JS includes the hooks.

- [ ] **Step 3: Implement Owner Console actions**

In `refreshShareLinks()`, render per-link actions:
- `active` -> button class `pause-share-link`
- `paused` -> button class `resume-share-link`
- terminal statuses -> muted label

Add:

```js
async function updateShareLinkLifecycle(shareLinkId, action) {
  await fetch("/v1/owner/share-links/" + encodeURIComponent(shareLinkId) + "/" + action, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ownerId }),
  });
  await refreshShareLinks();
  await refreshAuditLog();
}
```

Add delegated click handling on `shareLinkList`.

- [ ] **Step 4: Run HTTP/web test to verify green**

Run: `npm test apps/share-gateway/test/productization/httpServer.test.ts`

Expected: PASS.

## Task 4: Browser Smoke And Full Verification

**Files:**
- No source changes expected after this task unless verification finds defects.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test apps/share-gateway/test/productization/controls.test.ts
npm test apps/share-gateway/test/productization/httpServer.test.ts
```

Expected: PASS.

- [ ] **Step 2: Start productized dev server**

Run: `PORT=5180 npm run dev:productized`

Expected: server listens on `http://127.0.0.1:5180`.

- [ ] **Step 3: Browser smoke Owner Console**

Use Browser plugin to open `http://127.0.0.1:5180/app/owner`, create a share link, verify `.pause-share-link` appears, pause it, verify `.resume-share-link` appears, resume it, and verify `.pause-share-link` returns.

- [ ] **Step 4: Run full validation suite**

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

Expected: every command exits 0, with no failing test counts.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/share-gateway/src/productization/routes.ts \
  apps/share-gateway/src/productization/httpServer.ts \
  apps/share-gateway/test/productization/controls.test.ts \
  apps/share-gateway/test/productization/httpServer.test.ts \
  docs/superpowers/plans/2026-05-21-ralphloop-share-link-lifecycle.md
git commit -m "Add Ralphloop share link lifecycle controls"
```

Expected: commit succeeds; `agora-demo/` remains untracked and unstaged.
