import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { RelayStore } from "../../src/productization/relayStore.ts";
import {
  gateRuntimeActionV1,
  listFriendConfirmationsV1,
  listOwnerApprovalRequestsV1,
  resolveApprovalRequestV1,
  resolveFriendConfirmationV1,
  resolveOwnerApprovalRequestV1,
} from "../../src/productization/routes.ts";

function tempStore(): { directory: string; store: RelayStore } {
  const directory = mkdtempSync(join(tmpdir(), "ralphloop-approval-"));
  return {
    directory,
    store: new RelayStore({
      filePath: join(directory, "relay.json"),
      now: () => new Date("2026-05-21T00:00:00.000Z"),
    }),
  };
}

test("approval requests persist and resolve", () => {
  const { directory, store } = tempStore();
  try {
    const request = store.createApprovalRequest({
      sessionId: "session-1",
      taskId: "task-1",
      actionType: "send_email",
      permissionSource: "user_identity",
      summary: "Send email to teammate",
      riskLevel: "high",
      requiredDecision: "user_confirm",
    });

    const resolved = store.resolveApprovalRequest({
      requestId: request.id,
      status: "approved",
      resolvedBy: "friend",
    });

    assert.equal(resolved?.status, "approved");
    assert.equal(resolved?.resolvedBy, "friend");
    assert.equal(store.listApprovalRequests({ status: "approved" }).length, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("runtime-internal destructive shell is blocked and audited", () => {
  const store = new RelayStore({
    now: () => new Date("2026-05-21T00:00:00.000Z"),
  });

  const response = gateRuntimeActionV1({
    store,
    ownerId: "owner-1",
    sessionId: "session-1",
    taskId: "task-1",
    action: "shell",
    permissionSource: "runtime_internal",
    summary: "rm -rf ./data",
    command: "rm -rf ./data",
  });

  assert.equal(response.status, 403);
  assert.deepEqual(response.body, {
    decision: "block",
    reason: "destructive_shell",
  });
  assert.equal(store.snapshot().approvalRequests.length, 0);
  assert.equal(store.snapshot().auditLogs[0].eventType, "approval.blocked");
});

test("user identity side effects create friend confirmation request", () => {
  const store = new RelayStore({
    now: () => new Date("2026-05-21T00:00:00.000Z"),
  });

  const response = gateRuntimeActionV1({
    store,
    ownerId: "owner-1",
    sessionId: "session-1",
    taskId: "task-1",
    action: "send_email",
    permissionSource: "user_identity",
    summary: "Send email to teammate",
  });

  assert.equal(response.status, 202);
  assert.equal(response.body.decision, "user_confirm");
  assert.equal(response.body.approvalRequest?.status, "pending");
  assert.equal(response.body.approvalRequest?.requiredDecision, "user_confirm");
});

test("owner delegated sensitive actions create owner approval request", () => {
  const store = new RelayStore({
    now: () => new Date("2026-05-21T00:00:00.000Z"),
  });

  const response = gateRuntimeActionV1({
    store,
    ownerId: "owner-1",
    sessionId: "session-1",
    taskId: "task-1",
    action: "owner_account_access",
    permissionSource: "owner_delegated",
    summary: "Open owner Gmail",
  });

  assert.equal(response.status, 202);
  assert.equal(response.body.decision, "owner_approve");
  assert.equal(response.body.approvalRequest?.requiredDecision, "owner_approve");

  const resolved = resolveApprovalRequestV1({
    store,
    requestId: response.body.approvalRequest?.id ?? "",
    status: "denied",
    resolvedBy: "owner",
  });

  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.approvalRequest.status, "denied");
  assert.equal(store.snapshot().auditLogs.at(-1)?.eventType, "approval.denied");
});

test("owner approval queue is owner scoped and only owner approvals are owner resolvable", () => {
  const store = new RelayStore({
    now: () => new Date("2026-05-21T00:00:00.000Z"),
  });
  const ownerRequest = store.createApprovalRequest({
    ownerId: "owner-1",
    sessionId: "session-1",
    taskId: "task-1",
    actionType: "owner_account_access",
    permissionSource: "owner_delegated",
    summary: "Open owner Gmail",
    riskLevel: "high",
    requiredDecision: "owner_approve",
  });
  const friendConfirmation = store.createApprovalRequest({
    ownerId: "owner-1",
    sessionId: "session-2",
    taskId: "task-2",
    actionType: "send_email",
    permissionSource: "user_identity",
    summary: "Send friend email",
    riskLevel: "high",
    requiredDecision: "user_confirm",
  });
  store.createApprovalRequest({
    ownerId: "owner-2",
    sessionId: "session-3",
    taskId: "task-3",
    actionType: "owner_account_access",
    permissionSource: "owner_delegated",
    summary: "Other owner action",
    riskLevel: "high",
    requiredDecision: "owner_approve",
  });

  const queue = listOwnerApprovalRequestsV1({ store, ownerId: "owner-1", status: "pending" });
  const wrongOwner = resolveOwnerApprovalRequestV1({
    store,
    ownerId: "owner-2",
    requestId: ownerRequest.id,
    status: "approved",
  });
  const wrongDecision = resolveOwnerApprovalRequestV1({
    store,
    ownerId: "owner-1",
    requestId: friendConfirmation.id,
    status: "approved",
  });
  const approved = resolveOwnerApprovalRequestV1({
    store,
    ownerId: "owner-1",
    requestId: ownerRequest.id,
    status: "approved",
  });

  assert.equal(queue.status, 200);
  assert.deepEqual(queue.body.approvalRequests.map((request) => request.id), [ownerRequest.id, friendConfirmation.id]);
  assert.equal(JSON.stringify(queue.body).includes("Other owner action"), false);
  assert.equal(wrongOwner.status, 404);
  assert.equal(wrongDecision.status, 404);
  assert.equal(approved.status, 200);
  assert.equal(approved.body.approvalRequest.status, "approved");
  assert.equal(approved.body.approvalRequest.resolvedBy, "owner");
  assert.equal(store.snapshot().auditLogs.at(-1)?.eventType, "approval.approved");
});

test("friend confirmations are token and session scoped without owner-only fields", () => {
  const store = new RelayStore({
    now: () => new Date("2026-05-21T00:00:00.000Z"),
  });
  const link = store.createShareLink({
    ownerId: "owner-1",
    hostId: "host-1",
    rawToken: "local-friend",
    name: "Ralphloop Agent",
    allowedAdapterIds: ["opencode"],
  });
  const session = store.createSession({
    shareLinkId: link.id,
    friendActorId: "friend",
    hostId: "host-1",
    adapterId: "opencode",
  });
  const confirmation = store.createApprovalRequest({
    ownerId: "owner-1",
    sessionId: session.id,
    taskId: "task-1",
    actionType: "send_email",
    permissionSource: "user_identity",
    summary: "Send email as friend",
    riskLevel: "high",
    requiredDecision: "user_confirm",
  });
  const otherFriendSession = store.createSession({
    shareLinkId: link.id,
    friendActorId: "other-friend",
    hostId: "host-1",
    adapterId: "opencode",
  });
  store.createApprovalRequest({
    ownerId: "owner-1",
    sessionId: otherFriendSession.id,
    taskId: "task-2",
    actionType: "send_email",
    permissionSource: "user_identity",
    summary: "Other friend action",
    riskLevel: "high",
    requiredDecision: "user_confirm",
  });
  store.createApprovalRequest({
    ownerId: "owner-1",
    sessionId: session.id,
    taskId: "task-3",
    actionType: "owner_account_access",
    permissionSource: "owner_delegated",
    summary: "Needs owner",
    riskLevel: "high",
    requiredDecision: "owner_approve",
  });

  const confirmations = listFriendConfirmationsV1({
    store,
    token: "local-friend",
    sessionId: session.id,
  });
  const wrongSession = resolveFriendConfirmationV1({
    store,
    token: "local-friend",
    sessionId: otherFriendSession.id,
    requestId: confirmation.id,
    status: "approved",
  });
  const approved = resolveFriendConfirmationV1({
    store,
    token: "local-friend",
    sessionId: session.id,
    requestId: confirmation.id,
    status: "approved",
  });

  assert.equal(confirmations.status, 200);
  assert.deepEqual(confirmations.body.confirmations.map((request) => request.id), [confirmation.id]);
  assert.equal(JSON.stringify(confirmations.body).includes("ownerId"), false);
  assert.equal(JSON.stringify(confirmations.body).includes("Other friend action"), false);
  assert.equal(JSON.stringify(confirmations.body).includes("Needs owner"), false);
  assert.equal(wrongSession.status, 404);
  assert.equal(approved.status, 200);
  assert.equal(approved.body.confirmation.status, "approved");
  assert.equal(approved.body.confirmation.resolvedBy, "friend");
  assert.equal(store.snapshot().auditLogs.at(-1)?.eventType, "approval.approved");
});
