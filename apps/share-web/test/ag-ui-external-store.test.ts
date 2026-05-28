import assert from "node:assert/strict";
import { test } from "node:test";

import { createAssistantUiExternalStoreFromAgUiEvents } from "../src/runtime/agUiExternalStore.ts";
import { createSharePageModel } from "../src/pages/share/[token].ts";

test("AG-UI events convert to assistant-ui external store text messages", () => {
  const store = createAssistantUiExternalStoreFromAgUiEvents([
    {
      type: "RUN_STARTED",
      threadId: "session-1",
      runId: "task-1",
      input: {
        messages: [{ id: "task-1:user", role: "user", content: "Inspect the local repo" }],
      },
    },
    { type: "TEXT_MESSAGE_START", messageId: "task-1:assistant", role: "assistant" },
    { type: "TEXT_MESSAGE_CONTENT", messageId: "task-1:assistant", delta: "First line" },
    { type: "TEXT_MESSAGE_CONTENT", messageId: "task-1:assistant", delta: "\nSecond line" },
    { type: "TEXT_MESSAGE_END", messageId: "task-1:assistant" },
    {
      type: "RUN_FINISHED",
      threadId: "session-1",
      runId: "task-1",
      result: { status: "completed" },
    },
  ]);

  assert.equal(store.currentThreadId, "session-1");
  assert.equal(store.currentRunId, "task-1");
  assert.equal(store.status, "completed");
  assert.equal(store.isRunning, false);
  assert.deepEqual(store.messages, [
    {
      id: "task-1:user",
      role: "user",
      content: [{ type: "text", text: "Inspect the local repo" }],
      metadata: { source: "ag-ui", threadId: "session-1", runId: "task-1" },
    },
    {
      id: "task-1:assistant",
      role: "assistant",
      content: [{ type: "text", text: "First line\nSecond line" }],
      status: { type: "complete" },
      metadata: { source: "ag-ui", threadId: "session-1", runId: "task-1" },
    },
  ]);
});

test("AG-UI external store keeps streaming assistant message running until terminal event", () => {
  const store = createAssistantUiExternalStoreFromAgUiEvents([
    { type: "RUN_STARTED", threadId: "session-1", runId: "task-2" },
    { type: "TEXT_MESSAGE_START", messageId: "task-2:assistant", role: "assistant" },
    { type: "TEXT_MESSAGE_CONTENT", messageId: "task-2:assistant", delta: "Partial output" },
  ]);

  assert.equal(store.status, "running");
  assert.equal(store.isRunning, true);
  assert.deepEqual(store.messages, [
    {
      id: "task-2:assistant",
      role: "assistant",
      content: [{ type: "text", text: "Partial output" }],
      status: { type: "running" },
      metadata: { source: "ag-ui", threadId: "session-1", runId: "task-2" },
    },
  ]);
});

test("AG-UI external store preserves safe custom events and drops secret-like fields", () => {
  const store = createAssistantUiExternalStoreFromAgUiEvents([
    { type: "RUN_STARTED", threadId: "session-1", runId: "task-3" },
    {
      type: "CUSTOM",
      name: "ralphloop.task.needs_user_auth",
      value: {
        provider: "github",
        scopeSummary: "Read repositories",
        tokenHash: "hidden-token-hash",
        deviceKey: "hidden-device-key",
        bootstrap: "hidden-bootstrap",
      },
    },
    { type: "RUN_ERROR", message: "Needs user auth", code: "auth_required" },
  ]);

  assert.equal(store.status, "failed");
  assert.equal(store.isRunning, false);
  assert.deepEqual(store.customEvents, [
    {
      name: "ralphloop.task.needs_user_auth",
      value: {
        provider: "github",
        scopeSummary: "Read repositories",
      },
    },
  ]);
  assert.equal(JSON.stringify(store).includes("hidden-token-hash"), false);
  assert.equal(JSON.stringify(store).includes("hidden-device-key"), false);
  assert.equal(JSON.stringify(store).includes("hidden-bootstrap"), false);
});

test("friend share page model can render AG-UI external store messages", () => {
  const page = createSharePageModel({
    token: "local-friend",
    agent: { name: "Friend Agent", adapterId: "opencode", previewMode: "read_only" },
    agUiEvents: [
      {
        type: "RUN_STARTED",
        threadId: "session-1",
        runId: "task-4",
        input: {
          messages: [{ id: "task-4:user", role: "user", content: "Use the shared agent" }],
        },
      },
      { type: "TEXT_MESSAGE_START", messageId: "task-4:assistant", role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "task-4:assistant", delta: "Shared agent output" },
      { type: "TEXT_MESSAGE_END", messageId: "task-4:assistant" },
      {
        type: "RUN_FINISHED",
        threadId: "session-1",
        runId: "task-4",
        result: { status: "completed" },
      },
    ],
  });

  assert.equal(page.chatThread.status, "completed");
  assert.equal(page.chatThread.statusLabel, "已完成");
  assert.deepEqual(page.chatThread.messages, [
    { role: "user", content: "Use the shared agent" },
    { role: "assistant", content: "Shared agent output" },
  ]);
});
