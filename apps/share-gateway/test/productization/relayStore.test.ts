import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { RelayStore } from "../../src/productization/relayStore.ts";
import { hashShareToken } from "../../src/productization/token.ts";

function tempStorePath(): { directory: string; filePath: string } {
  const directory = mkdtempSync(join(tmpdir(), "ralphloop-relay-"));
  return { directory, filePath: join(directory, "relay.json") };
}

test("share links persist with hashed tokens and reload by raw token", () => {
  const { directory, filePath } = tempStorePath();
  try {
    const store = new RelayStore({
      filePath,
      now: () => new Date("2026-05-21T00:00:00.000Z"),
    });
    const link = store.createShareLink({
      ownerId: "owner-1",
      hostId: "host-1",
      rawToken: "local-friend",
      name: "Ralphloop Agent",
      allowedAdapterIds: ["opencode"],
    });

    assert.equal(link.tokenHash, hashShareToken("local-friend"));
    assert.equal("token" in link, false);
    assert.equal(link.status, "active");
    assert.equal(link.policy.permissionMode, "user_identity");
    assert.equal(link.policy.previewMode, "read_only");

    const reloaded = new RelayStore({ filePath });
    const found = reloaded.findShareLinkByToken("local-friend");

    assert.equal(found?.id, link.id);
    assert.equal(found?.tokenHash, hashShareToken("local-friend"));
    assert.equal(reloaded.findShareLinkByToken("wrong-token"), undefined);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("host, session, task, runtime event, and audit records are persisted", () => {
  const { directory, filePath } = tempStorePath();
  try {
    const store = new RelayStore({
      filePath,
      now: () => new Date("2026-05-21T00:00:00.000Z"),
    });
    const host = store.upsertHost({
      ownerId: "owner-1",
      hostId: "host-1",
      deviceName: "Benzema Mac",
      hostVersion: "0.1.0",
      supportedAdapters: ["opencode"],
    });
    const link = store.createShareLink({
      ownerId: "owner-1",
      hostId: host.id,
      rawToken: "local-friend",
      name: "Ralphloop Agent",
      allowedAdapterIds: ["opencode"],
    });
    const session = store.createSession({
      shareLinkId: link.id,
      friendActorId: "anonymous-friend",
      hostId: host.id,
      adapterId: "opencode",
    });
    const task = store.createTask({
      sessionId: session.id,
      prompt: "Summarize the current runtime",
    });
    const runtimeEvent = store.appendRuntimeEvent({
      sessionId: session.id,
      taskId: task.id,
      event: { type: "task.output", taskId: task.id, text: "done" },
    });
    const audit = store.appendAuditLog({
      ownerId: "owner-1",
      shareLinkId: link.id,
      sessionId: session.id,
      actorType: "friend",
      eventType: "task.created",
      summary: task.prompt,
    });

    const reloaded = new RelayStore({ filePath });
    const snapshot = reloaded.snapshot();

    assert.equal(snapshot.hosts[0].status, "online");
    assert.equal(snapshot.sessions[0].status, "waiting");
    assert.equal(snapshot.tasks[0].status, "waiting");
    assert.equal(snapshot.runtimeEvents[0].id, runtimeEvent.id);
    assert.deepEqual(reloaded.listRuntimeEvents({ taskId: task.id }).map((entry) => entry.event.type), ["task.output"]);
    assert.equal(snapshot.auditLogs[0].id, audit.id);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cancelTasksForSession preserves terminal task history", () => {
  const store = new RelayStore({
    now: () => new Date("2026-05-21T00:00:00.000Z"),
  });
  const host = store.upsertHost({
    ownerId: "owner-1",
    hostId: "host-1",
    deviceName: "Benzema Mac",
    hostVersion: "0.1.0",
    supportedAdapters: ["opencode"],
  });
  const link = store.createShareLink({
    ownerId: "owner-1",
    hostId: host.id,
    rawToken: "local-friend",
    name: "Ralphloop Agent",
    allowedAdapterIds: ["opencode"],
  });
  const session = store.createSession({
    shareLinkId: link.id,
    friendActorId: "anonymous-friend",
    hostId: host.id,
    adapterId: "opencode",
  });
  const completed = store.createTask({ sessionId: session.id, prompt: "already complete" });
  const failed = store.createTask({ sessionId: session.id, prompt: "already failed" });
  const waiting = store.createTask({ sessionId: session.id, prompt: "still waiting" });
  store.updateTask({ taskId: completed.id, status: "completed" });
  store.updateTask({ taskId: failed.id, status: "failed" });

  const cancelled = store.cancelTasksForSession(session.id);

  assert.deepEqual(cancelled.map((task) => task.id), [waiting.id]);
  assert.equal(store.findTask(completed.id)?.status, "completed");
  assert.equal(store.findTask(failed.id)?.status, "failed");
  assert.equal(store.findTask(waiting.id)?.status, "cancelled");
});

test("persisted RelayStore writes a journal line per mutation and reloads identically", () => {
  const { directory, filePath } = tempStorePath();
  try {
    const store = new RelayStore({
      filePath,
      now: () => new Date("2026-05-21T00:00:00.000Z"),
    });
    store.upsertHost({
      ownerId: "owner-1",
      hostId: "host-1",
      deviceName: "Benzema Mac",
      hostVersion: "0.1.0",
      supportedAdapters: ["opencode"],
    });
    const link = store.createShareLink({
      ownerId: "owner-1",
      hostId: "host-1",
      rawToken: "local-friend",
      name: "Ralphloop Agent",
      allowedAdapterIds: ["opencode"],
    });
    const session = store.createSession({
      shareLinkId: link.id,
      friendActorId: "anonymous-friend",
      hostId: "host-1",
      adapterId: "opencode",
    });
    const task = store.createTask({
      sessionId: session.id,
      prompt: "journal test",
    });
    store.appendRuntimeEvent({
      sessionId: session.id,
      taskId: task.id,
      event: { type: "task.output", taskId: task.id, text: "hi" },
    });

    const journalPath = `${filePath}.journal.jsonl`;
    assert.equal(existsSync(journalPath), true, "journal file should exist after mutations");
    const journalLines = readFileSync(journalPath, "utf8")
      .split("\n")
      .filter((line) => line.length > 0);
    // upsertHost + createShareLink + createSession + createTask + appendRuntimeEvent = 5 ops
    assert.equal(journalLines.length, 5, `expected 5 journal lines, got ${journalLines.length}`);
    for (const line of journalLines) {
      assert.doesNotThrow(() => JSON.parse(line));
    }

    const reloaded = new RelayStore({ filePath });
    const snapshot = reloaded.snapshot();
    assert.equal(snapshot.hosts.length, 1);
    assert.equal(snapshot.shareLinks.length, 1);
    assert.equal(snapshot.sessions.length, 1);
    assert.equal(snapshot.tasks.length, 1);
    assert.equal(snapshot.runtimeEvents.length, 1);
    assert.equal(snapshot.shareLinks[0].id, link.id);
    assert.equal(reloaded.findTask(task.id)?.prompt, "journal test");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("RelayStore still loads the legacy single-file JSON dump (no journal yet)", () => {
  const { directory, filePath } = tempStorePath();
  try {
    // Hand-author a legacy snapshot file in the old format (no `epoch`).
    const legacy = {
      hosts: [
        {
          id: "host-legacy",
          ownerId: "owner-legacy",
          deviceName: "Legacy Mac",
          hostVersion: "0.0.9",
          status: "online",
          lastSeenAt: "2026-05-01T00:00:00.000Z",
          supportedAdapters: ["opencode"],
          capabilities: [],
          registeredAt: "2026-05-01T00:00:00.000Z",
        },
      ],
      shareLinks: [],
      sessions: [],
      tasks: [],
      runtimeEvents: [],
      friendAuthRequests: [],
      hostCommands: [],
      approvalRequests: [],
      previewFrames: [],
      auditLogs: [],
    };
    writeFileSync(filePath, `${JSON.stringify(legacy, null, 2)}\n`, "utf8");

    const store = new RelayStore({ filePath });
    assert.equal(store.findHost("host-legacy")?.deviceName, "Legacy Mac");

    // First mutation lazy-upgrades: snapshot rewritten with an epoch and any
    // future journal lines target that epoch.
    store.upsertHost({
      ownerId: "owner-legacy",
      hostId: "host-legacy-2",
      deviceName: "Brand New Mac",
      hostVersion: "0.2.0",
      supportedAdapters: ["opencode"],
    });

    const reloaded = new RelayStore({ filePath });
    const snapshot = reloaded.snapshot();
    const ids = snapshot.hosts.map((host) => host.id).sort();
    assert.deepEqual(ids, ["host-legacy", "host-legacy-2"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("updateTask refuses to transition out of a terminal state and logs a warning", () => {
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((arg) => String(arg)).join(" "));
  };
  try {
    const store = new RelayStore({ now: () => new Date("2026-05-21T00:00:00.000Z") });
    const host = store.upsertHost({
      ownerId: "owner-1",
      hostId: "host-1",
      deviceName: "Mac",
      hostVersion: "0.1.0",
      supportedAdapters: ["opencode"],
    });
    const link = store.createShareLink({
      ownerId: "owner-1",
      hostId: host.id,
      rawToken: "local-friend",
      name: "Agent",
      allowedAdapterIds: ["opencode"],
    });
    const session = store.createSession({
      shareLinkId: link.id,
      friendActorId: "anonymous-friend",
      hostId: host.id,
      adapterId: "opencode",
    });
    const task = store.createTask({ sessionId: session.id, prompt: "cancel race" });

    const cancelled = store.updateTask({ taskId: task.id, status: "cancelled" });
    assert.equal(cancelled?.status, "cancelled");
    const cancelledCompletedAt = cancelled?.completedAt;

    // Late "task.completed" arrives after cancel — MUST be rejected.
    const afterLate = store.updateTask({ taskId: task.id, status: "completed" });
    assert.equal(afterLate?.status, "cancelled");
    assert.equal(afterLate?.completedAt, cancelledCompletedAt);

    // Audit logger surfaced the dropped transition.
    const auditSummaries = store.snapshot().auditLogs.map((entry) => entry.summary);
    const lateAuditEntries = store.snapshot().auditLogs.filter((entry) =>
      entry.eventType === "task.terminal_overwrite_blocked"
    );
    assert.equal(lateAuditEntries.length, 1, `expected one audit entry, got ${JSON.stringify(auditSummaries)}`);
    assert.equal(lateAuditEntries[0].metadata?.attemptedStatus, "completed");
    assert.equal(lateAuditEntries[0].metadata?.currentStatus, "cancelled");

    // Same guard for completed → cancelled and failed → completed.
    const completedTask = store.createTask({ sessionId: session.id, prompt: "completed first" });
    store.updateTask({ taskId: completedTask.id, status: "completed" });
    const reCancelAttempt = store.updateTask({ taskId: completedTask.id, status: "cancelled" });
    assert.equal(reCancelAttempt?.status, "completed");

    const failedTask = store.createTask({ sessionId: session.id, prompt: "failed first" });
    store.updateTask({ taskId: failedTask.id, status: "failed", failureReason: "blew up" });
    const completeAfterFail = store.updateTask({ taskId: failedTask.id, status: "completed" });
    assert.equal(completeAfterFail?.status, "failed");
    assert.equal(completeAfterFail?.failureReason, "blew up");
  } finally {
    console.warn = originalWarn;
  }
});

test("in-memory RelayStore (no filePath) writes no journal file", () => {
  const { directory, filePath } = tempStorePath();
  try {
    const store = new RelayStore({ now: () => new Date("2026-05-21T00:00:00.000Z") });
    store.upsertHost({
      ownerId: "owner-1",
      hostId: "host-1",
      deviceName: "Test Mac",
      hostVersion: "0.1.0",
      supportedAdapters: ["opencode"],
    });
    // No file path means no on-disk artifact whatsoever.
    assert.equal(existsSync(filePath), false);
    assert.equal(existsSync(`${filePath}.journal.jsonl`), false);
    assert.equal(store.snapshot().hosts.length, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
