# Ralphloop Outbound Host Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打通“真实 Desktop Agent Host 主动连接 Relay，朋友网页提交任务并看到 Host 回传结果”的最小可运行闭环。

**Architecture:** 保留现有 in-process `HostRuntimeRegistry` 作为本地测试和 demo 后备，新增 HTTP outbound Host protocol。Relay 在朋友提交任务后为支持 `outbound_commands` capability 的 Host 入队 `HostCommand`；Host 用设备密钥主动拉取命令、执行本地 adapter，并把 runtime events 回传 Relay；Friend Web 继续通过 events API 读取完整输出。

**Tech Stack:** TypeScript, Node HTTP server, `node:test`, Ralphloop productization RelayStore/routes/httpServer, existing adapter registry and demo adapters.

---

## 0. 完成状态（2026-05-22）

- 状态：Task 1～4 已完成。
- 新增能力：Relay command queue、Host command/event HTTP API、outbound Host client、可运行 outbound dev server。
- 可运行命令：`npm run dev:productized:outbound`。
- 验证：最终验证矩阵见本文末尾；所有命令 exit 0，失败数为 0。

## Task 1: Relay Host Command Queue

**Files:**

- [x] Modify: `apps/share-gateway/src/productization/types.ts`
- [x] Modify: `apps/share-gateway/src/productization/relayStore.ts`
- [x] Modify: `apps/share-gateway/src/productization/routes.ts`
- [x] Test: `apps/share-gateway/test/productization/hostTransport.test.ts`

**Acceptance:**

- Host record with `capabilities: ["outbound_commands"]` can receive queued commands.
- `submitFriendTaskV1` does not require in-process adapter when the Host supports outbound commands.
- Queued command is bound to owner、host、share link、session、policy and task.
- Claiming a command marks it claimed and does not leak device key or owner secrets.

## Task 2: Host Event Ingestion API

**Files:**

- [x] Modify: `apps/share-gateway/src/productization/routes.ts`
- [x] Modify: `apps/share-gateway/src/productization/httpServer.ts`
- [x] Test: `apps/share-gateway/test/productization/hostTransport.test.ts`
- [x] Existing coverage: `apps/share-gateway/test/productization/httpServer.test.ts`

**Acceptance:**

- `GET /v1/hosts/:hostId/commands` requires `x-ralphloop-device-key`.
- `POST /v1/hosts/:hostId/events` requires `x-ralphloop-device-key`.
- Host can post task events for a claimed command.
- Relay validates host、command、session、task binding before accepting events.
- Friend events API can read the Host-returned output.

## Task 3: Outbound Host Client

**Files:**

- [x] Create: `apps/share-gateway/src/productization/hostClient.ts`
- [x] Test: `apps/share-gateway/test/productization/hostClient.test.ts`

**Acceptance:**

- Host client pulls command over HTTP.
- Host client executes the configured local adapter.
- Host client posts friend-safe runtime events back to Relay.
- One test proves the path crosses the HTTP boundary instead of using in-process `HostRuntimeRegistry`.

## Task 4: Runnable Dev Flow

**Files:**

- [x] Create: `apps/share-gateway/src/productization/devOutbound.ts`
- [x] Modify: `package.json`
- [x] Test: `apps/share-gateway/test/productization/devOutbound.test.ts`

**Acceptance:**

- `npm run dev:productized:outbound` starts Relay, registers an outbound Host, creates a local friend link, starts the Host polling loop, and prints Owner/Friend URLs.
- Submitting a friend task through HTTP is executed by the outbound Host client and returned through events API.

## Final Verification

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

Expected: all commands exit 0 with 0 failures.

实际验证结果：

- `npm test`：exit 0（134 pass / 0 fail）
- `npm run lint`：exit 0
- `npm run typecheck`：exit 0
- `npm run build`：exit 0
- `npm run test:contract`：exit 0（22 pass / 0 fail）
- `npm run test:integration`：exit 0（58 pass / 0 fail）
- `npm run test:security`：exit 0（48 pass / 0 fail）
- `npm run test:e2e`：exit 0（1 pass / 0 fail）
- `npm run test:smoke:real-adapter`：exit 0（22 pass / 0 fail）
- `git diff --check`：exit 0
