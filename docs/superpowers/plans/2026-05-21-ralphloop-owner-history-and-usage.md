# Ralphloop 创建者链接历史与用量实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让创建者能在产品化 API 和 Owner Console 中查看分享链接列表、任务历史，以及每条链接的用量/预算状态。

**Architecture:** 在 route 层新增 owner-only share link summary 与 task history contract，基于现有 RelayStore snapshot 过滤 owner 资源。HTTP 层暴露 `/v1/owner/share-links` 和 `/v1/owner/tasks` 的 GET 端点。Owner 页面新增链接列表与任务历史 panel，展示状态、adapter、用量和任务结果，不影响 friend 页面成本隐藏规则。

**Tech Stack:** Node.js `http`, TypeScript, `node:test`, built-in `fetch`.

---

## Task 1: Owner History Route Contract

**Files:**
- Modify: `apps/share-gateway/src/productization/routes.ts`
- Modify: `apps/share-gateway/test/productization/controls.test.ts`

- [x] **Step 1: 写失败测试**

覆盖：

- Owner 只能看到自己创建的 share links。
- Share link summary 包含 status、host、adapter、created/expires、budgetUsed、maxTotalBudget、maxTaskBudget。
- Owner 只能看到自己链接下的 task history。
- Task history 包含 session、friend、adapter、status、failureReason。

- [x] **Step 2: 验证 red**

Run:

```bash
npm test apps/share-gateway/test/productization/controls.test.ts
```

Expected: FAIL，因为 owner history route 函数尚未存在。

- [x] **Step 3: 实现最小 route contract**

新增 `listOwnerShareLinksV1` 和 `listOwnerTasksV1`。

- [x] **Step 4: 验证 green**

Run:

```bash
npm test apps/share-gateway/test/productization/controls.test.ts
```

Expected: PASS.

## Task 2: HTTP Owner History API

**Files:**
- Modify: `apps/share-gateway/src/productization/httpServer.ts`
- Modify: `apps/share-gateway/test/productization/httpServer.test.ts`

- [x] **Step 1: 写失败 HTTP 测试**

覆盖：

- `GET /v1/owner/share-links?ownerId=owner-1`
- `GET /v1/owner/tasks?ownerId=owner-1`
- wrong owner 看不到其他 owner 的 link/task。

- [x] **Step 2: 验证 red**

Run:

```bash
npm test apps/share-gateway/test/productization/httpServer.test.ts
```

Expected: FAIL，因为 HTTP history endpoints 尚未存在。

- [x] **Step 3: 实现 HTTP endpoints**

把 owner history route 函数接入 `createProductizedShareServer`。

- [x] **Step 4: 验证 green**

Run:

```bash
npm test apps/share-gateway/test/productization/httpServer.test.ts
```

Expected: PASS.

## Task 3: Owner Console History UI

**Files:**
- Modify: `apps/share-gateway/src/productization/httpServer.ts`
- Modify: `apps/share-gateway/test/productization/httpServer.test.ts`

- [x] **Step 1: 增加页面 contract 断言**

Owner 页面包含 `share-link-list`、`refresh-share-links`、`task-history`、`refresh-task-history`，并包含 `/v1/owner/share-links`、`/v1/owner/tasks`。

- [x] **Step 2: 实现页面 hook**

Owner 页面可刷新链接列表和任务历史。链接列表显示状态、adapter、用量；任务历史显示任务状态和失败原因。

- [x] **Step 3: 验证 targeted tests**

Run:

```bash
npm test apps/share-gateway/test/productization/httpServer.test.ts
```

Expected: PASS.

## Task 4: 验证与提交

- [x] **Step 1: 浏览器 smoke**

Run `npm run dev:productized`，创建分享链接并提交任务，验证 Owner 页面能看到链接列表和任务历史。

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
git commit -m "Add Ralphloop owner history and usage"
```
