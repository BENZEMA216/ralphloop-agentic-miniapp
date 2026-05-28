import assert from "node:assert/strict";
import { test } from "node:test";

import type { AgentAdapter } from "../../share-gateway/src/adapters/types.ts";
import { listOwnerAdapters } from "../../share-gateway/src/routes/adapters.ts";
import { classifyHighRiskAction } from "../../share-gateway/src/policy/highRiskActions.ts";
import {
  ShareLinkStore,
  createOwnerShareLink,
  getSharedAgentPage,
} from "../../share-gateway/src/routes/shareLinks.ts";
import { submitSharedTask } from "../../share-gateway/src/routes/tasks.ts";
import { createOwnerPageModel } from "../src/pages/owner/index.ts";
import { createSharePageModel } from "../src/pages/share/[token].ts";

function fakeAdapter(): AgentAdapter {
  return {
    async detect() {
      return {
        id: "opencode",
        displayName: "OpenCode",
        status: "available",
        version: "1.2.27",
        startCapability: "server",
        taskCapability: "server_api",
        eventCapability: "http_events",
        desktopPreviewCapability: "web",
      };
    },
    async start() {
      return {
        adapterId: "opencode",
        runtimeId: "opencode:runtime",
        status: "running",
      };
    },
    async submitTask() {
      return {
        adapterId: "opencode",
        runtimeId: "opencode:runtime",
        taskId: "task-1",
        status: "running",
      };
    },
    async *streamEvents(input) {
      yield { type: "task.accepted", taskId: input.task.taskId };
      yield { type: "task.progress", taskId: input.task.taskId, text: "running" };
    },
    async stop() {},
  };
}

test("personal agent share MVP smoke flow", async () => {
  const store = new ShareLinkStore();
  const adapter = fakeAdapter();

  const adapterResponse = await listOwnerAdapters({
    detectAll: async () => [await adapter.detect()],
  });
  assert.equal(adapterResponse.status, 200);
  assert.equal(adapterResponse.body.adapters[0].id, "opencode");

  const ownerPage = createOwnerPageModel({
    adapters: adapterResponse.body.adapters,
    baseUrl: "http://localhost:5179",
  });
  assert.equal(ownerPage.canGenerateShareLink, true);
  assert.equal(ownerPage.advancedSettingsRequired, false);

  const shareLinkResponse = createOwnerShareLink({
    store,
    input: { adapterId: ownerPage.adapterPicker.selectedAdapterId ?? "opencode" },
    tokenFactory: () => "local-friend",
  });
  assert.equal(shareLinkResponse.status, 201);

  const friendEntry = getSharedAgentPage({ store, token: "local-friend" });
  assert.equal(friendEntry.status, 200);
  assert.equal(friendEntry.body.available, true);

  const friendPage = createSharePageModel({
    token: "local-friend",
    agent: {
      name: friendEntry.body.agent.name,
      adapterId: friendEntry.body.agent.adapterId,
      previewMode: friendEntry.body.agent.previewMode,
    },
  });
  assert.equal(friendPage.experienceLabel, "Agent Chat");
  assert.equal(friendPage.sessionSidebar.visible, true);
  assert.equal(friendPage.chatComposer.inputVisible, true);
  assert.equal(JSON.stringify(friendPage).includes("cost"), false);

  const taskResponse = await submitSharedTask({
    store,
    token: "local-friend",
    prompt: "请用一句话说明这个共享 Agent 当前连接的是哪个运行时。",
    adapters: { opencode: adapter },
  });
  assert.equal(taskResponse.status, 202);
  assert.equal(taskResponse.body.task.id, "task-1");

  const runningPage = createSharePageModel({
    token: "local-friend",
    agent: {
      name: friendEntry.body.agent.name,
      adapterId: friendEntry.body.agent.adapterId,
      previewMode: friendEntry.body.agent.previewMode,
    },
    task: {
      id: "task-1",
      status: "running",
      prompt: "请用一句话说明这个共享 Agent 当前连接的是哪个运行时。",
    },
  });
  assert.equal(runningPage.chatThread.statusLabel, "运行中");
  assert.equal(runningPage.previewDrawer.readOnly, true);

  const highRisk = classifyHighRiskAction({
    action: "send_email",
    permissionSource: "user_identity",
    summary: "发送一封邮件给测试对象",
  });
  assert.equal(highRisk.decision, "user_confirm");
});
