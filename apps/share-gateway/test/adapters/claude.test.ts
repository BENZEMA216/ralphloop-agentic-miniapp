import assert from "node:assert/strict";
import { test } from "node:test";

import { ClaudeCodeAdapter } from "../../src/adapters/claude.ts";
import type { CommandRunner } from "../../src/adapters/claude.ts";

function commandRunner(
  handler: (
    command: string,
    args: string[],
    options?: { cwd?: string; timeoutMs?: number; signal?: AbortSignal },
  ) => { code: number; stdout: string; stderr: string },
): CommandRunner {
  return async (command, args, options) => handler(command, args, options);
}

test("detect reads Claude Code version", async () => {
  const adapter = new ClaudeCodeAdapter({
    commandRunner: commandRunner((command, args) => {
      assert.equal(command, "claude");
      assert.deepEqual(args, ["--version"]);
      return { code: 0, stdout: "2.1.145 (Claude Code)\n", stderr: "" };
    }),
  });

  const info = await adapter.detect();

  assert.equal(info.id, "claude-code");
  assert.equal(info.displayName, "Claude Code");
  assert.equal(info.status, "available");
  assert.equal(info.version, "2.1.145 (Claude Code)");
  assert.equal(info.startCapability, "process");
  assert.equal(info.taskCapability, "cli_once");
  assert.equal(info.eventCapability, "stream_json");
  assert.equal(info.desktopPreviewCapability, "none");
});

test("detect reports not_configured when Claude Code returns non-zero for version", async () => {
  const adapter = new ClaudeCodeAdapter({
    commandRunner: commandRunner(() => ({ code: 1, stdout: "", stderr: "missing auth" })),
  });

  const info = await adapter.detect();

  assert.equal(info.status, "not_configured");
});

test("detect reports not_installed when Claude Code is missing", async () => {
  const adapter = new ClaudeCodeAdapter({
    commandRunner: async () => {
      const error = new Error("claude missing");
      Object.assign(error, { code: "ENOENT" });
      throw error;
    },
  });

  const info = await adapter.detect();

  assert.equal(info.status, "not_installed");
});

test("submitTask uses claude print mode with conservative permissions", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const adapter = new ClaudeCodeAdapter({
    permissionMode: "default",
    allowedTools: ["Bash(ls:*)"],
    disallowedTools: ["Edit"],
    commandRunner: commandRunner((command, args) => {
      calls.push({ command, args });
      return {
        code: 0,
        stdout: [
          JSON.stringify({
            type: "assistant",
            message: { content: [{ type: "text", text: "hello from claude" }] },
          }),
          JSON.stringify({ type: "result", subtype: "success" }),
        ].join("\n"),
        stderr: "",
      };
    }),
  });

  const task = await adapter.submitTask({
    runtime: {
      adapterId: "claude-code",
      runtimeId: "claude-code:print",
      status: "running",
    },
    prompt: "Say hello",
    taskId: "task-1",
  });

  assert.deepEqual(calls, [
    {
      command: "claude",
      args: [
        "--bare",
        "-p",
        "Say hello",
        "--output-format",
        "stream-json",
        "--permission-mode",
        "default",
        "--allowedTools",
        "Bash(ls:*)",
        "--disallowedTools",
        "Edit",
      ],
    },
  ]);
  assert.equal(task.adapterId, "claude-code");
  assert.equal(task.runtimeId, "claude-code:print");
  assert.equal(task.taskId, "task-1");
  assert.equal(task.status, "completed");
});

test("submitTask never enables dangerous skip permissions by default", async () => {
  let commandArgs: string[] = [];
  const adapter = new ClaudeCodeAdapter({
    commandRunner: commandRunner((_command, args) => {
      commandArgs = args;
      return { code: 0, stdout: JSON.stringify({ type: "result", subtype: "success" }), stderr: "" };
    }),
  });

  await adapter.submitTask({
    runtime: {
      adapterId: "claude-code",
      runtimeId: "claude-code:print",
      status: "running",
    },
    prompt: "No danger",
  });

  assert.equal(commandArgs.includes("--dangerously-skip-permissions"), false);
});

test("submitTask passes cancellation signal to the Claude command runner", async () => {
  const controller = new AbortController();
  let receivedSignal: AbortSignal | undefined;
  const adapter = new ClaudeCodeAdapter({
    commandRunner: commandRunner((_command, _args, options) => {
      receivedSignal = options?.signal;
      return { code: 0, stdout: JSON.stringify({ type: "result", subtype: "success" }), stderr: "" };
    }),
  });

  await adapter.submitTask({
    runtime: {
      adapterId: "claude-code",
      runtimeId: "claude-code:print",
      status: "running",
    },
    prompt: "Cancelable",
    taskId: "task-cancel-signal",
    signal: controller.signal,
  });

  assert.equal(receivedSignal, controller.signal);
});

test("streamEvents maps Claude stream-json output into runtime events", async () => {
  const adapter = new ClaudeCodeAdapter({
    commandRunner: commandRunner(() => ({
      code: 0,
      stdout: [
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "first line" }] },
        }),
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "second line" }] },
        }),
        JSON.stringify({ type: "result", subtype: "success" }),
      ].join("\n"),
      stderr: "",
    })),
  });
  const task = await adapter.submitTask({
    runtime: {
      adapterId: "claude-code",
      runtimeId: "claude-code:print",
      status: "running",
    },
    prompt: "Summarize",
    taskId: "task-2",
  });

  const events = [];
  for await (const event of adapter.streamEvents({
    runtime: {
      adapterId: "claude-code",
      runtimeId: "claude-code:print",
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

test("streamEvents maps failed Claude execution into task.failed", async () => {
  const adapter = new ClaudeCodeAdapter({
    commandRunner: commandRunner(() => ({
      code: 1,
      stdout: JSON.stringify({ type: "result", subtype: "error", result: "rate limited" }),
      stderr: "rate limited",
    })),
  });
  const task = await adapter.submitTask({
    runtime: {
      adapterId: "claude-code",
      runtimeId: "claude-code:print",
      status: "running",
    },
    prompt: "Fail",
    taskId: "task-3",
  });

  const events = [];
  for await (const event of adapter.streamEvents({
    runtime: {
      adapterId: "claude-code",
      runtimeId: "claude-code:print",
      status: "running",
    },
    task,
  })) {
    events.push(event);
  }

  assert.deepEqual(events, [
    { type: "task.accepted", taskId: "task-3" },
    { type: "task.failed", taskId: "task-3", message: "rate limited" },
  ]);
});
