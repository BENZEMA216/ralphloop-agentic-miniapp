import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyHighRiskAction } from "../../src/policy/highRiskActions.ts";

test("messages and comments require user confirmation for user-owned identity", () => {
  assert.equal(
    classifyHighRiskAction({
      action: "send_email",
      permissionSource: "user_identity",
      summary: "send an email to a teammate",
    }).decision,
    "user_confirm",
  );
  assert.equal(
    classifyHighRiskAction({
      action: "post_comment",
      permissionSource: "user_identity",
      summary: "post a Linear comment",
    }).decision,
    "user_confirm",
  );
});

test("external costs require confirmation or owner approval based on permission source", () => {
  assert.equal(
    classifyHighRiskAction({
      action: "purchase",
      permissionSource: "user_identity",
      summary: "buy a SaaS subscription",
    }).decision,
    "user_confirm",
  );
  assert.equal(
    classifyHighRiskAction({
      action: "place_order",
      permissionSource: "owner_delegated",
      summary: "order a laptop",
    }).decision,
    "owner_approve",
  );
});

test("persistent file mutation is high risk", () => {
  assert.equal(
    classifyHighRiskAction({
      action: "delete_file",
      permissionSource: "runtime_internal",
      summary: "delete a project file",
    }).decision,
    "block",
  );
  assert.equal(
    classifyHighRiskAction({
      action: "overwrite_file",
      permissionSource: "owner_delegated",
      summary: "overwrite a private document",
    }).decision,
    "owner_approve",
  );
});

test("private accounts and secrets are protected", () => {
  assert.equal(
    classifyHighRiskAction({
      action: "owner_account_access",
      permissionSource: "owner_delegated",
      summary: "open owner's Gmail",
    }).decision,
    "owner_approve",
  );
  assert.equal(
    classifyHighRiskAction({
      action: "user_account_access",
      permissionSource: "user_identity",
      summary: "open user's Notion",
    }).decision,
    "user_confirm",
  );
  assert.equal(
    classifyHighRiskAction({
      action: "read_secret",
      permissionSource: "runtime_internal",
      summary: "read an API key",
    }).decision,
    "block",
  );
});

test("destructive shell commands are blocked", () => {
  assert.equal(
    classifyHighRiskAction({
      action: "shell",
      permissionSource: "runtime_internal",
      summary: "rm -rf ./data",
      command: "rm -rf ./data",
    }).decision,
    "block",
  );
});

test("unknown non-mutating actions are allowed", () => {
  assert.equal(
    classifyHighRiskAction({
      action: "read_public_page",
      permissionSource: "runtime_internal",
      summary: "read a public website",
    }).decision,
    "allow",
  );
});
