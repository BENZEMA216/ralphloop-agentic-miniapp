import assert from "node:assert/strict";
import { test } from "node:test";

import type { RuntimeEvent } from "../../src/adapters/types.ts";
import { HostRuntimeRegistry } from "../../src/productization/hostRuntime.ts";
import { createProductizedShareServer } from "../../src/productization/httpServer.ts";
import { RelayStore } from "../../src/productization/relayStore.ts";
import {
  cancelFriendSessionV1,
  claimHostCommandV1,
  createOwnerShareLinkV1,
  getFriendTaskEventsV1,
  recordHostCommandEventsV1,
  registerHost,
  submitFriendTaskV1,
} from "../../src/productization/routes.ts";

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

test("friend task can be queued for an outbound host and completed from host events", async () => {
  const store = fixedStore();
  const runtimes = new HostRuntimeRegistry();
  setupOutboundShare(store);

  const submitted = await submitFriendTaskV1({
    store,
    runtimes,
    token: "local-friend",
    prompt: "Summarize this repo",
  });
  assert.equal(submitted.status, 202);
  assert.equal(submitted.body.task?.status, "waiting");
  assert.deepEqual(submitted.body.events, []);

  const claimed = claimHostCommandV1({ store, hostId: "host-1" });
  assert.equal(claimed.status, 200);
  assert.equal(claimed.body.commands.length, 1);
  const command = claimed.body.commands[0];
  assert.equal(command.command.commandType, "task.submit");
  assert.equal(command.command.hostId, "host-1");
  assert.equal(command.command.taskId, submitted.body.task?.id);
  assert.equal(JSON.stringify(command).includes("deviceKey"), false);

  const events: RuntimeEvent[] = [
    { type: "task.output", taskId: "host-local-task", text: "done from outbound host" },
    { type: "task.completed", taskId: "host-local-task" },
  ];
  const recorded = recordHostCommandEventsV1({
    store,
    hostId: "host-1",
    commandId: command.id,
    sessionId: command.command.sessionId,
    taskId: command.command.taskId,
    runtimeId: "opencode:outbound-runtime",
    events,
  });
  assert.equal(recorded.status, 202);

  const friendEvents = getFriendTaskEventsV1({
    store,
    token: "local-friend",
    sessionId: command.command.sessionId,
    taskId: command.command.taskId,
  });
  const snapshot = store.snapshot();

  assert.equal(friendEvents.status, 200);
  assert.deepEqual(friendEvents.body.events.map((event) => event.type), ["task.output", "task.completed"]);
  assert.equal(friendEvents.body.events[0].taskId, submitted.body.task?.id);
  assert.equal(snapshot.tasks[0].status, "completed");
  assert.equal(snapshot.sessions[0].status, "completed");
  assert.equal(snapshot.hostCommands[0].status, "completed");
});

test("friend session cancel skips stale outbound submit and is acknowledged by host", async () => {
  const store = fixedStore();
  const runtimes = new HostRuntimeRegistry();
  setupOutboundShare(store);

  const submitted = await submitFriendTaskV1({
    store,
    runtimes,
    token: "local-friend",
    prompt: "Cancel before host runs",
  });
  assert.equal(submitted.status, 202);
  const sessionId = store.snapshot().sessions[0].id;
  const taskId = submitted.body.task?.id ?? "";

  const cancelled = await cancelFriendSessionV1({
    store,
    runtimes,
    token: "local-friend",
    sessionId,
  });
  assert.equal(cancelled.status, 200);

  const claimed = claimHostCommandV1({ store, hostId: "host-1" });
  assert.equal(claimed.status, 200);
  assert.equal(claimed.body.commands.length, 1);
  const command = claimed.body.commands[0];
  assert.equal(command.command.commandType, "session.cancel");
  assert.equal(command.command.sessionId, sessionId);

  const recorded = recordHostCommandEventsV1({
    store,
    hostId: "host-1",
    commandId: command.id,
    sessionId,
    taskId: "",
    events: [],
  });
  assert.equal(recorded.status, 202);

  const friendEvents = getFriendTaskEventsV1({
    store,
    token: "local-friend",
    sessionId,
    taskId,
  });
  const snapshot = store.snapshot();

  assert.equal(friendEvents.status, 200);
  assert.deepEqual(friendEvents.body.events.map((event) => event.type), ["task.cancelled"]);
  assert.equal(snapshot.tasks[0].status, "cancelled");
  assert.equal(snapshot.sessions[0].status, "cancelled");
  assert.deepEqual(snapshot.hostCommands.map((entry) => [entry.command.commandType, entry.status]), [
    ["task.submit", "cancelled"],
    ["session.cancel", "completed"],
  ]);
});

test("HTTP outbound host command and event APIs are device-key scoped", async () => {
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
      body: JSON.stringify({ prompt: "Run through outbound host" }),
    });
    assert.equal(submitted.status, 202);
    const submittedBody = await submitted.json();
    assert.equal(submittedBody.task.status, "waiting");

    const unauthenticatedCommands = await server.fetch(`${baseUrl}/v1/hosts/host-1/commands`);
    assert.equal(unauthenticatedCommands.status, 401);

    const claimed = await server.fetch(`${baseUrl}/v1/hosts/host-1/commands`, {
      headers: { "x-ralphloop-device-key": registeredBody.deviceKey },
    });
    assert.equal(claimed.status, 200);
    const claimedBody = await claimed.json();
    assert.equal(claimedBody.commands.length, 1);
    const command = claimedBody.commands[0];
    assert.equal(command.command.commandType, "task.submit");
    assert.equal(command.command.taskId, submittedBody.task.id);

    const rejectedEvents = await server.fetch(`${baseUrl}/v1/hosts/host-1/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ralphloop-device-key": "wrong-device-key",
      },
      body: JSON.stringify({
        commandId: command.id,
        sessionId: command.command.sessionId,
        taskId: command.command.taskId,
        events: [],
      }),
    });
    assert.equal(rejectedEvents.status, 403);

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
          { type: "task.output", taskId: "host-local-task", text: "done over HTTP" },
          { type: "task.completed", taskId: "host-local-task" },
        ],
      }),
    });
    assert.equal(recorded.status, 202);

    const friendEvents = await server.fetch(
      `${baseUrl}/v1/share/local-friend/events?sessionId=${command.command.sessionId}&taskId=${command.command.taskId}`,
    );
    assert.equal(friendEvents.status, 200);
    const friendEventsBody = await friendEvents.json();
    assert.deepEqual(friendEventsBody.events.map((event: RuntimeEvent) => event.type), [
      "task.output",
      "task.completed",
    ]);
    assert.equal(friendEventsBody.events[0].text, "done over HTTP");
  } finally {
    await server.close();
  }
});
