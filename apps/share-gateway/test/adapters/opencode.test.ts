import assert from "node:assert/strict";
import { test } from "node:test";

import { OpenCodeAdapter } from "../../src/adapters/opencode.ts";
import type { CommandRunner, ProcessHandle, ProcessRunner } from "../../src/adapters/opencode.ts";

function commandRunner(output: Record<string, string>): CommandRunner {
  return async (command, args) => {
    const key = [command, ...args].join(" ");
    if (Object.hasOwn(output, key)) {
      return { code: 0, stdout: output[key], stderr: "" };
    }
    return { code: 1, stdout: "", stderr: `unexpected command: ${key}` };
  };
}

function processRunner(calls: Array<{ command: string; args: string[] }>): ProcessRunner {
  return (command, args): ProcessHandle => {
    calls.push({ command, args });
    return {
      pid: 4242,
      killed: false,
      kill() {
        this.killed = true;
        return true;
      },
    };
  };
}

test("detect reads opencode version", async () => {
  const adapter = new OpenCodeAdapter({
    commandRunner: commandRunner({ "opencode --version": "1.2.27\n" }),
  });

  const info = await adapter.detect();

  assert.equal(info.id, "opencode");
  assert.equal(info.displayName, "OpenCode");
  assert.equal(info.status, "available");
  assert.equal(info.version, "1.2.27");
  assert.equal(info.startCapability, "server");
  assert.equal(info.taskCapability, "server_api");
  assert.equal(info.eventCapability, "http_events");
  assert.equal(info.desktopPreviewCapability, "web");
});

test("detect reports not_configured when opencode returns non-zero for version", async () => {
  const adapter = new OpenCodeAdapter({
    commandRunner: async () => ({ code: 1, stdout: "", stderr: "missing config" }),
  });

  const info = await adapter.detect();

  assert.equal(info.status, "not_configured");
});

test("detect reports not_installed when opencode is missing", async () => {
  const adapter = new OpenCodeAdapter({
    commandRunner: async () => {
      const error = new Error("opencode missing");
      Object.assign(error, { code: "ENOENT" });
      throw error;
    },
  });

  const info = await adapter.detect();

  assert.equal(info.status, "not_installed");
});

test("start runs opencode serve on localhost and returns a runtime handle", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const adapter = new OpenCodeAdapter({
    processRunner: processRunner(calls),
  });

  const runtime = await adapter.start({ adapterId: "opencode", port: 4096 });

  assert.deepEqual(calls, [
    {
      command: "opencode",
      args: ["serve", "--hostname", "127.0.0.1", "--port", "4096"],
    },
  ]);
  assert.equal(runtime.adapterId, "opencode");
  assert.equal(runtime.runtimeId, "opencode:4096");
  assert.equal(runtime.status, "running");
  assert.equal(runtime.endpoint, "http://127.0.0.1:4096");
  assert.equal(runtime.pid, 4242);
});

test("submitTask uses opencode run attached to the runtime endpoint", async () => {
  const calls: Array<{ command: string; args: string[]; timeoutMs?: number; signal?: AbortSignal }> = [];
  const controller = new AbortController();
  const adapter = new OpenCodeAdapter({
    commandRunner: async (command, args, options) => {
      calls.push({ command, args, timeoutMs: options?.timeoutMs, signal: options?.signal });
      return { code: 0, stdout: '{"type":"message","text":"done"}\n', stderr: "" };
    },
  });

  const task = await adapter.submitTask({
    runtime: {
      adapterId: "opencode",
      runtimeId: "opencode:4096",
      status: "running",
      endpoint: "http://127.0.0.1:4096",
    },
    prompt: "Say hello",
    taskId: "task-1",
    signal: controller.signal,
  });

  assert.deepEqual(calls, [
    {
      command: "opencode",
      args: [
        "run",
        "--attach",
        "http://127.0.0.1:4096",
        "--format",
        "json",
        "Say hello",
      ],
      timeoutMs: 120_000,
      signal: controller.signal,
    },
  ]);
  assert.equal(task.adapterId, "opencode");
  assert.equal(task.runtimeId, "opencode:4096");
  assert.equal(task.taskId, "task-1");
  assert.equal(task.status, "completed");
});

test("streamEvents maps OpenCode JSON output into runtime events", async () => {
  const adapter = new OpenCodeAdapter({
    commandRunner: async () => ({
      code: 0,
      stdout: [
        JSON.stringify({ type: "message", text: "first line" }),
        JSON.stringify({ type: "assistant", message: { content: "second line" } }),
      ].join("\n"),
      stderr: "",
    }),
  });
  const runtime = {
    adapterId: "opencode",
    runtimeId: "opencode:4096",
    status: "running" as const,
    endpoint: "http://127.0.0.1:4096",
  };
  const task = await adapter.submitTask({
    runtime,
    prompt: "Summarize",
    taskId: "task-output",
  });

  const events = [];
  for await (const event of adapter.streamEvents({ runtime, task })) {
    events.push(event);
  }

  assert.deepEqual(events, [
    { type: "task.accepted", taskId: "task-output" },
    { type: "task.output", taskId: "task-output", text: "first line" },
    { type: "task.output", taskId: "task-output", text: "second line" },
    { type: "task.completed", taskId: "task-output" },
  ]);
});

test("streamEvents maps failed OpenCode execution into task.failed", async () => {
  const adapter = new OpenCodeAdapter({
    commandRunner: async () => ({
      code: 1,
      stdout: JSON.stringify({ type: "error", message: "model unavailable" }),
      stderr: "model unavailable",
    }),
  });
  const runtime = {
    adapterId: "opencode",
    runtimeId: "opencode:4096",
    status: "running" as const,
    endpoint: "http://127.0.0.1:4096",
  };
  const task = await adapter.submitTask({
    runtime,
    prompt: "Summarize",
    taskId: "task-failed",
  });

  const events = [];
  for await (const event of adapter.streamEvents({ runtime, task })) {
    events.push(event);
  }

  assert.deepEqual(events, [
    { type: "task.accepted", taskId: "task-failed" },
    { type: "task.failed", taskId: "task-failed", message: "model unavailable" },
  ]);
});

test("stop kills a started runtime process", async () => {
  let handle: ProcessHandle | undefined;
  const adapter = new OpenCodeAdapter({
    processRunner: () => {
      handle = {
        pid: 4242,
        killed: false,
        kill() {
          this.killed = true;
          return true;
        },
      };
      return handle;
    },
  });
  const runtime = await adapter.start({ adapterId: "opencode", port: 4096 });

  await adapter.stop({ runtime });

  assert.equal(handle?.killed, true);
});
