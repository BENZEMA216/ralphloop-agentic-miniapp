# Ralphloop Local Agent QA Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用本地 Agent 运行时完成 Ralphloop 创建者侧和朋友侧的严谨 QA，并把朋友侧多轮体验与创建者已有链接管理补到可验收状态。

**Architecture:** 先把当前缺口转成可重复测试，再按 TDD 修复 UI 和运行时行为。朋友侧以同一 share link 的多轮 Agent thread 为主线；创建者侧以已有链接列表、暂停、启用、撤销和状态反馈为主线；本地 Agent dogfood 使用 `npm run dev:productized:outbound` 和当前机器上的 adapter 检测结果。

**Tech Stack:** Node.js, TypeScript stripped runtime, node:test, server-rendered HTML/CSS/vanilla JS, Chrome/AppleScript browser dogfood, existing Ralphloop outbound host.

---

## 当前事实

- 当前目录：`/Users/benzema/Documents/使用`
- 无关未跟踪目录：`agora-demo/`，本计划不读取、不修改、不提交。
- 核心验证文档：`docs/superpowers/validation/2026-05-22-ralphloop-user-flow-test-cases.zh.md`
- 朋友侧已知缺口：API 有 explicit session 复用测试，但浏览器主流程还不是严格多轮 thread；当前页面任务终态后会清空 `currentSessionId`，事件流也偏当前任务。
- 创建者侧已知缺口：后端和 HTML 合约覆盖已有链接列表、暂停、启用、撤销，但缺少浏览器级 Owner 管理 dogfood。

## 完成标准

- 朋友侧同一页面连续提交至少两轮任务，第二轮完成后第一轮输出仍可见。
- 朋友侧多轮过程不展示 `cost`、`budget`、`tokenHash`、`模型价格`。
- 创建者侧可查看已有链接列表，并通过浏览器验证 active -> paused -> active -> revoked 状态链路。
- 本地 outbound Host 在 dogfood 期间保持在线。
- 所有新增问题都有自动化测试或明确记录为当前不可自动化的浏览器验证。
- 回归命令全部通过。

## Task 1: 补朋友侧多轮主流程测试

**Files:**
- Modify: `apps/share-gateway/test/productization/httpServer.test.ts`
- Optional Modify: `apps/share-web/e2e/share-flow.test.ts`

- [x] **Step 1: 写失败测试**

增加一个朋友页 HTML/JS 合约测试，要求页面包含多轮 thread 所需语义：

```ts
assert.match(friendHtml, /conversationEvents/);
assert.match(friendHtml, /appendConversationEvents/);
assert.match(friendHtml, /data-task-id/);
```

如果直接做端到端模型测试，则新增测试描述：

```ts
test("friend page keeps prior round output when a second task finishes", ...)
```

- [x] **Step 2: 运行失败测试**

```bash
node scripts/test.mjs apps/share-gateway/test/productization/httpServer.test.ts
```

Expected: FAIL，证明当前页面没有多轮 thread 语义。

## Task 2: 修复朋友侧多轮 thread 体验

**Files:**
- Modify: `apps/share-gateway/src/productization/httpServer.ts`
- Modify tests from Task 1

- [x] **Step 1: 保留会话语境**

不要在每轮任务终态后立即清空 `currentSessionId`。保留 session，直到链接失效、页面刷新或明确需要新 session。

- [x] **Step 2: 引入页面内 conversation event buffer**

维护 `conversationEvents`，每轮提交任务时追加用户任务行；每次收到 runtime events 时按 `taskId` 去重并追加，不覆盖前一轮输出。

- [x] **Step 3: 事件流显示轮次**

每条 `.thread-event` 至少包含事件 label、正文和 `data-task-id`。第二轮完成后第一轮事件仍在 DOM 中。

- [x] **Step 4: 运行 focused tests**

```bash
node scripts/test.mjs apps/share-gateway/test/productization/httpServer.test.ts
node scripts/test.mjs apps/share-web/test/share-page.test.ts
```

Expected: PASS。

## Task 3: 补创建者已有链接管理 QA

**Files:**
- Modify: `apps/share-gateway/test/productization/httpServer.test.ts`
- Optional Create: `docs/superpowers/validation/2026-05-23-ralphloop-owner-link-management-dogfood.zh.md`

- [x] **Step 1: 加强 HTML 合约**

确认 Owner 页面包含：

```ts
assert.match(ownerHtml, /share-link-list/);
assert.match(ownerHtml, /pause-share-link/);
assert.match(ownerHtml, /resume-share-link/);
assert.match(ownerHtml, /refreshShareLinks/);
```

- [x] **Step 2: 浏览器 dogfood Owner 链路**

用本地 `npm run dev:productized:outbound` 打开 Owner 页面，验证：

- Host 在线。
- 列表能看到已有 active 链接。
- 暂停后朋友链接不可用。
- 启用后朋友链接可用。
- 撤销后不可恢复。

- [x] **Step 3: 记录结果**

如果浏览器 dogfood 暂时无法完全自动化，写入验证文档并标注剩余缺口。

## Task 4: 本地 Agent 真实运行测试

**Files:**
- Existing tests only unless failures require fixes.

- [x] **Step 1: 检测本地 adapter**

```bash
npm run test:smoke:real-adapter
```

- [x] **Step 2: 启动 outbound Host**

```bash
npm run dev:productized:outbound
```

- [x] **Step 3: 朋友侧多轮浏览器 dogfood**

在 `http://127.0.0.1:5181/app/share/local-friend` 连续提交两轮任务，断言：

- 第一轮和第二轮输出都留在 thread。
- 状态最终为 `已完成` 或明确失败状态。
- 页面无成本字段。

- [x] **Step 4: 创建者侧浏览器 dogfood**

在 `http://127.0.0.1:5181/app/owner` 验证已有链接列表和管理动作。

## Task 5: 全量回归

**Files:**
- All modified files.

- [x] **Step 1: 运行 focused tests**

```bash
node scripts/test.mjs apps/share-gateway/test/productization/httpServer.test.ts
node scripts/test.mjs apps/share-web/test/share-page.test.ts
```

- [x] **Step 2: 运行全量验证**

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

- [x] **Step 3: 更新验证文档**

把本轮已补齐和仍缺失的用例写回：

`docs/superpowers/validation/2026-05-22-ralphloop-user-flow-test-cases.zh.md`

- [x] **Step 4: 提交**

只提交相关文件，不提交 `agora-demo/`。

```bash
git add <relevant files>
git commit -m "Harden Ralphloop local agent QA flows"
```

## Task 6: 固化关键 UI 脚本级回归

**Files:**
- Modify: `apps/share-gateway/test/productization/httpServer.test.ts`
- Modify: `apps/share-gateway/src/productization/httpServer.ts`
- Modify: `docs/superpowers/validation/2026-05-22-ralphloop-user-flow-test-cases.zh.md`

- [x] **Step 1: 为 Friend 页面内联 JS 增加 harness**

直接执行 `/app/share/:token` 的页面脚本，模拟朋友提交两轮任务，断言：

- 第一轮输出在第二轮完成后仍可见。
- 第二轮输出追加到同一个 thread。
- 成功提交后 composer 输入框清空。
- 页面输出不包含 `cost`、`budget`、`tokenHash`、`模型价格`。

- [x] **Step 2: 为 Owner 页面内联 JS 增加 harness**

直接执行 `/app/owner` 的页面脚本，模拟已有链接列表上的暂停、启用和撤销，断言：

- active -> paused -> active -> revoked 状态链路真实命中 HTTP API。
- paused 链接让 Friend 页面返回中性不可用。
- revoked 链接不可恢复，并且 Friend 页面返回不可用。

- [x] **Step 3: 用 TDD 修复发现的 Friend 输入框问题**

先运行失败测试确认成功提交后输入框没有清空，再在 Friend 页面脚本中只对成功提交执行 `taskPrompt.value = ""`。

- [x] **Step 4: 更新验证文档**

把“朋友侧多轮 UI”和“创建者已有链接管理”从纯手工 dogfood 更新为脚本级 UI 自动化已覆盖，剩余缺口限定为真实浏览器截图、布局和跨浏览器验证。

## 自动化运行规则

- 每 20 分钟唤醒一次当前线程。
- 每次唤醒先读本计划和验证文档。
- 用 `git status --short` 确认未提交状态。
- 从第一个未完成 checklist 开始执行。
- 每完成一个步骤更新本计划 checkbox，并在对话 plan 中同步状态。
- 如果测试失败，先定位根因，写失败测试，再修复。
- 如果所有完成标准达成，暂停或删除自动化，避免继续产生重复 session。
