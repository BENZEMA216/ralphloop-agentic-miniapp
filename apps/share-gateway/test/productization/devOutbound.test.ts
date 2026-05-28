import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { startOutboundDevServer } from "../../src/productization/devOutbound.ts";

test("outbound dev server creates a runnable relay-host-friend loop", async () => {
  const dev = await startOutboundDevServer({
    port: 0,
    adapterMode: "demo",
    pollIntervalMs: 0,
    token: "local-friend",
    adapterIds: ["opencode"],
  });

  try {
    assert.equal(dev.ownerUrl.endsWith("/app/owner"), true);
    assert.equal(dev.friendUrl.endsWith("/app/share/local-friend/assistant-ui"), true);

    const submitted = await dev.fetch(`${dev.baseUrl}/v1/share/local-friend/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "Run through outbound dev server" }),
    });
    const submittedBody = await submitted.json();
    assert.equal(submitted.status, 202);
    assert.equal(submittedBody.task.status, "waiting");

    const queuedOwnerTasks = await dev.fetch(`${dev.baseUrl}/v1/owner/tasks?ownerId=owner-1`);
    const queuedOwnerTasksBody = await queuedOwnerTasks.json();
    const queuedSessionId = queuedOwnerTasksBody.tasks[0].sessionId;
    const queuedFriendEvents = await dev.fetch(
      `${dev.baseUrl}/v1/share/local-friend/events?sessionId=${queuedSessionId}&taskId=${submittedBody.task.id}`,
    );
    const queuedFriendEventsBody = await queuedFriendEvents.json();
    assert.equal(queuedFriendEvents.status, 200);
    assert.deepEqual(queuedFriendEventsBody.events, []);

    const processed = await dev.runOnce();
    assert.equal(processed, 1);

    const ownerTasks = await dev.fetch(`${dev.baseUrl}/v1/owner/tasks?ownerId=owner-1`);
    const ownerTasksBody = await ownerTasks.json();
    const sessionId = ownerTasksBody.tasks[0].sessionId;
    const friendEvents = await dev.fetch(
      `${dev.baseUrl}/v1/share/local-friend/events?sessionId=${sessionId}&taskId=${submittedBody.task.id}`,
    );
    const friendEventsBody = await friendEvents.json();
    assert.equal(friendEvents.status, 200);
    assert.equal(friendEventsBody.events.some((event: { type: string }) => event.type === "task.completed"), true);
  } finally {
    await dev.close();
  }
});

test("package exposes the outbound productized dev script", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts?: Record<string, string>;
  };

  assert.match(pkg.scripts?.["dev:productized:outbound"] ?? "", /devOutbound\.ts/);
});

test("outbound dev server creates unique links after the seeded local friend link", async () => {
  const dev = await startOutboundDevServer({
    port: 0,
    adapterMode: "demo",
    pollIntervalMs: 0,
    heartbeatIntervalMs: 0,
    token: "local-friend",
    adapterIds: ["opencode"],
  });

  try {
    const created = await dev.fetch(`${dev.baseUrl}/v1/owner/share-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: "owner-1",
        hostId: "host-1",
        name: "Ralphloop Agent",
      }),
    });
    const createdBody = await created.json();
    const links = await dev.fetch(`${dev.baseUrl}/v1/owner/share-links?ownerId=owner-1`);
    const linksBody = await links.json();

    assert.equal(created.status, 201);
    assert.notEqual(createdBody.shareLink.token, "local-friend");
    assert.notEqual(createdBody.shareLink.url, dev.friendUrl);
    assert.equal(new Set(linksBody.shareLinks.map((link: { id: string }) => link.id)).size, 2);
  } finally {
    await dev.close();
  }
});

test("outbound dev server can refresh host heartbeat explicitly", async () => {
  const dev = await startOutboundDevServer({
    port: 0,
    adapterMode: "demo",
    pollIntervalMs: 0,
    heartbeatIntervalMs: 0,
    token: "local-friend",
    adapterIds: ["opencode"],
  });

  try {
    const before = await (await dev.fetch(`${dev.baseUrl}/v1/owner/audit-logs?ownerId=owner-1`)).json();
    assert.equal(before.auditLogs.some((entry: { eventType: string }) => entry.eventType === "host.heartbeat"), false);

    const heartbeat = await dev.heartbeatOnce();
    assert.equal(heartbeat.status, 200);

    const after = await (await dev.fetch(`${dev.baseUrl}/v1/owner/audit-logs?ownerId=owner-1`)).json();
    assert.equal(after.auditLogs.some((entry: { eventType: string }) => entry.eventType === "host.heartbeat"), true);
  } finally {
    await dev.close();
  }
});
