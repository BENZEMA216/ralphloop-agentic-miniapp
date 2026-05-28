# Ralphloop Productization Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the productized Relay contracts to a Host runtime registry so friend tasks can route through a registered Host to an Agent Adapter instead of the local MVP fake adapter.

**Architecture:** Add a transport-free Host runtime registry that models the outbound Host connection boundary from the productization spec. Productization task routes look up an active share link, verify the linked Host is online, require a connected Host runtime adapter, create persisted session/task records, execute the adapter, filter events for friend-safe output, and record audit logs.

**Tech Stack:** Node.js built-ins, TypeScript executed through `node --experimental-strip-types`, `node:test`, existing AgentAdapter contract.

---

## Scope

This plan implements the first half of productization Phase 2 from `docs/superpowers/specs/2026-05-21-personal-agent-share-productization-spec.zh.md`.

In scope:

- Connected Host runtime registry.
- Adapter lookup by `hostId` and `adapterId`.
- Friend task submission route that requires a connected Host runtime.
- Persisted session/task/audit records for submitted tasks.
- Friend-safe event filtering and no-cost response contract.
- Contract/integration/security tests.

Out of scope:

- Real websocket transport.
- Real browser/desktop preview stream.
- OAuth provider flows.
- Production queueing.
- Running paid model calls in CI.

## Task 1: Host Runtime Registry

**Files:**
- Create: `apps/share-gateway/test/productization/hostRuntime.test.ts`
- Create: `apps/share-gateway/src/productization/hostRuntime.ts`

- [x] **Step 1: Write failing tests**

Cover:

- A Host can connect adapters by `hostId`.
- Adapter lookup returns undefined when Host is disconnected.
- Disconnect removes access.

Run:

```bash
npm test apps/share-gateway/test/productization/hostRuntime.test.ts
```

Expected: FAIL because `hostRuntime.ts` does not exist.

- [x] **Step 2: Implement registry**

Add `HostRuntimeRegistry` with `connectHost`, `disconnectHost`, `findAdapter`, `hasHost`.

- [x] **Step 3: Verify targeted tests**

Run:

```bash
npm test apps/share-gateway/test/productization/hostRuntime.test.ts
```

Expected: PASS.

## Task 2: Relay To Host Task Submission

**Files:**
- Create: `apps/share-gateway/test/productization/taskFlow.test.ts`
- Modify: `apps/share-gateway/src/productization/relayStore.ts`
- Modify: `apps/share-gateway/src/productization/routes.ts`

- [x] **Step 1: Write failing task flow tests**

Cover:

- Friend task submission creates session/task records.
- Task routes to the connected Host adapter.
- Response includes friend-safe task status and events.
- Missing Host runtime returns neutral unavailable response.
- Response does not include cost, budget, token hash, or owner-only fields.

Run:

```bash
npm test apps/share-gateway/test/productization/taskFlow.test.ts
```

Expected: FAIL because `submitFriendTaskV1` does not exist.

- [x] **Step 2: Add RelayStore update helpers**

Add helpers to update session status/runtime and task status/result/failure.

- [x] **Step 3: Implement `submitFriendTaskV1`**

Use existing share link, host, policy, and adapter contracts. Do not create a fallback fake adapter.

- [x] **Step 4: Verify targeted tests**

Run:

```bash
npm test apps/share-gateway/test/productization/taskFlow.test.ts
```

Expected: PASS.

## Task 3: Productization Script Coverage

**Files:**
- Modify: `package.json`

- [x] **Step 1: Include Phase 2 tests in scripts**

Update:

- `test:contract` includes routes and host runtime contract.
- `test:integration` includes relay store and task flow.
- `test:security` includes security and task flow safe response checks.

- [x] **Step 2: Run productization scripts**

Run:

```bash
npm run test:contract
npm run test:integration
npm run test:security
```

Expected: PASS.

## Task 4: Full Verification And Commit

- [x] **Step 1: Mark completed steps**

Update this plan's checkboxes.

- [x] **Step 2: Run full verification**

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
git status --short
```

Expected: all tests pass, diff check clean.

- [x] **Step 3: Commit**

Commit message:

```bash
git commit -m "Add Ralphloop host runtime task routing"
```
