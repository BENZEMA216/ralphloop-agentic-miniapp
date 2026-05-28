# Ralphloop Friend Agent Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the friend share link from a raw task form into a productized Agent console aligned with assistant-ui and AG-UI concepts.

**Architecture:** Keep the current server-rendered HTML path for this phase, but rename and structure the friend page around Composer, Thread, Preview, and HITL panels. Preserve the existing relay APIs and add contract tests that make the productized structure and no-cost rule enforceable.

**Tech Stack:** Node HTTP server, TypeScript stripped at runtime, node:test, server-rendered HTML/CSS/vanilla JavaScript, future-compatible assistant-ui/AG-UI semantics.

---

### Task 1: Lock Friend Console Contract Tests

**Files:**
- Modify: `apps/share-gateway/test/productization/httpServer.test.ts`
- Modify: `apps/share-web/test/share-page.test.ts`

- [x] **Step 1: Write failing HTML contract assertions**

Add assertions that `/app/share/local-friend` includes:

```ts
assert.match(friendHtml, /agent-console-shell/);
assert.match(friendHtml, /agent-composer/);
assert.match(friendHtml, /agent-thread/);
assert.match(friendHtml, /agent-preview-panel/);
assert.match(friendHtml, /agent-confirmation-panel/);
assert.match(friendHtml, /给 Agent 一个任务/);
assert.match(friendHtml, /data-testid="friend-task-submit"/);
assert.match(friendHtml, /data-testid="friend-agent-thread"/);
assert.match(friendHtml, /data-testid="friend-preview-panel"/);
```

- [x] **Step 2: Run focused test and verify it fails**

Run:

```bash
node scripts/test.mjs apps/share-gateway/test/productization/httpServer.test.ts
```

Expected: fail because the current friend page uses `friend-shell`, `composer-grid`, and raw task form naming.

- [x] **Step 3: Add model-level expectations**

Extend share web model tests to assert friend console language and sections:

```ts
assert.equal(page.consoleLabel, "Agent 控制台");
assert.equal(page.taskComposer.title, "给 Agent 一个任务");
assert.equal(page.thread.visible, true);
```

- [x] **Step 4: Run model test and verify it fails**

Run:

```bash
node scripts/test.mjs apps/share-web/test/share-page.test.ts
```

Expected: fail because the model does not expose console labels yet.

### Task 2: Productize Friend Page Model

**Files:**
- Modify: `apps/share-web/src/components/TaskComposer.ts`
- Modify: `apps/share-web/src/pages/share/[token].ts`

- [x] **Step 1: Implement minimal model fields**

Add stable fields used by tests:

```ts
title: "给 Agent 一个任务";
consoleLabel: "Agent 控制台";
thread: { visible: true };
```

- [x] **Step 2: Run model tests**

Run:

```bash
node scripts/test.mjs apps/share-web/test/share-page.test.ts
```

Expected: pass.

### Task 3: Redesign Server-Rendered Friend Console

**Files:**
- Modify: `apps/share-gateway/src/productization/httpServer.ts`
- Test: `apps/share-gateway/test/productization/httpServer.test.ts`

- [x] **Step 1: Replace friend page shell**

Update `renderFriendPage` to render:

- `agent-console-shell`
- `agent-console-topbar`
- `agent-composer`
- `agent-thread`
- `agent-preview-panel`
- `agent-confirmation-panel`

- [x] **Step 2: Keep existing APIs and JavaScript behavior**

Preserve:

- session creation
- task submission
- event refresh
- preview refresh
- friend confirmations

- [x] **Step 3: Improve event rendering**

Render empty state, user task, Agent output, completed, failed and system events as visible timeline rows.

- [x] **Step 4: Add responsive CSS**

Add CSS for desktop two-column layout and mobile single-column layout without text overlap.

- [x] **Step 5: Run focused HTTP test**

Run:

```bash
node scripts/test.mjs apps/share-gateway/test/productization/httpServer.test.ts
```

Expected: pass.

### Task 4: Browser Dogfood

**Files:**
- Runtime only.

- [x] **Step 1: Restart productized outbound dev server**

Run:

```bash
npm run dev:productized:outbound
```

- [x] **Step 2: Verify owner share link exists**

Use fetch or browser to create/open:

```text
http://127.0.0.1:5181/app/share/local-friend
```

- [x] **Step 3: Submit a real task from browser**

Use browser automation to fill the friend task input and click submit.

Expected:

- Submit button remains usable.
- Status becomes running or completed.
- Thread contains Agent output.
- Page does not show cost/budget language.

### Task 5: Full Verification and Commit

**Files:**
- All modified files.

- [x] **Step 1: Run focused tests**

```bash
node scripts/test.mjs apps/share-web/test/share-page.test.ts
node scripts/test.mjs apps/share-gateway/test/productization/httpServer.test.ts
```

- [x] **Step 2: Run full validation**

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

- [x] **Step 3: Commit relevant files only**

Do not add unrelated `agora-demo/`.

```bash
git add docs/superpowers/specs/2026-05-22-ralphloop-friend-agent-console-spec.zh.md \
  docs/superpowers/plans/2026-05-22-ralphloop-friend-agent-console.md \
  apps/share-web/src/components/TaskComposer.ts \
  apps/share-web/src/pages/share/[token].ts \
  apps/share-web/test/share-page.test.ts \
  apps/share-gateway/src/productization/httpServer.ts \
  apps/share-gateway/test/productization/httpServer.test.ts
git commit -m "Productize Ralphloop friend agent console"
```
