import assert from "node:assert/strict";
import { test } from "node:test";

import type { AgentAdapter } from "../../src/adapters/types.ts";
import { buildHostCommand } from "../../src/productization/hostCommands.ts";
import { HostRuntimeRegistry } from "../../src/productization/hostRuntime.ts";
import type { SharePolicyRecord } from "../../src/productization/types.ts";

function adapter(id: string): AgentAdapter {
  return {
    async detect() {
      throw new Error(`${id} detect not used`);
    },
    async start() {
      throw new Error(`${id} start not used`);
    },
    async submitTask() {
      throw new Error(`${id} submit not used`);
    },
    async *streamEvents() {},
    async stop() {},
  };
}

test("connected host adapters are addressable by host and adapter id", () => {
  const registry = new HostRuntimeRegistry();
  const opencode = adapter("opencode");

  registry.connectHost({
    hostId: "host-1",
    adapters: { opencode },
  });

  assert.equal(registry.hasHost("host-1"), true);
  assert.equal(registry.findAdapter("host-1", "opencode"), opencode);
  assert.equal(registry.findAdapter("host-1", "codex"), undefined);
});

test("disconnect removes access to host adapters", () => {
  const registry = new HostRuntimeRegistry();
  registry.connectHost({
    hostId: "host-1",
    adapters: { opencode: adapter("opencode") },
  });

  registry.disconnectHost("host-1");

  assert.equal(registry.hasHost("host-1"), false);
  assert.equal(registry.findAdapter("host-1", "opencode"), undefined);
});

function policy(): SharePolicyRecord {
  return {
    maxTotalBudget: 20,
    maxTaskBudget: 2,
    maxConcurrentSessions: 1,
    allowedAdapterIds: ["opencode"],
    previewMode: "read_only",
    permissionMode: "user_identity",
    highRiskActionMode: "owner_approve",
    blockedActions: ["destructive_shell"],
    approvalRequiredActions: ["send_message"],
    allowedDomains: [],
    maxRequestsPerMinute: 30,
    sessionTtlMs: 30 * 60 * 1000,
  };
}

test("startRuntime and submitTask enforce host command bindings", async () => {
  const registry = new HostRuntimeRegistry();
  const calls: string[] = [];
  const opencode: AgentAdapter = {
    async detect() {
      throw new Error("detect not used");
    },
    async start(input) {
      calls.push(`start:${input.adapterId}`);
      return {
        adapterId: input.adapterId,
        runtimeId: "runtime-1",
        status: "running",
      };
    },
    async submitTask(input) {
      calls.push(`submit:${input.taskId}:${input.prompt}`);
      return {
        adapterId: input.runtime.adapterId,
        runtimeId: input.runtime.runtimeId,
        taskId: input.taskId ?? "task-1",
        status: "completed",
      };
    },
    async *streamEvents() {},
    async stop() {},
  };

  registry.connectHost({
    hostId: "host-1",
    adapters: { opencode },
  });

  const expected = {
    ownerId: "owner-1",
    hostId: "host-1",
    shareLinkId: "link-1",
    sessionId: "session-1",
    policy: policy(),
  };

  const started = await registry.startRuntime({
    command: buildHostCommand({
      commandType: "runtime.start",
      ownerId: expected.ownerId,
      hostId: expected.hostId,
      shareLinkId: expected.shareLinkId,
      sessionId: expected.sessionId,
      adapterId: "opencode",
      policy: expected.policy,
      issuedAt: "2026-05-21T00:00:00.000Z",
    }),
    expected,
  });

  assert.equal(started.runtime.runtimeId, "runtime-1");

  const taskHandle = await registry.submitTask({
    command: buildHostCommand({
      commandType: "task.submit",
      ownerId: expected.ownerId,
      hostId: expected.hostId,
      shareLinkId: expected.shareLinkId,
      sessionId: expected.sessionId,
      adapterId: "opencode",
      taskId: "task-1",
      prompt: "hello",
      policy: expected.policy,
      issuedAt: "2026-05-21T00:00:00.000Z",
    }),
    expected,
    runtime: started.runtime,
  });

  assert.equal(taskHandle.status, "completed");
  assert.deepEqual(calls, ["start:opencode", "submit:task-1:hello"]);
});

test("host runtime rejects mismatched command expectations", async () => {
  const registry = new HostRuntimeRegistry();
  registry.connectHost({
    hostId: "host-1",
    adapters: { opencode: adapter("opencode") },
  });

  const command = buildHostCommand({
    commandType: "runtime.start",
    ownerId: "owner-1",
    hostId: "host-1",
    shareLinkId: "link-1",
    sessionId: "session-1",
    adapterId: "opencode",
    policy: policy(),
    issuedAt: "2026-05-21T00:00:00.000Z",
  });

  await assert.rejects(
    () =>
      registry.startRuntime({
        command,
        expected: {
          ownerId: "owner-1",
          hostId: "host-2",
          shareLinkId: "link-1",
          sessionId: "session-1",
          policy: policy(),
        },
      }),
    (error) => error instanceof Error && error.message === "host_command_binding_invalid",
  );
});

test("submitTask rejects when runtime adapter mismatches the command adapter", async () => {
  const registry = new HostRuntimeRegistry();
  registry.connectHost({
    hostId: "host-1",
    adapters: { opencode: adapter("opencode") },
  });

  const expected = {
    ownerId: "owner-1",
    hostId: "host-1",
    shareLinkId: "link-1",
    sessionId: "session-1",
    policy: policy(),
  };

  const command = buildHostCommand({
    commandType: "task.submit",
    ownerId: expected.ownerId,
    hostId: expected.hostId,
    shareLinkId: expected.shareLinkId,
    sessionId: expected.sessionId,
    adapterId: "opencode",
    taskId: "task-1",
    prompt: "hello",
    policy: expected.policy,
    issuedAt: "2026-05-21T00:00:00.000Z",
  });

  await assert.rejects(
    () =>
      registry.submitTask({
        command,
        expected,
        runtime: { adapterId: "codex", runtimeId: "runtime-1", status: "running" },
      }),
    (error) => error instanceof Error && error.message === "host_command_binding_invalid",
  );
});

test("stopRuntime stops a previously started runtime and removes it from the registry", async () => {
  const registry = new HostRuntimeRegistry();
  const calls: string[] = [];
  const opencode: AgentAdapter = {
    async detect() {
      throw new Error("detect not used");
    },
    async start(input) {
      calls.push(`start:${input.adapterId}`);
      return {
        adapterId: input.adapterId,
        runtimeId: "runtime-1",
        status: "running",
      };
    },
    async submitTask() {
      throw new Error("submit not used");
    },
    async *streamEvents() {},
    async stop(input) {
      calls.push(`stop:${input.runtime.runtimeId}:${input.reason ?? ""}`);
    },
  };

  registry.connectHost({
    hostId: "host-1",
    adapters: { opencode },
  });

  const expected = {
    ownerId: "owner-1",
    hostId: "host-1",
    shareLinkId: "link-1",
    sessionId: "session-1",
    policy: policy(),
  };

  const started = await registry.startRuntime({
    command: buildHostCommand({
      commandType: "runtime.start",
      ownerId: expected.ownerId,
      hostId: expected.hostId,
      shareLinkId: expected.shareLinkId,
      sessionId: expected.sessionId,
      adapterId: "opencode",
      policy: expected.policy,
      issuedAt: "2026-05-21T00:00:00.000Z",
    }),
    expected,
  });

  await registry.stopRuntime({
    command: buildHostCommand({
      commandType: "runtime.stop",
      ownerId: expected.ownerId,
      hostId: expected.hostId,
      shareLinkId: expected.shareLinkId,
      sessionId: expected.sessionId,
      adapterId: "opencode",
      runtimeId: started.runtime.runtimeId,
      reason: "owner_cancelled",
      policy: expected.policy,
      issuedAt: "2026-05-21T00:00:00.000Z",
    }),
    expected,
  });

  assert.deepEqual(calls, ["start:opencode", "stop:runtime-1:owner_cancelled"]);

  await assert.rejects(
    () =>
      registry.stopRuntime({
        command: buildHostCommand({
          commandType: "runtime.stop",
          ownerId: expected.ownerId,
          hostId: expected.hostId,
          shareLinkId: expected.shareLinkId,
          sessionId: expected.sessionId,
          adapterId: "opencode",
          runtimeId: started.runtime.runtimeId,
          reason: "owner_cancelled",
          policy: expected.policy,
          issuedAt: "2026-05-21T00:00:00.000Z",
        }),
        expected,
      }),
    (error) => error instanceof Error && error.message === "runtime_not_found",
  );
});
