import type { DesktopPreviewMode, PermissionMode } from "../routes/shareLinks.ts";
import type { RuntimeEvent } from "../adapters/types.ts";
import type { HostCommand } from "./hostCommands.ts";

export type HostStatus = "online" | "offline" | "updating" | "blocked";
export type ShareLinkStatus = "active" | "paused" | "revoked" | "expired";
export type PreviewMode = "none" | DesktopPreviewMode;
export type HighRiskActionMode = "block" | "user_confirm" | "owner_approve";
export type SessionStatus =
  | "waiting"
  | "starting"
  | "running"
  | "needs_input"
  | "needs_user_auth"
  | "needs_user_confirm"
  | "needs_owner_approval"
  | "completed"
  | "failed"
  | "cancelled";
export type TaskStatus = "waiting" | "running" | "completed" | "failed" | "cancelled";
export type AuditActorType = "owner" | "friend" | "host" | "system";
export type ApprovalStatus = "pending" | "approved" | "denied" | "expired";
export type ApprovalDecision = "user_confirm" | "owner_approve";
export type RiskLevel = "medium" | "high" | "critical";
export type FriendAuthProvider = "manual" | "file";
export type FriendAuthStatus = "pending" | "completed" | "cancelled";
export type HostCommandStatus = "queued" | "claimed" | "completed" | "failed" | "cancelled";

export type HostRecord = {
  id: string;
  ownerId: string;
  deviceName: string;
  hostVersion: string;
  status: HostStatus;
  lastSeenAt: string;
  offlineReason?: string;
  registeredAt?: string;
  deviceKeyHash?: string;
  supportedAdapters: string[];
  capabilities: string[];
};

export type SharePolicyRecord = {
  maxTotalBudget: number;
  maxTaskBudget: number;
  maxConcurrentSessions: number;
  allowedAdapterIds: string[];
  previewMode: PreviewMode;
  permissionMode: PermissionMode;
  highRiskActionMode: HighRiskActionMode;
  blockedActions: string[];
  approvalRequiredActions: string[];
  allowedDomains: string[];
  maxRequestsPerMinute: number;
  sessionTtlMs: number;
};

export type ShareLinkRecord = {
  id: string;
  ownerId: string;
  hostId: string;
  tokenHash: string;
  name: string;
  status: ShareLinkStatus;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
  budgetUsed: number;
  policy: SharePolicyRecord;
};

export type SessionRecord = {
  id: string;
  shareLinkId: string;
  friendActorId: string;
  friendDisplayName?: string;
  hostId: string;
  adapterId: string;
  runtimeId?: string;
  status: SessionStatus;
  startedAt: string;
  endedAt?: string;
  lastEventAt: string;
};

export type TaskRecord = {
  id: string;
  sessionId: string;
  prompt: string;
  status: TaskStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  resultRef?: string;
  failureReason?: string;
};

export type AuditLogRecord = {
  id: string;
  ownerId: string;
  shareLinkId?: string;
  sessionId?: string;
  actorType: AuditActorType;
  eventType: string;
  summary: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type ApprovalRequestRecord = {
  id: string;
  ownerId: string;
  sessionId: string;
  taskId: string;
  actionType: string;
  permissionSource: "user_identity" | "owner_delegated" | "runtime_internal";
  summary: string;
  riskLevel: RiskLevel;
  requiredDecision: ApprovalDecision;
  status: ApprovalStatus;
  requestedAt: string;
  resolvedAt?: string;
  resolvedBy?: "owner" | "friend" | "system";
};

export type PreviewFrameRecord = {
  id: string;
  sessionId: string;
  taskId: string;
  contentType: "image/png" | "image/jpeg" | "image/webp" | "text/plain";
  data: string;
  byteLength: number;
  createdAt: string;
};

export type RuntimeEventRecord = {
  id: string;
  sessionId: string;
  taskId: string;
  event: RuntimeEvent;
  createdAt: string;
};

export type FriendAuthRequestRecord = {
  id: string;
  shareLinkId: string;
  sessionId: string;
  friendActorId: string;
  provider: FriendAuthProvider;
  policyVersion: string;
  status: FriendAuthStatus;
  requestedAt: string;
};

export type HostCommandRecord = {
  id: string;
  hostId: string;
  command: HostCommand;
  status: HostCommandStatus;
  createdAt: string;
  claimedAt?: string;
  completedAt?: string;
  failureReason?: string;
};

export type RelayData = {
  hosts: HostRecord[];
  shareLinks: ShareLinkRecord[];
  sessions: SessionRecord[];
  tasks: TaskRecord[];
  runtimeEvents: RuntimeEventRecord[];
  friendAuthRequests: FriendAuthRequestRecord[];
  hostCommands: HostCommandRecord[];
  approvalRequests: ApprovalRequestRecord[];
  previewFrames: PreviewFrameRecord[];
  auditLogs: AuditLogRecord[];
};
