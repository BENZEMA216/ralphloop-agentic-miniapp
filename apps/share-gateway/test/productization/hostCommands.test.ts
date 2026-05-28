import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildHostCommand,
  computePolicyVersion,
  validateHostCommandBinding,
} from "../../src/productization/hostCommands.ts";
import type { SharePolicyRecord } from "../../src/productization/types.ts";

function policy(allowedAdapterIds: string[] = ["opencode"]): SharePolicyRecord {
  return {
    maxTotalBudget: 20,
    maxTaskBudget: 2,
    maxConcurrentSessions: 1,
    allowedAdapterIds,
    previewMode: "read_only",
    permissionMode: "user_identity",
    highRiskActionMode: "owner_approve",
    blockedActions: ["destructive_shell"],
    approvalRequiredActions: ["send_message"],
    allowedDomains: [],
    maxRequestsPerMinute: 30,
    sessionTtlMs: 30 * 60 * 1000,
  };
}

test("buildHostCommand stamps policyVersion and issuedAt", () => {
  const command = buildHostCommand({
    commandType: "runtime.start",
    ownerId: "owner-1",
    hostId: "host-1",
    shareLinkId: "link-1",
    sessionId: "session-1",
    adapterId: "opencode",
    policy: policy(),
    issuedAt: "2026-05-21T00:00:00.000Z",
  });

  assert.equal(command.commandType, "runtime.start");
  assert.equal(command.policyVersion.length, 64);
  assert.equal(command.issuedAt, "2026-05-21T00:00:00.000Z");
});

test("validateHostCommandBinding accepts matching binding and policy version", () => {
  const sharePolicy = policy(["opencode", "codex"]);
  const command = buildHostCommand({
    commandType: "task.submit",
    ownerId: "owner-1",
    hostId: "host-1",
    shareLinkId: "link-1",
    sessionId: "session-1",
    adapterId: "opencode",
    taskId: "task-1",
    prompt: "hello",
    policy: sharePolicy,
    issuedAt: "2026-05-21T00:00:00.000Z",
  });

  const validation = validateHostCommandBinding({
    command,
    expected: {
      ownerId: "owner-1",
      hostId: "host-1",
      shareLinkId: "link-1",
      sessionId: "session-1",
      policy: sharePolicy,
    },
  });

  assert.deepEqual(validation, { ok: true });
});

test("validateHostCommandBinding rejects mismatched share link or policy", () => {
  const sharePolicy = policy(["opencode"]);
  const command = buildHostCommand({
    commandType: "session.cancel",
    ownerId: "owner-1",
    hostId: "host-1",
    shareLinkId: "link-1",
    sessionId: "session-1",
    adapterId: "opencode",
    policy: sharePolicy,
    issuedAt: "2026-05-21T00:00:00.000Z",
  });

  assert.deepEqual(
    validateHostCommandBinding({
      command,
      expected: {
        ownerId: "owner-1",
        hostId: "host-1",
        shareLinkId: "link-2",
        sessionId: "session-1",
        policy: sharePolicy,
      },
    }),
    { ok: false, error: "host_command_binding_invalid" },
  );

  assert.deepEqual(
    validateHostCommandBinding({
      command,
      expected: {
        ownerId: "owner-1",
        hostId: "host-1",
        shareLinkId: "link-1",
        sessionId: "session-1",
        policy: {
          ...sharePolicy,
          maxTaskBudget: sharePolicy.maxTaskBudget + 1,
        },
      },
    }),
    { ok: false, error: "host_command_binding_invalid" },
  );
});

test("computePolicyVersion is stable for identical normalized policies", () => {
  const a = policy(["opencode", "codex"]);
  const b: SharePolicyRecord = {
    ...a,
    allowedAdapterIds: [...a.allowedAdapterIds],
    blockedActions: [...a.blockedActions],
    approvalRequiredActions: [...a.approvalRequiredActions],
    allowedDomains: [...a.allowedDomains],
  };

  assert.equal(computePolicyVersion(a), computePolicyVersion(b));
});
