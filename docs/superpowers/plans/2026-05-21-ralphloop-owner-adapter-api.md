# Ralphloop Owner Adapter API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐产品化 Owner API 的 adapter inventory，使创建者能通过 `/v1/owner/adapters` 获取 Codex、Claude Code、OpenCode、Hermes、Agent Zero 等目标框架清单。

**Architecture:** 复用现有 `AdapterRegistry.detectAll()` 作为全局目标 adapter 清单，同时结合 owner 名下在线 Host 的 `supportedAdapters` 标记哪些 adapter 已经在该 owner 的 Host 上可用。HTTP Server 暴露 owner-scoped endpoint，响应不包含 token、成本、预算或其他 owner-only 敏感字段。

**Tech Stack:** TypeScript, Node HTTP server, `node:test`, Ralphloop productization routes.

---

## 文件结构

- Modify: `apps/share-gateway/src/productization/routes.ts`
  - 新增 `listOwnerAdaptersV1` route helper。
  - 返回目标 adapter 清单与当前 owner 的 `connectedHostIds`。
- Modify: `apps/share-gateway/src/productization/httpServer.ts`
  - 增加 `adapterInventory` server option。
  - 暴露 `GET /v1/owner/adapters?ownerId=...`。
- Modify: `apps/share-gateway/test/productization/httpServer.test.ts`
  - 增加 HTTP 合同测试，覆盖目标框架清单、owner host 作用域和敏感字段过滤。
- Modify: `apps/share-gateway/test/productization/routes.test.ts`
  - 增加 route 层合同测试，确保 `test:contract` 覆盖 adapter inventory 合并逻辑。

## Task 1: HTTP adapter inventory contract

- [x] **Step 1: Write failing HTTP test**

在 `apps/share-gateway/test/productization/httpServer.test.ts` 增加测试：

```ts
test("productized HTTP owner adapters expose target framework inventory scoped to owner hosts", async () => {
  const server = createProductizedShareServer({
    adapterInventory: {
      async detectAll() {
        return [
          adapterInfo("opencode", "OpenCode", "available"),
          adapterInfo("codex", "Codex", "not_installed"),
          adapterInfo("claude-code", "Claude Code", "not_installed"),
          adapterInfo("hermes", "Hermes Agent", "not_installed"),
          adapterInfo("agent-zero", "Agent Zero", "not_installed"),
        ];
      },
    },
  });

  // Register owner-1 host with opencode + codex and owner-2 host with claude-code.
  // GET /v1/owner/adapters?ownerId=owner-1
  // Assert five target adapter ids are returned.
  // Assert opencode and codex have connectedHostIds ["host-1"].
  // Assert claude-code does not leak host-2.
  // Assert no cost/budget/tokenHash fields.
});
```

- [x] **Step 2: Run test to verify failure**

Run:

```bash
npm test apps/share-gateway/test/productization/httpServer.test.ts
```

Expected: FAIL with 404 because `/v1/owner/adapters` is not wired yet.

- [x] **Step 3: Implement productized route helper**

Add `listOwnerAdaptersV1` in `apps/share-gateway/src/productization/routes.ts`:

- Calls `adapterInventory.detectAll()`.
- Finds hosts where `host.ownerId === ownerId && host.status === "online"`.
- Adds `connectedHostIds` per adapter.
- If a Host supports an adapter, returned status is `available`.
- If a Host reports a custom adapter missing from inventory, synthesize a conservative adapter record.

- [x] **Step 4: Implement HTTP endpoint**

In `apps/share-gateway/src/productization/httpServer.ts`:

- Add `adapterInventory?: { detectAll(): Promise<AgentAdapterInfo[]> }` to server options.
- Default to `new AdapterRegistry()`.
- Add `GET /v1/owner/adapters?ownerId=...`.

- [x] **Step 5: Run focused test**

Run:

```bash
npm test apps/share-gateway/test/productization/httpServer.test.ts
```

Expected: PASS.

- [x] **Step 6: Add route-layer contract coverage**

在 `apps/share-gateway/test/productization/routes.test.ts` 增加 `listOwnerAdaptersV1` 合同测试，覆盖目标 adapter 清单与 owner host 作用域。

## 验收标准

1. `GET /v1/owner/adapters?ownerId=owner-1` 返回目标 adapter 清单。
2. 响应包含 Codex、Claude Code、OpenCode、Hermes、Agent Zero 等目标框架。
3. owner 名下在线 Host 支持的 adapter 标记为 `available`，并返回该 owner 的 `connectedHostIds`。
4. 不泄露其他 owner 的 Host ID。
5. 不返回 token hash、成本、预算或模型密钥信息。
6. 聚焦测试、全量测试、类型检查、构建、合同测试、集成测试、安全测试、E2E、真实适配器 smoke 和 diff 空白检查均通过。
