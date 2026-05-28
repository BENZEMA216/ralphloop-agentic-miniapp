import assert from "node:assert/strict";
import { test } from "node:test";

import { createFriendAgUiRuntimeStore } from "../src/runtime/friendAgUiRuntimeStore.ts";

type RecordedRequest = {
  url: string;
  method: string;
  body?: unknown;
};

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

test("friend AG-UI runtime store exposes assistant-ui thread list adapter with current session messages", async () => {
  const store = createFriendAgUiRuntimeStore({
    baseUrl: "https://share.example",
    token: "local-friend",
    currentThreadId: "session-1",
    threads: [
      {
        id: "session-1",
        title: "Repo review",
        status: "regular",
        taskId: "task-1",
        events: [
          {
            type: "RUN_STARTED",
            threadId: "session-1",
            runId: "task-1",
            input: {
              messages: [{ id: "task-1:user", role: "user", content: "Review the repo" }],
            },
          },
          { type: "TEXT_MESSAGE_START", messageId: "task-1:assistant", role: "assistant" },
          { type: "TEXT_MESSAGE_CONTENT", messageId: "task-1:assistant", delta: "Repo review output" },
          { type: "TEXT_MESSAGE_END", messageId: "task-1:assistant" },
          { type: "RUN_FINISHED", threadId: "session-1", runId: "task-1", result: { status: "completed" } },
        ],
      },
      {
        id: "session-2",
        title: "Archived idea",
        status: "archived",
        events: [
          {
            type: "RUN_STARTED",
            threadId: "session-2",
            runId: "task-2",
            input: {
              messages: [{ id: "task-2:user", role: "user", content: "Old idea" }],
            },
          },
        ],
      },
    ],
    fetch: async () => jsonResponse({ events: [] }),
  });

  const adapter = store.getAssistantUiExternalStoreAdapter();

  assert.equal(adapter.adapters.threadList.threadId, "session-1");
  assert.deepEqual(adapter.adapters.threadList.threads, [
    { id: "session-1", title: "Repo review", status: "regular" },
  ]);
  assert.deepEqual(adapter.adapters.threadList.archivedThreads, [
    { id: "session-2", title: "Archived idea", status: "archived" },
  ]);
  assert.deepEqual(adapter.messages.map((message) => ({
    role: message.role,
    text: message.content.map((part) => part.text).join(""),
  })), [
    { role: "user", text: "Review the repo" },
    { role: "assistant", text: "Repo review output" },
  ]);

  await adapter.adapters.threadList.onSwitchToThread("session-2");
  assert.equal(store.getSnapshot().currentThreadId, "session-2");
  assert.deepEqual(store.getSnapshot().messages.map((message) => message.content[0]?.text), ["Old idea"]);
});

test("friend AG-UI runtime store creates a thread and routes onNew through the active session", async () => {
  const requests: RecordedRequest[] = [];
  const store = createFriendAgUiRuntimeStore({
    baseUrl: "https://share.example/",
    token: "local-friend",
    threads: [],
    fetch: async (url, init) => {
      requests.push({
        url,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (url === "https://share.example/v1/share/local-friend/sessions") {
        return jsonResponse({ session: { id: "session-new", status: "waiting" } }, { status: 201 });
      }
      if (url === "https://share.example/v1/share/local-friend/tasks") {
        return jsonResponse({ task: { id: "task-new", status: "waiting" } }, { status: 202 });
      }
      if (url === "https://share.example/v1/share/local-friend/events?sessionId=session-new&taskId=task-new&format=ag-ui") {
        return jsonResponse({
          format: "ag-ui",
          events: [
            {
              type: "RUN_STARTED",
              threadId: "session-new",
              runId: "task-new",
              input: {
                messages: [{ id: "task-new:user", role: "user", content: "Use the shared desktop Agent" }],
              },
            },
            { type: "TEXT_MESSAGE_START", messageId: "task-new:assistant", role: "assistant" },
            { type: "TEXT_MESSAGE_CONTENT", messageId: "task-new:assistant", delta: "Runtime output" },
            { type: "TEXT_MESSAGE_END", messageId: "task-new:assistant" },
            { type: "RUN_FINISHED", threadId: "session-new", runId: "task-new", result: { status: "completed" } },
          ],
        });
      }
      return jsonResponse({ error: "unexpected_request" }, { status: 500 });
    },
  });

  const adapter = store.getAssistantUiExternalStoreAdapter();
  await adapter.adapters.threadList.onSwitchToNewThread();
  await store.getAssistantUiExternalStoreAdapter().onNew(textAppendMessage("Use the shared desktop Agent"));

  assert.deepEqual(requests, [
    {
      url: "https://share.example/v1/share/local-friend/sessions",
      method: "POST",
      body: {},
    },
    {
      url: "https://share.example/v1/share/local-friend/tasks",
      method: "POST",
      body: {
        sessionId: "session-new",
        prompt: "Use the shared desktop Agent",
      },
    },
    {
      url: "https://share.example/v1/share/local-friend/events?sessionId=session-new&taskId=task-new&format=ag-ui",
      method: "GET",
      body: undefined,
    },
  ]);
  assert.equal(store.getSnapshot().currentThreadId, "session-new");
  assert.deepEqual(store.getSnapshot().threads, [
    { id: "session-new", title: "Use the shared desktop Agent", status: "regular" },
  ]);
  assert.deepEqual(store.getSnapshot().messages.map((message) => message.content[0]?.text), [
    "Use the shared desktop Agent",
    "Runtime output",
  ]);
  assert.equal(JSON.stringify(requests).includes("budget"), false);
  assert.equal(JSON.stringify(requests).includes("cost"), false);
  assert.equal(JSON.stringify(requests).includes("deviceKey"), false);
  assert.equal(JSON.stringify(requests).includes("bootstrap"), false);
});

test("friend AG-UI runtime store cancels only the selected thread task", async () => {
  const requests: RecordedRequest[] = [];
  const store = createFriendAgUiRuntimeStore({
    baseUrl: "https://share.example",
    token: "local-friend",
    currentThreadId: "session-2",
    threads: [
      {
        id: "session-1",
        title: "First",
        status: "regular",
        taskId: "task-1",
        events: [
          {
            type: "RUN_STARTED",
            threadId: "session-1",
            runId: "task-1",
            input: { messages: [{ id: "task-1:user", role: "user", content: "First prompt" }] },
          },
        ],
      },
      {
        id: "session-2",
        title: "Second",
        status: "regular",
        taskId: "task-2",
        events: [
          {
            type: "RUN_STARTED",
            threadId: "session-2",
            runId: "task-2",
            input: { messages: [{ id: "task-2:user", role: "user", content: "Second prompt" }] },
          },
        ],
      },
    ],
    fetch: async (url, init) => {
      requests.push({
        url,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (url === "https://share.example/v1/share/local-friend/sessions/session-2/cancel") {
        return jsonResponse({ session: { id: "session-2", status: "cancelled" } });
      }
      if (url === "https://share.example/v1/share/local-friend/events?sessionId=session-2&taskId=task-2&format=ag-ui") {
        return jsonResponse({
          events: [
            { type: "RUN_STARTED", threadId: "session-2", runId: "task-2" },
            { type: "CUSTOM", name: "ralphloop.run.cancelled", value: { threadId: "session-2", runId: "task-2" } },
            { type: "RUN_FINISHED", threadId: "session-2", runId: "task-2", result: { status: "cancelled" } },
          ],
        });
      }
      return jsonResponse({ error: "unexpected_request" }, { status: 500 });
    },
  });

  await store.getAssistantUiExternalStoreAdapter().onCancel();

  assert.deepEqual(requests, [
    {
      url: "https://share.example/v1/share/local-friend/sessions/session-2/cancel",
      method: "POST",
      body: { taskId: "task-2" },
    },
    {
      url: "https://share.example/v1/share/local-friend/events?sessionId=session-2&taskId=task-2&format=ag-ui",
      method: "GET",
      body: undefined,
    },
  ]);
  assert.equal(store.getSnapshot().status, "cancelled");
  await store.switchToThread("session-1");
  assert.deepEqual(store.getSnapshot().messages.map((message) => message.content[0]?.text), ["First prompt"]);
});
