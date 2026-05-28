import assert from "node:assert/strict";
import { test } from "node:test";

import { ClaudeCodeAdapter } from "../../src/adapters/claude.ts";
import type { CommandRunner as ClaudeCommandRunner } from "../../src/adapters/claude.ts";
import { CodexAdapter } from "../../src/adapters/codex.ts";
import type { CommandRunner as CodexCommandRunner } from "../../src/adapters/codex.ts";
import { OpenCodeAdapter } from "../../src/adapters/opencode.ts";
import type {
  CommandRunner as OpenCodeCommandRunner,
  ProcessHandle,
  ProcessRunner,
} from "../../src/adapters/opencode.ts";
import {
  assertProviderContract,
  ProviderContractError,
  toCapabilityDescriptor,
  type ProviderAdapter,
} from "../../src/adapters/provider.ts";
import type {
  RuntimeEvent,
  RuntimeHandle,
  TaskHandle,
} from "../../src/adapters/types.ts";

type ContractFactory = () => {
  adapter: ProviderAdapter;
  cleanup?: () => Promise<void> | void;
};

/**
 * Reusable contract spec — every `ProviderAdapter` must pass these assertions.
 * Keeps adapter-specific test files focused on adapter quirks; consistency
 * comes from one place.
 */
export function runProviderContract(input: {
  name: string;
  factory: ContractFactory;
}): void {
  const { name, factory } = input;

  test(`${name}: assertProviderContract accepts the adapter`, () => {
    const { adapter } = factory();
    assertProviderContract(adapter);
  });

  test(`${name}: detect() returns well-formed AgentAdapterInfo`, async () => {
    const { adapter } = factory();
    const info = await adapter.detect();
    assert.equal(typeof info.id, "string");
    assert.ok(info.id.length > 0, "id should be non-empty");
    assert.equal(typeof info.displayName, "string");
    assert.ok(info.displayName.length > 0, "displayName should be non-empty");
    assert.ok(
      ["available", "not_installed", "not_configured", "unsupported"].includes(info.status),
      `unexpected status ${info.status}`,
    );
    assert.ok(typeof info.startCapability === "string");
    assert.ok(typeof info.taskCapability === "string");
    assert.ok(typeof info.eventCapability === "string");
    assert.ok(typeof info.desktopPreviewCapability === "string");

    // Capability descriptor narrowing must succeed.
    const descriptor = toCapabilityDescriptor(info);
    assert.equal(descriptor.id, info.id);
    assert.equal(descriptor.displayName, info.displayName);
  });

  test(`${name}: start() returns a running RuntimeHandle`, async () => {
    const { adapter } = factory();
    const handle = await adapter.start({ adapterId: name });
    assert.equal(handle.status, "running", "fresh runtime should be 'running'");
    assert.equal(typeof handle.runtimeId, "string");
    assert.ok(handle.runtimeId.length > 0, "runtimeId should be non-empty");
    assert.equal(typeof handle.adapterId, "string");
  });

  test(`${name}: submitTask() honors an already-aborted AbortSignal`, async () => {
    const { adapter } = factory();
    const runtime = await adapter.start({ adapterId: name });
    const controller = new AbortController();
    controller.abort();
    const task = await adapter.submitTask({
      runtime,
      prompt: "contract-abort-pre",
      taskId: `${name}-contract-abort`,
      signal: controller.signal,
    });
    assert.equal(typeof task.taskId, "string");
    assert.ok(
      ["accepted", "running", "completed", "failed", "cancelled"].includes(task.status),
      `unexpected task status ${task.status}`,
    );
  });

  test(`${name}: streamEvents() emits task.accepted first and task.completed last on success`, async () => {
    const { adapter } = factory();
    const runtime = await adapter.start({ adapterId: name });
    const task = await adapter.submitTask({
      runtime,
      prompt: "contract-success",
      taskId: `${name}-contract-success`,
    });

    const events: RuntimeEvent[] = [];
    for await (const event of adapter.streamEvents({ runtime, task })) {
      events.push(event);
    }

    assert.ok(events.length >= 2, "expected at least accepted + completed");
    assert.equal(events[0]?.type, "task.accepted");
    assert.equal(events[events.length - 1]?.type, "task.completed");
  });

  test(`${name}: stop() is idempotent`, async () => {
    const { adapter, cleanup } = factory();
    const runtime = await adapter.start({ adapterId: name });
    await adapter.stop({ runtime });
    // Second call must not throw.
    await adapter.stop({ runtime });
    if (cleanup) {
      await cleanup();
    }
  });
}

// ---------- assertProviderContract direct unit tests ----------

test("assertProviderContract throws ProviderContractError when methods are missing", () => {
  assert.throws(() => assertProviderContract({}), (error) => {
    assert.ok(error instanceof ProviderContractError);
    assert.deepEqual(error.missing, ["detect", "start", "submitTask", "streamEvents", "stop"]);
    return true;
  });
});

test("assertProviderContract throws when the argument is not an object", () => {
  assert.throws(() => assertProviderContract(null), (error) => {
    assert.ok(error instanceof ProviderContractError);
    return true;
  });
  assert.throws(() => assertProviderContract("not-an-adapter"), (error) => {
    assert.ok(error instanceof ProviderContractError);
    return true;
  });
});

test("assertProviderContract accepts a structurally complete adapter", () => {
  const adapter: ProviderAdapter = {
    async detect() {
      return {
        id: "stub",
        displayName: "Stub",
        status: "available",
        startCapability: "none",
        taskCapability: "cli_once",
        eventCapability: "stdout_text",
        desktopPreviewCapability: "none",
      };
    },
    async start(): Promise<RuntimeHandle> {
      return { adapterId: "stub", runtimeId: "stub:1", status: "running" };
    },
    async submitTask(): Promise<TaskHandle> {
      return { adapterId: "stub", runtimeId: "stub:1", taskId: "t", status: "completed" };
    },
    async *streamEvents(): AsyncIterable<RuntimeEvent> {
      yield { type: "task.accepted", taskId: "t" };
      yield { type: "task.completed", taskId: "t" };
    },
    async stop() {},
  };

  assertProviderContract(adapter);
});

// ---------- Adapter factories (deterministic command runners) ----------

function codexRunner(): CodexCommandRunner {
  return async (command, args) => {
    if (command === "codex" && args[0] === "--version") {
      return { code: 0, stdout: "codex-cli 0.130.0\n", stderr: "" };
    }
    if (command === "codex" && args[0] === "exec") {
      return {
        code: 0,
        stdout: [
          JSON.stringify({ type: "item.completed", item: { text: "codex-contract-output" } }),
          JSON.stringify({ type: "turn.completed" }),
        ].join("\n"),
        stderr: "",
      };
    }
    return { code: 1, stdout: "", stderr: `unexpected: ${command} ${args.join(" ")}` };
  };
}

function claudeRunner(): ClaudeCommandRunner {
  return async (command, args) => {
    if (command === "claude" && args[0] === "--version") {
      return { code: 0, stdout: "2.1.145 (Claude Code)\n", stderr: "" };
    }
    if (command === "claude") {
      return {
        code: 0,
        stdout: [
          JSON.stringify({
            type: "assistant",
            message: { content: [{ type: "text", text: "claude-contract-output" }] },
          }),
          JSON.stringify({ type: "result", subtype: "success" }),
        ].join("\n"),
        stderr: "",
      };
    }
    return { code: 1, stdout: "", stderr: `unexpected: ${command} ${args.join(" ")}` };
  };
}

function openCodeRunner(): OpenCodeCommandRunner {
  return async (command, args) => {
    if (command === "opencode" && args[0] === "--version") {
      return { code: 0, stdout: "1.2.27\n", stderr: "" };
    }
    if (command === "opencode" && args[0] === "run") {
      return {
        code: 0,
        stdout: JSON.stringify({ type: "message", text: "opencode-contract-output" }) + "\n",
        stderr: "",
      };
    }
    return { code: 1, stdout: "", stderr: `unexpected: ${command} ${args.join(" ")}` };
  };
}

function openCodeProcessRunner(handles: ProcessHandle[]): ProcessRunner {
  return () => {
    const handle: ProcessHandle = {
      pid: 4242,
      killed: false,
      kill() {
        this.killed = true;
        return true;
      },
    };
    handles.push(handle);
    return handle;
  };
}

// ---------- Wire the spec to the three real adapters ----------

runProviderContract({
  name: "codex",
  factory: () => ({
    adapter: new CodexAdapter({ commandRunner: codexRunner() }),
  }),
});

runProviderContract({
  name: "claude-code",
  factory: () => ({
    adapter: new ClaudeCodeAdapter({ commandRunner: claudeRunner() }),
  }),
});

runProviderContract({
  name: "opencode",
  factory: () => {
    const handles: ProcessHandle[] = [];
    return {
      adapter: new OpenCodeAdapter({
        commandRunner: openCodeRunner(),
        processRunner: openCodeProcessRunner(handles),
      }),
    };
  },
});
