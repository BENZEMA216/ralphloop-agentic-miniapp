import { createHash } from "node:crypto";

import type { SharePolicyRecord } from "./types.ts";

export type HostCommandType =
  | "runtime.start"
  | "task.submit"
  | "session.cancel"
  | "runtime.stop"
  | "policy.update";

export type HostCommandBinding = {
  ownerId: string;
  hostId: string;
  sessionId: string;
  shareLinkId: string;
  policyVersion: string;
};

export type HostCommandBase = HostCommandBinding & {
  commandType: HostCommandType;
  issuedAt: string;
};

export type HostRuntimeStartCommand = HostCommandBase & {
  commandType: "runtime.start";
  adapterId: string;
};

export type HostTaskSubmitCommand = HostCommandBase & {
  commandType: "task.submit";
  adapterId: string;
  taskId: string;
  prompt: string;
  estimatedTaskBudget?: number;
};

export type HostSessionCancelCommand = HostCommandBase & {
  commandType: "session.cancel";
  adapterId: string;
  reason?: string;
};

export type HostRuntimeStopCommand = HostCommandBase & {
  commandType: "runtime.stop";
  adapterId: string;
  runtimeId?: string;
  reason?: string;
};

export type HostPolicyUpdateCommand = HostCommandBase & {
  commandType: "policy.update";
  adapterId: string;
  updatedPolicy: Partial<SharePolicyRecord>;
};

export type HostCommand =
  | HostRuntimeStartCommand
  | HostTaskSubmitCommand
  | HostSessionCancelCommand
  | HostRuntimeStopCommand
  | HostPolicyUpdateCommand;

export type HostCommandExpectation = {
  ownerId: string;
  hostId: string;
  sessionId: string;
  shareLinkId: string;
  policy: SharePolicyRecord;
};

export function buildHostCommand(
  input: Omit<HostRuntimeStartCommand, "issuedAt" | "policyVersion"> & { policy: SharePolicyRecord; issuedAt?: string },
): HostRuntimeStartCommand;
export function buildHostCommand(
  input: Omit<HostTaskSubmitCommand, "issuedAt" | "policyVersion"> & { policy: SharePolicyRecord; issuedAt?: string },
): HostTaskSubmitCommand;
export function buildHostCommand(
  input: Omit<HostSessionCancelCommand, "issuedAt" | "policyVersion"> & { policy: SharePolicyRecord; issuedAt?: string },
): HostSessionCancelCommand;
export function buildHostCommand(
  input: Omit<HostRuntimeStopCommand, "issuedAt" | "policyVersion"> & { policy: SharePolicyRecord; issuedAt?: string },
): HostRuntimeStopCommand;
export function buildHostCommand(
  input: Omit<HostPolicyUpdateCommand, "issuedAt" | "policyVersion"> & { policy: SharePolicyRecord; issuedAt?: string },
): HostPolicyUpdateCommand;
export function buildHostCommand(
  input: Omit<HostCommand, "issuedAt" | "policyVersion"> & { policy: SharePolicyRecord; issuedAt?: string },
): HostCommand {
  return {
    ...input,
    issuedAt: input.issuedAt ?? new Date().toISOString(),
    policyVersion: computePolicyVersion(input.policy),
  } as HostCommand;
}

export function validateHostCommandBinding(input: {
  command: HostCommand;
  expected: HostCommandExpectation;
}): { ok: true } | { ok: false; error: "host_command_unbound" | "host_command_binding_invalid" } {
  const { command, expected } = input;
  if (
    !command.ownerId
    || !command.hostId
    || !command.sessionId
    || !command.shareLinkId
    || !command.policyVersion
    || !command.commandType
  ) {
    return { ok: false, error: "host_command_unbound" };
  }

  if (
    command.ownerId !== expected.ownerId
    || command.hostId !== expected.hostId
    || command.sessionId !== expected.sessionId
    || command.shareLinkId !== expected.shareLinkId
    || command.policyVersion !== computePolicyVersion(expected.policy)
  ) {
    return { ok: false, error: "host_command_binding_invalid" };
  }

  return { ok: true };
}

export function computePolicyVersion(policy: SharePolicyRecord): string {
  const normalized = normalizePolicy(policy);
  return sha256(JSON.stringify(normalized));
}

function normalizePolicy(policy: SharePolicyRecord): SharePolicyRecord {
  return {
    maxTotalBudget: policy.maxTotalBudget,
    maxTaskBudget: policy.maxTaskBudget,
    maxConcurrentSessions: policy.maxConcurrentSessions,
    allowedAdapterIds: [...policy.allowedAdapterIds],
    previewMode: policy.previewMode,
    permissionMode: policy.permissionMode,
    highRiskActionMode: policy.highRiskActionMode,
    blockedActions: [...policy.blockedActions],
    approvalRequiredActions: [...policy.approvalRequiredActions],
    allowedDomains: [...policy.allowedDomains],
    maxRequestsPerMinute: policy.maxRequestsPerMinute,
    sessionTtlMs: policy.sessionTtlMs,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
