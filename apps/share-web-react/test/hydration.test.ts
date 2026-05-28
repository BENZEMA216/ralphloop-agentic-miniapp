import assert from "node:assert/strict";
import { after, test } from "node:test";
import React from "react";
import { renderToString } from "react-dom/server";

import { App, type RalphloopReactInitialState } from "../src/App.ts";

function buildInitialState(): RalphloopReactInitialState {
  return {
    token: "local-friend",
    currentThreadId: "session-1",
    taskId: "task-1",
    threads: [
      {
        id: "session-1",
        title: "Test Thread",
        status: "regular",
        taskId: "task-1",
        events: [
          {
            type: "RUN_STARTED",
            threadId: "session-1",
            runId: "run-1",
            input: {
              messages: [
                { id: "user-1", role: "user", content: "hello agent" },
              ],
            },
          },
          { type: "TEXT_MESSAGE_START", messageId: "assistant-1", role: "assistant" },
          { type: "TEXT_MESSAGE_CONTENT", messageId: "assistant-1", delta: "Hi from the agent" },
          { type: "TEXT_MESSAGE_END", messageId: "assistant-1" },
          {
            type: "RUN_FINISHED",
            threadId: "session-1",
            runId: "run-1",
            result: { status: "completed" },
          },
        ],
      },
    ],
  };
}

// React 19 + @assistant-ui/react keep a MessageChannel-backed scheduler alive after
// renderToString returns. The unit assertions complete synchronously; force a clean
// exit so node:test doesn't time out waiting for the scheduler ref to settle.
after(() => {
  setImmediate(() => process.exit(0));
});

test("App hydrates with initial events and renders assistant-ui shell markup", () => {
  const stubFetch: typeof fetch = async () =>
    new Response(JSON.stringify({ events: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  const html = renderToString(
    React.createElement(App, {
      initialState: buildInitialState(),
      fetch: stubFetch,
    }),
  );

  assert.match(html, /data-ralphloop-react-app="true"/);
  assert.match(html, /data-assistant-ui-thread="true"/);
  assert.match(html, /data-assistant-ui-message-list="true"/);
  assert.match(html, /data-current-thread-id="session-1"/);
  assert.match(html, /assistant-ui-message-user[\s\S]*?hello agent/);
  assert.match(html, /assistant-ui-message-assistant[\s\S]*?Hi from the agent/);
  assert.match(html, /data-message-role="assistant"/);
  assert.doesNotMatch(html, /tokenHash|deviceKey|bootstrap|模型价格/);
});
