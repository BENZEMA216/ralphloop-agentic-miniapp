import assert from "node:assert/strict";
import { test } from "node:test";

import type { RuntimeEvent } from "../../src/adapters/types.ts";
import { HostRuntimeRegistry } from "../../src/productization/hostRuntime.ts";
import { createProductizedShareServer } from "../../src/productization/httpServer.ts";
import { RelayStore } from "../../src/productization/relayStore.ts";
import {
  claimHostCommandV1,
  createOwnerShareLinkV1,
  getFriendTaskEventsV1,
  recordHostCommandEventsV1,
  registerHost,
  submitFriendTaskV1,
} from "../../src/productization/routes.ts";
import { runtimeEventsToAgUiEvents } from "../../src/productization/agUiEvents.ts";

function fixedStore(): RelayStore {
  return new RelayStore({
    now: () => new Date("2026-05-22T00:00:00.000Z"),
  });
}

function setupOutboundShare(store: RelayStore) {
  registerHost({
    store,
    ownerId: "owner-1",
    hostId: "host-1",
    deviceName: "Benzema Mac",
    hostVersion: "0.2.0",
    supportedAdapters: ["opencode"],
    capabilities: ["outbound_commands"],
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

test("RuntimeEvent output maps to AG-UI run lifecycle and streaming text events", () => {
  const events = runtimeEventsToAgUiEvents({
    threadId: "session-1",
    runId: "task-1",
    prompt: "Summarize the repo",
    events: [
      { type: "task.accepted", taskId: "task-1" },
      { type: "task.output", taskId: "task-1", text: "first line" },
      { type: "task.output", taskId: "task-1", text: "second line" },
      { type: "task.completed", taskId: "task-1" },
    ],
  });

  assert.deepEqual(events.map((event) => event.type), [
    "RUN_STARTED",
    "TEXT_MESSAGE_START",
    "TEXT_MESSAGE_CONTENT",
    "TEXT_MESSAGE_CONTENT",
    "TEXT_MESSAGE_END",
    "RUN_FINISHED",
  ]);
  assert.deepEqual(events[0], {
    type: "RUN_STARTED",
    threadId: "session-1",
    runId: "task-1",
    input: {
      messages: [{ id: "task-1:user", role: "user", content: "Summarize the repo" }],
    },
  });
  assert.deepEqual(events.slice(1, 5), [
    { type: "TEXT_MESSAGE_START", messageId: "task-1:assistant", role: "assistant" },
    { type: "TEXT_MESSAGE_CONTENT", messageId: "task-1:assistant", delta: "first line" },
    { type: "TEXT_MESSAGE_CONTENT", messageId: "task-1:assistant", delta: "\nsecond line" },
    { type: "TEXT_MESSAGE_END", messageId: "task-1:assistant" },
  ]);
  assert.deepEqual(events[5], {
    type: "RUN_FINISHED",
    threadId: "session-1",
    runId: "task-1",
    result: { status: "completed" },
  });
});

test("RuntimeEvent failure and cancellation map to terminal AG-UI events without internal accepted events", () => {
  const failed = runtimeEventsToAgUiEvents({
    threadId: "session-1",
    runId: "task-failed",
    events: [
      { type: "task.accepted", taskId: "task-failed" },
      { type: "task.failed", taskId: "task-failed", message: "friendly failure" },
    ],
  });
  assert.deepEqual(failed.map((event) => event.type), ["RUN_STARTED", "RUN_ERROR"]);
  assert.deepEqual(failed[1], {
    type: "RUN_ERROR",
    message: "friendly failure",
    code: "task_failed",
  });
  assert.equal(JSON.stringify(failed).includes("task.accepted"), false);

  const cancelled = runtimeEventsToAgUiEvents({
    threadId: "session-1",
    runId: "task-cancelled",
    events: [{ type: "task.cancelled", taskId: "task-cancelled" }],
  });
  assert.deepEqual(cancelled, [
    { type: "RUN_STARTED", threadId: "session-1", runId: "task-cancelled" },
    {
      type: "CUSTOM",
      name: "ralphloop.run.cancelled",
      value: { threadId: "session-1", runId: "task-cancelled" },
    },
    {
      type: "RUN_FINISHED",
      threadId: "session-1",
      runId: "task-cancelled",
      result: { status: "cancelled" },
    },
  ]);
});

test("friend events API can return AG-UI formatted events for a task", async () => {
  const store = fixedStore();
  const runtimes = new HostRuntimeRegistry();
  setupOutboundShare(store);

  const submitted = await submitFriendTaskV1({
    store,
    runtimes,
    token: "local-friend",
    prompt: "Run through AG-UI",
  });
  assert.equal(submitted.status, 202);

  const claimed = claimHostCommandV1({ store, hostId: "host-1" });
  assert.equal(claimed.status, 200);
  const command = claimed.body.commands[0];
  const runtimeEvents: RuntimeEvent[] = [
    { type: "task.output", taskId: "host-local-task", text: "AG-UI output" },
    { type: "task.completed", taskId: "host-local-task" },
  ];
  const recorded = recordHostCommandEventsV1({
    store,
    hostId: "host-1",
    commandId: command.id,
    sessionId: command.command.sessionId,
    taskId: command.command.taskId,
    runtimeId: "opencode:outbound-runtime",
    events: runtimeEvents,
  });
  assert.equal(recorded.status, 202);

  const friendEvents = getFriendTaskEventsV1({
    store,
    token: "local-friend",
    sessionId: command.command.sessionId,
    taskId: command.command.taskId,
    format: "ag-ui",
  });

  assert.equal(friendEvents.status, 200);
  assert.deepEqual(friendEvents.body.events.map((event) => event.type), [
    "RUN_STARTED",
    "TEXT_MESSAGE_START",
    "TEXT_MESSAGE_CONTENT",
    "TEXT_MESSAGE_END",
    "RUN_FINISHED",
  ]);
  assert.deepEqual(friendEvents.body.events[0], {
    type: "RUN_STARTED",
    threadId: command.command.sessionId,
    runId: command.command.taskId,
    input: {
      messages: [{ id: `${command.command.taskId}:user`, role: "user", content: "Run through AG-UI" }],
    },
  });
  assert.equal(JSON.stringify(friendEvents.body).includes("cost"), false);
  assert.equal(JSON.stringify(friendEvents.body).includes("budget"), false);
  assert.equal(JSON.stringify(friendEvents.body).includes("tokenHash"), false);

  const defaultRuntimeResponse = getFriendTaskEventsV1({
    store,
    token: "local-friend",
    sessionId: command.command.sessionId,
    taskId: command.command.taskId,
  });
  assert.equal(defaultRuntimeResponse.status, 200);
  assert.deepEqual(defaultRuntimeResponse.body.events.map((event) => event.type), ["task.output", "task.completed"]);
  assert.equal("format" in defaultRuntimeResponse.body, false);
});

test("HTTP friend events endpoint exposes AG-UI format through query parameter", async () => {
  const bootstrapSecret = "test-bootstrap-secret";
  const server = createProductizedShareServer({
    tokenFactory: () => "local-friend",
    hostBootstrapSecret: bootstrapSecret,
  });
  await server.listen(0);
  const baseUrl = server.url();

  try {
    const registered = await server.fetch(`${baseUrl}/v1/hosts/register`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ralphloop-bootstrap-secret": bootstrapSecret,
      },
      body: JSON.stringify({
        ownerId: "owner-1",
        hostId: "host-1",
        deviceName: "Benzema Mac",
        hostVersion: "0.2.0",
        supportedAdapters: ["opencode"],
        capabilities: ["outbound_commands"],
      }),
    });
    assert.equal(registered.status, 201);
    const registeredBody = await registered.json();

    const created = await server.fetch(`${baseUrl}/v1/owner/share-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: "owner-1",
        hostId: "host-1",
        name: "Ralphloop Agent",
      }),
    });
    assert.equal(created.status, 201);

    const submitted = await server.fetch(`${baseUrl}/v1/share/local-friend/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "HTTP AG-UI contract" }),
    });
    assert.equal(submitted.status, 202);
    const submittedBody = await submitted.json();

    const claimed = await server.fetch(`${baseUrl}/v1/hosts/host-1/commands`, {
      headers: { "x-ralphloop-device-key": registeredBody.deviceKey },
    });
    assert.equal(claimed.status, 200);
    const claimedBody = await claimed.json();
    const command = claimedBody.commands[0];

    const recorded = await server.fetch(`${baseUrl}/v1/hosts/host-1/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ralphloop-device-key": registeredBody.deviceKey,
      },
      body: JSON.stringify({
        commandId: command.id,
        sessionId: command.command.sessionId,
        taskId: command.command.taskId,
        runtimeId: "opencode:outbound-runtime",
        events: [
          { type: "task.output", taskId: "host-local-task", text: "HTTP AG-UI output" },
          { type: "task.completed", taskId: "host-local-task" },
        ],
      }),
    });
    assert.equal(recorded.status, 202);

    const response = await server.fetch(
      `${baseUrl}/v1/share/local-friend/events?sessionId=${command.command.sessionId}&taskId=${submittedBody.task.id}&format=ag-ui`,
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.format, "ag-ui");
    assert.deepEqual(body.events.map((event: { type: string }) => event.type), [
      "RUN_STARTED",
      "TEXT_MESSAGE_START",
      "TEXT_MESSAGE_CONTENT",
      "TEXT_MESSAGE_END",
      "RUN_FINISHED",
    ]);
    assert.equal(body.events[2].delta, "HTTP AG-UI output");
    assert.equal(JSON.stringify(body).includes("deviceKey"), false);
  } finally {
    await server.close();
  }
});
