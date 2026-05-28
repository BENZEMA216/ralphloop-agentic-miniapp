# Ralphloop Productized HTTP API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the productized Relay contracts through HTTP endpoints so Ralphloop has a runnable product API beyond transport-free functions.

**Architecture:** Add a separate productized HTTP server under `apps/share-gateway/src/productization/httpServer.ts`. It owns a RelayStore and HostRuntimeRegistry, exposes v1 Host/Owner/Friend endpoints, and keeps the old local MVP server unchanged.

**Tech Stack:** Node.js `http`, TypeScript executed through `node --experimental-strip-types`, `node:test`, built-in `fetch`.

---

## Task 1: HTTP API Test

**Files:**
- Create: `apps/share-gateway/test/productization/httpServer.test.ts`
- Create: `apps/share-gateway/src/productization/httpServer.ts`

- [x] **Step 1: Write failing HTTP API test**

Cover:

- Register Host.
- Create owner share link.
- Friend opens link.
- Friend submits task through connected Host runtime.
- Response hides cost and token hash.
- Missing Host runtime returns neutral unavailable.

- [x] **Step 2: Verify red**

Run:

```bash
npm test apps/share-gateway/test/productization/httpServer.test.ts
```

Expected: FAIL because productized HTTP server does not exist.

## Task 2: Implement Server

- [x] **Step 1: Implement `createProductizedShareServer`**

Routes:

- `POST /v1/hosts/register`
- `POST /v1/hosts/:hostId/heartbeat`
- `POST /v1/owner/share-links`
- `GET /v1/share/:token`
- `POST /v1/share/:token/tasks`

- [x] **Step 2: Run targeted test**

Expected: PASS.

## Task 3: Full Verification And Commit

- [x] **Step 1: Update scripts**

Include productized HTTP server tests in integration.

- [x] **Step 2: Full verification**

Run all project verification commands.

- [x] **Step 3: Commit**

Commit message:

```bash
git commit -m "Add Ralphloop productized HTTP API"
```
