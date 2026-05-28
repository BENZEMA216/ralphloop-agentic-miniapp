# Ralphloop 创建者会话控制台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Owner Console 显示创建者当前和历史会话，并能从页面一键终止非终态会话。

**Architecture:** 复用已有 owner-scoped `GET /v1/owner/sessions` 与 `POST /v1/owner/sessions/:id/cancel` HTTP contract，不新增存储模型。Owner Console 增加会话列表 section、刷新按钮、按状态渲染 cancel action，并在终止后刷新会话、任务历史和审计日志。

**Tech Stack:** TypeScript, Node HTTP server, `node:test`, Ralphloop productization Owner Console.

---

## 文件结构

- 修改：`apps/share-gateway/test/productization/httpServer.test.ts`
  - 增加 Owner HTML hook 断言，确保会话控制台不是只存在后端 API。
- 修改：`apps/share-gateway/src/productization/httpServer.ts`
  - 增加 `session-list` section。
  - 增加 `refreshSessions()` 和 `cancelOwnerSession()` 前端函数。
  - 增加 `cancel-owner-session` 按钮和 delegated click handler。

## Task 1: Owner Console Session Hooks

**Files:**
- Modify: `apps/share-gateway/test/productization/httpServer.test.ts`
- Modify: `apps/share-gateway/src/productization/httpServer.ts`

- [ ] **Step 1: Write failing HTML hook assertions**

在 `productized web pages expose owner and friend flows without friend cost fields` 中断言：

```ts
assert.match(ownerHtml, /session-list/);
assert.match(ownerHtml, /refresh-sessions/);
assert.match(ownerHtml, /cancel-owner-session/);
assert.match(ownerHtml, /\/v1\/owner\/sessions/);
assert.match(ownerHtml, /\/cancel/);
```

- [ ] **Step 2: Run test to verify red**

Run: `npm test apps/share-gateway/test/productization/httpServer.test.ts`

Expected: FAIL because Owner HTML does not expose session list controls.

- [ ] **Step 3: Implement Owner Console session section**

Add a section:

```html
<section class="surface history-surface" aria-label="当前会话">
  <div class="section-heading">
    <h2>当前会话</h2>
    <button id="refresh-sessions" class="secondary-button" type="button">刷新</button>
  </div>
  <ol id="session-list" class="owner-list"></ol>
</section>
```

Add DOM refs:

```js
const sessionList = document.getElementById("session-list");
const refreshSessionsButton = document.getElementById("refresh-sessions");
```

Add refresh and cancel functions:

```js
const terminalSessionStatuses = new Set(["completed", "failed", "cancelled"]);

async function refreshSessions() {
  const response = await fetch("/v1/owner/sessions?ownerId=" + encodeURIComponent(ownerId));
  const body = await response.json();
  sessionList.innerHTML = (body.sessions ?? []).map((session) => {
    const action = terminalSessionStatuses.has(session.status)
      ? '<span class="muted-label">已结束</span>'
      : '<button class="cancel-owner-session danger-button" data-session-id="' + escapeText(session.id) + '" type="button">终止</button>';
    return '<li><strong>' + escapeText(session.status) + '</strong><span>' + escapeText(session.adapterId) + ' · ' + escapeText(session.friendActorId) + '</span><div class="approval-actions">' + action + '</div></li>';
  }).join("");
}

async function cancelOwnerSession(sessionId) {
  await fetch("/v1/owner/sessions/" + encodeURIComponent(sessionId) + "/cancel", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ownerId }),
  });
  await refreshSessions();
  await refreshTaskHistory();
  await refreshAuditLog();
}
```

Add listeners:

```js
refreshSessionsButton?.addEventListener("click", () => {
  void refreshSessions();
});

sessionList?.addEventListener("click", (event) => {
  const target = event.target;
  if (target?.classList?.contains("cancel-owner-session")) {
    void cancelOwnerSession(target.dataset.sessionId);
  }
});
```

Call `refreshSessions()` on load.

- [ ] **Step 4: Run test to verify green**

Run: `npm test apps/share-gateway/test/productization/httpServer.test.ts`

Expected: PASS.

## Task 2: Browser Smoke And Verification

**Files:**
- No source changes expected after this task unless verification finds defects.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test apps/share-gateway/test/productization/httpServer.test.ts
```

Expected: PASS.

- [ ] **Step 2: Browser smoke**

Run `PORT=5180 npm run dev:productized`, open Owner Console, verify the session section exists, create a share link, submit a friend task through HTTP or Friend Web, refresh sessions, and verify the session appears without friend cost fields.

- [ ] **Step 3: Full validation**

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

Expected: every command exits 0, with no failing test counts.

- [ ] **Step 4: Commit**

Run:

```bash
git add apps/share-gateway/src/productization/httpServer.ts \
  apps/share-gateway/test/productization/httpServer.test.ts \
  docs/superpowers/plans/2026-05-21-ralphloop-owner-session-console.md
git commit -m "Add Ralphloop owner session console"
```

Expected: commit succeeds; `agora-demo/` remains untracked and unstaged.
