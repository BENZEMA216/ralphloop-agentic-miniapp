import { randomUUID } from "node:crypto";

import type { AgentAdapterInfo, RuntimeEvent, TaskHandle } from "../adapters/types.ts";
import { classifyHighRiskAction } from "../policy/highRiskActions.ts";
import type { PermissionSource } from "../policy/highRiskActions.ts";
import type { HostRuntimeRegistry } from "./hostRuntime.ts";
import { buildHostCommand, computePolicyVersion } from "./hostCommands.ts";
import { buildPendingAuthState, parseFriendAuthProvider } from "./friendAuth.ts";
import { runtimeEventsToAgUiEvents, type AgUiEvent } from "./agUiEvents.ts";
import type { RelayStore } from "./relayStore.ts";
import type {
  AuditLogRecord,
  ApprovalRequestRecord,
  HostCommandRecord,
  HostRecord,
  PreviewFrameRecord,
  SessionRecord,
  ShareLinkRecord,
  SharePolicyRecord,
  TaskRecord,
} from "./types.ts";
import type { FriendAuthPendingState } from "./friendAuth.ts";

type JsonResponse<T> = {
  status: number;
  body: T;
};

type PublicHost = Pick<
  HostRecord,
  "id" | "ownerId" | "deviceName" | "hostVersion" | "status" | "lastSeenAt" | "offlineReason" | "supportedAdapters"
>;

type OwnerShareLink = {
  id: string;
  token: string;
  url: string;
  name: string;
  status: ShareLinkRecord["status"];
  expiresAt: string;
  policy: SharePolicyRecord;
};

type OwnerAdapterInfo = AgentAdapterInfo & {
  connectedHostIds: string[];
};

type FriendSharePage =
  | {
    available: true;
    agent: {
      name: string;
      adapterId: string;
      previewMode: SharePolicyRecord["previewMode"];
    };
  }
  | {
    available: false;
    error: string;
  };

type FriendTaskResponse = {
  task?: {
    id: string;
    status: string;
  };
  events: RuntimeEvent[];
  available?: false;
  error?: string;
};

type FriendSession = Pick<
  SessionRecord,
  "id" | "adapterId" | "status" | "startedAt" | "lastEventAt" | "friendActorId"
> & {
  previewMode: SharePolicyRecord["previewMode"];
  displayName?: string;
};

type FriendSessionResponse =
  | {
    session: FriendSession;
  }
  | {
    available: false;
    error: string;
  };

type FriendSessionCancelResponse =
  | {
    session: {
      id: string;
      status: "cancelled";
    };
  }
  | {
    available: false;
    error: string;
  };

type ApprovalGateResponse =
  | {
    decision: "allow" | "block";
    reason: string;
  }
  | {
    decision: "user_confirm" | "owner_approve";
    reason: string;
    approvalRequest: ApprovalRequestRecord;
  };

type FriendPreviewResponse =
  | {
    frames: PreviewFrameRecord[];
  }
  | {
    frames: [];
    available: false;
    error: string;
  };

type FriendEventsResponse =
  | {
    events: RuntimeEvent[] | AgUiEvent[];
    format?: "runtime" | "ag-ui";
  }
  | {
    events: [];
    available: false;
    error: string;
  };

type OwnerSession = Pick<
  SessionRecord,
  "id" | "shareLinkId" | "friendActorId" | "hostId" | "adapterId" | "status" | "startedAt" | "endedAt" | "lastEventAt"
>;

type OwnerShareLinkSummary = Pick<
  ShareLinkRecord,
  "id" | "hostId" | "name" | "status" | "createdAt" | "expiresAt" | "revokedAt" | "budgetUsed"
> & {
  allowedAdapterIds: string[];
  maxTotalBudget: number;
  maxTaskBudget: number;
  maxConcurrentSessions: number;
  maxRequestsPerMinute: number;
  sessionTtlMs: number;
};

type OwnerTaskSummary = Pick<
  TaskRecord,
  "id" | "sessionId" | "prompt" | "status" | "createdAt" | "startedAt" | "completedAt" | "resultRef" | "failureReason"
> & Pick<SessionRecord, "shareLinkId" | "friendActorId" | "hostId" | "adapterId">;

type FriendConfirmation = Omit<ApprovalRequestRecord, "ownerId">;

type FriendAuthStartResponse =
  | {
    auth: FriendAuthPendingState;
  }
  | {
    available: false;
    error: string;
  };

type HostCommandResponse = {
  commands: HostCommandRecord[];
};

type HostCommandEventsResponse =
  | {
    accepted: true;
  }
  | {
    accepted: false;
    error: string;
  };

const activeSessionStatuses = new Set<SessionRecord["status"]>([
  "waiting",
  "starting",
  "running",
  "needs_input",
  "needs_user_auth",
  "needs_user_confirm",
  "needs_owner_approval",
]);
const reusableSessionStatuses = new Set<SessionRecord["status"]>(["waiting", "completed", "failed"]);

const HOST_HEARTBEAT_TIMEOUT_MS = 30_000;
const MAX_FRIEND_DISPLAY_NAME_LENGTH = 64;
const MAX_SHARE_TOKEN_GENERATION_ATTEMPTS = 8;

function generateFriendActorId(): string {
  return `anon_${randomUUID()}`;
}

function normalizeFriendDisplayName(raw?: string): { ok: true; value?: string } | { ok: false; error: string } {
  if (raw === undefined) {
    return { ok: true, value: undefined };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: true, value: undefined };
  }
  if (trimmed.length > MAX_FRIEND_DISPLAY_NAME_LENGTH) {
    return { ok: false, error: "display_name_invalid" };
  }
  return { ok: true, value: trimmed };
}

function enforceHostHeartbeatTimeout(store: RelayStore) {
  const transitioned = store.markStaleHostsOffline({ timeoutMs: HOST_HEARTBEAT_TIMEOUT_MS });
  for (const host of transitioned) {
    store.appendAuditLog({
      ownerId: host.ownerId,
      actorType: "system",
      eventType: "host.offline",
      summary: `${host.deviceName} offline`,
      metadata: { hostId: host.id, reason: host.offlineReason },
    });
  }
}

export function registerHost(input: {
  store: RelayStore;
  ownerId: string;
  hostId?: string;
  deviceName: string;
  hostVersion: string;
  supportedAdapters: string[];
  capabilities?: string[];
  deviceKeyHash?: string;
}): JsonResponse<{ host: PublicHost }> {
  const host = input.store.upsertHost({
    ownerId: input.ownerId,
    hostId: input.hostId,
    deviceName: input.deviceName,
    hostVersion: input.hostVersion,
    supportedAdapters: input.supportedAdapters,
    capabilities: input.capabilities,
    deviceKeyHash: input.deviceKeyHash,
  });
  input.store.appendAuditLog({
    ownerId: input.ownerId,
    actorType: "host",
    eventType: "host.registered",
    summary: `${input.deviceName} registered`,
    metadata: { hostId: host.id },
  });

  return {
    status: 201,
    body: { host: publicHost(host) },
  };
}

export function recordHostHeartbeat(input: {
  store: RelayStore;
  hostId: string;
  supportedAdapters?: string[];
  capabilities?: string[];
}): JsonResponse<{ host: PublicHost } | { error: string }> {
  const before = input.store.findHost(input.hostId);
  const host = input.store.recordHostHeartbeat({
    hostId: input.hostId,
    supportedAdapters: input.supportedAdapters,
    capabilities: input.capabilities,
  });
  if (!host) {
    return { status: 404, body: { error: "host_not_found" } };
  }

  if (before?.status === "offline") {
    input.store.appendAuditLog({
      ownerId: host.ownerId,
      actorType: "host",
      eventType: "host.reconnected",
      summary: `${host.deviceName} reconnected`,
      metadata: { hostId: host.id, offlineReason: before.offlineReason },
    });
  }

  input.store.appendAuditLog({
    ownerId: host.ownerId,
    actorType: "host",
    eventType: "host.heartbeat",
    summary: `${host.deviceName} heartbeat`,
    metadata: { hostId: host.id },
  });

  return {
    status: 200,
    body: { host: publicHost(host) },
  };
}

export function claimHostCommandV1(input: {
  store: RelayStore;
  hostId: string;
}): JsonResponse<HostCommandResponse | { error: string }> {
  const host = input.store.findHost(input.hostId);
  if (!host) {
    return { status: 404, body: { error: "host_not_found" } };
  }
  if (host.status !== "online") {
    return { status: 409, body: { error: "host_unavailable" } };
  }

  let command = input.store.claimNextHostCommand(input.hostId);
  while (command && shouldSkipCancelledTaskSubmit(input.store, command)) {
    input.store.completeHostCommand({
      commandId: command.id,
      status: "cancelled",
      failureReason: "session_cancelled",
    });
    command = input.store.claimNextHostCommand(input.hostId);
  }
  return {
    status: 200,
    body: { commands: command ? [command] : [] },
  };
}

export function recordHostCommandEventsV1(input: {
  store: RelayStore;
  hostId: string;
  commandId: string;
  sessionId: string;
  taskId: string;
  runtimeId?: string;
  events: RuntimeEvent[];
}): JsonResponse<HostCommandEventsResponse> {
  const commandRecord = input.store.findHostCommand(input.commandId);
  if (!commandRecord || commandRecord.hostId !== input.hostId) {
    return { status: 404, body: { accepted: false, error: "host_command_unavailable" } };
  }
  if (commandRecord.status !== "claimed") {
    return { status: 409, body: { accepted: false, error: "host_command_not_claimed" } };
  }

  const command = commandRecord.command;
  if (command.commandType === "session.cancel") {
    if (command.sessionId !== input.sessionId) {
      return { status: 403, body: { accepted: false, error: "host_command_binding_invalid" } };
    }

    const session = input.store.findSession(input.sessionId);
    const link = input.store.findShareLinkById(command.shareLinkId);
    if (!session || !link || session.hostId !== input.hostId) {
      return { status: 404, body: { accepted: false, error: "host_command_unavailable" } };
    }

    const cancelledTasks = input.store.cancelTasksForSession(session.id);
    input.store.updateSession({ sessionId: session.id, status: "cancelled" });
    for (const task of cancelledTasks) {
      const alreadyRecorded = input.store
        .listRuntimeEvents({ taskId: task.id })
        .some((entry) => entry.event.type === "task.cancelled");
      if (alreadyRecorded) {
        continue;
      }
      input.store.appendRuntimeEvent({
        sessionId: session.id,
        taskId: task.id,
        event: { type: "task.cancelled", taskId: task.id },
      });
    }
    input.store.completeHostCommand({
      commandId: commandRecord.id,
      status: "completed",
    });
    input.store.appendAuditLog({
      ownerId: link.ownerId,
      shareLinkId: link.id,
      sessionId: session.id,
      actorType: "host",
      eventType: "session.cancelled",
      summary: session.id,
      metadata: { commandId: commandRecord.id, outbound: true },
    });

    return { status: 202, body: { accepted: true } };
  }

  if (
    command.sessionId !== input.sessionId
    || command.commandType !== "task.submit"
    || command.taskId !== input.taskId
  ) {
    return { status: 403, body: { accepted: false, error: "host_command_binding_invalid" } };
  }

  const session = input.store.findSession(input.sessionId);
  const task = input.store.findTask(input.taskId);
  const link = input.store.findShareLinkById(command.shareLinkId);
  if (!session || !task || !link || session.hostId !== input.hostId || task.sessionId !== session.id) {
    return { status: 404, body: { accepted: false, error: "host_command_unavailable" } };
  }

  if (input.runtimeId) {
    input.store.updateSession({ sessionId: session.id, runtimeId: input.runtimeId, status: "running" });
  }
  input.store.updateTask({ taskId: task.id, status: "running" });

  let finalStatus: "running" | "completed" | "failed" | "cancelled" = "running";
  for (const event of input.events) {
    const safeEvent = friendSafeEvent(event, task.id);
    const alreadyRecorded = input.store
      .listRuntimeEvents({ taskId: task.id })
      .some((entry) => {
        return entry.event.type === safeEvent.type && safeEvent.type === "task.cancelled";
      });
    if (alreadyRecorded) {
      finalStatus = taskStatusFromRuntimeEvent(safeEvent, finalStatus);
      continue;
    }
    input.store.appendRuntimeEvent({
      sessionId: session.id,
      taskId: task.id,
      event: safeEvent,
    });
    finalStatus = taskStatusFromRuntimeEvent(safeEvent, finalStatus);
  }

  input.store.updateTask({ taskId: task.id, status: finalStatus });
  input.store.updateSession({ sessionId: session.id, status: sessionStatusFromTask(finalStatus) });
  input.store.completeHostCommand({
    commandId: commandRecord.id,
    status: finalStatus === "failed" ? "failed" : finalStatus === "cancelled" ? "cancelled" : "completed",
    failureReason: finalStatus === "failed" ? "host_task_failed" : undefined,
  });
  input.store.appendAuditLog({
    ownerId: link.ownerId,
    shareLinkId: link.id,
    sessionId: session.id,
    actorType: "host",
    eventType: `task.${finalStatus}`,
    summary: task.id,
    metadata: { commandId: commandRecord.id, outbound: true },
  });

  return { status: 202, body: { accepted: true } };
}

export function listOwnerHostsV1(input: {
  store: RelayStore;
  ownerId: string;
}): JsonResponse<{ hosts: PublicHost[] }> {
  enforceHostHeartbeatTimeout(input.store);

  return {
    status: 200,
    body: {
      hosts: input.store
        .snapshot()
        .hosts
        .filter((host) => host.ownerId === input.ownerId)
        .map(publicHost),
    },
  };
}

export async function listOwnerAdaptersV1(input: {
  store: RelayStore;
  ownerId: string;
  adapterInventory: { detectAll(): Promise<AgentAdapterInfo[]> };
}): Promise<JsonResponse<{ adapters: OwnerAdapterInfo[] }>> {
  enforceHostHeartbeatTimeout(input.store);

  const detectedAdapters = await input.adapterInventory.detectAll();
  const connectedHostIdsByAdapter = ownerConnectedHostIdsByAdapter(input.store, input.ownerId);
  const knownAdapterIds = new Set(detectedAdapters.map((adapter) => adapter.id));
  const adapters: OwnerAdapterInfo[] = detectedAdapters.map((adapter) => {
    const connectedHostIds = connectedHostIdsByAdapter.get(adapter.id) ?? [];
    return {
      ...adapter,
      status: connectedHostIds.length > 0 ? "available" as const : adapter.status,
      connectedHostIds,
    };
  });

  for (const [adapterId, connectedHostIds] of connectedHostIdsByAdapter) {
    if (knownAdapterIds.has(adapterId)) {
      continue;
    }

    adapters.push({
      id: adapterId,
      displayName: adapterId,
      status: "available",
      startCapability: "none",
      taskCapability: "cli_once",
      eventCapability: "stdout_text",
      desktopPreviewCapability: "none",
      connectedHostIds,
    });
  }

  return {
    status: 200,
    body: { adapters },
  };
}

export function createOwnerShareLinkV1(input: {
  store: RelayStore;
  ownerId: string;
  hostId: string;
  name: string;
  baseUrl: string;
  tokenFactory?: () => string;
  policy?: Partial<SharePolicyRecord>;
}): JsonResponse<{ shareLink: OwnerShareLink } | { error: string }> {
  const host = input.store.findHost(input.hostId);
  if (!host || host.ownerId !== input.ownerId) {
    return { status: 404, body: { error: "host_not_found" } };
  }

  if (host.status !== "online") {
    return { status: 409, body: { error: "host_unavailable" } };
  }

  const requestedAdapters = input.policy?.allowedAdapterIds;
  if (requestedAdaptersUnavailable(host, requestedAdapters)) {
    return { status: 422, body: { error: "adapter_not_available" } };
  }

  const rawToken = uniqueShareToken(input.store, input.tokenFactory);
  if (!rawToken) {
    return { status: 409, body: { error: "share_token_collision" } };
  }
  const link = input.store.createShareLink({
    ownerId: input.ownerId,
    hostId: input.hostId,
    rawToken,
    name: input.name,
    allowedAdapterIds: requestedAdapters ?? host.supportedAdapters,
    policy: input.policy,
  });
  input.store.appendAuditLog({
    ownerId: input.ownerId,
    shareLinkId: link.id,
    actorType: "owner",
    eventType: "share_link.created",
    summary: `${input.name} share link created`,
  });

  return {
    status: 201,
    body: {
      shareLink: {
        id: link.id,
        token: rawToken,
        url: `${input.baseUrl.replace(/\/$/, "")}/app/share/${rawToken}/assistant-ui`,
        name: link.name,
        status: link.status,
        expiresAt: link.expiresAt,
        policy: link.policy,
      },
    },
  };
}

export function updateOwnerShareLinkV1(input: {
  store: RelayStore;
  ownerId: string;
  shareLinkId: string;
  name?: string;
  expiresAt?: string;
  policy?: Partial<SharePolicyRecord>;
}): JsonResponse<{ shareLink: OwnerShareLinkSummary } | { error: string }> {
  const link = input.store.findShareLinkById(input.shareLinkId);
  if (!link || link.ownerId !== input.ownerId) {
    return { status: 404, body: { error: "share_link_unavailable" } };
  }

  if (link.status === "revoked" || link.status === "expired") {
    return { status: 409, body: { error: "share_link_final" } };
  }

  const host = input.store.findHost(link.hostId);
  if (!host) {
    return { status: 404, body: { error: "host_not_found" } };
  }

  if (requestedAdaptersUnavailable(host, input.policy?.allowedAdapterIds)) {
    return { status: 422, body: { error: "adapter_not_available" } };
  }

  const updated = input.store.updateShareLink({
    id: link.id,
    name: input.name,
    expiresAt: input.expiresAt,
    policy: input.policy,
  });
  if (!updated) {
    return { status: 404, body: { error: "share_link_unavailable" } };
  }

  input.store.appendAuditLog({
    ownerId: updated.ownerId,
    shareLinkId: updated.id,
    actorType: "owner",
    eventType: "share_link.updated",
    summary: `${updated.name} updated`,
  });

  return {
    status: 200,
    body: { shareLink: publicOwnerShareLink(updated) },
  };
}

export function getFriendSharePageV1(input: {
  store: RelayStore;
  token: string;
  now?: () => Date;
}): JsonResponse<FriendSharePage> {
  enforceHostHeartbeatTimeout(input.store);

  const link = input.store.findShareLinkByToken(input.token);
  const unavailable = unavailableFriendResponse(input.store, link, input.now?.() ?? input.store.now());
  if (unavailable) {
    return unavailable;
  }

  return {
    status: 200,
    body: {
      available: true,
      agent: {
        name: link.name,
        adapterId: link.policy.allowedAdapterIds[0] ?? "unknown",
        previewMode: link.policy.previewMode,
      },
    },
  };
}

export function pauseOwnerShareLinkV1(input: {
  store: RelayStore;
  token: string;
}): JsonResponse<{ ok: boolean } | { error: string }> {
  return updateLinkStatusByToken(input.store, input.token, "paused", "share_link.paused");
}

export function pauseOwnerShareLinkByIdV1(input: {
  store: RelayStore;
  ownerId: string;
  shareLinkId: string;
}): JsonResponse<{ ok: boolean } | { error: string }> {
  return updateOwnerShareLinkStatusById({
    store: input.store,
    ownerId: input.ownerId,
    shareLinkId: input.shareLinkId,
    status: "paused",
    eventType: "share_link.paused",
  });
}

export function revokeOwnerShareLinkV1(input: {
  store: RelayStore;
  token: string;
}): JsonResponse<{ ok: boolean } | { error: string }> {
  return updateLinkStatusByToken(input.store, input.token, "revoked", "share_link.revoked");
}

export async function revokeOwnerShareLinkByIdV1(input: {
  store: RelayStore;
  runtimes: HostRuntimeRegistry;
  ownerId: string;
  shareLinkId: string;
}): Promise<JsonResponse<{ ok: boolean } | { error: string }>> {
  const link = input.store.findShareLinkById(input.shareLinkId);
  if (!link || link.ownerId !== input.ownerId) {
    return { status: 404, body: { error: "share_link_unavailable" } };
  }

  const updated = input.store.updateShareLinkStatus(link.id, "revoked");
  if (!updated) {
    return { status: 404, body: { error: "share_link_unavailable" } };
  }

  const runtimeStops: Array<{ sessionId: string; runtimeId?: string; ok: boolean; error?: string }> = [];
  for (const session of input.store.snapshot().sessions) {
    if (session.shareLinkId !== updated.id || !activeSessionStatuses.has(session.status)) {
      continue;
    }

    input.store.updateSession({ sessionId: session.id, status: "cancelled" });
    input.store.cancelTasksForSession(session.id);

    if (session.runtimeId) {
      try {
        await input.runtimes.stopRuntime({
          command: buildHostCommand({
            commandType: "runtime.stop",
            ownerId: updated.ownerId,
            hostId: session.hostId,
            shareLinkId: updated.id,
            sessionId: session.id,
            adapterId: session.adapterId,
            runtimeId: session.runtimeId,
            reason: "share_link_revoked",
            policy: updated.policy,
          }),
          expected: {
            ownerId: updated.ownerId,
            hostId: session.hostId,
            shareLinkId: updated.id,
            sessionId: session.id,
            policy: updated.policy,
          },
        });
        runtimeStops.push({ sessionId: session.id, runtimeId: session.runtimeId, ok: true });
      } catch (error) {
        runtimeStops.push({
          sessionId: session.id,
          runtimeId: session.runtimeId,
          ok: false,
          error: error instanceof Error ? error.message : "runtime_stop_failed",
        });
      }
    }
  }

  input.store.appendAuditLog({
    ownerId: updated.ownerId,
    shareLinkId: updated.id,
    actorType: "owner",
    eventType: "share_link.revoked",
    summary: `${updated.name} revoked`,
    metadata: runtimeStops.length > 0 ? { runtimeStops } : undefined,
  });

  return {
    status: 200,
    body: { ok: true },
  };
}

export function resumeOwnerShareLinkByIdV1(input: {
  store: RelayStore;
  ownerId: string;
  shareLinkId: string;
}): JsonResponse<{ ok: boolean } | { error: string }> {
  return updateOwnerShareLinkStatusById({
    store: input.store,
    ownerId: input.ownerId,
    shareLinkId: input.shareLinkId,
    status: "active",
    eventType: "share_link.resumed",
  });
}

export function listOwnerAuditLogsV1(input: {
  store: RelayStore;
  ownerId: string;
}): JsonResponse<{ auditLogs: AuditLogRecord[] }> {
  return {
    status: 200,
    body: {
      auditLogs: input.store
        .snapshot()
        .auditLogs
        .filter((entry) => entry.ownerId === input.ownerId),
    },
  };
}

export function listOwnerSessionsV1(input: {
  store: RelayStore;
  ownerId: string;
}): JsonResponse<{ sessions: OwnerSession[] }> {
  const snapshot = input.store.snapshot();
  const ownedShareLinkIds = new Set(
    snapshot.shareLinks
      .filter((link) => link.ownerId === input.ownerId)
      .map((link) => link.id),
  );

  return {
    status: 200,
    body: {
      sessions: snapshot.sessions
        .filter((session) => ownedShareLinkIds.has(session.shareLinkId))
        .map(publicSession),
    },
  };
}

export function listOwnerShareLinksV1(input: {
  store: RelayStore;
  ownerId: string;
}): JsonResponse<{ shareLinks: OwnerShareLinkSummary[] }> {
  return {
    status: 200,
    body: {
      shareLinks: input.store
        .snapshot()
        .shareLinks
        .filter((link) => link.ownerId === input.ownerId)
        .map(publicOwnerShareLink),
    },
  };
}

export function listOwnerTasksV1(input: {
  store: RelayStore;
  ownerId: string;
}): JsonResponse<{ tasks: OwnerTaskSummary[] }> {
  const snapshot = input.store.snapshot();
  const ownedShareLinkIds = new Set(
    snapshot.shareLinks
      .filter((link) => link.ownerId === input.ownerId)
      .map((link) => link.id),
  );
  const sessionsById = new Map(
    snapshot.sessions
      .filter((session) => ownedShareLinkIds.has(session.shareLinkId))
      .map((session) => [session.id, session]),
  );

  return {
    status: 200,
    body: {
      tasks: snapshot.tasks
        .flatMap((task) => {
          const session = sessionsById.get(task.sessionId);
          if (!session) {
            return [];
          }
          return [publicOwnerTask(task, session)];
        }),
    },
  };
}

export function listOwnerApprovalRequestsV1(input: {
  store: RelayStore;
  ownerId: string;
  status?: ApprovalRequestRecord["status"];
}): JsonResponse<{ approvalRequests: ApprovalRequestRecord[] }> {
  return {
    status: 200,
    body: {
      approvalRequests: input.store
        .listApprovalRequests({ status: input.status })
        .filter((request) => request.ownerId === input.ownerId),
    },
  };
}

export function resolveOwnerApprovalRequestV1(input: {
  store: RelayStore;
  ownerId: string;
  requestId: string;
  status: "approved" | "denied";
}): JsonResponse<{ approvalRequest: ApprovalRequestRecord } | { error: string }> {
  const request = input.store
    .snapshot()
    .approvalRequests
    .find((entry) => entry.id === input.requestId);
  if (!request || request.ownerId !== input.ownerId || request.requiredDecision !== "owner_approve") {
    return { status: 404, body: { error: "approval_request_not_found" } };
  }

  return resolveApprovalRequestV1({
    store: input.store,
    requestId: input.requestId,
    status: input.status,
    resolvedBy: "owner",
  });
}

export function listFriendConfirmationsV1(input: {
  store: RelayStore;
  token: string;
  sessionId: string;
}): JsonResponse<{ confirmations: FriendConfirmation[] } | { confirmations: []; available: false; error: string }> {
  const link = input.store.findShareLinkByToken(input.token);
  const unavailable = unavailableFriendLinkResponse(link, input.store.now());
  if (unavailable) {
    return {
      status: unavailable.status,
      body: { confirmations: [], available: false, error: unavailable.body.error },
    };
  }

  const session = input.store.findSession(input.sessionId);
  if (!session || session.shareLinkId !== link.id) {
    return {
      status: 404,
      body: { confirmations: [], available: false, error: "confirmations_unavailable" },
    };
  }

  const confirmations = input.store
    .listApprovalRequests({ status: "pending" })
    .filter((request) => {
      return request.requiredDecision === "user_confirm" && request.sessionId === input.sessionId;
    })
    .map(publicConfirmation);

  return {
    status: 200,
    body: { confirmations },
  };
}

export function resolveFriendConfirmationV1(input: {
  store: RelayStore;
  token: string;
  sessionId: string;
  requestId: string;
  status: "approved" | "denied";
}): JsonResponse<{ confirmation: FriendConfirmation } | { error: string }> {
  const link = input.store.findShareLinkByToken(input.token);
  const unavailable = unavailableFriendLinkResponse(link, input.store.now());
  if (unavailable) {
    return { status: unavailable.status, body: { error: unavailable.body.error } };
  }

  const session = input.store.findSession(input.sessionId);
  if (!session || session.shareLinkId !== link.id) {
    return { status: 404, body: { error: "confirmation_not_found" } };
  }

  const request = input.store
    .snapshot()
    .approvalRequests
    .find((entry) => entry.id === input.requestId);
  if (!request || request.requiredDecision !== "user_confirm" || request.sessionId !== input.sessionId) {
    return { status: 404, body: { error: "confirmation_not_found" } };
  }

  const resolved = resolveApprovalRequestV1({
    store: input.store,
    requestId: input.requestId,
    status: input.status,
    resolvedBy: "friend",
  });
  if (resolved.status !== 200) {
    return { status: resolved.status, body: resolved.body };
  }

  return {
    status: 200,
    body: { confirmation: publicConfirmation(resolved.body.approvalRequest) },
  };
}

export function createFriendSessionV1(input: {
  store: RelayStore;
  token: string;
  displayName?: string;
}): JsonResponse<FriendSessionResponse> {
  enforceHostHeartbeatTimeout(input.store);
  const link = input.store.findShareLinkByToken(input.token);
  const unavailable = unavailableFriendResponse(input.store, link, input.store.now());
  if (unavailable) {
    return {
      status: unavailable.status,
      body: { available: false, error: unavailable.body.error },
    };
  }

  const host = input.store.findHost(link.hostId);
  const adapterId = link.policy.allowedAdapterIds[0];
  if (!host || !adapterId) {
    return {
      status: 503,
      body: { available: false, error: "shared_agent_unavailable" },
    };
  }

  expireStaleSessionsForLink(input.store, link);
  const rateLimitRejection = requestRateLimitPreflight(input.store, link);
  if (rateLimitRejection) {
    recordRateLimitRejection(input.store, link, rateLimitRejection);
    return {
      status: 429,
      body: { available: false, error: "shared_agent_unavailable" },
    };
  }

  if (input.store.activeSessionCount(link.id) >= link.policy.maxConcurrentSessions) {
    input.store.appendAuditLog({
      ownerId: link.ownerId,
      shareLinkId: link.id,
      actorType: "system",
      eventType: "session.rejected",
      summary: "max_concurrent_sessions",
    });
    return {
      status: 429,
      body: { available: false, error: "shared_agent_unavailable" },
    };
  }

  const displayNameResult = normalizeFriendDisplayName(input.displayName);
  if (!displayNameResult.ok) {
    return {
      status: 422,
      body: { available: false, error: displayNameResult.error },
    };
  }

  const friendActorId = generateFriendActorId();
  const session = input.store.createSession({
    shareLinkId: link.id,
    friendActorId,
    friendDisplayName: displayNameResult.value,
    hostId: host.id,
    adapterId,
  });
  input.store.appendAuditLog({
    ownerId: link.ownerId,
    shareLinkId: link.id,
    sessionId: session.id,
    actorType: "friend",
    eventType: "session.created",
    summary: friendActorId,
    metadata: {
      friendActorId,
      displayName: displayNameResult.value,
    },
  });

  return {
    status: 201,
    body: { session: publicFriendSession(session, link) },
  };
}

export function startFriendAuthV1(input: {
  store: RelayStore;
  token: string;
  sessionId: string;
  provider: string;
}): JsonResponse<FriendAuthStartResponse> {
  enforceHostHeartbeatTimeout(input.store);

  const link = input.store.findShareLinkByToken(input.token);
  const unavailable = unavailableFriendResponse(input.store, link, input.store.now());
  if (unavailable) {
    return {
      status: unavailable.status,
      body: { available: false, error: unavailable.body.error },
    };
  }

  const session = input.store.findSession(input.sessionId);
  if (!session || session.shareLinkId !== link.id) {
    return {
      status: 404,
      body: { available: false, error: "auth_unavailable" },
    };
  }

  if (!activeSessionStatuses.has(session.status)) {
    return {
      status: 409,
      body: { available: false, error: "auth_unavailable" },
    };
  }

  const provider = parseFriendAuthProvider(input.provider);
  if (!provider) {
    return {
      status: 400,
      body: { available: false, error: "auth_not_configured" },
    };
  }

  const request = input.store.createFriendAuthRequest({
    shareLinkId: link.id,
    sessionId: session.id,
    friendActorId: session.friendActorId,
    provider,
    policyVersion: computePolicyVersion(link.policy),
  });

  input.store.appendAuditLog({
    ownerId: link.ownerId,
    shareLinkId: link.id,
    sessionId: session.id,
    actorType: "friend",
    eventType: "auth.started",
    summary: provider,
    metadata: {
      authRequestId: request.id,
      provider,
      friendActorId: session.friendActorId,
      policyVersion: request.policyVersion,
    },
  });

  return {
    status: 201,
    body: { auth: buildPendingAuthState({ id: request.id, provider }) },
  };
}

export async function submitFriendTaskV1(input: {
  store: RelayStore;
  runtimes: HostRuntimeRegistry;
  token: string;
  sessionId?: string;
  prompt: string;
  estimatedTaskBudget?: number;
}): Promise<JsonResponse<FriendTaskResponse>> {
  enforceHostHeartbeatTimeout(input.store);

  const prompt = input.prompt.trim();
  if (!prompt) {
    return friendTaskUnavailable(422, "prompt_required");
  }

  const link = input.store.findShareLinkByToken(input.token);
  const unavailable = unavailableFriendResponse(input.store, link, input.store.now());
  if (unavailable) {
    return {
      status: unavailable.status,
      body: {
        task: undefined,
        events: [],
        available: false,
        error: unavailable.body.error,
      },
    };
  }

  const host = input.store.findHost(link.hostId);
  expireStaleSessionsForLink(input.store, link);
  let adapterId = link.policy.allowedAdapterIds[0];
  let session: SessionRecord | undefined;
  let reusingInactiveSession = false;
  if (input.sessionId) {
    const existing = input.store.findSession(input.sessionId);
    if (!existing || existing.shareLinkId !== link.id) {
      return friendTaskUnavailable(404, "session_unavailable");
    }
    if (!reusableSessionStatuses.has(existing.status)) {
      return friendTaskUnavailable(409, "session_unavailable");
    }
    reusingInactiveSession = !activeSessionStatuses.has(existing.status);
    session = existing;
    adapterId = existing.adapterId;
  }
  if (!adapterId) {
    return friendTaskUnavailable(503, "shared_agent_unavailable");
  }
  if (!host) {
    return {
      status: 503,
      body: {
        task: undefined,
        events: [],
        available: false,
        error: "shared_agent_unavailable",
      },
    };
  }
  const hasInProcessAdapter = Boolean(input.runtimes.findAdapter(link.hostId, adapterId));
  const canUseOutboundHost = hostSupportsOutboundCommands(host);
  if (!hasInProcessAdapter && !canUseOutboundHost) {
    return friendTaskUnavailable(503, "shared_agent_unavailable");
  }

  const rateLimitRejection = requestRateLimitPreflight(input.store, link);
  if (rateLimitRejection) {
    recordRateLimitRejection(input.store, link, rateLimitRejection);
    return friendTaskUnavailable(429, "shared_agent_unavailable");
  }

  const estimatedTaskBudget = input.estimatedTaskBudget ?? 0;
  const budgetRejection = budgetPreflight(link, estimatedTaskBudget);
  if (budgetRejection) {
    input.store.appendAuditLog({
      ownerId: link.ownerId,
      shareLinkId: link.id,
      actorType: "system",
      eventType: "budget.rejected",
      summary: budgetRejection,
      metadata: { estimatedTaskBudget },
    });
    return {
      status: 402,
      body: {
        task: undefined,
        events: [],
        available: false,
        error: "shared_agent_unavailable",
      },
    };
  }

  if ((!session || reusingInactiveSession) && input.store.activeSessionCount(link.id) >= link.policy.maxConcurrentSessions) {
    input.store.appendAuditLog({
      ownerId: link.ownerId,
      shareLinkId: link.id,
      actorType: "system",
      eventType: "session.rejected",
      summary: "max_concurrent_sessions",
    });
    return {
      status: 429,
      body: {
        task: undefined,
        events: [],
        available: false,
        error: "shared_agent_unavailable",
      },
    };
  }

  session ??= input.store.createSession({
    shareLinkId: link.id,
    friendActorId: generateFriendActorId(),
    hostId: host.id,
    adapterId,
  });
  if (reusingInactiveSession) {
    const resumedSession = input.store.updateSession({ sessionId: session.id, status: "waiting" });
    if (!resumedSession) {
      return friendTaskUnavailable(404, "session_unavailable");
    }
    session = resumedSession;
  }
  const task = input.store.createTask({
    sessionId: session.id,
    prompt,
  });
  input.store.appendAuditLog({
    ownerId: link.ownerId,
    shareLinkId: link.id,
    sessionId: session.id,
    actorType: "friend",
    eventType: "task.submitted",
    summary: prompt,
    metadata: {
      friendActorId: session.friendActorId,
      displayName: session.friendDisplayName,
    },
  });

  try {
    const latestLink = input.store.findShareLinkById(link.id);
    const latestLinkUnavailable = unavailableFriendLinkResponse(latestLink, input.store.now());
    if (latestLinkUnavailable) {
      input.store.updateTask({ taskId: task.id, status: "cancelled" });
      input.store.updateSession({ sessionId: session.id, status: "cancelled" });
      return friendTaskUnavailable(latestLinkUnavailable.status, latestLinkUnavailable.body.error);
    }

    const latestSession = input.store.findSession(session.id);
    if (!latestSession || latestSession.status !== "waiting") {
      input.store.updateTask({ taskId: task.id, status: "cancelled" });
      return friendTaskUnavailable(409, "session_unavailable");
    }

    const expected = {
      ownerId: link.ownerId,
      hostId: link.hostId,
      shareLinkId: link.id,
      sessionId: session.id,
      policy: link.policy,
    };

    if (!hasInProcessAdapter && canUseOutboundHost) {
      const command = input.store.enqueueHostCommand({
        hostId: link.hostId,
        command: buildHostCommand({
          commandType: "task.submit",
          ownerId: link.ownerId,
          hostId: link.hostId,
          shareLinkId: link.id,
          sessionId: session.id,
          adapterId,
          taskId: task.id,
          prompt,
          estimatedTaskBudget,
          policy: link.policy,
        }),
      });
      input.store.updateSession({ sessionId: session.id, status: "waiting" });
      input.store.appendAuditLog({
        ownerId: link.ownerId,
        shareLinkId: link.id,
        sessionId: session.id,
        actorType: "system",
        eventType: "host_command.queued",
        summary: command.id,
        metadata: { hostId: link.hostId, taskId: task.id },
      });
      return {
        status: 202,
        body: {
          task: {
            id: task.id,
            status: "waiting",
          },
          events: [],
        },
      };
    }

    const { runtime, adapter } = await input.runtimes.startRuntime({
      command: buildHostCommand({
        commandType: "runtime.start",
        ownerId: link.ownerId,
        hostId: link.hostId,
        shareLinkId: link.id,
        sessionId: session.id,
        adapterId,
        policy: link.policy,
      }),
      expected,
    });
    const linkAfterStart = input.store.findShareLinkById(link.id);
    const linkAfterStartUnavailable = unavailableFriendLinkResponse(linkAfterStart, input.store.now());
    if (linkAfterStartUnavailable) {
      input.store.updateTask({ taskId: task.id, status: "cancelled" });
      input.store.updateSession({ sessionId: session.id, status: "cancelled" });
      try {
        await input.runtimes.stopRuntime({
          command: buildHostCommand({
            commandType: "runtime.stop",
            ownerId: link.ownerId,
            hostId: link.hostId,
            shareLinkId: link.id,
            sessionId: session.id,
            adapterId,
            runtimeId: runtime.runtimeId,
            reason: "share_link_revoked",
            policy: link.policy,
          }),
          expected,
        });
      } catch {
        // best effort: owner controls and audits will capture runtime stop failures
      }
      return friendTaskUnavailable(linkAfterStartUnavailable.status, linkAfterStartUnavailable.body.error);
    }
    const sessionBeforeRun = input.store.findSession(session.id);
    if (!sessionBeforeRun || sessionBeforeRun.status !== "waiting") {
      input.store.updateTask({ taskId: task.id, status: "cancelled" });
      try {
        await input.runtimes.stopRuntime({
          command: buildHostCommand({
            commandType: "runtime.stop",
            ownerId: link.ownerId,
            hostId: link.hostId,
            shareLinkId: link.id,
            sessionId: session.id,
            adapterId,
            runtimeId: runtime.runtimeId,
            reason: "session_cancelled",
            policy: link.policy,
          }),
          expected,
        });
      } catch {
        // best effort: owner controls and audits will capture runtime stop failures
      }
      return friendTaskUnavailable(409, "session_unavailable");
    }

    input.store.updateSession({
      sessionId: session.id,
      runtimeId: runtime.runtimeId,
      status: "running",
    });
    input.store.updateTask({ taskId: task.id, status: "running" });

    const taskHandle = await input.runtimes.submitTask({
      command: buildHostCommand({
        commandType: "task.submit",
        ownerId: link.ownerId,
        hostId: link.hostId,
        shareLinkId: link.id,
        sessionId: session.id,
        adapterId,
        taskId: task.id,
        prompt,
        estimatedTaskBudget,
        policy: link.policy,
      }),
      expected,
      runtime,
    });
    const status = taskStatusFromHandle(taskHandle);
    input.store.updateTask({ taskId: task.id, status });
    input.store.addShareLinkBudgetUsage(link.id, estimatedTaskBudget);

    const events = [];
    for await (const event of adapter.streamEvents({ runtime, task: taskHandle })) {
      const safeEvent = friendSafeEvent(event, task.id);
      input.store.appendRuntimeEvent({
        sessionId: session.id,
        taskId: task.id,
        event: safeEvent,
      });
      events.push(safeEvent);
    }

    input.store.updateSession({ sessionId: session.id, status: sessionStatusFromTask(status) });
    input.store.appendAuditLog({
      ownerId: link.ownerId,
      shareLinkId: link.id,
      sessionId: session.id,
      actorType: "host",
      eventType: `task.${status}`,
      summary: task.id,
    });

    return {
      status: 202,
      body: {
        task: {
          id: task.id,
          status,
        },
        events,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "task failed";
    const failedEvent: RuntimeEvent = { type: "task.failed", taskId: task.id, message };
    input.store.updateTask({ taskId: task.id, status: "failed", failureReason: message });
    input.store.updateSession({ sessionId: session.id, status: "failed" });
    input.store.appendRuntimeEvent({
      sessionId: session.id,
      taskId: task.id,
      event: failedEvent,
    });
    input.store.appendAuditLog({
      ownerId: link.ownerId,
      shareLinkId: link.id,
      sessionId: session.id,
      actorType: "host",
      eventType: "task.failed",
      summary: message,
    });
    return {
      status: 502,
      body: {
        task: {
          id: task.id,
          status: "failed",
        },
        events: [failedEvent],
      },
    };
  }
}

export function getFriendTaskEventsV1(input: {
  store: RelayStore;
  token: string;
  sessionId: string;
  taskId?: string;
  format?: "runtime" | "ag-ui";
}): JsonResponse<FriendEventsResponse> {
  const link = input.store.findShareLinkByToken(input.token);
  const unavailable = unavailableFriendLinkResponse(link, input.store.now());
  if (unavailable) {
    return {
      status: unavailable.status,
      body: { events: [], available: false, error: unavailable.body.error },
    };
  }

  const session = input.store.findSession(input.sessionId);
  if (!session || session.shareLinkId !== link.id) {
    return {
      status: 404,
      body: { events: [], available: false, error: "events_unavailable" },
    };
  }

  const requestedTask = input.taskId ? input.store.findTask(input.taskId) : undefined;
  if (input.taskId) {
    const task = requestedTask;
    if (!task || task.sessionId !== session.id) {
      return {
        status: 404,
        body: { events: [], available: false, error: "events_unavailable" },
      };
    }
  }

  const events = input.store
    .listRuntimeEvents(input.taskId ? { taskId: input.taskId } : {})
    .filter((entry) => entry.sessionId === session.id);

  if (input.format === "ag-ui") {
    const groupedEvents = new Map<string, RuntimeEvent[]>();
    for (const entry of events) {
      const taskId = entry.taskId || entry.event.taskId;
      groupedEvents.set(taskId, [...(groupedEvents.get(taskId) ?? []), entry.event]);
    }
    const agUiEvents = [...groupedEvents.entries()].flatMap(([taskId, runtimeEvents]) => {
      const task = input.store.findTask(taskId);
      return runtimeEventsToAgUiEvents({
        threadId: session.id,
        runId: taskId,
        prompt: task?.prompt,
        events: runtimeEvents,
      });
    });

    return {
      status: 200,
      body: {
        format: "ag-ui",
        events: agUiEvents,
      },
    };
  }

  return {
    status: 200,
    body: {
      events: events.map((entry) => entry.event),
    },
  };
}

export async function cancelFriendSessionV1(input: {
  store: RelayStore;
  runtimes: HostRuntimeRegistry;
  token: string;
  sessionId: string;
}): Promise<JsonResponse<FriendSessionCancelResponse>> {
  const link = input.store.findShareLinkByToken(input.token);
  const unavailable = unavailableFriendLinkResponse(link, input.store.now());
  if (unavailable) {
    return {
      status: unavailable.status,
      body: { available: false, error: unavailable.body.error },
    };
  }

  const existing = input.store.findSession(input.sessionId);
  if (!existing || existing.shareLinkId !== link.id) {
    return {
      status: 404,
      body: { available: false, error: "session_unavailable" },
    };
  }

  const session = input.store.updateSession({
    sessionId: existing.id,
    status: "cancelled",
  });
  if (!session) {
    return {
      status: 404,
      body: { available: false, error: "session_unavailable" },
    };
  }

  const cancelledTasks = input.store.cancelTasksForSession(session.id);
  for (const task of cancelledTasks) {
    input.store.appendRuntimeEvent({
      sessionId: session.id,
      taskId: task.id,
      event: { type: "task.cancelled", taskId: task.id },
    });
  }

  const host = input.store.findHost(existing.hostId);
  let hostCommand: HostCommandRecord | undefined;
  if (host && hostSupportsOutboundCommands(host)) {
    hostCommand = input.store.enqueueHostCommand({
      hostId: existing.hostId,
      command: buildHostCommand({
        commandType: "session.cancel",
        ownerId: link.ownerId,
        hostId: existing.hostId,
        shareLinkId: link.id,
        sessionId: existing.id,
        adapterId: existing.adapterId,
        reason: "friend_cancelled",
        policy: link.policy,
      }),
    });
  }

  let runtimeStop: { ok: boolean; runtimeId?: string; error?: string } | undefined;
  if (existing.runtimeId) {
    try {
      await input.runtimes.stopRuntime({
        command: buildHostCommand({
          commandType: "runtime.stop",
          ownerId: link.ownerId,
          hostId: existing.hostId,
          shareLinkId: link.id,
          sessionId: existing.id,
          adapterId: existing.adapterId,
          runtimeId: existing.runtimeId,
          reason: "friend_cancelled",
          policy: link.policy,
        }),
        expected: {
          ownerId: link.ownerId,
          hostId: existing.hostId,
          shareLinkId: link.id,
          sessionId: existing.id,
          policy: link.policy,
        },
      });
      runtimeStop = { ok: true, runtimeId: existing.runtimeId };
    } catch (error) {
      runtimeStop = {
        ok: false,
        runtimeId: existing.runtimeId,
        error: error instanceof Error ? error.message : "runtime_stop_failed",
      };
    }
  }

  input.store.appendAuditLog({
    ownerId: link.ownerId,
    shareLinkId: link.id,
    sessionId: session.id,
    actorType: "friend",
    eventType: "session.cancelled",
    summary: session.id,
    metadata: {
      ...(runtimeStop ? { runtimeStop } : {}),
      ...(hostCommand ? { hostCommandId: hostCommand.id } : {}),
    },
  });

  return {
    status: 200,
    body: { session: { id: session.id, status: "cancelled" } },
  };
}

export function markHostOfflineV1(input: {
  store: RelayStore;
  ownerId: string;
  hostId: string;
}): JsonResponse<{ host: PublicHost } | { error: string }> {
  const host = input.store.updateHostStatus(input.hostId, "offline");
  if (!host) {
    return { status: 404, body: { error: "host_not_found" } };
  }

  input.store.appendAuditLog({
    ownerId: input.ownerId,
    actorType: "host",
    eventType: "host.offline",
    summary: host.deviceName,
    metadata: { hostId: host.id },
  });

  return {
    status: 200,
    body: { host: publicHost(host) },
  };
}

export async function cancelOwnerSessionV1(input: {
  store: RelayStore;
  runtimes: HostRuntimeRegistry;
  ownerId: string;
  sessionId: string;
}): Promise<JsonResponse<{ session: { id: string; status: "cancelled" } } | { error: string }>> {
  const existing = input.store.findSession(input.sessionId);
  if (!existing) {
    return { status: 404, body: { error: "session_not_found" } };
  }

  const link = input.store.findShareLinkById(existing.shareLinkId);
  if (!link || link.ownerId !== input.ownerId) {
    return { status: 404, body: { error: "session_not_found" } };
  }

  const command = buildHostCommand({
    commandType: "session.cancel",
    ownerId: link.ownerId,
    hostId: existing.hostId,
    shareLinkId: link.id,
    sessionId: existing.id,
    adapterId: existing.adapterId,
    policy: link.policy,
  });

  const session = input.store.updateSession({
    sessionId: input.sessionId,
    status: "cancelled",
  });
  if (!session) {
    return { status: 404, body: { error: "session_not_found" } };
  }

  input.store.cancelTasksForSession(session.id);
  let runtimeStop: { ok: boolean; runtimeId?: string; error?: string } | undefined;
  if (existing.runtimeId) {
    try {
      await input.runtimes.stopRuntime({
        command: buildHostCommand({
          commandType: "runtime.stop",
          ownerId: link.ownerId,
          hostId: existing.hostId,
          shareLinkId: link.id,
          sessionId: existing.id,
          adapterId: existing.adapterId,
          runtimeId: existing.runtimeId,
          reason: "session_cancelled",
          policy: link.policy,
        }),
        expected: {
          ownerId: link.ownerId,
          hostId: existing.hostId,
          shareLinkId: link.id,
          sessionId: existing.id,
          policy: link.policy,
        },
      });
      runtimeStop = { ok: true, runtimeId: existing.runtimeId };
    } catch (error) {
      runtimeStop = {
        ok: false,
        runtimeId: existing.runtimeId,
        error: error instanceof Error ? error.message : "runtime_stop_failed",
      };
    }
  }
  input.store.appendAuditLog({
    ownerId: input.ownerId,
    shareLinkId: session.shareLinkId,
    sessionId: session.id,
    actorType: "owner",
    eventType: "session.cancelled",
    summary: session.id,
    metadata: runtimeStop ? { hostCommand: command, runtimeStop } : { hostCommand: command },
  });

  return {
    status: 200,
    body: { session: { id: session.id, status: "cancelled" } },
  };
}

export function gateRuntimeActionV1(input: {
  store: RelayStore;
  ownerId: string;
  sessionId: string;
  taskId: string;
  action: string;
  permissionSource: PermissionSource;
  summary: string;
  command?: string;
}): JsonResponse<ApprovalGateResponse> {
  const classification = classifyHighRiskAction({
    action: input.action,
    permissionSource: input.permissionSource,
    summary: input.summary,
    command: input.command,
  });
  const session = input.store.findSession(input.sessionId);
  const friendIdentity = session
    ? { friendActorId: session.friendActorId, displayName: session.friendDisplayName }
    : undefined;

  if (classification.decision === "allow") {
    input.store.appendAuditLog({
      ownerId: input.ownerId,
      sessionId: input.sessionId,
      actorType: "system",
      eventType: "approval.allowed",
      summary: input.summary,
      metadata: { action: input.action, reason: classification.reason, ...(friendIdentity ?? {}) },
    });
    return {
      status: 200,
      body: { decision: "allow", reason: classification.reason },
    };
  }

  if (classification.decision === "block") {
    input.store.appendAuditLog({
      ownerId: input.ownerId,
      sessionId: input.sessionId,
      actorType: "system",
      eventType: "approval.blocked",
      summary: input.summary,
      metadata: { action: input.action, reason: classification.reason, ...(friendIdentity ?? {}) },
    });
    return {
      status: 403,
      body: { decision: "block", reason: classification.reason },
    };
  }

  const approvalRequest = input.store.createApprovalRequest({
    ownerId: input.ownerId,
    sessionId: input.sessionId,
    taskId: input.taskId,
    actionType: input.action,
    permissionSource: input.permissionSource,
    summary: input.summary,
    riskLevel: "high",
    requiredDecision: classification.decision,
  });
  input.store.appendAuditLog({
    ownerId: input.ownerId,
    sessionId: input.sessionId,
    actorType: "system",
    eventType: `approval.${classification.decision}.requested`,
    summary: input.summary,
    metadata: { approvalRequestId: approvalRequest.id, action: input.action, ...(friendIdentity ?? {}) },
  });

  return {
    status: 202,
    body: {
      decision: classification.decision,
      reason: classification.reason,
      approvalRequest,
    },
  };
}

export function resolveApprovalRequestV1(input: {
  store: RelayStore;
  requestId: string;
  status: "approved" | "denied";
  resolvedBy: "owner" | "friend";
}): JsonResponse<{ approvalRequest: ApprovalRequestRecord } | { error: string }> {
  const approvalRequest = input.store.resolveApprovalRequest({
    requestId: input.requestId,
    status: input.status,
    resolvedBy: input.resolvedBy,
  });
  if (!approvalRequest) {
    return { status: 404, body: { error: "approval_request_not_found" } };
  }

  const session = input.store.findSession(approvalRequest.sessionId);
  const friendIdentity = session
    ? { friendActorId: session.friendActorId, displayName: session.friendDisplayName }
    : undefined;

  input.store.appendAuditLog({
    ownerId: approvalRequest.ownerId,
    sessionId: approvalRequest.sessionId,
    actorType: input.resolvedBy,
    eventType: `approval.${input.status}`,
    summary: approvalRequest.summary,
    metadata: { approvalRequestId: approvalRequest.id, ...(friendIdentity ?? {}) },
  });

  return {
    status: 200,
    body: { approvalRequest },
  };
}

export function appendHostPreviewFrameV1(input: {
  store: RelayStore;
  ownerId: string;
  sessionId: string;
  taskId: string;
  contentType: PreviewFrameRecord["contentType"];
  data: string;
}): JsonResponse<{ frame: PreviewFrameRecord } | { error: string }> {
  const session = input.store.findSession(input.sessionId);
  if (!session) {
    return { status: 404, body: { error: "session_not_found" } };
  }

  const task = input.store.findTask(input.taskId);
  if (!task || task.sessionId !== session.id) {
    return { status: 404, body: { error: "task_not_found" } };
  }

  if (!previewContentTypes.has(input.contentType)) {
    input.store.appendAuditLog({
      ownerId: input.ownerId,
      shareLinkId: session.shareLinkId,
      sessionId: session.id,
      actorType: "host",
      eventType: "preview.frame_rejected",
      summary: "unsupported_content_type",
      metadata: {
        taskId: input.taskId,
        contentType: input.contentType,
      },
    });
    return { status: 415, body: { error: "preview_frame_rejected" } };
  }

  const normalizedBase64 = normalizeBase64(input.data);
  if (!normalizedBase64.ok) {
    input.store.appendAuditLog({
      ownerId: input.ownerId,
      shareLinkId: session.shareLinkId,
      sessionId: session.id,
      actorType: "host",
      eventType: "preview.frame_rejected",
      summary: "invalid_base64",
      metadata: {
        taskId: input.taskId,
        contentType: input.contentType,
      },
    });
    return { status: 422, body: { error: "preview_frame_rejected" } };
  }

  if (normalizedBase64.byteLength > previewMaxBytes) {
    input.store.appendAuditLog({
      ownerId: input.ownerId,
      shareLinkId: session.shareLinkId,
      sessionId: session.id,
      actorType: "host",
      eventType: "preview.frame_rejected",
      summary: "too_large",
      metadata: {
        taskId: input.taskId,
        contentType: input.contentType,
        byteLength: normalizedBase64.byteLength,
      },
    });
    return { status: 413, body: { error: "preview_frame_rejected" } };
  }

  const frame = input.store.appendPreviewFrame({
    sessionId: input.sessionId,
    taskId: input.taskId,
    contentType: input.contentType,
    data: normalizedBase64.base64,
    byteLength: normalizedBase64.byteLength,
  });
  input.store.appendAuditLog({
    ownerId: input.ownerId,
    shareLinkId: session.shareLinkId,
    sessionId: session.id,
    actorType: "host",
    eventType: "preview.frame",
    summary: input.contentType,
    metadata: {
      taskId: input.taskId,
      contentType: input.contentType,
      byteLength: frame.byteLength,
    },
  });

  return {
    status: 201,
    body: { frame },
  };
}

export function getFriendPreviewV1(input: {
  store: RelayStore;
  token: string;
  sessionId: string;
  taskId: string;
  now?: () => Date;
}): JsonResponse<FriendPreviewResponse> {
  const link = input.store.findShareLinkByToken(input.token);
  const unavailable = unavailableFriendResponse(input.store, link, input.now?.() ?? input.store.now());
  if (unavailable) {
    return {
      status: unavailable.status,
      body: { frames: [], available: false, error: unavailable.body.error },
    };
  }

  const session = input.store.findSession(input.sessionId);
  if (!session || session.shareLinkId !== link.id) {
    return {
      status: 404,
      body: { frames: [], available: false, error: "preview_unavailable" },
    };
  }

  const task = input.store.findTask(input.taskId);
  if (!task || task.sessionId !== session.id) {
    return {
      status: 404,
      body: { frames: [], available: false, error: "preview_unavailable" },
    };
  }

  const frames = input.store.listPreviewFrames({ sessionId: input.sessionId, taskId: input.taskId });
  const latest = frames.at(-1);
  if (latest) {
    const now = input.now?.() ?? input.store.now();
    const created = new Date(latest.createdAt);
    if (Number.isFinite(created.getTime()) && now.getTime() - created.getTime() > previewStaleMs) {
      return {
        status: 200,
        body: { frames: [], available: false, error: "preview_stale" },
      };
    }
  }

  return {
    status: 200,
    body: {
      frames,
    },
  };
}

export function rejectPreviewInteractionV1(input: {
  store: RelayStore;
  ownerId: string;
  sessionId: string;
  inputType: "click" | "key" | "pointer" | "paste";
}): JsonResponse<{ ok: false; error: string }> {
  input.store.appendAuditLog({
    ownerId: input.ownerId,
    sessionId: input.sessionId,
    actorType: "friend",
    eventType: "preview.interaction_blocked",
    summary: input.inputType,
  });

  return {
    status: 403,
    body: {
      ok: false,
      error: "preview_read_only",
    },
  };
}

function publicHost(host: HostRecord): PublicHost {
  return {
    id: host.id,
    ownerId: host.ownerId,
    deviceName: host.deviceName,
    hostVersion: host.hostVersion,
    status: host.status,
    lastSeenAt: host.lastSeenAt,
    offlineReason: host.offlineReason,
    supportedAdapters: host.supportedAdapters,
  };
}

const previewContentTypes = new Set<PreviewFrameRecord["contentType"]>([
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
]);

const previewMaxBytes = 256 * 1024;
const previewStaleMs = 30 * 1000;

function normalizeBase64(input: string): { ok: true; base64: string; byteLength: number } | { ok: false } {
  const base64 = String(input).replace(/\s+/g, "");
  if (!base64) {
    return { ok: true, base64: "", byteLength: 0 };
  }

  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    return { ok: false };
  }

  const remainder = base64.length % 4;
  if (remainder === 1) {
    return { ok: false };
  }

  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const byteLength = Math.floor((base64.length * 3) / 4) - padding;
  if (!Number.isFinite(byteLength) || byteLength < 0) {
    return { ok: false };
  }

  return { ok: true, base64, byteLength };
}

function ownerConnectedHostIdsByAdapter(store: RelayStore, ownerId: string): Map<string, string[]> {
  const byAdapter = new Map<string, string[]>();
  for (const host of store.snapshot().hosts) {
    if (host.ownerId !== ownerId || host.status !== "online") {
      continue;
    }

    for (const adapterId of host.supportedAdapters) {
      const hostIds = byAdapter.get(adapterId) ?? [];
      hostIds.push(host.id);
      byAdapter.set(adapterId, hostIds);
    }
  }

  return byAdapter;
}

function requestedAdaptersUnavailable(host: HostRecord, requestedAdapters: string[] | undefined): boolean {
  if (!requestedAdapters) {
    return false;
  }

  const supported = new Set(host.supportedAdapters);
  return requestedAdapters.length === 0 || !requestedAdapters.every((adapterId) => supported.has(adapterId));
}

function hostSupportsOutboundCommands(host: HostRecord): boolean {
  return host.capabilities.includes("outbound_commands");
}

function publicSession(session: SessionRecord): OwnerSession {
  return {
    id: session.id,
    shareLinkId: session.shareLinkId,
    friendActorId: session.friendActorId,
    hostId: session.hostId,
    adapterId: session.adapterId,
    status: session.status,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    lastEventAt: session.lastEventAt,
  };
}

function publicFriendSession(session: SessionRecord, link: ShareLinkRecord): FriendSession {
  return {
    id: session.id,
    adapterId: session.adapterId,
    status: session.status,
    startedAt: session.startedAt,
    lastEventAt: session.lastEventAt,
    previewMode: link.policy.previewMode,
    friendActorId: session.friendActorId,
    displayName: session.friendDisplayName,
  };
}

function publicOwnerShareLink(link: ShareLinkRecord): OwnerShareLinkSummary {
  return {
    id: link.id,
    hostId: link.hostId,
    name: link.name,
    status: link.status,
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
    revokedAt: link.revokedAt,
    budgetUsed: link.budgetUsed,
    allowedAdapterIds: [...link.policy.allowedAdapterIds],
    maxTotalBudget: link.policy.maxTotalBudget,
    maxTaskBudget: link.policy.maxTaskBudget,
    maxConcurrentSessions: link.policy.maxConcurrentSessions,
    maxRequestsPerMinute: link.policy.maxRequestsPerMinute ?? 30,
    sessionTtlMs: link.policy.sessionTtlMs ?? 30 * 60 * 1000,
  };
}

function friendTaskUnavailable(status: number, error: string): JsonResponse<FriendTaskResponse> {
  return {
    status,
    body: {
      task: undefined,
      events: [],
      available: false,
      error,
    },
  };
}

function publicOwnerTask(task: TaskRecord, session: SessionRecord): OwnerTaskSummary {
  return {
    id: task.id,
    sessionId: task.sessionId,
    shareLinkId: session.shareLinkId,
    friendActorId: session.friendActorId,
    hostId: session.hostId,
    adapterId: session.adapterId,
    prompt: task.prompt,
    status: task.status,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    resultRef: task.resultRef,
    failureReason: task.failureReason,
  };
}

function publicConfirmation(request: ApprovalRequestRecord): FriendConfirmation {
  const { ownerId: _ownerId, ...confirmation } = request;
  return confirmation;
}

// friend sessions are session-scoped; do not use friendActorId for cross-session access.

function unavailableFriendResponse(
  store: RelayStore,
  link: ShareLinkRecord | undefined,
  now: Date,
): JsonResponse<FriendSharePage> | undefined {
  const linkUnavailable = unavailableFriendLinkResponse(link, now);
  if (linkUnavailable) {
    return linkUnavailable;
  }

  const host = store.findHost(link.hostId);
  if (!host || host.status !== "online") {
    return { status: 503, body: { available: false, error: "shared_agent_unavailable" } };
  }

  return undefined;
}

function unavailableFriendLinkResponse(
  link: ShareLinkRecord | undefined,
  now: Date,
): JsonResponse<FriendSharePage> | undefined {
  if (!link || link.status === "revoked") {
    return { status: 404, body: { available: false, error: "share_link_unavailable" } };
  }

  if (link.status === "paused") {
    return { status: 423, body: { available: false, error: "share_link_paused" } };
  }

  if (link.status === "expired" || Date.parse(link.expiresAt) <= now.getTime()) {
    return { status: 410, body: { available: false, error: "share_link_expired" } };
  }

  return undefined;
}

function updateLinkStatusByToken(
  store: RelayStore,
  token: string,
  status: ShareLinkRecord["status"],
  eventType: string,
): JsonResponse<{ ok: boolean } | { error: string }> {
  const link = store.findShareLinkByToken(token);
  if (!link) {
    return { status: 404, body: { error: "share_link_unavailable" } };
  }

  const updated = store.updateShareLinkStatus(link.id, status);
  if (!updated) {
    return { status: 404, body: { error: "share_link_unavailable" } };
  }

  store.appendAuditLog({
    ownerId: updated.ownerId,
    shareLinkId: updated.id,
    actorType: "owner",
    eventType,
    summary: `${updated.name} ${status}`,
  });

  return {
    status: 200,
    body: { ok: true },
  };
}

function updateOwnerShareLinkStatusById(input: {
  store: RelayStore;
  ownerId: string;
  shareLinkId: string;
  status: ShareLinkRecord["status"];
  eventType: string;
}): JsonResponse<{ ok: boolean } | { error: string }> {
  const link = input.store.findShareLinkById(input.shareLinkId);
  if (!link || link.ownerId !== input.ownerId) {
    return { status: 404, body: { error: "share_link_unavailable" } };
  }

  if (link.status === "revoked" || link.status === "expired") {
    return { status: 409, body: { error: "share_link_final" } };
  }

  const updated = input.store.updateShareLinkStatus(link.id, input.status);
  if (!updated) {
    return { status: 404, body: { error: "share_link_unavailable" } };
  }

  input.store.appendAuditLog({
    ownerId: updated.ownerId,
    shareLinkId: updated.id,
    actorType: "owner",
    eventType: input.eventType,
    summary: `${updated.name} ${input.status}`,
  });

  return {
    status: 200,
    body: { ok: true },
  };
}

function cryptoRandomToken(): string {
  return randomUUID();
}

function uniqueShareToken(store: RelayStore, tokenFactory?: () => string): string | undefined {
  for (let attempt = 0; attempt < MAX_SHARE_TOKEN_GENERATION_ATTEMPTS; attempt += 1) {
    const rawToken = tokenFactory?.() ?? cryptoRandomToken();
    if (!store.findShareLinkByToken(rawToken)) {
      return rawToken;
    }
  }
  return undefined;
}

function taskStatusFromHandle(task: TaskHandle): "running" | "completed" | "failed" | "cancelled" {
  if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
    return task.status;
  }
  return "running";
}

function shouldSkipCancelledTaskSubmit(store: RelayStore, commandRecord: HostCommandRecord): boolean {
  const command = commandRecord.command;
  if (command.commandType !== "task.submit") {
    return false;
  }

  const session = store.findSession(command.sessionId);
  const task = store.findTask(command.taskId);
  return session?.status === "cancelled" || task?.status === "cancelled";
}

function taskStatusFromRuntimeEvent(
  event: RuntimeEvent,
  current: "running" | "completed" | "failed" | "cancelled",
): "running" | "completed" | "failed" | "cancelled" {
  switch (event.type) {
    case "task.completed":
      return "completed";
    case "task.failed":
      return "failed";
    case "task.cancelled":
      return "cancelled";
    default:
      return current;
  }
}

function budgetPreflight(link: ShareLinkRecord, estimatedTaskBudget: number): string | undefined {
  if (estimatedTaskBudget > link.policy.maxTaskBudget) {
    return "max_task_budget";
  }

  if ((link.budgetUsed ?? 0) + estimatedTaskBudget > link.policy.maxTotalBudget) {
    return "max_total_budget";
  }

  return undefined;
}

function requestRateLimitPreflight(store: RelayStore, link: ShareLinkRecord): string | undefined {
  const maxRequestsPerMinute = link.policy.maxRequestsPerMinute ?? 30;
  if (!Number.isFinite(maxRequestsPerMinute) || maxRequestsPerMinute <= 0) {
    return undefined;
  }

  const windowStart = store.now().getTime() - 60 * 1000;
  const recentFriendRequests = store
    .snapshot()
    .auditLogs
    .filter((entry) => {
      return entry.shareLinkId === link.id
        && entry.actorType === "friend"
        && (entry.eventType === "session.created" || entry.eventType === "task.submitted")
        && Date.parse(entry.createdAt) > windowStart;
    });

  if (recentFriendRequests.length >= maxRequestsPerMinute) {
    return "max_requests_per_minute";
  }

  return undefined;
}

function recordRateLimitRejection(store: RelayStore, link: ShareLinkRecord, reason: string) {
  store.appendAuditLog({
    ownerId: link.ownerId,
    shareLinkId: link.id,
    actorType: "system",
    eventType: "rate_limit.rejected",
    summary: reason,
    metadata: {
      maxRequestsPerMinute: link.policy.maxRequestsPerMinute ?? 30,
    },
  });
}

function expireStaleSessionsForLink(store: RelayStore, link: ShareLinkRecord) {
  const sessionTtlMs = link.policy.sessionTtlMs ?? 30 * 60 * 1000;
  if (!Number.isFinite(sessionTtlMs) || sessionTtlMs <= 0) {
    return;
  }

  const nowMs = store.now().getTime();
  for (const session of store.snapshot().sessions) {
    if (
      session.shareLinkId !== link.id
      || !activeSessionStatuses.has(session.status)
      || nowMs - Date.parse(session.lastEventAt) <= sessionTtlMs
    ) {
      continue;
    }

    store.updateSession({
      sessionId: session.id,
      status: "cancelled",
    });
    store.cancelTasksForSession(session.id);
    store.appendAuditLog({
      ownerId: link.ownerId,
      shareLinkId: link.id,
      sessionId: session.id,
      actorType: "system",
      eventType: "session.timeout",
      summary: "session_ttl",
      metadata: { sessionTtlMs },
    });
  }
}

function sessionStatusFromTask(status: "running" | "completed" | "failed" | "cancelled") {
  return status;
}

function friendSafeEvent(event: RuntimeEvent, taskId: string): RuntimeEvent {
  switch (event.type) {
    case "task.accepted":
    case "task.completed":
    case "task.cancelled":
      return { type: event.type, taskId };
    case "task.plan":
    case "task.progress":
    case "task.output":
      return { type: event.type, taskId, text: event.text };
    case "task.needs_user_auth":
      return {
        type: event.type,
        taskId,
        provider: event.provider,
        scopeSummary: event.scopeSummary,
      };
    case "task.needs_user_confirm":
    case "task.needs_owner_approval":
      return { type: event.type, taskId, actionSummary: event.actionSummary };
    case "task.failed":
      return { type: event.type, taskId, message: event.message };
  }
}
