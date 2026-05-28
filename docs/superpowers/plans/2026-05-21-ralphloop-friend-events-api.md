# Ralphloop 朋友事件读取 API 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让朋友在任务提交后可以通过 `GET /v1/share/:token/events` 重新读取任务事件和完整输出，补齐 AC-005 的可恢复事件读取能力。

**Architecture:** 在 RelayStore 中持久化 friend-safe runtime events，任务执行时将 adapter event 过滤后写入事件表。Route 层新增 token/session 绑定的 `getFriendTaskEventsV1`，HTTP 层暴露 `GET /v1/share/:token/events?taskId=...`。Friend Web 在提交后通过 events API 刷新输出，页面和 API 响应继续禁止成本、token hash、owner-only 字段泄露。

**Tech Stack:** Node.js `http`, TypeScript, `node:test`, built-in `fetch`.

---

## Task 1: Runtime Event Persistence And Route Contract

**Files:**
- Modify: `apps/share-gateway/src/productization/types.ts`
- Modify: `apps/share-gateway/src/productization/relayStore.ts`
- Modify: `apps/share-gateway/src/productization/routes.ts`
- Modify: `apps/share-gateway/test/productization/taskFlow.test.ts`
- Modify: `apps/share-gateway/test/productization/relayStore.test.ts`

- [x] **Step 1: 写失败测试**

覆盖：

- `submitFriendTaskV1` 将 friend-safe events 写入 RelayStore。
- `getFriendTaskEventsV1` 只能通过匹配 token 读取对应 link/session/task 的事件。
- events 响应不包含 cost、budget、tokenHash。
- runtime events 可以持久化后 reload。

- [x] **Step 2: 验证 red**

Run:

```bash
npm test apps/share-gateway/test/productization/taskFlow.test.ts apps/share-gateway/test/productization/relayStore.test.ts
```

Expected: FAIL，因为 runtime event store 和 route 函数尚未存在。

- [x] **Step 3: 实现最小 persistence 和 route**

新增 `RuntimeEventRecord`、`RelayStore.appendRuntimeEvent`、`RelayStore.listRuntimeEvents`、`getFriendTaskEventsV1`，并在 `submitFriendTaskV1` 中写入 filtered events。

- [x] **Step 4: 验证 green**

Run:

```bash
npm test apps/share-gateway/test/productization/taskFlow.test.ts apps/share-gateway/test/productization/relayStore.test.ts
```

Expected: PASS.

## Task 2: HTTP Events API And Friend Web Hook

**Files:**
- Modify: `apps/share-gateway/src/productization/httpServer.ts`
- Modify: `apps/share-gateway/test/productization/httpServer.test.ts`

- [x] **Step 1: 写失败 HTTP 测试**

覆盖：

- `GET /v1/share/:token/events?taskId=...` 返回任务事件。
- 错误 token 或不属于该 token 的 task 不返回事件。
- Friend HTML 包含 events endpoint hook，且仍无成本字段。

- [x] **Step 2: 验证 red**

Run:

```bash
npm test apps/share-gateway/test/productization/httpServer.test.ts
```

Expected: FAIL，因为 HTTP endpoint 和页面 hook 尚未存在。

- [x] **Step 3: 实现 HTTP endpoint 和页面刷新**

把 `getFriendTaskEventsV1` 接入 server；Friend Web 提交任务后通过 events API 读取并渲染输出。

- [x] **Step 4: 验证 green**

Run:

```bash
npm test apps/share-gateway/test/productization/httpServer.test.ts
```

Expected: PASS.

## Task 3: 验证与提交

- [x] **Step 1: 浏览器 smoke**

Run `npm run dev:productized`，创建分享链接、提交任务或用 HTTP 生成任务，然后在 Friend 页面/接口验证 events 可恢复读取。

- [x] **Step 2: 全量验证**

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

- [x] **Step 3: Commit**

Commit message:

```bash
git commit -m "Add Ralphloop friend events API"
```
