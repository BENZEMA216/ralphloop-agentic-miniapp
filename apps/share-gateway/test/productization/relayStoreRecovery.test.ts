import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { RelayStore } from "../../src/productization/relayStore.ts";

function tempStorePath(): { directory: string; filePath: string } {
  const directory = mkdtempSync(join(tmpdir(), "ralphloop-relay-recovery-"));
  return { directory, filePath: join(directory, "relay.json") };
}

test("RelayStore reloads share links, sessions, tasks, runtime events, host commands, and approvals after a tear-down", () => {
  const { directory, filePath } = tempStorePath();
  let clockTickMs = Date.parse("2026-05-21T00:00:00.000Z");
  const tickNow = () => new Date((clockTickMs += 1));

  try {
    const original = new RelayStore({ filePath, now: tickNow });
    const host = original.upsertHost({
      ownerId: "owner-1",
      hostId: "host-1",
      deviceName: "Recovery Mac",
      hostVersion: "0.1.0",
      supportedAdapters: ["opencode"],
    });
    const link = original.createShareLink({
      ownerId: "owner-1",
      hostId: host.id,
      rawToken: "local-friend",
      name: "Ralphloop Agent",
      allowedAdapterIds: ["opencode"],
    });
    const session = original.createSession({
      shareLinkId: link.id,
      friendActorId: "anonymous-friend",
      hostId: host.id,
      adapterId: "opencode",
    });
    const task = original.createTask({
      sessionId: session.id,
      prompt: "Recover me",
    });
    const command = original.enqueueHostCommand({
      hostId: host.id,
      command: {
        ownerId: "owner-1",
        hostId: host.id,
        sessionId: session.id,
        shareLinkId: link.id,
        policyVersion: "test",
        issuedAt: new Date(clockTickMs).toISOString(),
        commandType: "task.submit",
        adapterId: "opencode",
        taskId: task.id,
        prompt: task.prompt,
      },
    });
    const event = original.appendRuntimeEvent({
      sessionId: session.id,
      taskId: task.id,
      event: { type: "task.output", taskId: task.id, text: "in-flight" },
    });
    const approval = original.createApprovalRequest({
      ownerId: "owner-1",
      sessionId: session.id,
      taskId: task.id,
      actionType: "send_message",
      permissionSource: "user_identity",
      summary: "approve me",
      riskLevel: "medium",
      requiredDecision: "owner_approve",
    });
    const audit = original.appendAuditLog({
      ownerId: "owner-1",
      shareLinkId: link.id,
      sessionId: session.id,
      actorType: "system",
      eventType: "recovery.test",
      summary: "covered",
    });

    // Drop the instance: simulate a gateway crash/restart.
    const beforeSnapshot = original.snapshot();

    const reloaded = new RelayStore({ filePath, now: tickNow });
    const after = reloaded.snapshot();

    // Every collection round-trips identically.
    assert.deepEqual(after.hosts, beforeSnapshot.hosts);
    assert.deepEqual(after.shareLinks, beforeSnapshot.shareLinks);
    assert.deepEqual(after.sessions, beforeSnapshot.sessions);
    assert.deepEqual(after.tasks, beforeSnapshot.tasks);
    assert.deepEqual(after.runtimeEvents, beforeSnapshot.runtimeEvents);
    assert.deepEqual(after.hostCommands, beforeSnapshot.hostCommands);
    assert.deepEqual(after.approvalRequests, beforeSnapshot.approvalRequests);
    assert.deepEqual(after.auditLogs, beforeSnapshot.auditLogs);

    // The exact records survive by id.
    assert.equal(reloaded.findShareLinkByToken("local-friend")?.id, link.id);
    assert.equal(reloaded.findSession(session.id)?.adapterId, "opencode");
    assert.equal(reloaded.findTask(task.id)?.prompt, task.prompt);
    assert.equal(reloaded.findHostCommand(command.id)?.status, "queued");
    assert.equal(
      reloaded.listRuntimeEvents({ taskId: task.id }).map((entry) => entry.id).includes(event.id),
      true,
    );
    assert.equal(
      reloaded.listApprovalRequests().map((entry) => entry.id).includes(approval.id),
      true,
    );
    assert.equal(after.auditLogs.map((entry) => entry.id).includes(audit.id), true);

    // Mutations on the reloaded store flow through the journal and are
    // visible through public read paths.
    const followUp = reloaded.appendRuntimeEvent({
      sessionId: session.id,
      taskId: task.id,
      event: { type: "task.output", taskId: task.id, text: "post-restart" },
    });
    const eventsAfter = reloaded.listRuntimeEvents({ taskId: task.id });
    assert.equal(eventsAfter.map((entry) => entry.id).includes(followUp.id), true);
    assert.equal(eventsAfter.length, 2);

    // A third construction from the same path sees the post-restart event too.
    const thirdGeneration = new RelayStore({ filePath, now: tickNow });
    assert.equal(
      thirdGeneration.listRuntimeEvents({ taskId: task.id })
        .map((entry) => entry.id)
        .includes(followUp.id),
      true,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("reclaimStaleHostCommands recovers stale claimed commands, leaves recent + terminal alone", () => {
  const { directory, filePath } = tempStorePath();
  let nowMs = Date.parse("2026-05-21T00:00:00.000Z");
  const now = () => new Date(nowMs);

  try {
    const store = new RelayStore({ filePath, now });
    const stale = store.enqueueHostCommand({
      hostId: "host-1",
      command: {
        ownerId: "owner-1",
        hostId: "host-1",
        sessionId: "session-stale",
        shareLinkId: "share-link-1",
        policyVersion: "test",
        issuedAt: now().toISOString(),
        commandType: "task.submit",
        adapterId: "opencode",
        taskId: "task-stale",
        prompt: "stale claim",
      },
    });
    const fresh = store.enqueueHostCommand({
      hostId: "host-1",
      command: {
        ownerId: "owner-1",
        hostId: "host-1",
        sessionId: "session-fresh",
        shareLinkId: "share-link-1",
        policyVersion: "test",
        issuedAt: now().toISOString(),
        commandType: "task.submit",
        adapterId: "opencode",
        taskId: "task-fresh",
        prompt: "fresh claim",
      },
    });
    const willComplete = store.enqueueHostCommand({
      hostId: "host-1",
      command: {
        ownerId: "owner-1",
        hostId: "host-1",
        sessionId: "session-done",
        shareLinkId: "share-link-1",
        policyVersion: "test",
        issuedAt: now().toISOString(),
        commandType: "task.submit",
        adapterId: "opencode",
        taskId: "task-done",
        prompt: "already done",
      },
    });

    // Stale claim happens at t=0.
    store.claimNextHostCommand("host-1"); // claims `stale`
    // Move clock forward 60s, claim fresh.
    nowMs += 60_000;
    store.claimNextHostCommand("host-1"); // claims `fresh`
    // Mark willComplete as completed (terminal — never reclaimed).
    store.claimNextHostCommand("host-1");
    store.completeHostCommand({ commandId: willComplete.id, status: "completed" });

    // Move clock forward another 60s — `stale` has been claimed for 120s,
    // `fresh` for 60s.
    nowMs += 60_000;

    const reclaimed = store.reclaimStaleHostCommands({ olderThanMs: 90_000 });
    assert.equal(reclaimed, 1, "only the stale claim should be reclaimed");
    assert.equal(store.findHostCommand(stale.id)?.status, "queued");
    assert.equal(store.findHostCommand(stale.id)?.claimedAt, undefined);
    assert.equal(store.findHostCommand(fresh.id)?.status, "claimed");
    assert.equal(store.findHostCommand(willComplete.id)?.status, "completed");

    // The reclaimed stale command can be re-claimed.
    const reClaim = store.claimNextHostCommand("host-1");
    assert.equal(reClaim?.id, stale.id);

    // The reclaim survives a reload.
    nowMs += 1;
    const reloaded = new RelayStore({ filePath, now });
    assert.equal(reloaded.findHostCommand(stale.id)?.status, "claimed");
    assert.equal(reloaded.findHostCommand(willComplete.id)?.status, "completed");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("reclaimStaleHostCommands never touches terminal commands even when their claimedAt is ancient", () => {
  let nowMs = Date.parse("2026-05-21T00:00:00.000Z");
  const now = () => new Date(nowMs);

  const store = new RelayStore({ now });
  const completed = store.enqueueHostCommand({
    hostId: "host-1",
    command: {
      ownerId: "owner-1",
      hostId: "host-1",
      sessionId: "session-completed",
      shareLinkId: "share-link-1",
      policyVersion: "test",
      issuedAt: now().toISOString(),
      commandType: "task.submit",
      adapterId: "opencode",
      taskId: "task-completed",
      prompt: "completed",
    },
  });
  const failed = store.enqueueHostCommand({
    hostId: "host-1",
    command: {
      ownerId: "owner-1",
      hostId: "host-1",
      sessionId: "session-failed",
      shareLinkId: "share-link-1",
      policyVersion: "test",
      issuedAt: now().toISOString(),
      commandType: "task.submit",
      adapterId: "opencode",
      taskId: "task-failed",
      prompt: "failed",
    },
  });
  const cancelled = store.enqueueHostCommand({
    hostId: "host-1",
    command: {
      ownerId: "owner-1",
      hostId: "host-1",
      sessionId: "session-cancelled",
      shareLinkId: "share-link-1",
      policyVersion: "test",
      issuedAt: now().toISOString(),
      commandType: "task.submit",
      adapterId: "opencode",
      taskId: "task-cancelled",
      prompt: "cancelled",
    },
  });

  store.claimNextHostCommand("host-1");
  store.completeHostCommand({ commandId: completed.id, status: "completed" });
  store.claimNextHostCommand("host-1");
  store.completeHostCommand({ commandId: failed.id, status: "failed" });
  store.claimNextHostCommand("host-1");
  store.completeHostCommand({ commandId: cancelled.id, status: "cancelled" });

  // Jump way past any reasonable staleness threshold.
  nowMs += 24 * 60 * 60 * 1000;
  const reclaimed = store.reclaimStaleHostCommands({ olderThanMs: 1 });
  assert.equal(reclaimed, 0);
  assert.equal(store.findHostCommand(completed.id)?.status, "completed");
  assert.equal(store.findHostCommand(failed.id)?.status, "failed");
  assert.equal(store.findHostCommand(cancelled.id)?.status, "cancelled");
});
