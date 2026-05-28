# Ralphloop 审批与确认控制台实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让产品化 Owner Console 和 Friend Web 能通过 HTTP 处理创建者审批与朋友确认，补齐 AC-009、AC-012 的产品入口。

**Architecture:** 在 route 层新增 owner-scoped approval 列表与 resolve contract，以及 token/session 绑定的 friend confirmation 列表与 resolve contract。HTTP 层暴露 `/v1/owner/approvals`、`/v1/owner/approvals/:id/(approve|deny)`、`/v1/share/:token/confirmations`、`/v1/share/:token/confirmations/:id/(approve|deny)`。Owner/Friend 页面只增加轻量控制 hook，不引入新框架。

**Tech Stack:** Node.js `http`, TypeScript, `node:test`, built-in `fetch`.

---

## Task 1: 审批 Route Contract

**Files:**
- Modify: `apps/share-gateway/src/productization/routes.ts`
- Modify: `apps/share-gateway/test/productization/approvals.test.ts`

- [x] **Step 1: 写失败测试**

覆盖：

- Owner 只能列出自己名下的 approval requests。
- Owner 只能 approve/deny 自己的 `owner_approve` 请求。
- Friend 只能列出当前 token 和自己 session 里的 `user_confirm` 请求。
- Friend 只能 approve/deny 自己的 confirmation。

- [x] **Step 2: 验证 red**

Run:

```bash
npm test apps/share-gateway/test/productization/approvals.test.ts
```

Expected: FAIL，因为 route 函数尚未存在。

- [x] **Step 3: 实现最小 route contract**

新增 `listOwnerApprovalRequestsV1`、`resolveOwnerApprovalRequestV1`、`listFriendConfirmationsV1`、`resolveFriendConfirmationV1`，并保证 friend 响应不返回 owner-only 字段。

- [x] **Step 4: 验证 green**

Run:

```bash
npm test apps/share-gateway/test/productization/approvals.test.ts
```

Expected: PASS.

## Task 2: HTTP Approval API

**Files:**
- Modify: `apps/share-gateway/src/productization/httpServer.ts`
- Modify: `apps/share-gateway/test/productization/httpServer.test.ts`

- [x] **Step 1: 写失败 HTTP 测试**

覆盖：

- `GET /v1/owner/approvals?ownerId=owner-1&status=pending`
- `POST /v1/owner/approvals/:id/approve`
- `POST /v1/owner/approvals/:id/deny`
- `GET /v1/share/:token/confirmations?friendActorId=friend`
- `POST /v1/share/:token/confirmations/:id/approve`
- 越权 owner/friend 都返回 404。

- [x] **Step 2: 验证 red**

Run:

```bash
npm test apps/share-gateway/test/productization/httpServer.test.ts
```

Expected: FAIL，因为 HTTP approval endpoints 尚未存在。

- [x] **Step 3: 实现 HTTP endpoints**

把 route 函数接入 `createProductizedShareServer`。

- [x] **Step 4: 验证 green**

Run:

```bash
npm test apps/share-gateway/test/productization/httpServer.test.ts
```

Expected: PASS.

## Task 3: Owner/Friend 页面 Hook

**Files:**
- Modify: `apps/share-gateway/src/productization/httpServer.ts`
- Modify: `apps/share-gateway/test/productization/httpServer.test.ts`

- [x] **Step 1: 增加页面 contract 断言**

Owner 页面包含 `approval-queue`、`refresh-approvals`、`approve-owner-approval`、`deny-owner-approval`；Friend 页面包含 `friend-confirmations`、`refresh-confirmations`、`approve-friend-confirmation`、`deny-friend-confirmation`。

- [x] **Step 2: 实现页面 hook**

Owner 页面可刷新 pending approval 队列并 approve/deny；Friend 页面可刷新 pending confirmation 并 approve/deny。

- [x] **Step 3: 验证 targeted tests**

Run:

```bash
npm test apps/share-gateway/test/productization/httpServer.test.ts
```

Expected: PASS.

## Task 4: 验证与提交

- [x] **Step 1: 浏览器 smoke**

Run `npm run dev:productized`，打开 Owner/Friend 页面，验证审批/确认 hook 存在，页面无成本字段。

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
git commit -m "Add Ralphloop approval console"
```
