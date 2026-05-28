import assert from "node:assert/strict";
import { test } from "node:test";

import { CodexAdapter } from "../../src/adapters/codex.ts";
import type { CommandRunner } from "../../src/adapters/codex.ts";

function commandRunner(
  handler: (
    command: string,
    args: string[],
    options?: { cwd?: string; timeoutMs?: number; signal?: AbortSignal },
  ) => { code: number; stdout: string; stderr: string },
): CommandRunner {
  return async (command, args, options) => handler(command, args, options);
}

test("detect reads codex version", async () => {
  const adapter = new CodexAdapter({
    commandRunner: commandRunner((command, args) => {
      assert.equal(command, "codex");
      assert.deepEqual(args, ["--version"]);
      return { code: 0, stdout: "codex-cli 0.130.0\n", stderr: "" };
    }),
  });

  const info = await adapter.detect();

  assert.equal(info.id, "codex");
  assert.equal(info.displayName, "Codex");
  assert.equal(info.status, "available");
  assert.equal(info.version, "codex-cli 0.130.0");
  assert.equal(info.startCapability, "process");
  assert.equal(info.taskCapability, "cli_once");
  assert.equal(info.eventCapability, "jsonl");
  assert.equal(info.desktopPreviewCapability, "none");
});

test("detect reports not_configured when codex returns non-zero for version", async () => {
  const adapter = new CodexAdapter({
    commandRunner: commandRunner(() => ({ code: 1, stdout: "", stderr: "missing auth" })),
  });

  const info = await adapter.detect();

  assert.equal(info.status, "not_configured");
});

test("detect reports not_installed when codex is missing", async () => {
  const adapter = new CodexAdapter({
    commandRunner: async () => {
      const error = new Error("codex missing");
      Object.assign(error, { code: "ENOENT" });
      throw error;
    },
  });

  const info = await adapter.detect();

  assert.equal(info.status, "not_installed");
});

test("submitTask uses codex exec json in read-only sandbox", async () => {
  const calls: Array<{ command: string; args: string[]; timeoutMs?: number }> = [];
  const adapter = new CodexAdapter({
    commandRunner: commandRunner((command, args, options) => {
      calls.push({ command, args, timeoutMs: options?.timeoutMs });
      return {
        code: 0,
        stdout: [
          JSON.stringify({ type: "item.completed", item: { text: "hello from codex" } }),
          JSON.stringify({ type: "turn.completed" }),
        ].join("\n"),
        stderr: "",
      };
    }),
  });

  const task = await adapter.submitTask({
    runtime: {
      adapterId: "codex",
      runtimeId: "codex:exec",
      status: "running",
    },
    prompt: "Say hello",
    taskId: "task-1",
  });

  assert.deepEqual(calls, [
    {
      command: "codex",
      args: ["exec", "--json", "--sandbox", "read-only", "Say hello"],
      timeoutMs: 120_000,
    },
  ]);
  assert.equal(task.adapterId, "codex");
  assert.equal(task.runtimeId, "codex:exec");
  assert.equal(task.taskId, "task-1");
  assert.equal(task.status, "completed");
});

test("submitTask passes cancellation signal to the Codex command runner", async () => {
  const controller = new AbortController();
  let receivedSignal: AbortSignal | undefined;
  const adapter = new CodexAdapter({
    commandRunner: commandRunner((_command, _args, options) => {
      receivedSignal = options?.signal;
      return {
        code: 0,
        stdout: JSON.stringify({ type: "item.completed", item: { text: "done" } }),
        stderr: "",
      };
    }),
  });

  await adapter.submitTask({
    runtime: {
      adapterId: "codex",
      runtimeId: "codex:exec",
      status: "running",
    },
    prompt: "Cancelable",
    taskId: "task-cancel-signal",
    signal: controller.signal,
  });

  assert.equal(receivedSignal, controller.signal);
});

test("streamEvents maps Codex JSONL output into runtime events", async () => {
  const adapter = new CodexAdapter({
    commandRunner: commandRunner(() => ({
      code: 0,
      stdout: [
        JSON.stringify({ type: "turn.started" }),
        JSON.stringify({ type: "item.completed", item: { text: "first line" } }),
        JSON.stringify({ type: "item.completed", item: { message: { content: "second line" } } }),
        JSON.stringify({ type: "turn.completed" }),
      ].join("\n"),
      stderr: "",
    })),
  });
  const task = await adapter.submitTask({
    runtime: {
      adapterId: "codex",
      runtimeId: "codex:exec",
      status: "running",
    },
    prompt: "Summarize",
    taskId: "task-2",
  });

  const events = [];
  for await (const event of adapter.streamEvents({
    runtime: {
      adapterId: "codex",
      runtimeId: "codex:exec",
      status: "running",
    },
    task,
  })) {
    events.push(event);
  }

  assert.deepEqual(events, [
    { type: "task.accepted", taskId: "task-2" },
    { type: "task.output", taskId: "task-2", text: "first line" },
    { type: "task.output", taskId: "task-2", text: "second line" },
    { type: "task.completed", taskId: "task-2" },
  ]);
});

test("streamEvents maps failed Codex execution into task.failed", async () => {
  const adapter = new CodexAdapter({
    commandRunner: commandRunner(() => ({
      code: 2,
      stdout: JSON.stringify({ type: "error", message: "model unavailable" }),
      stderr: "model unavailable",
    })),
  });
  const task = await adapter.submitTask({
    runtime: {
      adapterId: "codex",
      runtimeId: "codex:exec",
      status: "running",
    },
    prompt: "Fail",
    taskId: "task-3",
  });

  const events = [];
  for await (const event of adapter.streamEvents({
    runtime: {
      adapterId: "codex",
      runtimeId: "codex:exec",
      status: "running",
    },
    task,
  })) {
    events.push(event);
  }

  assert.deepEqual(events, [
    { type: "task.accepted", taskId: "task-3" },
    { type: "task.failed", taskId: "task-3", message: "model unavailable" },
  ]);
});
