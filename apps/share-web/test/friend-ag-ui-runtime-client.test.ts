import assert from "node:assert/strict";
import { test } from "node:test";

import { createFriendAgUiRuntimeClient } from "../src/runtime/friendAgUiRuntimeClient.ts";

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

test("friend AG-UI runtime onNew submits text and reloads format=ag-ui events", async () => {
  const requests: RecordedRequest[] = [];
  const client = createFriendAgUiRuntimeClient({
    baseUrl: "https://share.example",
    token: "local-friend",
    sessionId: "session-1",
    fetch: async (url, init) => {
      requests.push({
        url,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (url === "https://share.example/v1/share/local-friend/tasks") {
        return jsonResponse({ task: { id: "task-1", status: "waiting" } }, { status: 202 });
      }
      if (url === "https://share.example/v1/share/local-friend/events?sessionId=session-1&taskId=task-1&format=ag-ui") {
        return jsonResponse({
          format: "ag-ui",
          events: [
            {
              type: "RUN_STARTED",
              threadId: "session-1",
              runId: "task-1",
              input: {
                messages: [{ id: "task-1:user", role: "user", content: "Use my shared Agent" }],
              },
            },
            { type: "TEXT_MESSAGE_START", messageId: "task-1:assistant", role: "assistant" },
            { type: "TEXT_MESSAGE_CONTENT", messageId: "task-1:assistant", delta: "Shared Agent output" },
            { type: "TEXT_MESSAGE_END", messageId: "task-1:assistant" },
            { type: "RUN_FINISHED", threadId: "session-1", runId: "task-1", result: { status: "completed" } },
          ],
        });
      }
      return jsonResponse({ error: "unexpected_request" }, { status: 500 });
    },
  });

  const state = await client.onNew(textAppendMessage("Use my shared Agent"));

  assert.deepEqual(requests, [
    {
      url: "https://share.example/v1/share/local-friend/tasks",
      method: "POST",
      body: {
        sessionId: "session-1",
        prompt: "Use my shared Agent",
      },
    },
    {
      url: "https://share.example/v1/share/local-friend/events?sessionId=session-1&taskId=task-1&format=ag-ui",
      method: "GET",
      body: undefined,
    },
  ]);
  assert.equal(client.currentTaskId, "task-1");
  assert.equal(state.status, "completed");
  assert.deepEqual(state.messages.map((message) => ({
    role: message.role,
    text: message.content.map((part) => part.text).join(""),
  })), [
    { role: "user", text: "Use my shared Agent" },
    { role: "assistant", text: "Shared Agent output" },
  ]);
  assert.equal(JSON.stringify(requests).includes("budget"), false);
  assert.equal(JSON.stringify(requests).includes("cost"), false);
});

test("friend AG-UI runtime onCancel cancels active task and refreshes cancellation events", async () => {
  const requests: RecordedRequest[] = [];
  const client = createFriendAgUiRuntimeClient({
    baseUrl: "https://share.example/",
    token: "local-friend",
    sessionId: "session-1",
    initialTaskId: "task-running",
    fetch: async (url, init) => {
      requests.push({
        url,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (url === "https://share.example/v1/share/local-friend/sessions/session-1/cancel") {
        return jsonResponse({ session: { id: "session-1", status: "cancelled" } });
      }
      if (url === "https://share.example/v1/share/local-friend/events?sessionId=session-1&taskId=task-running&format=ag-ui") {
        return jsonResponse({
          format: "ag-ui",
          events: [
            { type: "RUN_STARTED", threadId: "session-1", runId: "task-running" },
            {
              type: "CUSTOM",
              name: "ralphloop.run.cancelled",
              value: { threadId: "session-1", runId: "task-running" },
            },
            {
              type: "RUN_FINISHED",
              threadId: "session-1",
              runId: "task-running",
              result: { status: "cancelled" },
            },
          ],
        });
      }
      return jsonResponse({ error: "unexpected_request" }, { status: 500 });
    },
  });

  const state = await client.onCancel();

  assert.deepEqual(requests, [
    {
      url: "https://share.example/v1/share/local-friend/sessions/session-1/cancel",
      method: "POST",
      body: { taskId: "task-running" },
    },
    {
      url: "https://share.example/v1/share/local-friend/events?sessionId=session-1&taskId=task-running&format=ag-ui",
      method: "GET",
      body: undefined,
    },
  ]);
  assert.equal(state.status, "cancelled");
  assert.equal(state.isRunning, false);
});

test("friend AG-UI runtime rejects non-text or blank sends before transport", async () => {
  const requests: RecordedRequest[] = [];
  const client = createFriendAgUiRuntimeClient({
    baseUrl: "https://share.example",
    token: "local-friend",
    sessionId: "session-1",
    fetch: async (url, init) => {
      requests.push({ url, method: init?.method ?? "GET" });
      return jsonResponse({});
    },
  });

  await assert.rejects(
    () => client.onNew({ content: [{ type: "image", image: "base64" }] }),
    /Only text messages are supported/,
  );
  await assert.rejects(
    () => client.onNew(textAppendMessage("   ")),
    /Message text is required/,
  );
  await assert.rejects(
    () => client.onCancel(),
    /No active task to cancel/,
  );
  assert.deepEqual(requests, []);
});
