# Ralphloop Productization Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the productized read-only preview contract: Host can append preview frames for a session, Friend can fetch session-bound frames, and interactive input is denied by default.

**Architecture:** Extend RelayStore with preview frame records tied to sessions. Add route functions for Host preview frame append, Friend preview fetch by share token and session, and explicit read-only interaction rejection with audit logging.

**Tech Stack:** Node.js built-ins, TypeScript executed through `node --experimental-strip-types`, `node:test`.

---

## Task 1: Preview Frame Persistence

**Files:**
- Modify: `apps/share-gateway/src/productization/types.ts`
- Modify: `apps/share-gateway/src/productization/relayStore.ts`
- Create: `apps/share-gateway/test/productization/preview.test.ts`

- [x] **Step 1: Write failing preview persistence tests**

Cover append/list preview frames for a session.

- [x] **Step 2: Implement preview frame record helpers**

Add `PreviewFrameRecord`, `appendPreviewFrame`, `listPreviewFrames`.

- [x] **Step 3: Run targeted tests**

Run:

```bash
npm test apps/share-gateway/test/productization/preview.test.ts
```

Expected: PASS.

## Task 2: Friend Preview And Read-Only Rejection

**Files:**
- Modify: `apps/share-gateway/src/productization/routes.ts`
- Modify: `apps/share-gateway/test/productization/preview.test.ts`

- [x] **Step 1: Write failing route tests**

Cover:

- Friend can fetch frames only for a session belonging to the share token.
- Invalid token/session returns neutral unavailable.
- Preview interaction input is rejected by default and audited.

- [x] **Step 2: Implement route functions**

Add:

- `appendHostPreviewFrameV1`
- `getFriendPreviewV1`
- `rejectPreviewInteractionV1`

- [x] **Step 3: Run targeted tests**

Expected: PASS.

## Task 3: Full Verification And Commit

- [x] **Step 1: Update test scripts**

Ensure preview tests are included in productization integration/security layers.

- [x] **Step 2: Full verification**

Run all project validation commands.

- [x] **Step 3: Commit**

Commit message:

```bash
git commit -m "Add Ralphloop read-only preview contracts"
```
