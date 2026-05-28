import assert from "node:assert/strict";
import { test } from "node:test";

import { createSharePageModel } from "../src/pages/share/[token].ts";

test("friend page is a multi-session chatbot", () => {
  const page = createSharePageModel({
    token: "local-friend",
    agent: { name: "Friend Agent", adapterId: "opencode", previewMode: "read_only" },
  });

  assert.equal(page.agentName, "Friend Agent");
  assert.equal(page.experienceLabel, "Agent Chat");
  assert.equal(page.sessionSidebar.visible, true);
  assert.equal(page.sessionSidebar.newSessionLabel, "新会话");
  assert.equal(page.chatThread.visible, true);
  assert.equal(page.chatThread.statusLabel, "等待中");
  assert.equal(page.chatComposer.placeholder, "给 Agent 发送消息");
  assert.equal(page.chatComposer.submitLabel, "发送");
  assert.equal(page.previewDrawer.available, true);
  assert.equal(page.previewDrawer.open, false);
});

test("friend page never exposes cost or budget language", () => {
  const page = createSharePageModel({
    token: "local-friend",
    agent: { name: "Friend Agent", adapterId: "opencode", previewMode: "read_only" },
  });

  const serialized = JSON.stringify(page);
  assert.equal(serialized.includes("cost"), false);
  assert.equal(serialized.includes("dollar"), false);
  assert.equal(serialized.includes("budget"), false);
  assert.equal(serialized.includes("token cost"), false);
  assert.equal(serialized.includes("模型价格"), false);
});

test("friend page shows running status after task submission", () => {
  const page = createSharePageModel({
    token: "local-friend",
    agent: { name: "Friend Agent", adapterId: "opencode", previewMode: "read_only" },
    task: { id: "task-1", status: "running", prompt: "Research Linear" },
  });

  assert.equal(page.chatThread.statusLabel, "运行中");
  assert.deepEqual(page.chatThread.messages, [{
    role: "user",
    content: "Research Linear",
  }]);
});

test("friend page renders high-risk user confirmation and owner approval states", () => {
  const userConfirm = createSharePageModel({
    token: "local-friend",
    agent: { name: "Friend Agent", adapterId: "opencode", previewMode: "read_only" },
    permissionPrompt: { kind: "user_confirm", actionSummary: "发送邮件" },
  });
  assert.equal(userConfirm.permissionPrompt?.label, "需要你确认");

  const ownerApprove = createSharePageModel({
    token: "local-friend",
    agent: { name: "Friend Agent", adapterId: "opencode", previewMode: "read_only" },
    permissionPrompt: { kind: "owner_approve", actionSummary: "访问创建者账号" },
  });
  assert.equal(ownerApprove.permissionPrompt?.label, "需要分享者确认");
});

test("friend page preview is read-only by default", () => {
  const page = createSharePageModel({
    token: "local-friend",
    agent: { name: "Friend Agent", adapterId: "opencode", previewMode: "read_only" },
  });

  assert.equal(page.previewDrawer.readOnly, true);
  assert.equal(page.previewDrawer.open, false);
  assert.equal(page.directFrameworkUiExposed, false);
});
