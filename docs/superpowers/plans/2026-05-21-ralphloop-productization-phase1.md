# Ralphloop Productization Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first productization slice for personal Agent sharing: persistent Share Relay data, Host registration/heartbeat contracts, owner/friend API boundaries, and test commands tied to the productization spec.

**Architecture:** Add a focused `productization` module inside `apps/share-gateway` without rewriting the existing local MVP routes. The module owns V1 Relay data models, token hashing, file-backed persistence, Host lifecycle state, share link/session/task/audit records, and route-level functions that can later be wrapped by HTTP endpoints.

**Tech Stack:** Node.js built-ins, TypeScript executed through `node --experimental-strip-types`, `node:test`, existing npm scripts.

---

## Scope

This plan implements Phase 1 from `docs/superpowers/specs/2026-05-21-personal-agent-share-productization-spec.zh.md`.

In scope:

- Persistent Relay store.
- ShareLink, SharePolicy, Host, Session, Task, AuditLog models.
- Token hashing and lookup by raw token.
- Host registration and heartbeat.
- Owner/Friend/Host route functions.
- Contract/security test scripts wired into `package.json`.

Out of scope:

- Real outbound websocket tunnel.
- Real adapter execution through Host.
- Real desktop/browser preview stream.
- OAuth provider flows.
- Production database.
- Public deployment.

## File Structure

- Create `apps/share-gateway/src/productization/types.ts`
  - Productization entity types and status unions.
- Create `apps/share-gateway/src/productization/token.ts`
  - Token generation and SHA-256 token hashing.
- Create `apps/share-gateway/src/productization/relayStore.ts`
  - File-backed RelayStore with load/save, host, link, session, task, audit helpers.
- Create `apps/share-gateway/src/productization/routes.ts`
  - Owner/Friend/Host route-level functions, independent from HTTP transport.
- Create `apps/share-gateway/test/productization/relayStore.test.ts`
  - Persistence, token hashing, default policy, audit tests.
- Create `apps/share-gateway/test/productization/routes.test.ts`
  - Host registration/heartbeat and owner/friend API contract tests.
- Create `apps/share-gateway/test/productization/security.test.ts`
  - Friend response cost-hiding and token hash safety tests.
- Modify `package.json`
  - Add `test:contract`, `test:integration`, `test:security`, `test:e2e`, `test:smoke:real-adapter` scripts.

## Task 1: Relay Data Model And Persistence

**Files:**
- Create: `apps/share-gateway/test/productization/relayStore.test.ts`
- Create: `apps/share-gateway/src/productization/types.ts`
- Create: `apps/share-gateway/src/productization/token.ts`
- Create: `apps/share-gateway/src/productization/relayStore.ts`

- [x] **Step 1: Write failing persistence tests**

Test that a share link is persisted to disk, reloads after process/store restart, stores only `tokenHash`, and can be found by raw token.

Run:

```bash
npm test apps/share-gateway/test/productization/relayStore.test.ts
```

Expected: FAIL because files do not exist.

- [x] **Step 2: Implement productization types and token helpers**

Add entity types matching the V1 spec and `hashShareToken(token)`.

- [x] **Step 3: Implement RelayStore**

Implement file-backed JSON persistence using explicit `load()` and mutating methods that call `save()`.

- [x] **Step 4: Run targeted tests**

Run:

```bash
npm test apps/share-gateway/test/productization/relayStore.test.ts
```

Expected: PASS.

## Task 2: Host, Owner, And Friend Route Contracts

**Files:**
- Create: `apps/share-gateway/test/productization/routes.test.ts`
- Create: `apps/share-gateway/src/productization/routes.ts`

- [x] **Step 1: Write failing route contract tests**

Cover:

- Host registration returns online Host and audit entry.
- Host heartbeat updates `lastSeenAt` and adapter list.
- Owner creates an active link with default policy.
- Friend opening a valid link returns a cost-free task page contract.
- Paused/revoked links reject friend access.

Run:

```bash
npm test apps/share-gateway/test/productization/routes.test.ts
```

Expected: FAIL because route functions do not exist.

- [x] **Step 2: Implement route functions**

Implement transport-free functions:

- `registerHost`
- `recordHostHeartbeat`
- `createOwnerShareLinkV1`
- `getFriendSharePageV1`
- `pauseOwnerShareLinkV1`
- `revokeOwnerShareLinkV1`

- [x] **Step 3: Run targeted tests**

Run:

```bash
npm test apps/share-gateway/test/productization/routes.test.ts
```

Expected: PASS.

## Task 3: Security And Cost-Hiding Contract Tests

**Files:**
- Create: `apps/share-gateway/test/productization/security.test.ts`

- [x] **Step 1: Write failing security tests**

Cover:

- Friend page response omits `tokenHash`, `rawToken`, `maxTotalBudget`, `maxTaskBudget`, `cost`, `budget`, `price`.
- Invalid token returns neutral unavailable state.
- Stored links do not contain raw token.

Run:

```bash
npm test apps/share-gateway/test/productization/security.test.ts
```

Expected: FAIL until route/store helpers are complete.

- [x] **Step 2: Adjust route response filtering if needed**

Friend API contracts should return only safe fields: availability, display name, adapter id, preview mode, and neutral error.

- [x] **Step 3: Run targeted tests**

Run:

```bash
npm test apps/share-gateway/test/productization/security.test.ts
```

Expected: PASS.

## Task 4: Productization Test Scripts

**Files:**
- Modify: `package.json`

- [x] **Step 1: Add scripts**

Add:

```json
"test:contract": "node scripts/test.mjs apps/share-gateway/test/productization/routes.test.ts",
"test:integration": "node scripts/test.mjs apps/share-gateway/test/productization/relayStore.test.ts apps/share-gateway/test/routes apps/share-gateway/test/server",
"test:security": "node scripts/test.mjs apps/share-gateway/test/productization/security.test.ts apps/share-gateway/test/policy",
"test:e2e": "node scripts/test.mjs apps/share-web/e2e",
"test:smoke:real-adapter": "node scripts/test.mjs apps/share-gateway/test/adapters"
```

- [x] **Step 2: Run all new scripts**

Run:

```bash
npm run test:contract
npm run test:integration
npm run test:security
npm run test:e2e
npm run test:smoke:real-adapter
```

Expected: all pass. `test:smoke:real-adapter` is still mocked adapter smoke in Phase 1; Phase 2 must replace it with one true Host-to-adapter smoke.

## Task 5: Full Verification And Commit

**Files:**
- Modify: `docs/superpowers/plans/2026-05-21-ralphloop-productization-phase1.md`

- [x] **Step 1: Mark completed steps**

Update checkboxes for completed tasks.

- [x] **Step 2: Run full verification**

Run:

```bash
npm test
npm run lint
npm run typecheck
npm run build
git diff --check
git status --short
```

Expected: tests pass, lint/typecheck/build pass, diff check clean.

- [x] **Step 3: Commit**

Commit message:

```bash
git commit -m "Add Ralphloop productization phase 1 relay contracts"
```
