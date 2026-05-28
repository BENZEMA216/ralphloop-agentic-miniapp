import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createDevAdapterMap,
  supportedDevAdapterIds,
} from "../../src/productization/devRuntime.ts";

test("supportedDevAdapterIds filters available adapters and keeps stable ids", () => {
  const ids = supportedDevAdapterIds([
    {
      id: "opencode",
      displayName: "OpenCode",
      status: "available",
      version: "1.2.3",
      startCapability: "server",
      taskCapability: "server_api",
      eventCapability: "http_events",
      desktopPreviewCapability: "web",
    },
    {
      id: "hermes",
      displayName: "Hermes",
      status: "not_installed",
      startCapability: "process",
      taskCapability: "cli_once",
      eventCapability: "stdout_text",
      desktopPreviewCapability: "none",
    },
    {
      id: "codex",
      displayName: "Codex",
      status: "available",
      startCapability: "process",
      taskCapability: "cli_once",
      eventCapability: "jsonl",
      desktopPreviewCapability: "none",
    },
  ]);

  assert.deepEqual(ids, ["opencode", "codex"]);
});

test("supportedDevAdapterIds falls back to safe demo adapter when none are available", () => {
  const ids = supportedDevAdapterIds([
    {
      id: "hermes",
      displayName: "Hermes",
      status: "not_installed",
      startCapability: "process",
      taskCapability: "cli_once",
      eventCapability: "stdout_text",
      desktopPreviewCapability: "none",
    },
  ]);

  assert.deepEqual(ids, ["opencode"]);
});

test("createDevAdapterMap creates safe demo adapters for every detected id by default", async () => {
  const adapters = createDevAdapterMap({
    adapterIds: ["codex", "claude-code"],
    mode: "demo",
  });

  assert.deepEqual(Object.keys(adapters), ["codex", "claude-code"]);

  const runtime = await adapters.codex.start({ adapterId: "codex" });
  const task = await adapters.codex.submitTask({
    runtime,
    prompt: "hello",
    taskId: "task-1",
  });
  const events = [];
  for await (const event of adapters.codex.streamEvents({ runtime, task })) {
    events.push(event);
  }

  assert.equal(runtime.adapterId, "codex");
  assert.equal(task.status, "completed");
  assert.deepEqual(events, [
    { type: "task.output", taskId: "task-1", text: "Ralphloop codex demo adapter completed the task." },
    { type: "task.completed", taskId: "task-1" },
  ]);
});
