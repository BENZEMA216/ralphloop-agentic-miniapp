import assert from "node:assert/strict";
import { test } from "node:test";

import type { AgentAdapter } from "../../src/adapters/types.ts";
import {
  ShareLinkStore,
  createOwnerShareLink,
  pauseShareLink,
  revokeShareLink,
} from "../../src/routes/shareLinks.ts";
import { submitSharedTask } from "../../src/routes/tasks.ts";

function fakeAdapter(calls: string[] = []): AgentAdapter {
  return {
    async detect() {
      throw new Error("not needed");
    },
    async start(input) {
      calls.push(`start:${input.adapterId}`);
      return {
        adapterId: input.adapterId,
        runtimeId: `${input.adapterId}:runtime`,
        status: "running",
      };
    },
    async submitTask(input) {
      calls.push(`submit:${input.prompt}`);
      return {
        adapterId: input.runtime.adapterId,
        runtimeId: input.runtime.runtimeId,
        taskId: "task-1",
        status: "accepted",
      };
    },
    async *streamEvents(input) {
      yield { type: "task.accepted", taskId: input.task.taskId };
    },
    async stop() {},
  };
}

test("POST /share/:token/tasks submits a task for an active link", async () => {
  const calls: string[] = [];
  const store = new ShareLinkStore();
  createOwnerShareLink({
    store,
    input: { adapterId: "opencode" },
    tokenFactory: () => "local-friend",
  });

  const response = await submitSharedTask({
    store,
    token: "local-friend",
    prompt: "Research Linear and Notion AI",
    adapters: { opencode: fakeAdapter(calls) },
  });

  assert.equal(response.status, 202);
  assert.equal(response.body.task.id, "task-1");
  assert.equal(response.body.task.status, "accepted");
  assert.deepEqual(calls, ["start:opencode", "submit:Research Linear and Notion AI"]);
  assert.equal(JSON.stringify(response.body).includes("cost"), false);
  assert.equal(JSON.stringify(response.body).includes("budget"), false);
});

test("POST /share/:token/tasks rejects invalid links", async () => {
  const response = await submitSharedTask({
    store: new ShareLinkStore(),
    token: "missing",
    prompt: "Hello",
    adapters: { opencode: fakeAdapter() },
  });

  assert.equal(response.status, 404);
  assert.equal(response.body.error, "share_link_unavailable");
});

test("POST /share/:token/tasks rejects paused and revoked links", async () => {
  const store = new ShareLinkStore();
  createOwnerShareLink({
    store,
    input: { adapterId: "opencode" },
    tokenFactory: () => "local-friend",
  });

  pauseShareLink({ store, token: "local-friend" });
  const paused = await submitSharedTask({
    store,
    token: "local-friend",
    prompt: "Hello",
    adapters: { opencode: fakeAdapter() },
  });
  assert.equal(paused.status, 423);

  revokeShareLink({ store, token: "local-friend" });
  const revoked = await submitSharedTask({
    store,
    token: "local-friend",
    prompt: "Hello",
    adapters: { opencode: fakeAdapter() },
  });
  assert.equal(revoked.status, 404);
});
