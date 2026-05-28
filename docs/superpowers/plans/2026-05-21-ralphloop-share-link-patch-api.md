# Ralphloop 分享链接 PATCH API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐产品化 spec 中 Owner 最小 API 的 `PATCH /owner/share-links/:id`，允许创建者更新自己链接的名称、有效期和策略字段。

**Architecture:** 在 `RelayStore` 增加局部更新 share link 的方法，route 层做 owner scope、终态保护和 adapter 支持校验，HTTP 层暴露 PATCH endpoint。返回 owner-only summary，不向朋友端泄露 token hash 或成本细节。

**Tech Stack:** TypeScript, Node HTTP server, `node:test`, Ralphloop productization route contracts.

---

## 文件结构

- 修改：`apps/share-gateway/src/productization/relayStore.ts`
  - 增加 `updateShareLink()`，支持 `name`、`expiresAt`、`policy` partial merge。
- 修改：`apps/share-gateway/src/productization/routes.ts`
  - 增加 `updateOwnerShareLinkV1()`。
  - 抽取 adapter 支持校验，复用 create/update。
- 修改：`apps/share-gateway/src/productization/httpServer.ts`
  - 增加 `PATCH /v1/owner/share-links/:id`。
- 修改：`apps/share-gateway/test/productization/controls.test.ts`
  - 测试 owner patch、wrong owner 拒绝、unsupported adapter 拒绝、revoked 不可更新。
- 修改：`apps/share-gateway/test/productization/httpServer.test.ts`
  - 测试 HTTP PATCH endpoint 和 Owner HTML 包含 PATCH contract。

## Task 1: Route Contract

**Files:**
- Modify: `apps/share-gateway/test/productization/controls.test.ts`
- Modify: `apps/share-gateway/src/productization/routes.ts`
- Modify: `apps/share-gateway/src/productization/relayStore.ts`

- [ ] **Step 1: Write failing route tests**

新增测试：
- owner 可以更新自己链接的 `name`、`policy.allowedAdapterIds`、`maxTotalBudget`。
- wrong owner 返回 `404 share_link_unavailable`。
- unsupported adapter 返回 `422 adapter_not_available`。
- revoked link 更新返回 `409 share_link_final`。

- [ ] **Step 2: Run route test to verify red**

Run: `npm test apps/share-gateway/test/productization/controls.test.ts`

Expected: FAIL because `updateOwnerShareLinkV1` is not exported.

- [ ] **Step 3: Implement store and route**

`RelayStore.updateShareLink` partial merge:

```ts
updateShareLink(input: {
  id: string;
  name?: string;
  expiresAt?: string;
  policy?: Partial<SharePolicyRecord>;
}): ShareLinkRecord | undefined
```

`updateOwnerShareLinkV1` rules:
- missing/wrong owner -> `404 { error: "share_link_unavailable" }`
- revoked/expired -> `409 { error: "share_link_final" }`
- unsupported/empty `allowedAdapterIds` -> `422 { error: "adapter_not_available" }`
- success -> `200 { shareLink: publicOwnerShareLink(updated) }`
- append `share_link.updated` audit log.

- [ ] **Step 4: Run route test to verify green**

Run: `npm test apps/share-gateway/test/productization/controls.test.ts`

Expected: PASS.

## Task 2: HTTP Contract

**Files:**
- Modify: `apps/share-gateway/test/productization/httpServer.test.ts`
- Modify: `apps/share-gateway/src/productization/httpServer.ts`

- [ ] **Step 1: Write failing HTTP tests**

新增测试：
- `PATCH /v1/owner/share-links/:id` updates name and policy.
- wrong owner returns 404.
- unsupported adapter returns 422.

- [ ] **Step 2: Run HTTP test to verify red**

Run: `npm test apps/share-gateway/test/productization/httpServer.test.ts`

Expected: FAIL because PATCH endpoint returns 404.

- [ ] **Step 3: Implement HTTP PATCH**

Read body `{ ownerId, name?, expiresAt?, policy? }`, call `updateOwnerShareLinkV1`, return JSON status/body.

- [ ] **Step 4: Run HTTP test to verify green**

Run: `npm test apps/share-gateway/test/productization/httpServer.test.ts`

Expected: PASS.

## Task 3: Full Verification And Commit

- [ ] **Step 1: Run full validation**

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

Expected: every command exits 0.

- [ ] **Step 2: Commit**

Run:

```bash
git add apps/share-gateway/src/productization/relayStore.ts \
  apps/share-gateway/src/productization/routes.ts \
  apps/share-gateway/src/productization/httpServer.ts \
  apps/share-gateway/test/productization/controls.test.ts \
  apps/share-gateway/test/productization/httpServer.test.ts \
  docs/superpowers/plans/2026-05-21-ralphloop-share-link-patch-api.md
git commit -m "Add Ralphloop share link patch API"
```

Expected: commit succeeds; `agora-demo/` remains untracked and unstaged.
