import assert from "node:assert/strict";
import { test } from "node:test";

import type { AgentAdapter } from "../../src/adapters/types.ts";
import { HostRuntimeRegistry } from "../../src/productization/hostRuntime.ts";
import { RelayStore } from "../../src/productization/relayStore.ts";
import {
  cancelOwnerSessionV1,
  createFriendSessionV1,
  createOwnerShareLinkV1,
  getFriendSharePageV1,
  listOwnerAuditLogsV1,
  listOwnerShareLinksV1,
  listOwnerSessionsV1,
  listOwnerTasksV1,
  markHostOfflineV1,
  pauseOwnerShareLinkByIdV1,
  registerHost,
  revokeOwnerShareLinkByIdV1,
  resumeOwnerShareLinkByIdV1,
  submitFriendTaskV1,
  updateOwnerShareLinkV1,
} from "../../src/productization/routes.ts";

function fixedStore(): RelayStore {
  return new RelayStore({
    now: () => new Date("2026-05-21T00:00:00.000Z"),
  });
}

function noOpAdapter(calls: string[] = []): AgentAdapter {
  return {
    async detect() {
      throw new Error("detect not used");
    },
    async start(input) {
      calls.push(`start:${input.adapterId}`);
      return {
        adapterId: input.adapterId,
        runtimeId: `${input.adapterId}:runtime`,
        status: "running",
      };
    },
    async submitTask(input) {
      calls.push(`submit:${input.prompt}`);
      return {
        adapterId: input.runtime.adapterId,
        runtimeId: input.runtime.runtimeId,
        taskId: input.taskId ?? "task-1",
        status: "completed",
      };
    },
    async *streamEvents(input) {
      yield { type: "task.completed", taskId: input.task.taskId };
    },
    async stop() {},
  };
}

function setupShare(store: RelayStore, policy = {}) {
  registerHost({
    store,
    ownerId: "owner-1",
    hostId: "host-1",
    deviceName: "Benzema Mac",
    hostVersion: "0.1.0",
    supportedAdapters: ["opencode"],
  });
  createOwnerShareLinkV1({
    store,
    ownerId: "owner-1",
    hostId: "host-1",
    name: "Ralphloop Agent",
    baseUrl: "https://share.example",
    tokenFactory: () => "local-friend",
    policy,
  });
}

test("task budget is enforced before adapter execution", async () => {
  const store = fixedStore();
  const runtimes = new HostRuntimeRegistry();
  const calls: string[] = [];
  setupShare(store, { maxTaskBudget: 2 });
  runtimes.connectHost({ hostId: "host-1", adapters: { opencode: noOpAdapter(calls) } });

  const response = await submitFriendTaskV1({
    store,
    runtimes,
    token: "local-friend",
    prompt: "Run expensive task",
    estimatedTaskBudget: 3,
  });

  assert.equal(response.status, 402);
  assert.equal(response.body.error, "shared_agent_unavailable");
  assert.deepEqual(calls, []);
  assert.equal(store.snapshot().auditLogs.at(-1)?.eventType, "budget.rejected");
});

test("total budget is enforced across accepted tasks", async () => {
  const store = fixedStore();
  const runtimes = new HostRuntimeRegistry();
  setupShare(store, { maxTotalBudget: 3, maxTaskBudget: 3 });
  runtimes.connectHost({ hostId: "host-1", adapters: { opencode: noOpAdapter() } });

  const first = await submitFriendTaskV1({
    store,
    runtimes,
    token: "local-friend",
    prompt: "First task",
    estimatedTaskBudget: 2,
  });
  const second = await submitFriendTaskV1({
    store,
    runtimes,
    token: "local-friend",
    prompt: "Second task",
    estimatedTaskBudget: 2,
  });

  assert.equal(first.status, 202);
  assert.equal(second.status, 402);
  assert.equal(store.findShareLinkByToken("local-friend")?.budgetUsed, 2);
});

test("max concurrent sessions prevents new task execution", async () => {
  const store = fixedStore();
  const runtimes = new HostRuntimeRegistry();
  const calls: string[] = [];
  setupShare(store, { maxConcurrentSessions: 1 });
  const link = store.findShareLinkByToken("local-friend");
  if (!link) {
    throw new Error("missing link");
  }
  store.createSession({
    shareLinkId: link.id,
    friendActorId: "friend-1",
    hostId: "host-1",
    adapterId: "opencode",
  });
  runtimes.connectHost({ hostId: "host-1", adapters: { opencode: noOpAdapter(calls) } });

  const response = await submitFriendTaskV1({
    store,
    runtimes,
    token: "local-friend",
    prompt: "Another task",
  });

  assert.equal(response.status, 429);
  assert.equal(response.body.error, "shared_agent_unavailable");
  assert.deepEqual(calls, []);
});

test("request rate limit blocks friend session and task creation before adapter execution", async () => {
  const store = fixedStore();
  const runtimes = new HostRuntimeRegistry();
  const calls: string[] = [];
  setupShare(store, { maxRequestsPerMinute: 1 });
  runtimes.connectHost({ hostId: "host-1", adapters: { opencode: noOpAdapter(calls) } });

  const first = createFriendSessionV1({
    store,
    token: "local-friend",
  });
  const second = await submitFriendTaskV1({
    store,
    runtimes,
    token: "local-friend",
    prompt: "Run after limit",
  });

  assert.equal(first.status, 201);
  assert.equal(second.status, 429);
  assert.equal(second.body.error, "shared_agent_unavailable");
  assert.deepEqual(calls, []);
  assert.equal(store.snapshot().auditLogs.at(-1)?.eventType, "rate_limit.rejected");
});

test("expired sessions are cancelled before concurrency checks", () => {
  let nowMs = Date.parse("2026-05-21T00:00:00.000Z");
  const store = new RelayStore({
    now: () => new Date(nowMs),
  });
  setupShare(store, { maxConcurrentSessions: 1, sessionTtlMs: 1000 });

  const first = createFriendSessionV1({
    store,
    token: "local-friend",
  });
  nowMs += 2000;
  const second = createFriendSessionV1({
    store,
    token: "local-friend",
  });

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(store.findSession(first.body.session.id)?.status, "cancelled");
  assert.equal(store.snapshot().auditLogs.some((entry) => entry.eventType === "session.timeout"), true);
});

test("expired explicit session cannot accept a friend task", async () => {
  let nowMs = Date.parse("2026-05-21T00:00:00.000Z");
  const store = new RelayStore({
    now: () => new Date(nowMs),
  });
  const runtimes = new HostRuntimeRegistry();
  const calls: string[] = [];
  setupShare(store, { sessionTtlMs: 1000 });
  runtimes.connectHost({ hostId: "host-1", adapters: { opencode: noOpAdapter(calls) } });

  const session = createFriendSessionV1({
    store,
    token: "local-friend",
  });
  nowMs += 2000;
  const task = await submitFriendTaskV1({
    store,
    runtimes,
    token: "local-friend",
    sessionId: session.body.session.id,
    prompt: "Run stale session",
  });

  assert.equal(task.status, 409);
  assert.equal(task.body.error, "session_unavailable");
  assert.deepEqual(calls, []);
});

test("offline host makes friend page neutrally unavailable", () => {
  const store = fixedStore();
  setupShare(store);

  const offline = markHostOfflineV1({
    store,
    ownerId: "owner-1",
    hostId: "host-1",
  });
  const friend = getFriendSharePageV1({ store, token: "local-friend" });

  assert.equal(offline.status, 200);
  assert.equal(friend.status, 503);
  assert.deepEqual(friend.body, {
    available: false,
    error: "shared_agent_unavailable",
  });
});

test("owner can list only their audit logs and sessions", () => {
  const store = fixedStore();
  setupShare(store);
  const ownerLink = store.findShareLinkByToken("local-friend");
  if (!ownerLink) {
    throw new Error("missing owner link");
  }
  const ownerSession = store.createSession({
    shareLinkId: ownerLink.id,
    friendActorId: "friend",
    hostId: "host-1",
    adapterId: "opencode",
  });
  store.appendAuditLog({
    ownerId: "owner-1",
    shareLinkId: ownerLink.id,
    sessionId: ownerSession.id,
    actorType: "friend",
    eventType: "task.submitted",
    summary: "Owner task",
  });
  registerHost({
    store,
    ownerId: "owner-2",
    hostId: "host-2",
    deviceName: "Other Mac",
    hostVersion: "0.1.0",
    supportedAdapters: ["codex"],
  });
  const otherLink = store.createShareLink({
    ownerId: "owner-2",
    hostId: "host-2",
    rawToken: "other-friend",
    name: "Other Agent",
    allowedAdapterIds: ["codex"],
  });
  const otherSession = store.createSession({
    shareLinkId: otherLink.id,
    friendActorId: "other-friend",
    hostId: "host-2",
    adapterId: "codex",
  });
  store.appendAuditLog({
    ownerId: "owner-2",
    shareLinkId: otherLink.id,
    sessionId: otherSession.id,
    actorType: "friend",
    eventType: "task.submitted",
    summary: "Other task",
  });

  const audit = listOwnerAuditLogsV1({ store, ownerId: "owner-1" });
  const sessions = listOwnerSessionsV1({ store, ownerId: "owner-1" });

  assert.equal(audit.status, 200);
  assert.deepEqual(audit.body.auditLogs.map((entry) => entry.ownerId), ["owner-1", "owner-1", "owner-1"]);
  assert.equal(JSON.stringify(audit.body).includes("Other task"), false);
  assert.equal(sessions.status, 200);
  assert.deepEqual(sessions.body.sessions.map((session) => session.id), [ownerSession.id]);
});

test("owner can list only their share links and task history with usage", () => {
  const store = fixedStore();
  setupShare(store, { maxTotalBudget: 4, maxTaskBudget: 2 });
  const ownerLink = store.findShareLinkByToken("local-friend");
  if (!ownerLink) {
    throw new Error("missing owner link");
  }
  store.addShareLinkBudgetUsage(ownerLink.id, 2);
  const ownerSession = store.createSession({
    shareLinkId: ownerLink.id,
    friendActorId: "friend",
    hostId: "host-1",
    adapterId: "opencode",
  });
  const ownerTask = store.createTask({
    sessionId: ownerSession.id,
    prompt: "Owner task",
  });
  store.updateTask({
    taskId: ownerTask.id,
    status: "failed",
    failureReason: "Adapter stopped",
  });
  registerHost({
    store,
    ownerId: "owner-2",
    hostId: "host-2",
    deviceName: "Other Mac",
    hostVersion: "0.1.0",
    supportedAdapters: ["codex"],
  });
  const otherLink = store.createShareLink({
    ownerId: "owner-2",
    hostId: "host-2",
    rawToken: "other-friend",
    name: "Other Agent",
    allowedAdapterIds: ["codex"],
  });
  const otherSession = store.createSession({
    shareLinkId: otherLink.id,
    friendActorId: "other-friend",
    hostId: "host-2",
    adapterId: "codex",
  });
  store.createTask({
    sessionId: otherSession.id,
    prompt: "Other task",
  });

  const links = listOwnerShareLinksV1({ store, ownerId: "owner-1" });
  const tasks = listOwnerTasksV1({ store, ownerId: "owner-1" });

  assert.equal(links.status, 200);
  assert.equal(links.body.shareLinks.length, 1);
  assert.equal(links.body.shareLinks[0].id, ownerLink.id);
  assert.equal(links.body.shareLinks[0].status, "active");
  assert.deepEqual(links.body.shareLinks[0].allowedAdapterIds, ["opencode"]);
  assert.equal(links.body.shareLinks[0].budgetUsed, 2);
  assert.equal(links.body.shareLinks[0].maxTotalBudget, 4);
  assert.equal(links.body.shareLinks[0].maxTaskBudget, 2);
  assert.equal(JSON.stringify(links.body).includes("tokenHash"), false);

  assert.equal(tasks.status, 200);
  assert.equal(tasks.body.tasks.length, 1);
  assert.equal(tasks.body.tasks[0].id, ownerTask.id);
  assert.equal(tasks.body.tasks[0].shareLinkId, ownerLink.id);
  assert.match(tasks.body.tasks[0].friendActorId, /^anon_[a-f0-9-]+$|^friend$/);
  assert.equal(tasks.body.tasks[0].adapterId, "opencode");
  assert.equal(tasks.body.tasks[0].prompt, "Owner task");
  assert.equal(tasks.body.tasks[0].status, "failed");
  assert.equal(tasks.body.tasks[0].failureReason, "Adapter stopped");
  assert.equal(JSON.stringify(tasks.body).includes("Other task"), false);
});

test("owner can revoke share link by id and wrong owner cannot revoke it", async () => {
  const store = fixedStore();
  const runtimes = new HostRuntimeRegistry();
  setupShare(store);
  const link = store.findShareLinkByToken("local-friend");
  if (!link) {
    throw new Error("missing link");
  }

  const rejected = await revokeOwnerShareLinkByIdV1({
    store,
    runtimes,
    ownerId: "owner-2",
    shareLinkId: link.id,
  });
  const revoked = await revokeOwnerShareLinkByIdV1({
    store,
    runtimes,
    ownerId: "owner-1",
    shareLinkId: link.id,
  });

  assert.equal(rejected.status, 404);
  assert.deepEqual(rejected.body, { error: "share_link_unavailable" });
  assert.equal(revoked.status, 200);
  assert.deepEqual(revoked.body, { ok: true });
  assert.equal(getFriendSharePageV1({ store, token: "local-friend" }).status, 404);
  assert.equal(store.snapshot().auditLogs.at(-1)?.eventType, "share_link.revoked");
});

test("revoking a share link cancels active sessions and stops host runtimes", async () => {
  const store = fixedStore();
  const runtimes = new HostRuntimeRegistry();
  setupShare(store);
  const link = store.findShareLinkByToken("local-friend");
  if (!link) {
    throw new Error("missing link");
  }

  const calls: string[] = [];
  runtimes.connectHost({
    hostId: "host-1",
    adapters: {
      opencode: {
        ...noOpAdapter(),
        async submitTask(input) {
          return {
            adapterId: input.runtime.adapterId,
            runtimeId: input.runtime.runtimeId,
            taskId: input.taskId ?? "task-1",
            status: "running",
          };
        },
        async *streamEvents() {},
        async stop(input) {
          calls.push(`stop:${input.runtime.runtimeId}:${input.reason ?? ""}`);
        },
      },
    },
  });

  const taskResponse = await submitFriendTaskV1({
    store,
    runtimes,
    token: "local-friend",
    prompt: "Long running task",
  });
  assert.equal(taskResponse.status, 202);
  assert.equal(taskResponse.body.task.status, "running");

  const sessionId = store.snapshot().sessions[0]?.id;
  if (!sessionId) {
    throw new Error("missing session");
  }

  const revoked = await revokeOwnerShareLinkByIdV1({
    store,
    runtimes,
    ownerId: "owner-1",
    shareLinkId: link.id,
  });

  assert.equal(revoked.status, 200);
  assert.deepEqual(revoked.body, { ok: true });
  assert.equal(store.findSession(sessionId)?.status, "cancelled");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].startsWith("stop:"), true);
});

test("owner can pause and resume share link by id", async () => {
  const store = fixedStore();
  const runtimes = new HostRuntimeRegistry();
  setupShare(store);
  runtimes.connectHost({ hostId: "host-1", adapters: { opencode: noOpAdapter() } });
  const link = store.findShareLinkByToken("local-friend");
  if (!link) {
    throw new Error("missing link");
  }

  const deniedPause = pauseOwnerShareLinkByIdV1({
    store,
    ownerId: "owner-2",
    shareLinkId: link.id,
  });
  const paused = pauseOwnerShareLinkByIdV1({
    store,
    ownerId: "owner-1",
    shareLinkId: link.id,
  });
  const friendWhilePaused = getFriendSharePageV1({ store, token: "local-friend" });
  const taskWhilePaused = await submitFriendTaskV1({
    store,
    runtimes,
    token: "local-friend",
    prompt: "Run while paused",
  });
  const deniedResume = resumeOwnerShareLinkByIdV1({
    store,
    ownerId: "owner-2",
    shareLinkId: link.id,
  });
  const resumed = resumeOwnerShareLinkByIdV1({
    store,
    ownerId: "owner-1",
    shareLinkId: link.id,
  });
  const taskAfterResume = await submitFriendTaskV1({
    store,
    runtimes,
    token: "local-friend",
    prompt: "Run after resume",
  });

  assert.equal(deniedPause.status, 404);
  assert.deepEqual(deniedPause.body, { error: "share_link_unavailable" });
  assert.equal(paused.status, 200);
  assert.deepEqual(paused.body, { ok: true });
  assert.equal(friendWhilePaused.status, 423);
  assert.equal(taskWhilePaused.status, 423);
  assert.equal(deniedResume.status, 404);
  assert.deepEqual(deniedResume.body, { error: "share_link_unavailable" });
  assert.equal(resumed.status, 200);
  assert.deepEqual(resumed.body, { ok: true });
  assert.equal(taskAfterResume.status, 202);
  assert.equal(store.findShareLinkByToken("local-friend")?.status, "active");
  assert.deepEqual(
    store.snapshot().auditLogs.map((entry) => entry.eventType).filter((eventType) => {
      return eventType === "share_link.paused" || eventType === "share_link.resumed";
    }),
    ["share_link.paused", "share_link.resumed"],
  );
});

test("revoked share link cannot be resumed", async () => {
  const store = fixedStore();
  const runtimes = new HostRuntimeRegistry();
  setupShare(store);
  const link = store.findShareLinkByToken("local-friend");
  if (!link) {
    throw new Error("missing link");
  }

  await revokeOwnerShareLinkByIdV1({
    store,
    runtimes,
    ownerId: "owner-1",
    shareLinkId: link.id,
  });
  const resumed = resumeOwnerShareLinkByIdV1({
    store,
    ownerId: "owner-1",
    shareLinkId: link.id,
  });

  assert.equal(resumed.status, 409);
  assert.deepEqual(resumed.body, { error: "share_link_final" });
  assert.equal(store.findShareLinkByToken("local-friend")?.status, "revoked");
});

test("owner can update share link policy by id", () => {
  const store = fixedStore();
  registerHost({
    store,
    ownerId: "owner-1",
    hostId: "host-1",
    deviceName: "Benzema Mac",
    hostVersion: "0.1.0",
    supportedAdapters: ["opencode", "codex"],
  });
  createOwnerShareLinkV1({
    store,
    ownerId: "owner-1",
    hostId: "host-1",
    name: "Ralphloop Agent",
    baseUrl: "https://share.example",
    tokenFactory: () => "local-friend",
    policy: { allowedAdapterIds: ["opencode"], maxTotalBudget: 4 },
  });
  const link = store.findShareLinkByToken("local-friend");
  if (!link) {
    throw new Error("missing link");
  }

  const denied = updateOwnerShareLinkV1({
    store,
    ownerId: "owner-2",
    shareLinkId: link.id,
    name: "Other owner edit",
  });
  const unsupported = updateOwnerShareLinkV1({
    store,
    ownerId: "owner-1",
    shareLinkId: link.id,
    policy: { allowedAdapterIds: ["hermes"] },
  });
  const updated = updateOwnerShareLinkV1({
    store,
    ownerId: "owner-1",
    shareLinkId: link.id,
    name: "Ralphloop Codex Agent",
    policy: {
      allowedAdapterIds: ["codex"],
      maxTotalBudget: 8,
      maxConcurrentSessions: 2,
    },
  });

  assert.equal(denied.status, 404);
  assert.deepEqual(denied.body, { error: "share_link_unavailable" });
  assert.equal(unsupported.status, 422);
  assert.deepEqual(unsupported.body, { error: "adapter_not_available" });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.shareLink.name, "Ralphloop Codex Agent");
  assert.deepEqual(updated.body.shareLink.allowedAdapterIds, ["codex"]);
  assert.equal(updated.body.shareLink.maxTotalBudget, 8);
  assert.equal(updated.body.shareLink.maxConcurrentSessions, 2);
  assert.equal(getFriendSharePageV1({ store, token: "local-friend" }).body.agent.adapterId, "codex");
  assert.equal(store.snapshot().auditLogs.at(-1)?.eventType, "share_link.updated");
});

test("revoked share link cannot be updated", async () => {
  const store = fixedStore();
  const runtimes = new HostRuntimeRegistry();
  setupShare(store);
  const link = store.findShareLinkByToken("local-friend");
  if (!link) {
    throw new Error("missing link");
  }

  await revokeOwnerShareLinkByIdV1({
    store,
    runtimes,
    ownerId: "owner-1",
    shareLinkId: link.id,
  });
  const updated = updateOwnerShareLinkV1({
    store,
    ownerId: "owner-1",
    shareLinkId: link.id,
    name: "New name",
  });

  assert.equal(updated.status, 409);
  assert.deepEqual(updated.body, { error: "share_link_final" });
});

test("owner kill switch cancels session, tasks, and stops the host runtime", async () => {
  const store = fixedStore();
  setupShare(store);
  const link = store.findShareLinkByToken("local-friend");
  if (!link) {
    throw new Error("missing link");
  }
  const calls: string[] = [];
  const runtimes = new HostRuntimeRegistry();
  runtimes.connectHost({
    hostId: "host-1",
    adapters: {
      opencode: {
        ...noOpAdapter(),
        async submitTask(input) {
          calls.push(`submit:${input.taskId}:${input.prompt}`);
          return {
            adapterId: input.runtime.adapterId,
            runtimeId: input.runtime.runtimeId,
            taskId: input.taskId ?? "task-1",
            status: "running",
          };
        },
        async *streamEvents() {},
        async stop(input) {
          calls.push(`stop:${input.runtime.runtimeId}:${input.reason ?? ""}`);
        },
      },
    },
  });

  const taskResponse = await submitFriendTaskV1({
    store,
    runtimes,
    token: "local-friend",
    prompt: "Run task",
  });
  const sessionId = taskResponse.body.task ? store.snapshot().sessions[0]?.id : undefined;
  if (!sessionId) {
    throw new Error("missing session");
  }
  const taskId = taskResponse.body.task.id;

  const response = await cancelOwnerSessionV1({
    store,
    runtimes,
    ownerId: "owner-1",
    sessionId,
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.session.status, "cancelled");
  assert.equal(store.snapshot().tasks.find((entry) => entry.id === taskId)?.status, "cancelled");
  const audit = store.snapshot().auditLogs.at(-1);
  assert.equal(audit?.eventType, "session.cancelled");
  assert.equal(typeof audit?.metadata, "object");
  assert.equal(typeof (audit?.metadata as { hostCommand?: unknown }).hostCommand, "object");
  assert.equal(calls.some((entry) => entry.startsWith("stop:")), true);
});

test("wrong owner cannot cancel another owner session", async () => {
  const store = fixedStore();
  const runtimes = new HostRuntimeRegistry();
  setupShare(store);
  const link = store.findShareLinkByToken("local-friend");
  if (!link) {
    throw new Error("missing link");
  }
  const session = store.createSession({
    shareLinkId: link.id,
    friendActorId: "friend",
    hostId: "host-1",
    adapterId: "opencode",
  });
  const task = store.createTask({
    sessionId: session.id,
    prompt: "Run task",
  });

  const response = await cancelOwnerSessionV1({
    store,
    runtimes,
    ownerId: "owner-2",
    sessionId: session.id,
  });

  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { error: "session_not_found" });
  assert.equal(store.findSession(session.id)?.status, "waiting");
  assert.equal(store.snapshot().tasks.find((entry) => entry.id === task.id)?.status, "waiting");
});
