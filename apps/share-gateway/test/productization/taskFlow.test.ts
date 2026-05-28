import assert from "node:assert/strict";
import { test } from "node:test";

import type { AgentAdapter, RuntimeEvent } from "../../src/adapters/types.ts";
import { HostRuntimeRegistry } from "../../src/productization/hostRuntime.ts";
import { RelayStore } from "../../src/productization/relayStore.ts";
import {
  createOwnerShareLinkV1,
  createFriendSessionV1,
  getFriendTaskEventsV1,
  registerHost,
  submitFriendTaskV1,
} from "../../src/productization/routes.ts";

function fixedStore(): RelayStore {
  return new RelayStore({
    now: () => new Date("2026-05-21T00:00:00.000Z"),
  });
}

function setupShare(store: RelayStore) {
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
  });
}

function recordingAdapter(calls: string[], events: RuntimeEvent[]): AgentAdapter {
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
      calls.push(`submit:${input.taskId}:${input.prompt}`);
      return {
        adapterId: input.runtime.adapterId,
        runtimeId: input.runtime.runtimeId,
        taskId: input.taskId ?? "task-from-adapter",
        status: "completed",
      };
    },
    async *streamEvents() {
      for (const event of events) {
        yield event;
      }
    },
    async stop() {},
  };
}

test("friend task routes through connected host runtime and persists records", async () => {
  const store = fixedStore();
  const runtimes = new HostRuntimeRegistry();
  const calls: string[] = [];
  setupShare(store);
  runtimes.connectHost({
    hostId: "host-1",
    adapters: {
      opencode: recordingAdapter(calls, [
        { type: "task.accepted", taskId: "unused" },
        { type: "task.output", taskId: "unused", text: "done" },
        { type: "task.completed", taskId: "unused" },
      ]),
    },
  });

  const response = await submitFriendTaskV1({
    store,
    runtimes,
    token: "local-friend",
    prompt: "Summarize the current runtime",
  });
  const snapshot = store.snapshot();
  const serialized = JSON.stringify(response.body);
  const sessionId = snapshot.sessions[0]?.id ?? "";
  const persistedEvents = getFriendTaskEventsV1({
    store,
    token: "local-friend",
    sessionId,
    taskId: response.body.task?.id ?? "",
  });
  store.createShareLink({
    ownerId: "owner-2",
    hostId: "host-2",
    rawToken: "other-friend",
    name: "Other Agent",
    allowedAdapterIds: ["codex"],
  });
  const wrongTokenEvents = getFriendTaskEventsV1({
    store,
    token: "other-friend",
    sessionId,
    taskId: response.body.task?.id ?? "",
  });

  assert.equal(response.status, 202);
  assert.equal(response.body.task.status, "completed");
  assert.deepEqual(response.body.events.map((event) => event.type), [
    "task.accepted",
    "task.output",
    "task.completed",
  ]);
  assert.deepEqual(calls, [
    "start:opencode",
    `submit:${response.body.task.id}:Summarize the current runtime`,
  ]);
  assert.equal(snapshot.sessions.length, 1);
  assert.equal(snapshot.sessions[0].status, "completed");
  assert.equal(snapshot.tasks.length, 1);
  assert.equal(snapshot.tasks[0].status, "completed");
  assert.equal(snapshot.runtimeEvents.length, 3);
  assert.equal(persistedEvents.status, 200);
  assert.deepEqual(persistedEvents.body.events.map((event) => event.type), [
    "task.accepted",
    "task.output",
    "task.completed",
  ]);
  assert.equal(persistedEvents.body.events[1].taskId, response.body.task.id);
  assert.equal(JSON.stringify(persistedEvents.body).includes("cost"), false);
  assert.equal(JSON.stringify(persistedEvents.body).includes("budget"), false);
  assert.equal(JSON.stringify(persistedEvents.body).includes("tokenHash"), false);
  assert.equal(wrongTokenEvents.status, 404);
  assert.deepEqual(wrongTokenEvents.body, {
    events: [],
    available: false,
    error: "events_unavailable",
  });
  assert.equal(snapshot.auditLogs.some((entry) => entry.eventType === "task.submitted"), true);
  assert.equal(serialized.includes("cost"), false);
  assert.equal(serialized.includes("budget"), false);
  assert.equal(serialized.includes("tokenHash"), false);
});

test("friend task rejects a blank prompt before creating a session or task", async () => {
  const store = fixedStore();
  const runtimes = new HostRuntimeRegistry();
  const calls: string[] = [];
  setupShare(store);
  runtimes.connectHost({
    hostId: "host-1",
    adapters: { opencode: recordingAdapter(calls, []) },
  });

  const response = await submitFriendTaskV1({
    store,
    runtimes,
    token: "local-friend",
    prompt: "   ",
  });
  const snapshot = store.snapshot();

  assert.equal(response.status, 422);
  assert.deepEqual(response.body, {
    task: undefined,
    events: [],
    available: false,
    error: "prompt_required",
  });
  assert.equal(snapshot.sessions.length, 0);
  assert.equal(snapshot.tasks.length, 0);
  assert.deepEqual(calls, []);
});

test("friend can create an explicit session and submit task into it", async () => {
  const store = fixedStore();
  const runtimes = new HostRuntimeRegistry();
  const calls: string[] = [];
  setupShare(store);
  runtimes.connectHost({
    hostId: "host-1",
    adapters: {
      opencode: recordingAdapter(calls, [
        { type: "task.output", taskId: "unused", text: "session task done" },
        { type: "task.completed", taskId: "unused" },
      ]),
    },
  });

  const session = createFriendSessionV1({
    store,
    token: "local-friend",
    displayName: "Friend",
  });
  const serializedSession = JSON.stringify(session.body);

  assert.equal(session.status, 201);
  assert.equal(session.body.session.status, "waiting");
  assert.equal(session.body.session.adapterId, "opencode");
  assert.equal(serializedSession.includes("shareLinkId"), false);
  assert.equal(serializedSession.includes("hostId"), false);
  assert.equal(serializedSession.includes("tokenHash"), false);
  assert.equal(serializedSession.includes("cost"), false);
  assert.equal(serializedSession.includes("budget"), false);

  const response = await submitFriendTaskV1({
    store,
    runtimes,
    token: "local-friend",
    sessionId: session.body.session.id,
    prompt: "Run in explicit session",
  });
  const snapshot = store.snapshot();

  assert.equal(response.status, 202);
  assert.equal(response.body.task.status, "completed");
  assert.equal(snapshot.sessions.length, 1);
  assert.equal(snapshot.sessions[0].id, session.body.session.id);
  assert.equal(snapshot.sessions[0].status, "completed");
  assert.equal(snapshot.tasks.length, 1);
  assert.equal(snapshot.tasks[0].sessionId, session.body.session.id);
  assert.deepEqual(calls, [
    "start:opencode",
    `submit:${response.body.task.id}:Run in explicit session`,
  ]);
  assert.equal(snapshot.auditLogs.some((entry) => entry.eventType === "session.created"), true);
});

test("friend task rejects explicit session from a different share link", async () => {
  const store = fixedStore();
  const runtimes = new HostRuntimeRegistry();
  setupShare(store);
  runtimes.connectHost({
    hostId: "host-1",
    adapters: {
      opencode: recordingAdapter([], []),
    },
  });
  store.createShareLink({
    ownerId: "owner-1",
    hostId: "host-1",
    rawToken: "other-friend",
    name: "Other Agent",
    allowedAdapterIds: ["opencode"],
  });
  const session = createFriendSessionV1({ store, token: "other-friend" });

  const response = await submitFriendTaskV1({
    store,
    runtimes,
    token: "local-friend",
    sessionId: session.body.session.id,
    prompt: "Wrong session",
  });

  assert.equal(response.status, 404);
  assert.deepEqual(response.body, {
    task: undefined,
    events: [],
    available: false,
    error: "session_unavailable",
  });
});

test("friend task does not fallback when host runtime is not connected", async () => {
  const store = fixedStore();
  const runtimes = new HostRuntimeRegistry();
  setupShare(store);

  const response = await submitFriendTaskV1({
    store,
    runtimes,
    token: "local-friend",
    prompt: "Summarize the current runtime",
  });

  assert.equal(response.status, 503);
  assert.deepEqual(response.body, {
    task: undefined,
    events: [],
    available: false,
    error: "shared_agent_unavailable",
  });
  assert.equal(store.snapshot().sessions.length, 0);
});
