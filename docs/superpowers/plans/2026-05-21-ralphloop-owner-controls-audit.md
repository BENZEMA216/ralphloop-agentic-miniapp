# Ralphloop Owner Controls And Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让创建者能通过产品化 API 和 Owner Console 查看审计日志、查看会话、撤销分享链接、终止会话。

**Architecture:** 在 productization route 层新增 owner-only 查询和控制 contract，HTTP 层暴露 `/v1/owner/audit-logs`、`/v1/owner/sessions`、`/v1/owner/share-links/:id/revoke`、`/v1/owner/sessions/:id/cancel`。Owner 页面展示控制区和审计区，创建链接后可撤销，并能刷新审计日志。所有控制 API 必须校验资源归属。

**Tech Stack:** Node.js `http`, TypeScript, `node:test`, built-in `fetch`.

---

## Task 1: Owner Control Contracts

**Files:**
- Modify: `apps/share-gateway/src/productization/routes.ts`
- Modify: `apps/share-gateway/test/productization/controls.test.ts`

- [x] **Step 1: Write failing route tests**

Cover:

- Owner can list only their own audit logs.
- Owner can list only sessions that belong to their share links.
- Owner can revoke a share link by id and friend access becomes unavailable.
- Wrong owner cannot revoke another owner link.
- Wrong owner cannot cancel another owner session.

- [x] **Step 2: Verify red**

Run:

```bash
npm test apps/share-gateway/test/productization/controls.test.ts
```

Expected: FAIL because owner listing functions and ownership guards do not exist.

- [x] **Step 3: Implement minimal route contracts**

Add `listOwnerAuditLogsV1`, `listOwnerSessionsV1`, `revokeOwnerShareLinkByIdV1`, and owner validation inside `cancelOwnerSessionV1`.

- [x] **Step 4: Verify green**

Run:

```bash
npm test apps/share-gateway/test/productization/controls.test.ts
```

Expected: PASS.

## Task 2: HTTP Owner Control API

**Files:**
- Modify: `apps/share-gateway/src/productization/httpServer.ts`
- Modify: `apps/share-gateway/test/productization/httpServer.test.ts`

- [x] **Step 1: Write failing HTTP tests**

Cover:

- `GET /v1/owner/audit-logs?ownerId=owner-1`
- `GET /v1/owner/sessions?ownerId=owner-1`
- `POST /v1/owner/share-links/:id/revoke`
- `POST /v1/owner/sessions/:id/cancel`
- Friend API cannot submit after revoke.

- [x] **Step 2: Verify red**

Run:

```bash
npm test apps/share-gateway/test/productization/httpServer.test.ts
```

Expected: FAIL because HTTP control endpoints do not exist.

- [x] **Step 3: Implement HTTP endpoints**

Wire the route functions into `createProductizedShareServer`.

- [x] **Step 4: Verify green**

Run:

```bash
npm test apps/share-gateway/test/productization/httpServer.test.ts
```

Expected: PASS.

## Task 3: Owner Console Controls

**Files:**
- Modify: `apps/share-gateway/src/productization/httpServer.ts`
- Modify: `apps/share-gateway/test/productization/httpServer.test.ts`

- [x] **Step 1: Add UI contract assertions**

Assert `/app/owner` contains control and audit hooks: `owner-controls`, `revoke-share-link`, `audit-log`, `refresh-audit-log`.

- [x] **Step 2: Implement Owner UI controls**

Add a revoke button for the current link and an audit log panel that refreshes from the owner audit API.

- [x] **Step 3: Verify targeted tests**

Run:

```bash
npm test apps/share-gateway/test/productization/httpServer.test.ts
```

Expected: PASS.

## Task 4: Verification And Commit

- [x] **Step 1: Manual smoke**

Run `npm run dev:productized`, create link, submit a friend task, query audit logs, revoke link, verify friend task is rejected.

- [x] **Step 2: Full verification**

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
git commit -m "Add Ralphloop owner controls and audit"
```
