# Ralphloop Productization Phase 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add productized availability and risk controls: budget enforcement, concurrent session limits, Host offline handling, and owner kill switch.

**Architecture:** Enforce share policy before task execution in `submitFriendTaskV1`, persist budget usage on accepted tasks, add Host status controls, and add session cancellation route functions. Friend-facing errors remain neutral while owner/audit logs record concrete reasons.

**Tech Stack:** Node.js built-ins, TypeScript executed through `node --experimental-strip-types`, `node:test`.

---

## Task 1: Budget And Concurrency Controls

**Files:**
- Modify: `apps/share-gateway/src/productization/types.ts`
- Modify: `apps/share-gateway/src/productization/relayStore.ts`
- Modify: `apps/share-gateway/src/productization/routes.ts`
- Create: `apps/share-gateway/test/productization/controls.test.ts`

- [x] **Step 1: Write failing controls tests**

Cover max task budget, total budget, and max concurrent sessions.

- [x] **Step 2: Implement store helpers and route checks**

Add budget usage, active session count, and preflight checks before adapter execution.

- [x] **Step 3: Run targeted tests**

Expected: PASS.

## Task 2: Host Offline And Kill Switch

**Files:**
- Modify: `apps/share-gateway/src/productization/relayStore.ts`
- Modify: `apps/share-gateway/src/productization/routes.ts`
- Modify: `apps/share-gateway/test/productization/controls.test.ts`

- [x] **Step 1: Write failing tests**

Cover Host offline neutral friend response and owner session cancellation.

- [x] **Step 2: Implement route functions**

Add:

- `markHostOfflineV1`
- `cancelOwnerSessionV1`

- [x] **Step 3: Run targeted tests**

Expected: PASS.

## Task 3: Full Verification And Commit

- [x] **Step 1: Update test scripts**

Ensure controls tests run in integration/security layers.

- [x] **Step 2: Full verification**

Run all project validation commands.

- [x] **Step 3: Commit**

Commit message:

```bash
git commit -m "Add Ralphloop availability and budget controls"
```
