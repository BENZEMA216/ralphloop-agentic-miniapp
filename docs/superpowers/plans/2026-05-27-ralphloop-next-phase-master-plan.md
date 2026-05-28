# Ralphloop Next-Phase Master Plan (Phase A / C / D + Gap Closure)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Four workstreams run in parallel worktrees; obey the file-ownership boundaries called out under "Worktree Isolation" before merging.

**Goal:** Take the post-`codex/ralphloop-ui-automation` baseline (assistant-ui SSR shell at `/app/share/:token/assistant-ui`, real Codex/Claude/OpenCode adapters with cancel + 120 s timeout, in-memory `RelayStore` with optional JSON dump) and finish the four roadmap items from `docs/superpowers/research/2026-05-25-agent-share-github-deep-research.zh.md` §6 + §8: (A) hydrated React shell coexisting with SSR, (C) formal Provider Adapter contract + per-session process table, (D) durable Relay event store + reconnect recovery, (G) cross-browser smoke + owner screenshot archive + pixel baselines.

**Architecture:**

- **A** adds a brand-new `apps/share-web-react/` Vite + React 19 + `@assistant-ui/react` SPA that hydrates `createFriendAgUiRuntimeStore` against the existing `/v1/share/:token/*` HTTP API. Gateway exposes it at `/app/share/:token/v2` while `/assistant-ui` and `/classic` continue to work untouched. Reuses the runtime in `apps/share-web/src/runtime/` by adding it to a shared package source path — no behavior changes in `share-web`.
- **C** extracts the `ProviderAdapter` contract that `CodexAdapter`/`ClaudeAdapter`/`OpenCodeAdapter` already implement informally into `apps/share-gateway/src/adapters/provider.ts` (interface + capability descriptor + contract tests), adds a `ProviderRegistry` returning the right adapter for `adapterId`, and promotes `HostClientRuntimeState` (already present in `hostClient.ts`) to a typed `SessionProcessTable` with race-safe submit/cancel handoff and reclaim across poll ticks.
- **D** swaps `RelayStore`'s "load → mutate in memory → JSON.stringify whole file" pattern for an append-only JSONL event log + periodic compacted snapshot (chosen over `better-sqlite3` because it needs zero native deps, fits the existing stripped-types runtime, and matches what we already partially write). Same public API; lazy `flush()` instead of synchronous full rewrite. Adds reconnect recovery for queued/claimed `HostCommand`s and a terminal-state guard so late `completed`/`failed` cannot overwrite `cancelled`.
- **G** keeps the existing CDP-driven Chrome harness (`apps/share-web/e2e/browserHarness.ts`), adds a Firefox-or-additional-viewport second target, an owner-side screenshot archive under `.gstack/qa-reports/browser-screenshots/`, and a pixel-baseline harness using a pure-JS PNG diff (no `playwright` dep) that fails CI on >2% pixel divergence.

**Tech Stack:**

- Existing: Node.js, TypeScript stripped runtime (`node --experimental-strip-types`), `node:test`, custom `scripts/test.mjs|lint.mjs|check-syntax.mjs`, React 19 + `@assistant-ui/react@^0.14.7` (already in `package.json`), CDP-driven headless Chrome harness.
- **New dependencies to add:**
  - `vite` + `@vitejs/plugin-react` (devDependencies) for the `apps/share-web-react/` build (Workstream A).
  - `pngjs` + `pixelmatch` (devDependencies) for the pixel baseline diff harness (Workstream G). Pure JS, no native binaries.
- **Explicitly rejected:**
  - `better-sqlite3`: native binary, would break the "stripped-types runtime, no native deps" posture and adds cross-platform install fragility. JSONL append-log + snapshot is simpler and survives the same failure modes for our scale.
  - `@playwright/test`: brings ~300 MB of browser binaries and a parallel test runner that fights `node:test`. We already have a working CDP harness in `browserHarness.ts`; we extend it instead.

---

## Scope And File Map

### Worktree Isolation

| Workstream | Worktree | Files owned (writes) | Files read-only |
|---|---|---|---|
| A — React app | `wt-phase-a` | `apps/share-web-react/**` (new), `apps/share-gateway/src/productization/httpServer.ts` (one new route only, ~30 LOC), `package.json` (new `dev:web-react`, `build:web-react`, `test:web-react` scripts; new devDeps), `apps/share-gateway/test/productization/httpServer.test.ts` (one new assertion block for `/v2` route) | All `apps/share-web/`, all `apps/share-gateway/src/adapters/`, `relayStore.ts` |
| C — Provider contract | `wt-phase-c` | `apps/share-gateway/src/adapters/provider.ts` (new), `apps/share-gateway/src/adapters/registry.ts`, `apps/share-gateway/src/adapters/codex.ts`, `apps/share-gateway/src/adapters/claude.ts`, `apps/share-gateway/src/adapters/opencode.ts`, `apps/share-gateway/src/adapters/types.ts`, `apps/share-gateway/src/productization/hostClient.ts` (extract `SessionProcessTable`), `apps/share-gateway/test/adapters/**`, new `apps/share-gateway/test/adapters/providerContract.test.ts` | `relayStore.ts`, all `apps/share-web*/` |
| D — Durable Relay | `wt-phase-d` | `apps/share-gateway/src/productization/relayStore.ts`, new `apps/share-gateway/src/productization/relayStoreJournal.ts`, `apps/share-gateway/test/productization/relayStore.test.ts`, new `apps/share-gateway/test/productization/relayStoreRecovery.test.ts`, `apps/share-gateway/src/productization/hostClient.ts` **only inside** `executeHostCommand` terminal-event guard (small additive diff) | All `apps/share-gateway/src/adapters/` core files (C owns adapters, D only adds a guard in `hostClient`), all `apps/share-web*/` |
| G — Gap closure | `wt-gap-closure` | `apps/share-web/e2e/browserHarness.ts` (extend, do not break), new `apps/share-web/e2e/pixelBaseline.ts`, new `apps/share-web/e2e/baselines/**`, new `apps/share-web/e2e/owner-screenshot-archive.test.ts`, new `apps/share-web/e2e/cross-browser-smoke.test.ts`, `package.json` (devDeps `pngjs`, `pixelmatch`; new `test:e2e:pixel` and `test:e2e:cross-browser` scripts) | Everything in `apps/share-gateway/src` and `apps/share-web/src` |

**Conflict surface check:**

- A and C/D never touch the same file (A's `httpServer.ts` diff is the `/v2` route; C/D do not modify `httpServer.ts`).
- C and D both touch `hostClient.ts`. To avoid a merge race, **C lands first**: Task C.3 lifts `HostClientRuntimeState` into a typed `SessionProcessTable` exported from a new file; Task D.6 then adds only a small terminal-state guard inside `executeHostCommand` that depends on the post-C shape.
- G is read-only against src; it can ship in parallel with all of A/C/D.
- All four workstreams will independently touch `package.json` for scripts/devDeps. Sequence merges as A → C → D → G if a `package.json` conflict surfaces; the diffs are additive lines under different sub-keys.

---

## Workstream A — Hydrated React App skeleton

> Goal: prove the React app at `/app/share/:token/v2` can hydrate `createFriendAgUiRuntimeStore` against the live `/v1/share/:token/*` API and pass a real-browser smoke that sends a message and sees an Agent bubble. **Coexists** with `/assistant-ui` (SSR shell) and `/classic` (legacy). Do not delete `assistantUiReactShell.ts`, `assistantUiClientScript.ts`, or `renderAssistantUiReactShellInSubprocess`.

### Task A.1: Add Vite + React 19 dev/build harness under `apps/share-web-react/`

**Files:**
- Create: `apps/share-web-react/package.json` (private workspace stub)
- Create: `apps/share-web-react/vite.config.ts`, `apps/share-web-react/index.html`, `apps/share-web-react/tsconfig.json`
- Create: `apps/share-web-react/src/main.tsx`, `apps/share-web-react/src/App.tsx`
- Modify: root `package.json` (devDeps `vite`, `@vitejs/plugin-react`; scripts `dev:web-react`, `build:web-react`, `test:web-react`)

- [ ] **Step 1: Write the failing harness test**

In `apps/share-web-react/test/build.test.ts`, assert that `npm run build:web-react` produces `apps/share-web-react/dist/index.html` and a hashed JS bundle.

- [ ] **Step 2: Verify RED**

```bash
node scripts/test.mjs apps/share-web-react/test/build.test.ts
```

- [ ] **Step 3: Implement minimal Vite config + entry**

Vite emits `index.html` + JS bundle; `base` set to `/app/share/__TOKEN__/v2/assets/` placeholder; `define` Node env stubs for React 19 client.

- [ ] **Step 4: Verify GREEN**

```bash
node scripts/test.mjs apps/share-web-react/test/build.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/share-web-react package.json
git commit -m "feat(share-web-react): scaffold vite + react 19 build harness"
```

### Task A.2: Wire `createFriendAgUiRuntimeStore` into the React entry

**Files:**
- Modify: `apps/share-web-react/src/main.tsx`, `apps/share-web-react/src/App.tsx`
- Read-only reuse: `apps/share-web/src/runtime/friendAgUiRuntimeStore.ts`, `apps/share-web/src/runtime/assistantUiRuntimeBinding.ts`, `apps/share-web/src/runtime/agUiExternalStore.ts`
- Create: `apps/share-web-react/test/hydration.test.ts`

- [ ] **Step 1: Failing hydration unit test**

Mount `<App initialState={...} />` with stub `fetch`; assert `data-assistant-ui-thread` + `data-assistant-ui-message-list` exist; initial event list produces an Agent bubble.

- [ ] **Step 2: RED**

```bash
node scripts/test.mjs apps/share-web-react/test/hydration.test.ts
```

- [ ] **Step 3: Implement App.tsx**

Read `window.__RALPHLOOP_STATE__` (same JSON shape as `#assistant-ui-state` in `assistantUiClientScript.ts`); call `createFriendAgUiRuntimeStore({ baseUrl: "", token, currentThreadId, threads, fetch })`; wrap `useExternalStoreRuntime(createAssistantUiRuntimeOptions(store))` in `AssistantRuntimeProvider`; render an adapted version of `RalphloopAssistantUiShell`.

- [ ] **Step 4: GREEN**

```bash
node scripts/test.mjs apps/share-web-react/test/hydration.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/share-web-react/src apps/share-web-react/test
git commit -m "feat(share-web-react): hydrate friend runtime store in react entry"
```

### Task A.3: Resolve runtime imports across packages

**Files:**
- Modify: `apps/share-web-react/tsconfig.json` (paths `@runtime/*` → `../share-web/src/runtime/*`)
- Modify: `apps/share-web-react/vite.config.ts` (matching `resolve.alias`)

- [ ] **Step 1: Verify hydration test still passes**

```bash
node scripts/test.mjs apps/share-web-react/test/hydration.test.ts
```

- [ ] **Step 2: Commit**

```bash
git add apps/share-web-react
git commit -m "chore(share-web-react): alias share-web runtime imports"
```

### Task A.4: Add gateway route `/app/share/:token/v2`

**Files:**
- Modify: `apps/share-gateway/src/productization/httpServer.ts` (new route below existing `appShareAssistantUiMatch` block, ~30 LOC)
- Modify: `apps/share-gateway/test/productization/httpServer.test.ts`

- [ ] **Step 1: Failing contract assertion**

GET `/app/share/local-friend/v2` returns 200, HTML contains `data-ralphloop-react-app="true"`, includes `<script type="application/json" id="ralphloop-state">`, and `/assistant-ui` still returns 200 with `data-ralphloop-assistant-ui-shell="true"` (regression guard).

- [ ] **Step 2: RED**

```bash
node scripts/test.mjs apps/share-gateway/test/productization/httpServer.test.ts
```

- [ ] **Step 3: Implement the route**

`readFileSync` of `apps/share-web-react/dist/index.html`, replace placeholder with JSON state. For asset requests, validate path stays inside `dist/assets/`, set content-type via extension.

- [ ] **Step 4: GREEN**

```bash
node scripts/test.mjs apps/share-gateway/test/productization/httpServer.test.ts
node scripts/test.mjs apps/share-gateway/test/productization/security.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/share-gateway/src/productization/httpServer.ts apps/share-gateway/test/productization/httpServer.test.ts
git commit -m "feat(share-gateway): serve react v2 entry under /app/share/:token/v2"
```

### Task A.5: Real-browser smoke for `/v2`

**Files:**
- Create: `apps/share-web/e2e/react-v2-hydration-browser.test.ts`

- [ ] **Step 1: Failing browser e2e**

Use `launchChrome()` from `browserHarness.ts`. Boot gateway with seeded share-link + outbound Host. Navigate to `/app/share/local-friend/v2`, wait for `[data-ralphloop-react-app="true"]`, submit a prompt, poll until `[data-message-role="assistant"]` with non-empty text.

- [ ] **Step 2: Build then run**

```bash
npm run build:web-react
node scripts/test.mjs apps/share-web/e2e/react-v2-hydration-browser.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add apps/share-web/e2e/react-v2-hydration-browser.test.ts
git commit -m "test(e2e): smoke /app/share/:token/v2 react hydration"
```

### Workstream A verification block

```bash
npm test
npm run lint
npm run typecheck
npm run build
npm run build:web-react
npm run test:contract
npm run test:integration
npm run test:security
npm run test:e2e
npm run test:smoke:real-adapter
git diff --check
```

### Workstream A — Definition of Done

- [ ] `apps/share-web-react/` exists with a working Vite + React 19 build producing `dist/index.html` + hashed JS.
- [ ] `GET /app/share/:token/v2` returns 200 with `data-ralphloop-react-app="true"`; `/assistant-ui` and `/classic` still 200 with their existing markers.
- [ ] Real Chrome e2e demonstrates sending a message in `/v2` and observing an Agent bubble.
- [ ] No file in `apps/share-web/src/` or `apps/share-gateway/src/adapters/` was modified.
- [ ] Full verification block exits 0.

---

## Workstream C — Provider Adapter Contract + Per-Session Process Table

> Goal: formalize the contract so Codex / Claude / OpenCode / future ACP-generic adapters all conform; promote the existing `HostClientRuntimeState` into a typed, race-safe `SessionProcessTable`; back it with contract tests.

### Task C.1: Define the `ProviderAdapter` contract

**Files:**
- Create: `apps/share-gateway/src/adapters/provider.ts`
- Modify: `apps/share-gateway/src/adapters/types.ts` (re-export `ProviderAdapter` + `ProviderCapabilityDescriptor`)
- Create: `apps/share-gateway/test/adapters/providerContract.test.ts`

- [ ] **Step 1: Reusable contract spec**

`runProviderContract({ name, factory })` runs ~10 assertions: `detect()` returns well-formed `AgentAdapterInfo`; `start()` returns `RuntimeHandle` with `status: "running"`; `submitTask()` honors `AbortSignal`; `streamEvents()` emits `task.accepted` first and `task.completed` last on success; `stop()` is idempotent.

In `providerContract.test.ts`, call it for Codex/Claude/OpenCode.

- [ ] **Step 2: RED**

```bash
node scripts/test.mjs apps/share-gateway/test/adapters/providerContract.test.ts
```

- [ ] **Step 3: Implement `provider.ts`**

Export `interface ProviderAdapter` plus `ProviderCapabilityDescriptor`. Add `assertProviderContract(adapter)` helper.

- [ ] **Step 4: Adapters declare conformance**

`class CodexAdapter implements ProviderAdapter` (one keyword + import per adapter).

- [ ] **Step 5: GREEN**

```bash
node scripts/test.mjs apps/share-gateway/test/adapters/providerContract.test.ts
node scripts/test.mjs apps/share-gateway/test/adapters
```

- [ ] **Step 6: Commit**

```bash
git add apps/share-gateway/src/adapters apps/share-gateway/test/adapters/providerContract.test.ts
git commit -m "feat(adapters): formalize ProviderAdapter contract with shared spec"
```

### Task C.2: Add `ProviderRegistry`

**Files:**
- Create: `apps/share-gateway/src/adapters/providerRegistry.ts`
- Modify: `apps/share-gateway/src/adapters/registry.ts`
- Create: `apps/share-gateway/test/adapters/providerRegistry.test.ts`

- [ ] **Step 1: Failing test**

`get("codex")` returns adapter instance, `get("unknown")` throws `unknown_adapter`, `register({ id, factory })` allows new adapter, `list()` returns all ids.

- [ ] **Step 2: RED → implement → GREEN**

- [ ] **Step 3: Wire into `hostClient.ts`**

Add overload accepting `providerRegistry: ProviderRegistry` alongside the existing `adapters: Record<string, AgentAdapter>` (back-compat).

- [ ] **Step 4: Commit**

```bash
git add apps/share-gateway/src/adapters apps/share-gateway/test/adapters/providerRegistry.test.ts apps/share-gateway/src/productization/hostClient.ts
git commit -m "feat(adapters): add ProviderRegistry and accept it in hostClient"
```

### Task C.3: Extract `SessionProcessTable`

**Files:**
- Create: `apps/share-gateway/src/productization/sessionProcessTable.ts`
- Modify: `apps/share-gateway/src/productization/hostClient.ts`
- Modify: `apps/share-gateway/test/productization/hostClient.test.ts`

> Today `hostClient.ts` already exports `HostClientRuntimeState` with `activeTasksBySession: Map<string, ActiveHostTask>`. This task **promotes**, not invents, that structure.

- [ ] **Step 1: Concurrency tests**

  1. Two `task.submit` on different sessions concurrently — both run, both yield terminal events, table contains both then clears in `finally`.
  2. `session.cancel` races mid-`streamEvents` — `stopRequested` flips before late `task.completed`; emitted event list has exactly one `task.cancelled`.
  3. `session.cancel` for unknown session is a no-op.
  4. Table survives across poll ticks so a second `session.cancel` for same session still routes correctly.

- [ ] **Step 2: RED**

- [ ] **Step 3: Implement `SessionProcessTable`**

`class SessionProcessTable { acquire(sessionId): SessionSlot; getActive(sessionId): SessionSlot | undefined; cancel(sessionId, reason): Promise<void>; release(slot): void; }`. Per-session async lock prevents cancel-vs-finally race.

- [ ] **Step 4: Refactor `hostClient.ts`**

Replace `HostClientRuntimeState` with `SessionProcessTable`; export alias `HostClientRuntimeState = SessionProcessTable` for back-compat.

- [ ] **Step 5: GREEN**

```bash
node scripts/test.mjs apps/share-gateway/test/productization/hostClient.test.ts
node scripts/test.mjs apps/share-gateway/test/productization/devOutbound.test.ts
node scripts/test.mjs apps/share-gateway/test/productization/realAdapterSmoke.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/share-gateway/src/productization/sessionProcessTable.ts apps/share-gateway/src/productization/hostClient.ts apps/share-gateway/test/productization/hostClient.test.ts
git commit -m "refactor(hostClient): extract typed SessionProcessTable with race-safe cancel"
```

### Task C.4: Re-verify

```bash
node scripts/test.mjs apps/share-gateway/test/adapters
node scripts/test.mjs apps/share-gateway/test/productization/hostClient.test.ts apps/share-gateway/test/productization/hostCommands.test.ts apps/share-gateway/test/productization/realAdapterSmoke.test.ts
npm run test:smoke:real-adapter
```

### Workstream C verification block

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

### Workstream C — Definition of Done

- [ ] `ProviderAdapter` interface in `apps/share-gateway/src/adapters/provider.ts`; Codex, Claude, OpenCode all `implements ProviderAdapter`.
- [ ] `runProviderContract` spec reused across all three adapter test files.
- [ ] `ProviderRegistry.get` / `register` / `list` work; ready for ACP-generic later.
- [ ] `SessionProcessTable` survives across `runHostCommandOnce` invocations; four new concurrency tests pass deterministically.
- [ ] Full verification block exits 0.

---

## Workstream D — Persistent Relay Event Store + Reconnect Recovery

> Goal: durable across gateway restarts; `HostCommand` recovery on Host reconnect; terminal-state guard so late `completed`/`failed` cannot overwrite `cancelled`.

> **Decision: JSONL append-only journal + periodic snapshot.** Today's store already writes a single JSON dump. The change: every mutation appends a line to `relay.journal.jsonl`, every N mutations or M seconds we compact to `relay.snapshot.json`. On load we replay snapshot then newer journal lines. Zero native deps; respects stripped-types runtime.

### Task D.1: Define the journal format

**Files:**
- Create: `apps/share-gateway/src/productization/relayStoreJournal.ts`
- Create: `apps/share-gateway/test/productization/relayStoreJournal.test.ts`

- [ ] **Step 1: Failing test**

`appendJournal(filePath, { op, args, at })` writes one well-formed JSON line per call; `replayJournal(filePath, snapshot)` mutates a deep-cloned snapshot in order; truncated last line is skipped with warning; journal lines after a snapshot epoch are ignored.

- [ ] **Step 2: RED → implement → GREEN**

- [ ] **Step 3: Commit**

```bash
git add apps/share-gateway/src/productization/relayStoreJournal.ts apps/share-gateway/test/productization/relayStoreJournal.test.ts
git commit -m "feat(relayStore): add jsonl journal format with replay"
```

### Task D.2: Swap persistence path in `RelayStore`

**Files:**
- Modify: `apps/share-gateway/src/productization/relayStore.ts`
- Modify: `apps/share-gateway/test/productization/relayStore.test.ts`

- [ ] **Step 1: Failing migration test**

Old single-file JSON dump still loads (back-compat); mutations emit journal lines to `${filePath}.journal.jsonl`; new `RelayStore` from same `filePath` reloads identical state; existing in-memory API doesn't change.

- [ ] **Step 2: RED**

- [ ] **Step 3: Implement**

`#save()` becomes "append journal line." `#maybeCompact()` runs every N=500 ops or T=30 s. `#load()` reads snapshot then replays journal lines whose epoch matches.

In-memory consumers (no `filePath`) get zero behavior change. Persisted consumers lazy-upgrade on first mutation.

- [ ] **Step 4: GREEN**

```bash
node scripts/test.mjs apps/share-gateway/test/productization/relayStore.test.ts
node scripts/test.mjs apps/share-gateway/test/productization
```

- [ ] **Step 5: Commit**

```bash
git add apps/share-gateway/src/productization/relayStore.ts apps/share-gateway/test/productization/relayStore.test.ts
git commit -m "feat(relayStore): swap full-rewrite save for journal + snapshot"
```

### Task D.3: Gateway-restart recovery test

**Files:**
- Create: `apps/share-gateway/test/productization/relayStoreRecovery.test.ts`

- [ ] **Step 1: Failing test**

Create share link, session, host command, runtime events. `tearDown()`. Construct fresh `RelayStore` from same `filePath`. Assert: everything reloads identically; `appendRuntimeEvent` on reloaded store appears in `listRuntimeEvents`.

- [ ] **Step 2: RED → fix → GREEN**

- [ ] **Step 3: Commit**

```bash
git add apps/share-gateway/test/productization/relayStoreRecovery.test.ts
git commit -m "test(relayStore): gateway restart recovers full state"
```

### Task D.4: Host reconnect recovers pending commands

**Files:**
- Modify: `apps/share-gateway/src/productization/relayStore.ts` (add `reclaimStaleHostCommands({ olderThanMs })`)
- Modify: `apps/share-gateway/test/productization/relayStoreRecovery.test.ts`

- [ ] **Step 1: Failing test**

`reclaimStaleHostCommands` flips `claimed` commands older than threshold back to `queued`; `completed`/`failed`/`cancelled` are untouched.

- [ ] **Step 2: RED → implement → GREEN**

- [ ] **Step 3: Commit**

```bash
git add apps/share-gateway/src/productization/relayStore.ts apps/share-gateway/test/productization/relayStoreRecovery.test.ts
git commit -m "feat(relayStore): reclaimStaleHostCommands recovers pending work on reconnect"
```

### Task D.5: Friendly stale-session response

**Files:**
- Modify: `apps/share-gateway/src/productization/relayStore.ts` (add `findStaleSession({ sessionId, taskId, staleAfterMs })` returning `{ kind: "fresh" | "resumable" | "stale", session, task }`)
- Modify: `apps/share-gateway/src/productization/httpServer.ts` (inside existing assistant-ui block; on `stale` set `currentThreadId="assistant-ui-preview"` and inject banner event)
- Modify: `apps/share-gateway/test/productization/httpServer.test.ts`

> Conflict note: this only modifies the existing `assistant-ui` block; A only adds a new `/v2` route — no line collision.

- [ ] **Step 1: Failing contract test**

GET `/app/share/local-friend/assistant-ui?sessionId=expired&taskId=expired` renders shell with banner event "当前会话已失效" and `data-current-thread-id="assistant-ui-preview"`.

- [ ] **Step 2: RED → implement → GREEN**

- [ ] **Step 3: Commit**

```bash
git add apps/share-gateway/src/productization apps/share-gateway/test/productization/httpServer.test.ts
git commit -m "feat(relay): friendly stale session recovery for assistant-ui URL"
```

### Task D.6: Cancelled cannot be overwritten

**Files:**
- Modify: `apps/share-gateway/src/productization/relayStore.ts` (`updateTask` rejects transitions out of `cancelled`/`completed`/`failed`)
- Modify: `apps/share-gateway/src/productization/hostClient.ts` (defensive guard so late `task.completed` arriving after `executeHostCommand` returned is dropped)
- Modify: `apps/share-gateway/test/productization/relayStore.test.ts`

> Conflict note with C: after C merges, this adds ~5 lines inside `executeHostCommand` to early-return if the slot is gone. Rebase trivially.

- [ ] **Step 1: Failing test**

`updateTask({ taskId, status: "cancelled" })` then `updateTask({ taskId, status: "completed" })` returns unchanged cancelled record + audit-log warning.

- [ ] **Step 2: RED → implement → GREEN**

- [ ] **Step 3: Commit**

```bash
git add apps/share-gateway/src/productization/relayStore.ts apps/share-gateway/src/productization/hostClient.ts apps/share-gateway/test/productization/relayStore.test.ts
git commit -m "feat(relay): forbid terminal task state overwrite"
```

### Workstream D verification block

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

### Workstream D — Definition of Done

- [ ] `relayStoreJournal.ts` handles append, replay, truncated-line skip, snapshot compaction.
- [ ] Fresh `RelayStore` from same `filePath` reloads share links, sessions, tasks, runtime events, host commands, approvals identically.
- [ ] `reclaimStaleHostCommands` covered by test.
- [ ] `updateTask` rejects transitions out of terminal states.
- [ ] Existing in-memory consumers see zero behavior change.

---

## Workstream G — Gap Closure

> Goal: close gaps from `validation/2026-05-22-ralphloop-user-flow-test-cases.zh.md:1738-1748` — cross-browser, owner screenshot archive, pixel-level golden diff. Reject `@playwright/test`; extend CDP harness.

### Task G.1: Cross-browser strategy

**Files:**
- Create: `apps/share-web/e2e/cross-browser-smoke.test.ts`

- [ ] **Step 1: Decision header**

Document: rejected `@playwright/test` (300 MB binaries + parallel runner conflict with `node:test`). Strategy: headless Firefox via existing CDP-style harness if `firefox` on PATH; else additional Chromium viewports (375×667 mobile-portrait, 1440×900 desktop-wide).

- [ ] **Step 2: Failing smoke test**

Detect Firefox via `which firefox`; if found run assistant-ui smoke in Firefox; else run same assertions in Chromium across the two extra viewports. Either path: shell loads, composer submits message, Agent bubble appears.

- [ ] **Step 3: RED → implement → GREEN**

- [ ] **Step 4: Commit**

```bash
git add apps/share-web/e2e/cross-browser-smoke.test.ts
git commit -m "test(e2e): cross-browser smoke with firefox-or-extra-viewport fallback"
```

### Task G.2: Owner screenshot archive

**Files:**
- Create: `apps/share-web/e2e/owner-screenshot-archive.test.ts`
- Modify: `apps/share-web/e2e/browserHarness.ts` (add `archiveScreenshot({ page, name, archiveDir })` helper)

- [ ] **Step 1: Failing test**

Boot gateway, navigate to owner page on three viewports plus active/empty states. Each screenshot archived to `.gstack/qa-reports/browser-screenshots/owner/<viewport>-<state>.png`. Assert file size > 4 KB.

- [ ] **Step 2: RED → implement → GREEN**

- [ ] **Step 3: Confirm `.gitignore`**

`.gstack/qa-reports/` already ignored.

- [ ] **Step 4: Commit**

```bash
git add apps/share-web/e2e/owner-screenshot-archive.test.ts apps/share-web/e2e/browserHarness.ts
git commit -m "test(e2e): archive owner screenshots across viewports"
```

### Task G.3: Pixel-baseline diff harness

**Files:**
- Create: `apps/share-web/e2e/pixelBaseline.ts`
- Create: `apps/share-web/e2e/baselines/.gitkeep`, initial baselines
- Create: `apps/share-web/e2e/pixel-baseline.test.ts`
- Modify: `package.json` (devDeps `pngjs`, `pixelmatch`; script `test:e2e:pixel`)

- [ ] **Step 1: Failing test**

Capture screenshots of three canonical assistant-ui states (empty thread, after one message, after task completion). Compare against committed baseline PNGs. Fails when no baseline OR diff > 2% pixels.

- [ ] **Step 2: RED → implement → GREEN**

```bash
npm install --save-dev pngjs pixelmatch
node scripts/test.mjs apps/share-web/e2e/pixel-baseline.test.ts
```

Generate baselines in `UPDATE_BASELINES=1` mode, review, commit.

- [ ] **Step 3: Commit**

```bash
git add apps/share-web/e2e/pixelBaseline.ts apps/share-web/e2e/pixel-baseline.test.ts apps/share-web/e2e/baselines package.json package-lock.json
git commit -m "test(e2e): pixel baseline diff harness with 2% threshold"
```

### Task G.4: Wire into `npm run test:e2e`

```bash
npm run test:e2e
```

All new tests run and pass.

### Workstream G verification block

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

### Workstream G — Definition of Done

- [ ] `cross-browser-smoke.test.ts` runs Firefox-or-extra-viewports, decision documented in header.
- [ ] Owner screenshots archive to `.gstack/qa-reports/browser-screenshots/owner/` across mobile/tablet/desktop.
- [ ] `pixel-baseline.test.ts` fails on >2% diff against committed baselines, passes on unchanged.
- [ ] `npm run test:e2e` discovers and passes all three new files.

---

## Cross-workstream final verification

```bash
npm install
npm run build:web-react
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

Expected: all exit 0; assistant-ui / classic / v2 routes all return 200; cancelled task immutable; React app at `/v2` hydrates and exchanges a message with an Agent bubble in real Chrome.
