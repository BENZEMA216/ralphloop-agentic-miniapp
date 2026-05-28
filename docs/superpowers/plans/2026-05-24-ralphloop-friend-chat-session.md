# Ralphloop Friend Chat Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Friend page control-console layout with a multi-session Chatbot experience: session sidebar, chat thread, docked composer, inline confirmations, and right-side preview drawer.

**Architecture:** Keep the current server-rendered HTML + vanilla JS path for this MVP, but change the Friend page component boundaries to match assistant-ui concepts. Use backend sessions as the real execution boundary, and use `localStorage` only as the friend browser's local session index and message cache for share-token-scoped session switching. Preserve existing Friend APIs and avoid adding backend endpoints unless tests prove local session indexing is insufficient.

**Tech Stack:** Node.js, TypeScript stripped runtime, `node:test`, server-rendered HTML/CSS, vanilla JS, existing Ralphloop productization APIs.

---

## Scope And File Map

- Modify `apps/share-gateway/src/productization/httpServer.ts`
  - Replace `renderFriendPage` markup from agent-console layout to Chatbot layout.
  - Add vanilla JS session store, session switching, message rendering, preview drawer, and inline confirmation card behavior.
  - Add CSS for session sidebar, chat thread, composer dock, preview drawer, and mobile sheet behavior.
- Modify `apps/share-gateway/test/productization/httpServer.test.ts`
  - Update Friend HTML contract assertions.
  - Extend fake DOM utilities for `localStorage`, attributes, classList mutations, and chat-specific interactions.
  - Add script-level tests for auto session creation, new session, session switching, multi-round messages, preview drawer, and no leakage.
- Modify `apps/share-web/src/pages/share/[token].ts`
  - Update the product model from `consoleLabel` / `taskComposer` / `previewPanel` to `experienceLabel` / `sessionSidebar` / `chatThread` / `chatComposer` / `previewDrawer`.
- Modify or add focused share-web component model files as needed:
  - Prefer small model additions in `apps/share-web/src/components/` only if they simplify tests.
  - Avoid introducing React or dependencies in this stage.
- Modify `apps/share-web/test/share-page.test.ts`
  - Update expectations from control-console model to multi-session Chatbot model.
- Modify `docs/superpowers/validation/2026-05-22-ralphloop-user-flow-test-cases.zh.md`
  - Mark implemented coverage and browser QA evidence after implementation.
- Add `.gstack/qa-reports/qa-report-ralphloop-friend-chat-session-2026-05-24.md`
  - Local QA artifact only; it remains excluded from git via `.git/info/exclude`.

## Task 1: Product Model TDD For Chatbot Shape

**Files:**
- Modify: `apps/share-web/test/share-page.test.ts`
- Modify: `apps/share-web/src/pages/share/[token].ts`
- Optional Modify/Create: `apps/share-web/src/components/*.ts`

- [x] **Step 1: Write the failing product model tests**

Replace the old console test with Chatbot expectations:

```ts
test("friend page is a multi-session chatbot", () => {
  const page = createSharePageModel({
    token: "local-friend",
    agent: { name: "Friend Agent", adapterId: "opencode", previewMode: "read_only" },
  });

  assert.equal(page.experienceLabel, "Agent Chat");
  assert.equal(page.sessionSidebar.visible, true);
  assert.equal(page.sessionSidebar.newSessionLabel, "新会话");
  assert.equal(page.chatThread.visible, true);
  assert.equal(page.chatComposer.placeholder, "给 Agent 发送消息");
  assert.equal(page.previewDrawer.available, true);
  assert.equal(page.previewDrawer.open, false);
  assert.equal(page.directFrameworkUiExposed, false);
});
```

- [x] **Step 2: Run the test and verify RED**

Run:

```bash
node scripts/test.mjs apps/share-web/test/share-page.test.ts
```

Expected: FAIL because `experienceLabel`, `sessionSidebar`, `chatThread`, `chatComposer`, and `previewDrawer` do not exist yet.

- [x] **Step 3: Implement the minimal product model**

Update `createSharePageModel` to return Chatbot-shaped fields. Keep old implementation only if existing tests still need it; otherwise remove console-specific labels from the model.

- [x] **Step 4: Run product model tests and verify GREEN**

Run:

```bash
node scripts/test.mjs apps/share-web/test/share-page.test.ts
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/share-web/test/share-page.test.ts apps/share-web/src/pages/share/[token].ts apps/share-web/src/components
git commit -m "test: define friend chatbot product model"
```

## Task 2: Friend Page HTML Contract TDD

**Files:**
- Modify: `apps/share-gateway/test/productization/httpServer.test.ts`
- Modify: `apps/share-gateway/src/productization/httpServer.ts`

- [x] **Step 1: Write failing HTML contract assertions**

Update the Friend page contract to expect:

```ts
assert.match(friendHtml, /data-testid="friend-chat-shell"/);
assert.match(friendHtml, /data-testid="friend-session-sidebar"/);
assert.match(friendHtml, /data-testid="friend-new-session"/);
assert.match(friendHtml, /data-testid="friend-chat-thread"/);
assert.match(friendHtml, /data-testid="friend-chat-composer"/);
assert.match(friendHtml, /data-testid="friend-chat-submit"/);
assert.match(friendHtml, /data-testid="friend-preview-toggle"/);
assert.match(friendHtml, /data-testid="friend-preview-drawer"/);
assert.match(friendHtml, /data-testid="friend-preview-close"/);
assert.match(friendHtml, /sessionStore/);
assert.match(friendHtml, /activeSessionId/);
```

Keep leakage assertions:

```ts
assert.equal(/cost|budget|tokenHash|deviceKey|bootstrap|模型价格/.test(friendHtml), false);
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
node scripts/test.mjs apps/share-gateway/test/productization/httpServer.test.ts
```

Expected: FAIL on missing `friend-chat-*` selectors.

- [x] **Step 3: Implement minimal Chatbot markup**

Replace `renderFriendPage` markup with:

- `<main data-testid="friend-chat-shell">`
- left session sidebar with `#session-list` and `#new-session`
- central chat area with `#chat-thread`, `#chat-form`, `#chat-prompt`, `#chat-status`
- preview button `#preview-toggle`
- drawer `#preview-drawer`, close button `#preview-close`, and `#preview-frame`

- [x] **Step 4: Run focused test and verify GREEN**

Run:

```bash
node scripts/test.mjs apps/share-gateway/test/productization/httpServer.test.ts
```

Expected: PASS or fail only on script-level tests that still reference old DOM ids; fix in Task 3.

- [x] **Step 5: Commit**

```bash
git add apps/share-gateway/src/productization/httpServer.ts apps/share-gateway/test/productization/httpServer.test.ts
git commit -m "feat: render friend chatbot shell"
```

## Task 3: Session Store And Script-Level UI TDD

**Files:**
- Modify: `apps/share-gateway/test/productization/httpServer.test.ts`
- Modify: `apps/share-gateway/src/productization/httpServer.ts`

- [x] **Step 1: Extend the fake DOM harness**

Add or update:

- `FakeLocalStorage`
- `FakeClassList.add/remove/toggle`
- `FakeElement.getAttribute`
- chat-specific document ids: `chat-form`, `chat-prompt`, `chat-thread`, `chat-status`, `session-list`, `new-session`, `preview-toggle`, `preview-drawer`, `preview-close`, `preview-frame`
- helper `submitFriendChatMessage(document, prompt)`
- helper `clickFriendNewSession(document)`
- helper `clickFriendSession(document, sessionId)`
- helper `clickFriendPreviewToggle(document)`

- [x] **Step 2: Write failing script-level session test**

Add:

```ts
test("productized friend chatbot creates and switches sessions without mixing messages", async () => {
  // page load auto-creates Session 1
  // submit task in Session 1
  // click new session
  // submit task in Session 2
  // click Session 1
  // assert Session 1 message visible and Session 2 message hidden
});
```

- [x] **Step 3: Run focused test and verify RED**

Run:

```bash
node scripts/test.mjs apps/share-gateway/test/productization/httpServer.test.ts
```

Expected: FAIL because the Friend page does not yet maintain multi-session UI state.

- [x] **Step 4: Implement `sessionStore` in the Friend page script**

Implementation rules:

- `sessionStore` reads/writes `localStorage` key scoped by share token.
- First page load creates a backend session if no local session exists.
- `newSession()` calls `POST /v1/share/:token/sessions`.
- `switchSession(sessionId)` changes `activeSessionId`, renders only that session's messages, and fetches session events.
- `submitChatMessage()` sends task to `activeSessionId`, appends user message, appends Agent/status events, and stores messages.
- Session list displays title, status, and recency.

- [x] **Step 5: Run focused test and verify GREEN**

Run:

```bash
node scripts/test.mjs apps/share-gateway/test/productization/httpServer.test.ts
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add apps/share-gateway/src/productization/httpServer.ts apps/share-gateway/test/productization/httpServer.test.ts
git commit -m "feat: add friend chat sessions"
```

## Task 4: Preview Drawer And Inline Confirmation TDD

**Files:**
- Modify: `apps/share-gateway/test/productization/httpServer.test.ts`
- Modify: `apps/share-gateway/src/productization/httpServer.ts`

- [x] **Step 1: Write failing preview drawer test**

Assert:

- drawer starts closed with `aria-hidden="true"`
- clicking preview opens it
- clicking close closes it
- thread message HTML remains intact

- [x] **Step 2: Write failing inline confirmation test**

Use existing approval helpers to create a friend confirmation, then run the Friend script and assert:

- `data-testid="friend-approval-card"` appears inside `#chat-thread`
- approve/deny buttons call existing confirmation endpoints

- [x] **Step 3: Run focused test and verify RED**

Run:

```bash
node scripts/test.mjs apps/share-gateway/test/productization/httpServer.test.ts
```

Expected: FAIL until drawer and inline confirmation rendering are implemented.

- [x] **Step 4: Implement drawer and confirmation rendering**

Implementation rules:

- Preview drawer toggles class `is-open` and `aria-hidden`.
- Mobile uses CSS media query to make drawer a full-screen sheet.
- `refreshConfirmations()` renders approval cards in the chat thread, not in a bottom queue.
- Approve/deny updates the card and refreshes confirmations.

- [x] **Step 5: Run focused test and verify GREEN**

Run:

```bash
node scripts/test.mjs apps/share-gateway/test/productization/httpServer.test.ts
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add apps/share-gateway/src/productization/httpServer.ts apps/share-gateway/test/productization/httpServer.test.ts
git commit -m "feat: add friend preview drawer"
```

## Task 5: Docs, Browser QA, And Full Verification

**Files:**
- Modify: `docs/superpowers/validation/2026-05-22-ralphloop-user-flow-test-cases.zh.md`
- Add: `.gstack/qa-reports/qa-report-ralphloop-friend-chat-session-2026-05-24.md`

- [x] **Step 1: Update validation docs**

Mark the new Chatbot coverage as implemented:

- HTML contract
- script-level session switching
- preview drawer
- inline confirmation card
- mobile browser QA

- [x] **Step 2: Run browser QA**

Start or reuse:

```bash
PORT=5181 npm run dev:productized:outbound
```

Browser QA must cover:

- open `/app/share/local-friend`
- verify `friend-chat-shell`
- submit first message
- create second session
- submit second message
- switch back to first session
- open/close preview drawer
- run mobile `375x812` overflow check
- check console errors

- [x] **Step 3: Write QA report**

Write `.gstack/qa-reports/qa-report-ralphloop-friend-chat-session-2026-05-24.md` with:

- implementation summary
- screenshots
- browser assertions
- test commands
- remaining risks

- [x] **Step 4: Run full verification**

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

Expected: all pass.

- [x] **Step 5: Commit**

```bash
git add apps/share-gateway/src/productization/httpServer.ts apps/share-gateway/test/productization/httpServer.test.ts apps/share-web docs/superpowers/validation
git commit -m "feat: ship friend multi-session chatbot"
```

## Completion Checklist

- [x] Friend page is a Chatbot, not a control console.
- [x] Friend can create and switch Sessions.
- [x] Same Session supports multi-round chat without overwriting previous messages.
- [x] Preview drawer defaults closed and opens from the right.
- [x] Confirmation requests render inline in the thread.
- [x] Friend page does not leak cost, token, device key, bootstrap secret, or internal policy fields.
- [x] Desktop and mobile browser QA pass.
- [x] Full verification passes.
