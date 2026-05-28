# Ralphloop 滥用防护实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Ralphloop 产品化分享链路补齐请求频率限制和会话超时回收，降低朋友端滥用与悬挂会话风险。

**Architecture:** 在 SharePolicy 增加 `maxRequestsPerMinute` 与 `sessionTtlMs` 安全默认值。Relay route 层在创建朋友会话和提交朋友任务前执行限流与过期会话回收，朋友端继续只收到中性错误，创建者通过审计日志看到具体原因。

**Tech Stack:** TypeScript, Node HTTP server, `node:test`, Ralphloop productization RelayStore/routes.

---

## 文件结构

- Modify: `apps/share-gateway/src/productization/types.ts`
  - 为 `SharePolicyRecord` 增加请求频率和会话 TTL 字段。
- Modify: `apps/share-gateway/src/productization/relayStore.ts`
  - 暴露当前 store 时间 `now()`，补齐默认策略字段。
- Modify: `apps/share-gateway/src/productization/routes.ts`
  - 在 `createFriendSessionV1` 和 `submitFriendTaskV1` 前执行滥用防护。
  - 增加过期会话回收、请求频率判断、审计日志写入。
- Modify: `apps/share-gateway/test/productization/controls.test.ts`
  - 覆盖 route 层限流、会话超时释放并发、过期显式 session 不可继续提交。
- Modify: `apps/share-gateway/test/productization/httpServer.test.ts`
  - 覆盖 HTTP 层朋友请求被限流时只返回中性错误，owner audit 可见具体原因。

## Task 1: Route 层滥用防护

- [x] **Step 1: Write failing tests**

在 `controls.test.ts` 增加：

```ts
test("request rate limit blocks friend session and task creation before adapter execution", async () => {
  const store = fixedStore();
  const runtimes = new HostRuntimeRegistry();
  const calls: string[] = [];
  setupShare(store, { maxRequestsPerMinute: 1 });
  runtimes.connectHost({ hostId: "host-1", adapters: { opencode: noOpAdapter(calls) } });

  const first = createFriendSessionV1({ store, token: "local-friend", friendActorId: "friend" });
  const second = await submitFriendTaskV1({
    store,
    runtimes,
    token: "local-friend",
    prompt: "Run after limit",
    friendActorId: "friend",
  });

  assert.equal(first.status, 201);
  assert.equal(second.status, 429);
  assert.equal(second.body.error, "shared_agent_unavailable");
  assert.deepEqual(calls, []);
  assert.equal(store.snapshot().auditLogs.at(-1)?.eventType, "rate_limit.rejected");
});
```

增加会话 TTL 用例：

```ts
test("expired sessions are cancelled before concurrency checks", () => {
  let nowMs = Date.parse("2026-05-21T00:00:00.000Z");
  const store = new RelayStore({ now: () => new Date(nowMs) });
  setupShare(store, { maxConcurrentSessions: 1, sessionTtlMs: 1000 });

  const first = createFriendSessionV1({ store, token: "local-friend", friendActorId: "friend-1" });
  nowMs += 2000;
  const second = createFriendSessionV1({ store, token: "local-friend", friendActorId: "friend-2" });

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(store.findSession(first.body.session.id)?.status, "cancelled");
  assert.equal(store.snapshot().auditLogs.some((entry) => entry.eventType === "session.timeout"), true);
});
```

增加过期显式 session 用例：

```ts
test("expired explicit session cannot accept a friend task", async () => {
  let nowMs = Date.parse("2026-05-21T00:00:00.000Z");
  const store = new RelayStore({ now: () => new Date(nowMs) });
  const runtimes = new HostRuntimeRegistry();
  const calls: string[] = [];
  setupShare(store, { sessionTtlMs: 1000 });
  runtimes.connectHost({ hostId: "host-1", adapters: { opencode: noOpAdapter(calls) } });

  const session = createFriendSessionV1({ store, token: "local-friend", friendActorId: "friend" });
  nowMs += 2000;
  const task = await submitFriendTaskV1({
    store,
    runtimes,
    token: "local-friend",
    sessionId: session.body.session.id,
    prompt: "Run stale session",
    friendActorId: "friend",
  });

  assert.equal(task.status, 409);
  assert.equal(task.body.error, "session_unavailable");
  assert.deepEqual(calls, []);
});
```

- [x] **Step 2: Run tests to verify failure**

Run:

```bash
npm test apps/share-gateway/test/productization/controls.test.ts
```

Expected: FAIL because rate limiting, session TTL policy fields, and timeout cleanup are not implemented.

- [x] **Step 3: Implement minimal route/store changes**

Implement:

- `SharePolicyRecord.maxRequestsPerMinute`
- `SharePolicyRecord.sessionTtlMs`
- default values: `30` requests/minute and `30 * 60 * 1000` ms TTL.
- `RelayStore.now()`
- `expireStaleSessionsForLink(store, link)`
- `requestRateLimitPreflight(store, link)`
- `recordRateLimitRejection(store, link)`

- [x] **Step 4: Run route tests**

Run:

```bash
npm test apps/share-gateway/test/productization/controls.test.ts
```

Expected: PASS.

## Task 2: HTTP 中性错误合同

- [x] **Step 1: Write failing HTTP test**

在 `httpServer.test.ts` 增加：

```ts
test("productized HTTP friend rate limit returns neutral errors and owner audit reason", async () => {
  // Create link with { maxRequestsPerMinute: 1 }, create one session, then create another.
  // Friend sees 429 + shared_agent_unavailable.
  // Owner audit logs contain rate_limit.rejected.
});
```

- [x] **Step 2: Run focused HTTP test**

Run:

```bash
npm test apps/share-gateway/test/productization/httpServer.test.ts
```

Expected: FAIL before implementation, PASS after implementation.

## 验收标准

1. 朋友端请求超过 `maxRequestsPerMinute` 时返回 429。
2. 朋友端错误仍为中性 `shared_agent_unavailable`，不展示限流细节、预算、成本或 token hash。
3. 创建者审计日志记录 `rate_limit.rejected` 和具体原因。
4. 超过 `sessionTtlMs` 的 active session 会在下一次朋友会话或任务请求前被取消。
5. 超时回收释放 `maxConcurrentSessions` 配额。
6. 过期显式 session 不能继续提交任务，且不会触发 adapter 执行。
7. 聚焦测试、全量测试、类型检查、构建、合同测试、集成测试、安全测试、E2E、真实适配器 smoke 和 diff 空白检查均通过。
