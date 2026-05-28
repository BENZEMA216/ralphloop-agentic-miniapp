# Ralphloop Productization Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add productized high-risk action gates, approval requests, approval resolution, and audit records so sensitive actions cannot execute silently.

**Architecture:** Extend the productization RelayStore with `ApprovalRequest` records and add route functions that classify runtime actions with the existing policy engine. Allowed actions return immediately; blocked actions record an audit denial; user-confirm and owner-approval actions create persisted pending requests that can be approved or denied.

**Tech Stack:** Node.js built-ins, TypeScript executed through `node --experimental-strip-types`, `node:test`, existing high-risk policy module.

---

## Task 1: Approval Persistence

**Files:**
- Modify: `apps/share-gateway/src/productization/types.ts`
- Modify: `apps/share-gateway/src/productization/relayStore.ts`
- Create: `apps/share-gateway/test/productization/approvals.test.ts`

- [x] **Step 1: Write failing approval persistence tests**

Cover creating and resolving approval requests, with records surviving store reload.

Run:

```bash
npm test apps/share-gateway/test/productization/approvals.test.ts
```

Expected: FAIL because approval helpers do not exist.

- [x] **Step 2: Add approval types and store helpers**

Add `ApprovalRequestRecord`, `createApprovalRequest`, `resolveApprovalRequest`, and `listApprovalRequests`.

- [x] **Step 3: Run targeted tests**

Expected: PASS.

## Task 2: High-Risk Action Gate Routes

**Files:**
- Modify: `apps/share-gateway/src/productization/routes.ts`
- Modify: `apps/share-gateway/test/productization/approvals.test.ts`

- [x] **Step 1: Write failing route tests**

Cover:

- Runtime-internal destructive shell is blocked.
- User-identity send email creates `user_confirm` pending request.
- Owner-delegated account access creates `owner_approve` pending request.
- Approving and denying requests changes status and writes audit logs.

- [x] **Step 2: Implement routes**

Add:

- `gateRuntimeActionV1`
- `resolveApprovalRequestV1`

- [x] **Step 3: Run targeted tests**

Expected: PASS.

## Task 3: Script Coverage And Commit

- [x] **Step 1: Update scripts if needed**

Ensure `test:security` includes approval tests.

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
git commit -m "Add Ralphloop high risk approval gates"
```
