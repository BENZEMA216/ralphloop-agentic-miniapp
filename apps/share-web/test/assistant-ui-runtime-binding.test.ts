import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { createAssistantUiRuntimeOptions } from "../src/runtime/assistantUiRuntimeBinding.ts";
import { createFriendAgUiRuntimeStore } from "../src/runtime/friendAgUiRuntimeStore.ts";

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

function textAppendMessage(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  };
}

test("assistant-ui package exposes the runtime and thread primitives Ralphloop needs", () => {
  const result = spawnSync(process.execPath, [
    "--input-type=module",
    "-e",
    `
      import * as assistantUi from "@assistant-ui/react";
      console.log(JSON.stringify({
        useExternalStoreRuntime: typeof assistantUi.useExternalStoreRuntime,
        AssistantRuntimeProvider: typeof assistantUi.AssistantRuntimeProvider,
        ThreadPrimitiveRoot: typeof assistantUi.ThreadPrimitive?.Root,
        ThreadListPrimitiveRoot: typeof assistantUi.ThreadListPrimitive?.Root
      }));
      process.exit(0);
    `,
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    useExternalStoreRuntime: "function",
    AssistantRuntimeProvider: "object",
    ThreadPrimitiveRoot: "object",
    ThreadListPrimitiveRoot: "object",
  });
});

test("assistant-ui runtime binding exposes external store options backed by Ralphloop sessions", async () => {
  const requests: Array<{ url: string; method: string; body?: unknown }> = [];
  const store = createFriendAgUiRuntimeStore({
    baseUrl: "https://share.example",
    token: "local-friend",
    currentThreadId: "session-1",
    threads: [
      {
        id: "session-1",
        title: "Shared desktop task",
        status: "regular",
        taskId: "task-1",
        events: [
          {
            type: "RUN_STARTED",
            threadId: "session-1",
            runId: "task-1",
            input: {
              messages: [{ id: "task-1:user", role: "user", content: "Use my local Agent" }],
            },
          },
          { type: "TEXT_MESSAGE_START", messageId: "task-1:assistant", role: "assistant" },
          { type: "TEXT_MESSAGE_CONTENT", messageId: "task-1:assistant", delta: "Local Agent output" },
          { type: "TEXT_MESSAGE_END", messageId: "task-1:assistant" },
          { type: "RUN_FINISHED", threadId: "session-1", runId: "task-1", result: { status: "completed" } },
        ],
      },
    ],
    fetch: async (url, init) => {
      requests.push({
        url,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (url === "https://share.example/v1/share/local-friend/tasks") {
        return jsonResponse({ task: { id: "task-2", status: "waiting" } }, { status: 202 });
      }
      if (url === "https://share.example/v1/share/local-friend/events?sessionId=session-1&taskId=task-2&format=ag-ui") {
        return jsonResponse({
          events: [
            {
              type: "RUN_STARTED",
              threadId: "session-1",
              runId: "task-2",
              input: {
                messages: [{ id: "task-2:user", role: "user", content: "Next task" }],
              },
            },
            { type: "TEXT_MESSAGE_START", messageId: "task-2:assistant", role: "assistant" },
            { type: "TEXT_MESSAGE_CONTENT", messageId: "task-2:assistant", delta: "Next output" },
            { type: "TEXT_MESSAGE_END", messageId: "task-2:assistant" },
            { type: "RUN_FINISHED", threadId: "session-1", runId: "task-2", result: { status: "completed" } },
          ],
        });
      }
      return jsonResponse({ error: "unexpected_request" }, { status: 500 });
    },
  });

  const options = createAssistantUiRuntimeOptions(store);

  assert.deepEqual(options.messages.map((message) => ({
    role: message.role,
    text: message.content.map((part) => part.text).join(""),
  })), [
    { role: "user", text: "Use my local Agent" },
    { role: "assistant", text: "Local Agent output" },
  ]);
  assert.equal(options.isRunning, false);
  assert.equal(options.adapters.threadList.threadId, "session-1");
  assert.deepEqual(options.adapters.threadList.threads, [
    { id: "session-1", title: "Shared desktop task", status: "regular" },
  ]);

  await options.onNew(textAppendMessage("Next task"));

  assert.deepEqual(requests, [
    {
      url: "https://share.example/v1/share/local-friend/tasks",
      method: "POST",
      body: {
        sessionId: "session-1",
        prompt: "Next task",
      },
    },
    {
      url: "https://share.example/v1/share/local-friend/events?sessionId=session-1&taskId=task-2&format=ag-ui",
      method: "GET",
      body: undefined,
    },
  ]);
  assert.deepEqual(store.getSnapshot().messages.map((message) => message.content[0]?.text), [
    "Next task",
    "Next output",
  ]);
  assert.equal(JSON.stringify(requests).includes("budget"), false);
  assert.equal(JSON.stringify(requests).includes("cost"), false);
  assert.equal(JSON.stringify(requests).includes("deviceKey"), false);
  assert.equal(JSON.stringify(requests).includes("bootstrap"), false);
});
