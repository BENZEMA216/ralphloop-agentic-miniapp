# Ralphloop Productized Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add browser-usable productized Owner and Friend pages on top of the `/v1` API, plus a local productized dev server.

**Architecture:** Extend `createProductizedShareServer` with HTML routes under `/app`. The HTML pages use existing `/v1` APIs and keep friend-facing cost hidden. Add `dev:productized` that boots a local RelayStore, registers a demo Host, connects a safe demo adapter, and serves the productized web flow.

**Tech Stack:** Node.js `http`, TypeScript executed through `node --experimental-strip-types`, `node:test`, built-in `fetch`.

---

## Task 1: Productized Web Tests

**Files:**
- Modify: `apps/share-gateway/test/productization/httpServer.test.ts`
- Modify: `apps/share-gateway/src/productization/httpServer.ts`

- [x] **Step 1: Write failing page tests**

Cover:

- `GET /app/owner` returns productized owner page with host/share-link controls.
- Owner page references `/v1/owner/share-links`.
- `GET /app/share/:token` returns friend task page.
- Friend page references `/v1/share/:token/tasks`.
- Friend HTML does not contain cost, budget, token hash, or model price.

- [x] **Step 2: Verify red**

Run:

```bash
npm test apps/share-gateway/test/productization/httpServer.test.ts
```

Expected: FAIL because `/app` pages do not exist.

## Task 2: Implement Pages And Dev Server

**Files:**
- Modify: `apps/share-gateway/src/productization/httpServer.ts`
- Create: `apps/share-gateway/src/productization/dev.ts`
- Modify: `package.json`

- [x] **Step 1: Implement HTML routes**

Add:

- `GET /app/owner`
- `GET /app/share/:token`

- [x] **Step 2: Add local productized dev entry**

Add `dev:productized` script.

- [x] **Step 3: Run targeted tests**

Expected: PASS.

## Task 3: Full Verification And Commit

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
```

- [x] **Step 2: Manual HTTP smoke**

Run `npm run dev:productized`, fetch `/app/owner`, create link through API, fetch `/app/share/local-friend`, submit a task.

- [x] **Step 3: Commit**

Commit message:

```bash
git commit -m "Add Ralphloop productized web flow"
```
