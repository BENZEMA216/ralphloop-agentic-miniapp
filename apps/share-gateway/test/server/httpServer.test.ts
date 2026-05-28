import assert from "node:assert/strict";
import { test } from "node:test";

import { createShareRuntimeServer } from "../../src/server/httpServer.ts";

test("HTTP server serves owner and friend share flow without exposing cost", async () => {
  const server = createShareRuntimeServer({
    baseUrl: "http://127.0.0.1:0",
    tokenFactory: () => "local-friend",
  });
  const fetch = server.fetch;

  await server.listen(0);
  const baseUrl = server.url();

  try {
    const owner = await fetch(`${baseUrl}/owner`);
    assert.equal(owner.status, 200);
    const ownerHtml = await owner.text();
    assert.match(ownerHtml, /OpenCode/);
    assert.match(ownerHtml, /create-share-link/);
    assert.match(ownerHtml, /\/owner\/share-links/);

    const create = await fetch(`${baseUrl}/owner/share-links`, { method: "POST" });
    assert.equal(create.status, 201);
    const createBody = await create.json();
    assert.equal(createBody.shareLink.token, "local-friend");

    const friend = await fetch(`${baseUrl}/share/local-friend`);
    assert.equal(friend.status, 200);
    const friendHtml = await friend.text();
    assert.match(friendHtml, /Shared Agent/);
    assert.match(friendHtml, /Agent Chat/);
    assert.match(friendHtml, /给 Agent 发送消息/);
    assert.match(friendHtml, /chat-form/);
    assert.match(friendHtml, /friend-session-sidebar/);
    assert.match(friendHtml, /friend-preview-drawer/);
    assert.match(friendHtml, /\/share\/local-friend\/tasks/);
    assert.equal(friendHtml.includes("cost"), false);
    assert.equal(friendHtml.includes("budget"), false);

    const task = await fetch(`${baseUrl}/share/local-friend/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "请用一句话说明这个共享 Agent 当前连接的是哪个运行时。" }),
    });
    assert.equal(task.status, 202);
    const taskBody = await task.json();
    assert.equal(taskBody.task.status, "running");
  } finally {
    await server.close();
  }
});
