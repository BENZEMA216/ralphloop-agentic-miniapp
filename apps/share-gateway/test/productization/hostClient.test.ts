import assert from "node:assert/strict";
import { test } from "node:test";

import { ProviderRegistry } from "../../src/adapters/providerRegistry.ts";
import type { AgentAdapter } from "../../src/adapters/types.ts";
import { createProductizedShareServer } from "../../src/productization/httpServer.ts";
import { createHostClientRuntimeState, runHostCommandOnce } from "../../src/productization/hostClient.ts";
import { SessionBusyError, SessionProcessTable } from "../../src/productization/sessionProcessTable.ts";
import type { HostCommandRecord } from "../../src/productization/types.ts";

function recordingAdapter(calls: string[]): AgentAdapter {
  return {
    async detect() {
      throw new Error("detect not used");
    },
    async start(input) {
      calls.push(`start:${input.adapterId}`);
      return {
        adapterId: input.adapterId,
        runtimeId: `${input.adapterId}:host-client-runtime`,
        status: "running",
      };
    },
    async submitTask(input) {
      calls.push(`submit:${input.taskId}:${input.prompt}`);
      return {
        adapterId: input.runtime.adapterId,
        runtimeId: input.runtime.runtimeId,
        taskId: input.taskId ?? "task-from-host-client",
        status: "completed",
      };
    },
    async *streamEvents(input) {
      yield {
        type: "task.output",
        taskId: input.task.taskId,
        text: "host client completed over HTTP",
      };
      yield { type: "task.completed", taskId: input.task.taskId };
    },
    async stop() {},
  };
}

function runningUntilCancelledAdapter(input: {
  calls: string[];
  onTaskStarted(): void;
}): AgentAdapter {
  return {
    async detect() {
      throw new Error("detect not used");
    },
    async start(startInput) {
      input.calls.push(`start:${startInput.adapterId}`);
      return {
        adapterId: startInput.adapterId,
        runtimeId: `${startInput.adapterId}:running-runtime`,
        status: "running",
      };
    },
    async submitTask(taskInput) {
      input.calls.push(`submit:${taskInput.taskId}:${taskInput.prompt}`);
      input.onTaskStarted();
      await new Promise<void>((resolve) => {
        if (taskInput.signal?.aborted) {
          resolve();
          return;
        }
        taskInput.signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      input.calls.push(`submit-aborted:${taskInput.taskId}`);
      return {
        adapterId: taskInput.runtime.adapterId,
        runtimeId: taskInput.runtime.runtimeId,
        taskId: taskInput.taskId ?? "cancelled-task",
        status: "cancelled",
      };
    },
    async *streamEvents(streamInput) {
      if (streamInput.signal?.aborted || streamInput.task.status === "cancelled") {
        yield { type: "task.cancelled", taskId: streamInput.task.taskId };
        return;
      }
      yield {
        type: "task.output",
        taskId: streamInput.task.taskId,
        text: "should not be emitted after cancel",
      };
      yield { type: "task.completed", taskId: streamInput.task.taskId };
    },
    async stop(stopInput) {
      input.calls.push(`stop:${stopInput.runtime.runtimeId}:${stopInput.reason ?? ""}`);
    },
  };
}

test("host client pulls a command over HTTP and returns events to friend API", async () => {
  const calls: string[] = [];
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
    const registeredBody = await registered.json();
    assert.equal(registered.status, 201);

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
      body: JSON.stringify({ prompt: "Run through host client" }),
    });
    const submittedBody = await submitted.json();
    assert.equal(submitted.status, 202);

    const processed = await runHostCommandOnce({
      relayBaseUrl: baseUrl,
      hostId: "host-1",
      deviceKey: registeredBody.deviceKey,
      adapters: { opencode: recordingAdapter(calls) },
      fetch: server.fetch,
    });
    assert.equal(processed, 1);

    const events = await server.fetch(
      `${baseUrl}/v1/share/local-friend/events?sessionId=${submittedBody.task.sessionId ?? ""}&taskId=${submittedBody.task.id}`,
    );
    assert.equal(events.status, 404);

    const commands = await server.fetch(`${baseUrl}/v1/hosts/host-1/commands`, {
      headers: { "x-ralphloop-device-key": registeredBody.deviceKey },
    });
    const commandsBody = await commands.json();
    assert.equal(commandsBody.commands.length, 0);

    const ownerTasks = await server.fetch(`${baseUrl}/v1/owner/tasks?ownerId=owner-1`);
    const ownerTasksBody = await ownerTasks.json();
    const sessionId = ownerTasksBody.tasks[0].sessionId;
    const friendEvents = await server.fetch(
      `${baseUrl}/v1/share/local-friend/events?sessionId=${sessionId}&taskId=${submittedBody.task.id}`,
    );
    const friendEventsBody = await friendEvents.json();

    assert.equal(friendEvents.status, 200);
    assert.deepEqual(friendEventsBody.events.map((event: { type: string }) => event.type), [
      "task.output",
      "task.completed",
    ]);
    assert.deepEqual(calls, [
      "start:opencode",
      `submit:${submittedBody.task.id}:Run through host client`,
    ]);
  } finally {
    await server.close();
  }
});

test("host client acknowledges session cancel commands without running stale task submit", async () => {
  const calls: string[] = [];
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
    const registeredBody = await registered.json();
    assert.equal(registered.status, 201);

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
      body: JSON.stringify({ prompt: "Cancel this queued task" }),
    });
    const submittedBody = await submitted.json();
    assert.equal(submitted.status, 202);

    const ownerTasksBeforeCancel = await server.fetch(`${baseUrl}/v1/owner/tasks?ownerId=owner-1`);
    const ownerTasksBeforeCancelBody = await ownerTasksBeforeCancel.json();
    const sessionId = ownerTasksBeforeCancelBody.tasks[0].sessionId;
    const cancelled = await server.fetch(`${baseUrl}/v1/share/local-friend/sessions/${sessionId}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(cancelled.status, 200);

    const processed = await runHostCommandOnce({
      relayBaseUrl: baseUrl,
      hostId: "host-1",
      deviceKey: registeredBody.deviceKey,
      adapters: { opencode: recordingAdapter(calls) },
      fetch: server.fetch,
    });
    assert.equal(processed, 1);
    assert.deepEqual(calls, []);

    const commands = await server.fetch(`${baseUrl}/v1/hosts/host-1/commands`, {
      headers: { "x-ralphloop-device-key": registeredBody.deviceKey },
    });
    const commandsBody = await commands.json();
    assert.equal(commandsBody.commands.length, 0);

    const ownerTasks = await server.fetch(`${baseUrl}/v1/owner/tasks?ownerId=owner-1`);
    const ownerTasksBody = await ownerTasks.json();
    assert.equal(ownerTasksBody.tasks[0].id, submittedBody.task.id);
    assert.equal(ownerTasksBody.tasks[0].status, "cancelled");

    const friendEvents = await server.fetch(
      `${baseUrl}/v1/share/local-friend/events?sessionId=${sessionId}&taskId=${submittedBody.task.id}`,
    );
    const friendEventsBody = await friendEvents.json();
    assert.deepEqual(friendEventsBody.events.map((event: { type: string }) => event.type), ["task.cancelled"]);
  } finally {
    await server.close();
  }
});

test("host client aborts an active task when a session cancel command is claimed concurrently", async () => {
  const calls: string[] = [];
  let markTaskStarted!: () => void;
  const taskStarted = new Promise<void>((resolve) => {
    markTaskStarted = resolve;
  });
  const bootstrapSecret = "test-bootstrap-secret";
  const server = createProductizedShareServer({
    tokenFactory: () => "local-friend",
    hostBootstrapSecret: bootstrapSecret,
  });
  await server.listen(0);
  const baseUrl = server.url();
  const hostRuntimeState = createHostClientRuntimeState();

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
    const registeredBody = await registered.json();
    assert.equal(registered.status, 201);

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
      body: JSON.stringify({ prompt: "Cancel while running" }),
    });
    const submittedBody = await submitted.json();
    assert.equal(submitted.status, 202);

    const ownerTasksBeforeCancel = await server.fetch(`${baseUrl}/v1/owner/tasks?ownerId=owner-1`);
    const ownerTasksBeforeCancelBody = await ownerTasksBeforeCancel.json();
    const sessionId = ownerTasksBeforeCancelBody.tasks[0].sessionId;
    const adapter = runningUntilCancelledAdapter({
      calls,
      onTaskStarted: markTaskStarted,
    });

    const running = runHostCommandOnce({
      relayBaseUrl: baseUrl,
      hostId: "host-1",
      deviceKey: registeredBody.deviceKey,
      adapters: { opencode: adapter },
      fetch: server.fetch,
      runtimeState: hostRuntimeState,
    });
    await taskStarted;

    const cancelled = await server.fetch(`${baseUrl}/v1/share/local-friend/sessions/${sessionId}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(cancelled.status, 200);

    const processedCancel = await runHostCommandOnce({
      relayBaseUrl: baseUrl,
      hostId: "host-1",
      deviceKey: registeredBody.deviceKey,
      adapters: { opencode: adapter },
      fetch: server.fetch,
      runtimeState: hostRuntimeState,
    });
    const processedRunning = await running;
    assert.equal(processedCancel, 1);
    assert.equal(processedRunning, 1);

    assert.deepEqual(calls, [
      "start:opencode",
      `submit:${submittedBody.task.id}:Cancel while running`,
      "stop:opencode:running-runtime:friend_cancelled",
      `submit-aborted:${submittedBody.task.id}`,
    ]);

    const ownerTasks = await server.fetch(`${baseUrl}/v1/owner/tasks?ownerId=owner-1`);
    const ownerTasksBody = await ownerTasks.json();
    assert.equal(ownerTasksBody.tasks[0].id, submittedBody.task.id);
    assert.equal(ownerTasksBody.tasks[0].status, "cancelled");

    const friendEvents = await server.fetch(
      `${baseUrl}/v1/share/local-friend/events?sessionId=${sessionId}&taskId=${submittedBody.task.id}`,
    );
    const friendEventsBody = await friendEvents.json();
    assert.deepEqual(friendEventsBody.events.map((event: { type: string }) => event.type), ["task.cancelled"]);
  } finally {
    await server.close();
  }
});

// ============================================================================
// Workstream C — SessionProcessTable concurrency tests
// ============================================================================

type TaskSubmitCommand = HostCommandRecord["command"] & { commandType: "task.submit" };
type SessionCancelCommand = HostCommandRecord["command"] & { commandType: "session.cancel" };

const POLICY_VERSION_STUB = "policy-version-stub";

function taskSubmitRecord(input: {
  id: string;
  ownerId?: string;
  hostId?: string;
  sessionId: string;
  shareLinkId?: string;
  adapterId: string;
  taskId: string;
  prompt: string;
}): HostCommandRecord {
  const command: TaskSubmitCommand = {
    ownerId: input.ownerId ?? "owner-1",
    hostId: input.hostId ?? "host-1",
    sessionId: input.sessionId,
    shareLinkId: input.shareLinkId ?? "share-link-1",
    policyVersion: POLICY_VERSION_STUB,
    issuedAt: new Date(0).toISOString(),
    commandType: "task.submit",
    adapterId: input.adapterId,
    taskId: input.taskId,
    prompt: input.prompt,
  };
  return {
    id: input.id,
    hostId: command.hostId,
    command,
    status: "queued",
    createdAt: command.issuedAt,
  };
}

function sessionCancelRecord(input: {
  id: string;
  sessionId: string;
  adapterId: string;
  ownerId?: string;
  hostId?: string;
  shareLinkId?: string;
  reason?: string;
}): HostCommandRecord {
  const command: SessionCancelCommand = {
    ownerId: input.ownerId ?? "owner-1",
    hostId: input.hostId ?? "host-1",
    sessionId: input.sessionId,
    shareLinkId: input.shareLinkId ?? "share-link-1",
    policyVersion: POLICY_VERSION_STUB,
    issuedAt: new Date(0).toISOString(),
    commandType: "session.cancel",
    adapterId: input.adapterId,
    reason: input.reason,
  };
  return {
    id: input.id,
    hostId: command.hostId,
    command,
    status: "queued",
    createdAt: command.issuedAt,
  };
}

type PostedBody = {
  commandId: string;
  sessionId: string;
  taskId: string;
  runtimeId?: string;
  events: Array<{ type: string; taskId?: string; text?: string; message?: string }>;
};

/**
 * Minimal in-memory fetch double that backs runHostCommandOnce: returns the
 * supplied command queue once on GET, captures all POSTed event payloads.
 */
function createFakeFetch(input: { hostId: string; commands: HostCommandRecord[] }) {
  let delivered = false;
  const posts: PostedBody[] = [];
  const fetchImpl = async (
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
  ): Promise<Response> => {
    if (url.endsWith(`/v1/hosts/${input.hostId}/commands`)) {
      const payload = delivered ? { commands: [] } : { commands: input.commands };
      delivered = true;
      return new Response(JSON.stringify(payload), { status: 200 });
    }
    if (url.endsWith(`/v1/hosts/${input.hostId}/events`) && init?.method === "POST") {
      posts.push(JSON.parse(init.body ?? "{}"));
      return new Response("{}", { status: 200 });
    }
    return new Response("not_found", { status: 404 });
  };
  return { fetch: fetchImpl, posts };
}

type TaskGate = {
  /** Resolves when submitTask is invoked. */
  started: Promise<void>;
  /** Test calls release() to let streamEvents continue past its await. */
  release(): void;
  /** Internal — the stream awaits this. */
  readonly streamGate: Promise<void>;
};

function createTaskGate(): TaskGate {
  let resolveStarted!: () => void;
  let resolveStream!: () => void;
  const started = new Promise<void>((resolve) => {
    resolveStarted = resolve;
  });
  const streamGate = new Promise<void>((resolve) => {
    resolveStream = resolve;
  });
  return {
    started,
    release: () => resolveStream(),
    streamGate,
    // Surface resolveStarted via a property assignment trick so the adapter
    // can pull it without exposing internals to test code.
    // @ts-expect-error attached for adapter use
    _resolveStarted: () => resolveStarted(),
  };
}

type ConcurrentAdapterFlags = {
  gates: Map<string, TaskGate>;
  trace: string[];
};

function concurrentAdapter(flags: ConcurrentAdapterFlags, runtimeId: string): AgentAdapter {
  return {
    async detect() {
      throw new Error("detect not used");
    },
    async start(startInput) {
      flags.trace.push(`start:${runtimeId}`);
      return {
        adapterId: startInput.adapterId,
        runtimeId,
        status: "running",
      };
    },
    async submitTask(taskInput) {
      flags.trace.push(`submit:${runtimeId}:${taskInput.taskId}`);
      const gate = flags.gates.get(taskInput.taskId ?? "");
      // @ts-expect-error pull the resolver attached in createTaskGate
      gate?._resolveStarted?.();
      return {
        adapterId: taskInput.runtime.adapterId,
        runtimeId: taskInput.runtime.runtimeId,
        taskId: taskInput.taskId ?? "task",
        status: "completed",
      };
    },
    async *streamEvents(streamInput) {
      yield { type: "task.accepted", taskId: streamInput.task.taskId };
      const gate = flags.gates.get(streamInput.task.taskId);
      if (gate) {
        await gate.streamGate;
      }
      if (streamInput.signal?.aborted) {
        flags.trace.push(`aborted:${streamInput.task.taskId}`);
        yield { type: "task.cancelled", taskId: streamInput.task.taskId };
        return;
      }
      yield { type: "task.output", taskId: streamInput.task.taskId, text: "ok" };
      yield { type: "task.completed", taskId: streamInput.task.taskId };
    },
    async stop() {
      flags.trace.push(`stop:${runtimeId}`);
    },
  };
}

test("SessionProcessTable.cancel for an unknown session is a no-op", async () => {
  const table = new SessionProcessTable();
  await table.cancel("never-acquired", "test_reason");
  assert.equal(table.size(), 0);
  // Idempotent — a second call is also a no-op.
  await table.cancel("never-acquired", "test_reason");
  assert.equal(table.size(), 0);
});

test("SessionProcessTable.acquire rejects when the session is already busy", () => {
  const table = new SessionProcessTable();
  const adapter: AgentAdapter = recordingAdapter([]);
  table.acquire({ sessionId: "session-a", adapter, abortController: new AbortController() });
  assert.throws(
    () => table.acquire({ sessionId: "session-a", adapter, abortController: new AbortController() }),
    (error) => {
      assert.ok(error instanceof SessionBusyError);
      assert.equal(error.sessionId, "session-a");
      return true;
    },
  );
});

test("SessionProcessTable.cancel is idempotent — second call is a no-op", async () => {
  const stopReasons: string[] = [];
  const adapter: AgentAdapter = {
    async detect() {
      throw new Error("detect not used");
    },
    async start() {
      return { adapterId: "test", runtimeId: "test:1", status: "running" };
    },
    async submitTask() {
      throw new Error("not used");
    },
    async *streamEvents() {
      throw new Error("not used");
    },
    async stop(input) {
      stopReasons.push(input.reason ?? "");
    },
  };

  const table = new SessionProcessTable();
  const slot = table.acquire({
    sessionId: "session-b",
    adapter,
    abortController: new AbortController(),
  });
  slot.runtime = { adapterId: "test", runtimeId: "test:1", status: "running" };

  await table.cancel("session-b", "first_reason");
  assert.equal(slot.stopRequested, true);
  assert.equal(slot.cancelReason, "first_reason");
  assert.equal(slot.abortController.signal.aborted, true);
  assert.deepEqual(stopReasons, ["first_reason"]);

  // Second cancel — already stopRequested, must not call adapter.stop again.
  await table.cancel("session-b", "second_reason");
  assert.deepEqual(stopReasons, ["first_reason"]);
  assert.equal(slot.cancelReason, "first_reason");

  table.release(slot);
  assert.equal(table.size(), 0);

  // Cancel after release routes correctly — no-op without throwing.
  await table.cancel("session-b", "post_release_reason");
});

test("SessionProcessTable serializes cancel and release through a per-session lock", async () => {
  const table = new SessionProcessTable();
  let stopResolved!: () => void;
  const stopPromise = new Promise<void>((resolve) => {
    stopResolved = resolve;
  });
  const adapter: AgentAdapter = {
    async detect() {
      throw new Error("detect not used");
    },
    async start() {
      return { adapterId: "test", runtimeId: "test:1", status: "running" };
    },
    async submitTask() {
      throw new Error("not used");
    },
    async *streamEvents() {
      throw new Error("not used");
    },
    async stop() {
      await stopPromise;
    },
  };

  const slot = table.acquire({
    sessionId: "session-c",
    adapter,
    abortController: new AbortController(),
  });
  slot.runtime = { adapterId: "test", runtimeId: "test:1", status: "running" };

  const firstCancel = table.cancel("session-c", "racer-a");
  const secondCancel = table.cancel("session-c", "racer-b");

  // Both cancels are pending — release immediately, then unblock stop().
  stopResolved();
  await firstCancel;
  await secondCancel;

  // Even with two concurrent cancels, stopRequested flipped exactly once.
  assert.equal(slot.stopRequested, true);
  assert.equal(slot.cancelReason, "racer-a");
});

test("host client runs two concurrent task.submit commands on different sessions", async () => {
  const flags: ConcurrentAdapterFlags = { gates: new Map(), trace: [] };
  const gateA = createTaskGate();
  const gateB = createTaskGate();
  flags.gates.set("task-a", gateA);
  flags.gates.set("task-b", gateB);

  const adapter = concurrentAdapter(flags, "concurrent:1");

  const recordA = taskSubmitRecord({
    id: "cmd-a",
    sessionId: "session-A",
    adapterId: "opencode",
    taskId: "task-a",
    prompt: "do A",
  });
  const recordB = taskSubmitRecord({
    id: "cmd-b",
    sessionId: "session-B",
    adapterId: "opencode",
    taskId: "task-b",
    prompt: "do B",
  });

  const fakeA = createFakeFetch({ hostId: "host-1", commands: [recordA] });
  const fakeB = createFakeFetch({ hostId: "host-1", commands: [recordB] });

  // Two distinct runtime states (two outbound host clients) — each owns one
  // session and they both run against the same shared adapter.
  const stateA = createHostClientRuntimeState();
  const stateB = createHostClientRuntimeState();

  const runA = runHostCommandOnce({
    relayBaseUrl: "https://relay.test",
    hostId: "host-1",
    deviceKey: "key",
    adapters: { opencode: adapter },
    fetch: fakeA.fetch,
    runtimeState: stateA,
  });
  const runB = runHostCommandOnce({
    relayBaseUrl: "https://relay.test",
    hostId: "host-1",
    deviceKey: "key",
    adapters: { opencode: adapter },
    fetch: fakeB.fetch,
    runtimeState: stateB,
  });

  await Promise.all([gateA.started, gateB.started]);

  assert.equal(stateA.size(), 1, "state A should hold session-A");
  assert.equal(stateB.size(), 1, "state B should hold session-B");
  assert.ok(stateA.getActive("session-A"), "session-A active in state A");
  assert.ok(stateB.getActive("session-B"), "session-B active in state B");

  // Now release both streams and let each finish.
  gateA.release();
  gateB.release();

  const [countA, countB] = await Promise.all([runA, runB]);
  assert.equal(countA, 1);
  assert.equal(countB, 1);

  assert.equal(stateA.size(), 0, "state A clears in finally");
  assert.equal(stateB.size(), 0, "state B clears in finally");

  // Each host emitted terminal events for its own task.
  const typesA = fakeA.posts[0].events.map((event) => event.type);
  const typesB = fakeB.posts[0].events.map((event) => event.type);
  assert.ok(typesA.includes("task.completed"), `state A terminal: ${typesA.join(",")}`);
  assert.ok(typesB.includes("task.completed"), `state B terminal: ${typesB.join(",")}`);
});

test("host client races session.cancel mid-streamEvents and emits exactly one task.cancelled", async () => {
  const flags: ConcurrentAdapterFlags = {
    taskStarted: new Map(),
    releaseStream: new Map(),
    trace: [],
  };
  const taskStarted = new Promise<void>((resolve) => flags.taskStarted.set("task-x", resolve));

  const adapter: AgentAdapter = {
    async detect() {
      throw new Error("not used");
    },
    async start(startInput) {
      flags.trace.push(`start:${startInput.adapterId}`);
      return { adapterId: startInput.adapterId, runtimeId: "race:1", status: "running" };
    },
    async submitTask(taskInput) {
      flags.trace.push(`submit:${taskInput.taskId}`);
      flags.taskStarted.get(taskInput.taskId ?? "")!();
      // Block until aborted so the cancel can arrive mid-stream.
      await new Promise<void>((resolve) => {
        if (taskInput.signal?.aborted) {
          resolve();
          return;
        }
        taskInput.signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      return {
        adapterId: taskInput.runtime.adapterId,
        runtimeId: taskInput.runtime.runtimeId,
        taskId: taskInput.taskId ?? "task",
        status: "cancelled",
      };
    },
    async *streamEvents(streamInput) {
      // Late completion attempt — this MUST be suppressed by the cancel
      // post-processing in executeHostCommand.
      if (streamInput.signal?.aborted) {
        yield { type: "task.completed", taskId: streamInput.task.taskId };
        return;
      }
      yield { type: "task.output", taskId: streamInput.task.taskId, text: "should be dropped" };
      yield { type: "task.completed", taskId: streamInput.task.taskId };
    },
    async stop(stopInput) {
      flags.trace.push(`stop:${stopInput.runtime.runtimeId}:${stopInput.reason ?? ""}`);
    },
  };

  const submitRecord = taskSubmitRecord({
    id: "cmd-race-submit",
    sessionId: "session-race",
    adapterId: "opencode",
    taskId: "task-x",
    prompt: "race me",
  });
  const cancelRecord = sessionCancelRecord({
    id: "cmd-race-cancel",
    sessionId: "session-race",
    adapterId: "opencode",
    reason: "race_cancel",
  });

  const submitFake = createFakeFetch({ hostId: "host-1", commands: [submitRecord] });
  const cancelFake = createFakeFetch({ hostId: "host-1", commands: [cancelRecord] });
  const state = createHostClientRuntimeState();

  const runningSubmit = runHostCommandOnce({
    relayBaseUrl: "https://relay.test",
    hostId: "host-1",
    deviceKey: "key",
    adapters: { opencode: adapter },
    fetch: submitFake.fetch,
    runtimeState: state,
  });
  await taskStarted;

  // Snapshot stopRequested before cancel:
  const slotBefore = state.getActive("session-race");
  assert.ok(slotBefore, "slot present after submit started");
  assert.equal(slotBefore?.stopRequested, false);

  const cancelled = await runHostCommandOnce({
    relayBaseUrl: "https://relay.test",
    hostId: "host-1",
    deviceKey: "key",
    adapters: { opencode: adapter },
    fetch: cancelFake.fetch,
    runtimeState: state,
  });
  assert.equal(cancelled, 1);

  const processedSubmit = await runningSubmit;
  assert.equal(processedSubmit, 1);

  // The submit POSTed exactly one task.cancelled and zero task.completed.
  assert.equal(submitFake.posts.length, 1, `submit posts: ${submitFake.posts.length}`);
  const submitTypes = submitFake.posts[0].events.map((event) => event.type);
  const cancelledCount = submitTypes.filter((type) => type === "task.cancelled").length;
  const completedCount = submitTypes.filter((type) => type === "task.completed").length;
  assert.equal(cancelledCount, 1, `expected exactly one task.cancelled, got ${submitTypes.join(",")}`);
  assert.equal(completedCount, 0, `expected zero task.completed after cancel, got ${submitTypes.join(",")}`);

  // The cancel poll itself posted an empty event ack.
  assert.equal(cancelFake.posts.length, 1);
  assert.equal(cancelFake.posts[0].events.length, 0);

  // Table is clean after both runs.
  assert.equal(state.size(), 0);
});

test("SessionProcessTable survives across poll ticks — second cancel for same session is a clean no-op", async () => {
  const flags: ConcurrentAdapterFlags = {
    taskStarted: new Map(),
    releaseStream: new Map(),
    trace: [],
  };
  const taskStarted = new Promise<void>((resolve) => flags.taskStarted.set("task-survive", resolve));

  const adapter: AgentAdapter = {
    async detect() {
      throw new Error("not used");
    },
    async start(startInput) {
      return { adapterId: startInput.adapterId, runtimeId: "survive:1", status: "running" };
    },
    async submitTask(taskInput) {
      flags.taskStarted.get(taskInput.taskId ?? "")!();
      await new Promise<void>((resolve) => {
        if (taskInput.signal?.aborted) {
          resolve();
          return;
        }
        taskInput.signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      return {
        adapterId: taskInput.runtime.adapterId,
        runtimeId: taskInput.runtime.runtimeId,
        taskId: taskInput.taskId ?? "task",
        status: "cancelled",
      };
    },
    async *streamEvents(streamInput) {
      if (streamInput.signal?.aborted) {
        return;
      }
      yield { type: "task.output", taskId: streamInput.task.taskId, text: "not seen" };
    },
    async stop() {},
  };

  const submitRecord = taskSubmitRecord({
    id: "cmd-survive-submit",
    sessionId: "session-survive",
    adapterId: "opencode",
    taskId: "task-survive",
    prompt: "survive",
  });
  const cancelOne = sessionCancelRecord({
    id: "cmd-survive-cancel-1",
    sessionId: "session-survive",
    adapterId: "opencode",
  });
  const cancelTwo = sessionCancelRecord({
    id: "cmd-survive-cancel-2",
    sessionId: "session-survive",
    adapterId: "opencode",
  });

  const submitFake = createFakeFetch({ hostId: "host-1", commands: [submitRecord] });
  const firstCancelFake = createFakeFetch({ hostId: "host-1", commands: [cancelOne] });
  const secondCancelFake = createFakeFetch({ hostId: "host-1", commands: [cancelTwo] });

  const state = createHostClientRuntimeState();

  const running = runHostCommandOnce({
    relayBaseUrl: "https://relay.test",
    hostId: "host-1",
    deviceKey: "key",
    adapters: { opencode: adapter },
    fetch: submitFake.fetch,
    runtimeState: state,
  });
  await taskStarted;

  // First poll tick: deliver the cancel — sane path.
  await runHostCommandOnce({
    relayBaseUrl: "https://relay.test",
    hostId: "host-1",
    deviceKey: "key",
    adapters: { opencode: adapter },
    fetch: firstCancelFake.fetch,
    runtimeState: state,
  });

  await running;
  assert.equal(state.size(), 0, "table cleared after submit finally");

  // Second poll tick (a duplicate cancel arrives after the table cleared) —
  // must route through SessionProcessTable.cancel cleanly. The table being
  // shared across ticks is exactly what makes this safe.
  await runHostCommandOnce({
    relayBaseUrl: "https://relay.test",
    hostId: "host-1",
    deviceKey: "key",
    adapters: { opencode: adapter },
    fetch: secondCancelFake.fetch,
    runtimeState: state,
  });

  // The duplicate cancel still produced an ack POST (empty events).
  assert.equal(secondCancelFake.posts.length, 1);
  assert.equal(secondCancelFake.posts[0].events.length, 0);
  // Table is empty (was empty before the duplicate; still empty after).
  assert.equal(state.size(), 0);
});

test("D.6: late task.completed arriving after cancel is dropped, never posted to relay", async () => {
  // Adapter that emits exactly one `task.completed` AFTER its signal is
  // aborted, simulating a generator that had a terminal event in-flight
  // when the cancel won the race.
  let cancelObserved!: () => void;
  const cancelSeen = new Promise<void>((resolve) => {
    cancelObserved = resolve;
  });

  const adapter: AgentAdapter = {
    async detect() {
      throw new Error("not used");
    },
    async start(startInput) {
      return { adapterId: startInput.adapterId, runtimeId: "d6-late:1", status: "running" };
    },
    async submitTask(taskInput) {
      return {
        adapterId: taskInput.runtime.adapterId,
        runtimeId: taskInput.runtime.runtimeId,
        taskId: taskInput.taskId ?? "task-d6",
        status: "running",
      };
    },
    async *streamEvents(streamInput) {
      yield { type: "task.accepted", taskId: streamInput.task.taskId };
      // Wait for the cancel to land before yielding the late terminal event.
      await new Promise<void>((resolve) => {
        if (streamInput.signal?.aborted) {
          resolve();
          return;
        }
        streamInput.signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      cancelObserved();
      // The adversarial bit: emit task.completed AFTER abort. The D.6
      // guard must drop this so the cancel isn't overwritten downstream.
      yield { type: "task.completed", taskId: streamInput.task.taskId };
    },
    async stop() {},
  };

  const submitRecord = taskSubmitRecord({
    id: "cmd-d6-submit",
    sessionId: "session-d6",
    adapterId: "opencode",
    taskId: "task-d6",
    prompt: "race the cancel",
  });
  const cancelRecord = sessionCancelRecord({
    id: "cmd-d6-cancel",
    sessionId: "session-d6",
    adapterId: "opencode",
    reason: "d6_race_cancel",
  });

  const submitFake = createFakeFetch({ hostId: "host-1", commands: [submitRecord] });
  const cancelFake = createFakeFetch({ hostId: "host-1", commands: [cancelRecord] });
  const state = createHostClientRuntimeState();

  const submitDone = runHostCommandOnce({
    relayBaseUrl: "https://relay.test",
    hostId: "host-1",
    deviceKey: "key",
    adapters: { opencode: adapter },
    fetch: submitFake.fetch,
    runtimeState: state,
  });

  // Wait until the slot is registered so the cancel race is deterministic.
  await new Promise<void>((resolve) => {
    const check = () => {
      if (state.getActive("session-d6")) {
        resolve();
        return;
      }
      setImmediate(check);
    };
    check();
  });

  await runHostCommandOnce({
    relayBaseUrl: "https://relay.test",
    hostId: "host-1",
    deviceKey: "key",
    adapters: { opencode: adapter },
    fetch: cancelFake.fetch,
    runtimeState: state,
  });
  await cancelSeen;
  await submitDone;

  assert.equal(submitFake.posts.length, 1);
  const types = submitFake.posts[0].events.map((event) => event.type);
  assert.equal(
    types.filter((type) => type === "task.completed").length,
    0,
    `task.completed must be dropped after cancel, got events: ${types.join(",")}`,
  );
  assert.equal(
    types.filter((type) => type === "task.cancelled").length,
    1,
    `expected exactly one task.cancelled, got events: ${types.join(",")}`,
  );
});

test("host client accepts a ProviderRegistry instead of a Record<string, AgentAdapter>", async () => {
  const flags: ConcurrentAdapterFlags = { gates: new Map(), trace: [] };
  const gate = createTaskGate();
  // Pre-release so the stream proceeds immediately.
  gate.release();
  flags.gates.set("task-registry", gate);
  const adapter = concurrentAdapter(flags, "registry-driven:1");

  const registry = new ProviderRegistry([
    { id: "opencode", factory: () => adapter },
  ]);

  const submitRecord = taskSubmitRecord({
    id: "cmd-registry",
    sessionId: "session-registry",
    adapterId: "opencode",
    taskId: "task-registry",
    prompt: "registry path",
  });
  const fake = createFakeFetch({ hostId: "host-1", commands: [submitRecord] });
  const state = createHostClientRuntimeState();

  const processed = await runHostCommandOnce({
    relayBaseUrl: "https://relay.test",
    hostId: "host-1",
    deviceKey: "key",
    providerRegistry: registry,
    fetch: fake.fetch,
    runtimeState: state,
  });
  assert.equal(processed, 1);
  assert.equal(state.size(), 0);
  assert.equal(fake.posts.length, 1);
  const types = fake.posts[0].events.map((event) => event.type);
  assert.ok(types.includes("task.completed"), `events: ${types.join(",")}`);
});
