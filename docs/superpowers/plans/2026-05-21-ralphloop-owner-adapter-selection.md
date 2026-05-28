# Ralphloop Owner Adapter Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让产品化 Owner Console 读取真实 Host adapter 清单，并用创建者选中的 adapter 生成朋友分享链接。

**Architecture:** 在 productization route 层新增 Owner Host inventory contract，HTTP 层暴露 `GET /v1/owner/hosts`。Owner HTML 启动后读取该 API 渲染 adapter 单选项，创建分享链接时把选中的 adapter 写入 share policy，并在 route 层拒绝 Host 不支持的 adapter。

**Tech Stack:** Node.js `http`, TypeScript, `node:test`, built-in `fetch`.

---

## Task 1: Owner Host Inventory Contract

**Files:**
- Modify: `apps/share-gateway/src/productization/routes.ts`
- Modify: `apps/share-gateway/test/productization/routes.test.ts`

- [x] **Step 1: Write failing contract tests**

Cover:

- Owner can list only their own registered Hosts.
- Host inventory includes online status and supported adapter ids.
- Creating a share link can narrow policy to a selected supported adapter.
- Creating a share link with an unsupported adapter returns `adapter_not_available`.

- [x] **Step 2: Verify red**

Run:

```bash
npm test apps/share-gateway/test/productization/routes.test.ts
```

Expected: FAIL because the Owner inventory route and adapter validation do not exist yet.

- [x] **Step 3: Implement contract**

Add `listOwnerHostsV1` and selected adapter validation inside `createOwnerShareLinkV1`.

- [x] **Step 4: Verify green**

Run:

```bash
npm test apps/share-gateway/test/productization/routes.test.ts
```

Expected: PASS.

## Task 2: Productized HTTP And Owner UI

**Files:**
- Modify: `apps/share-gateway/src/productization/httpServer.ts`
- Modify: `apps/share-gateway/test/productization/httpServer.test.ts`

- [x] **Step 1: Write failing HTTP/UI tests**

Cover:

- `GET /v1/owner/hosts?ownerId=owner-1` returns registered adapter inventory.
- `POST /v1/owner/share-links` accepts selected adapter policy.
- `/app/owner` references the Host inventory API and renders adapter selection hooks.

- [x] **Step 2: Verify red**

Run:

```bash
npm test apps/share-gateway/test/productization/httpServer.test.ts
```

Expected: FAIL because the HTTP route and dynamic UI hooks do not exist yet.

- [x] **Step 3: Implement HTTP route and UI selection**

Add the Owner Host inventory endpoint and update Owner HTML JavaScript to load Hosts, render adapter radio inputs, and submit selected adapter policy.

- [x] **Step 4: Verify green**

Run:

```bash
npm test apps/share-gateway/test/productization/httpServer.test.ts
```

Expected: PASS.

## Task 3: Productized Dev Runtime

**Files:**
- Modify: `apps/share-gateway/src/productization/dev.ts`

- [x] **Step 1: Wire detected adapters into dev server**

Use `AdapterRegistry.detectAll()` to register locally available adapter ids. Keep a safe demo adapter by default, with optional real adapter mode for future manual runs.

- [x] **Step 2: Verify dev smoke**

Run `npm run dev:productized`, open `/app/owner`, create link, open `/app/share/local-friend`, submit a task.

## Task 4: Full Verification And Commit

- [x] **Step 1: Full verification**

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

- [x] **Step 2: Commit**

Commit message:

```bash
git commit -m "Add Ralphloop owner adapter selection"
```
