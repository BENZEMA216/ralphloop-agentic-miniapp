import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("assistant-ui React shell renders provider, thread, and thread list from Ralphloop store", () => {
  const result = spawnSync(process.execPath, [
    "--experimental-strip-types",
    "--input-type=module",
    "-e",
    `
      import { renderAssistantUiReactShellToString } from "./apps/share-web/src/runtime/assistantUiReactShell.ts";
      import { createFriendAgUiRuntimeStore } from "./apps/share-web/src/runtime/friendAgUiRuntimeStore.ts";
      const store = createFriendAgUiRuntimeStore({
        baseUrl: "https://share.example",
        token: "local-friend",
        currentThreadId: "session-1",
        threads: [{
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
                messages: [{ id: "task-1:user", role: "user", content: "Use the local Agent" }]
              }
            },
            { type: "TEXT_MESSAGE_START", messageId: "task-1:assistant", role: "assistant" },
            { type: "TEXT_MESSAGE_CONTENT", messageId: "task-1:assistant", delta: "Local Agent output" },
            { type: "TEXT_MESSAGE_END", messageId: "task-1:assistant" },
            { type: "RUN_FINISHED", threadId: "session-1", runId: "task-1", result: { status: "completed" } }
          ]
        }],
        fetch: async () => new Response(JSON.stringify({ events: [] }), {
          headers: { "content-type": "application/json" }
        })
      });
      console.log(renderAssistantUiReactShellToString(store));
      process.exit(0);
    `,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  const html = result.stdout;
  assert.match(html, /data-ralphloop-assistant-ui-shell="true"/);
  assert.match(html, /data-assistant-ui-layout="chatbot"/);
  assert.match(html, /class="assistant-ui-runtime-shell"/);
  assert.match(html, /data-current-thread-id="session-1"/);
  assert.match(html, /data-message-count="2"/);
  assert.match(html, /data-thread-count="1"/);
  assert.match(html, /data-assistant-ui-thread="true"/);
  assert.match(html, /data-assistant-ui-thread-list="true"/);
  assert.match(html, /data-assistant-ui-message-list="true"/);
  assert.match(html, /id="assistant-ui-preview-toggle"/);
  assert.match(html, /id="assistant-ui-preview-drawer"/);
  assert.match(html, /id="assistant-ui-preview-close"/);
  assert.match(html, /id="assistant-ui-preview-frame"/);
  assert.match(html, /class="assistant-ui-thread-rail"/);
  assert.match(html, /class="assistant-ui-thread-panel"/);
  assert.match(html, /class="assistant-ui-message assistant-ui-message-user"/);
  assert.match(html, /class="assistant-ui-message assistant-ui-message-assistant"/);
  assert.match(html, /data-assistant-ui-thread-status="completed"/);
  assert.match(html, /Use the local Agent/);
  assert.match(html, /Local Agent output/);
  assert.doesNotMatch(html, /cost|budget|deviceKey|bootstrap|tokenHash/i);
});
