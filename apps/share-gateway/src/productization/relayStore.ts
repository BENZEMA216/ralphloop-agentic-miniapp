import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";

import {
  appendJournal,
  replayJournal,
  type RelayJournalOp,
} from "./relayStoreJournal.ts";
import { generateShareToken, hashShareToken } from "./token.ts";
import type { RuntimeEvent } from "../adapters/types.ts";
import type { HostCommand } from "./hostCommands.ts";
import type {
  AuditLogRecord,
  ApprovalRequestRecord,
  FriendAuthRequestRecord,
  HostCommandRecord,
  HostRecord,
  PreviewFrameRecord,
  RelayData,
  RuntimeEventRecord,
  SessionRecord,
  ShareLinkRecord,
  SharePolicyRecord,
  TaskRecord,
} from "./types.ts";

type RelayStoreOptions = {
  filePath?: string;
  now?: () => Date;
};

type UpsertHostInput = {
  ownerId: string;
  hostId?: string;
  deviceName: string;
  hostVersion: string;
  supportedAdapters: string[];
  capabilities?: string[];
  deviceKeyHash?: string;
  registeredAt?: string;
};

type CreateShareLinkInput = {
  ownerId: string;
  hostId: string;
  rawToken?: string;
  name: string;
  allowedAdapterIds: string[];
  expiresAt?: string;
  policy?: Partial<SharePolicyRecord>;
};

type UpdateShareLinkInput = {
  id: string;
  name?: string;
  expiresAt?: string;
  policy?: Partial<SharePolicyRecord>;
};

type CreateSessionInput = {
  shareLinkId: string;
  friendActorId: string;
  friendDisplayName?: string;
  hostId: string;
  adapterId: string;
};

type CreateTaskInput = {
  sessionId: string;
  prompt: string;
};

type AppendAuditInput = {
  ownerId: string;
  shareLinkId?: string;
  sessionId?: string;
  actorType: AuditLogRecord["actorType"];
  eventType: string;
  summary: string;
  metadata?: Record<string, unknown>;
};

type CreateApprovalInput = {
  ownerId?: string;
  sessionId: string;
  taskId: string;
  actionType: string;
  permissionSource: ApprovalRequestRecord["permissionSource"];
  summary: string;
  riskLevel: ApprovalRequestRecord["riskLevel"];
  requiredDecision: ApprovalRequestRecord["requiredDecision"];
};

type ResolveApprovalInput = {
  requestId: string;
  status: Extract<ApprovalRequestRecord["status"], "approved" | "denied" | "expired">;
  resolvedBy: NonNullable<ApprovalRequestRecord["resolvedBy"]>;
};

type AppendPreviewFrameInput = {
  sessionId: string;
  taskId: string;
  contentType: PreviewFrameRecord["contentType"];
  data: string;
  byteLength: number;
};

type AppendRuntimeEventInput = {
  sessionId: string;
  taskId: string;
  event: RuntimeEvent;
};

type CreateFriendAuthRequestInput = {
  shareLinkId: string;
  sessionId: string;
  friendActorId: string;
  provider: FriendAuthRequestRecord["provider"];
  policyVersion: string;
};

type EnqueueHostCommandInput = {
  hostId: string;
  command: HostCommand;
};

type StaleSessionLookup = {
  sessionId: string;
  taskId?: string;
  staleAfterMs: number;
};

export type StaleSessionResult =
  | { kind: "fresh"; session: SessionRecord; task?: TaskRecord }
  | { kind: "resumable"; session: SessionRecord; task?: TaskRecord }
  | { kind: "stale"; session?: SessionRecord; task?: TaskRecord };

type RelaySnapshotFile = RelayData & { epoch?: string };

const SNAPSHOT_COMPACT_OP_THRESHOLD = 500;
const SNAPSHOT_COMPACT_MS_THRESHOLD = 30_000;

export class RelayStore {
  readonly #filePath?: string;
  readonly #journalPath?: string;
  readonly #now: () => Date;
  #data: RelayData;
  #epoch: string;
  #opsSinceCompact = 0;
  #lastCompactAtMs = 0;
  /**
   * True when the snapshot on disk already carries our `#epoch`. When
   * loading a legacy snapshot that predates the journal we keep this
   * false so the first mutation triggers an immediate compaction —
   * otherwise the journal lines we append could never be matched to a
   * snapshot epoch after a restart.
   */
  #snapshotEpochPersisted: boolean;

  constructor(options: RelayStoreOptions = {}) {
    this.#filePath = options.filePath;
    this.#journalPath = options.filePath ? `${options.filePath}.journal.jsonl` : undefined;
    this.#now = options.now ?? (() => new Date());
    const loaded = this.#load();
    this.#data = loaded.data;
    this.#epoch = loaded.epoch;
    this.#snapshotEpochPersisted = loaded.snapshotEpochPersisted;
    this.#lastCompactAtMs = Date.now();
  }

  snapshot(): RelayData {
    return JSON.parse(JSON.stringify(this.#data)) as RelayData;
  }

  now(): Date {
    return this.#now();
  }

  upsertHost(input: UpsertHostInput): HostRecord {
    const now = this.#now().toISOString();
    const existing = this.#data.hosts.find((host) => host.id === input.hostId);
    if (existing) {
      existing.deviceName = input.deviceName;
      existing.hostVersion = input.hostVersion;
      existing.status = "online";
      existing.lastSeenAt = now;
      existing.offlineReason = undefined;
      if (input.deviceKeyHash !== undefined) {
        existing.deviceKeyHash = input.deviceKeyHash;
      }
      if (input.registeredAt !== undefined) {
        existing.registeredAt = input.registeredAt;
      } else if (!existing.registeredAt) {
        existing.registeredAt = now;
      }
      existing.supportedAdapters = [...input.supportedAdapters];
      existing.capabilities = [...(input.capabilities ?? existing.capabilities)];
      this.#journalOp({ op: "upsertHost", args: { host: clone(existing) } });
      return existing;
    }

    const host: HostRecord = {
      id: input.hostId ?? randomUUID(),
      ownerId: input.ownerId,
      deviceName: input.deviceName,
      hostVersion: input.hostVersion,
      status: "online",
      lastSeenAt: now,
      offlineReason: undefined,
      registeredAt: input.registeredAt ?? now,
      deviceKeyHash: input.deviceKeyHash,
      supportedAdapters: [...input.supportedAdapters],
      capabilities: [...(input.capabilities ?? [])],
    };
    this.#data.hosts.push(host);
    this.#journalOp({ op: "upsertHost", args: { host: clone(host) } });
    return host;
  }

  recordHostHeartbeat(input: {
    hostId: string;
    supportedAdapters?: string[];
    capabilities?: string[];
  }): HostRecord | undefined {
    const host = this.#data.hosts.find((entry) => entry.id === input.hostId);
    if (!host) {
      return undefined;
    }

    host.status = "online";
    host.lastSeenAt = this.#now().toISOString();
    host.offlineReason = undefined;
    if (input.supportedAdapters) {
      host.supportedAdapters = [...input.supportedAdapters];
    }
    if (input.capabilities) {
      host.capabilities = [...input.capabilities];
    }
    this.#journalOp({ op: "recordHostHeartbeat", args: { host: clone(host) } });
    return host;
  }

  markStaleHostsOffline(input: { timeoutMs: number }): HostRecord[] {
    const now = this.#now();
    const nowMs = now.getTime();
    const transitioned: HostRecord[] = [];

    for (const host of this.#data.hosts) {
      if (host.status !== "online") {
        continue;
      }

      const lastSeenMs = Date.parse(host.lastSeenAt);
      if (!Number.isFinite(lastSeenMs)) {
        continue;
      }

      if (nowMs - lastSeenMs <= input.timeoutMs) {
        continue;
      }

      host.status = "offline";
      host.offlineReason = "heartbeat_timeout";
      transitioned.push(host);
    }

    if (transitioned.length > 0) {
      this.#journalOp({
        op: "markHostsOffline",
        args: { hosts: transitioned.map((host) => clone(host)) },
      });
    }

    return transitioned;
  }

  findHost(hostId: string): HostRecord | undefined {
    return this.#data.hosts.find((host) => host.id === hostId);
  }

  createShareLink(input: CreateShareLinkInput): ShareLinkRecord {
    const now = this.#now();
    const link: ShareLinkRecord = {
      id: randomUUID(),
      ownerId: input.ownerId,
      hostId: input.hostId,
      tokenHash: hashShareToken(input.rawToken ?? generateShareToken()),
      name: input.name,
      status: "active",
      createdAt: now.toISOString(),
      expiresAt: input.expiresAt ?? new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      budgetUsed: 0,
      policy: {
        ...defaultSharePolicy(input.allowedAdapterIds),
        ...input.policy,
      },
    };
    this.#data.shareLinks.push(link);
    this.#journalOp({ op: "createShareLink", args: { link: clone(link) } });
    return link;
  }

  findShareLinkByToken(rawToken: string): ShareLinkRecord | undefined {
    const tokenHash = hashShareToken(rawToken);
    return this.#data.shareLinks.find((link) => link.tokenHash === tokenHash);
  }

  findShareLinkById(id: string): ShareLinkRecord | undefined {
    return this.#data.shareLinks.find((link) => link.id === id);
  }

  updateShareLink(input: UpdateShareLinkInput): ShareLinkRecord | undefined {
    const link = this.findShareLinkById(input.id);
    if (!link) {
      return undefined;
    }

    if (input.name !== undefined) {
      link.name = input.name;
    }
    if (input.expiresAt !== undefined) {
      link.expiresAt = input.expiresAt;
    }
    if (input.policy !== undefined) {
      link.policy = {
        ...link.policy,
        ...input.policy,
        allowedAdapterIds: input.policy.allowedAdapterIds
          ? [...input.policy.allowedAdapterIds]
          : link.policy.allowedAdapterIds,
      };
    }

    this.#journalOp({ op: "updateShareLink", args: { link: clone(link) } });
    return link;
  }

  addShareLinkBudgetUsage(id: string, amount: number): ShareLinkRecord | undefined {
    const link = this.findShareLinkById(id);
    if (!link) {
      return undefined;
    }

    link.budgetUsed = (link.budgetUsed ?? 0) + amount;
    this.#journalOp({ op: "addShareLinkBudgetUsage", args: { link: clone(link) } });
    return link;
  }

  updateShareLinkStatus(
    id: string,
    status: ShareLinkRecord["status"],
  ): ShareLinkRecord | undefined {
    const link = this.findShareLinkById(id);
    if (!link) {
      return undefined;
    }

    link.status = status;
    if (status === "revoked") {
      link.revokedAt = this.#now().toISOString();
    }
    this.#journalOp({ op: "updateShareLinkStatus", args: { link: clone(link) } });
    return link;
  }

  updateHostStatus(hostId: string, status: HostRecord["status"]): HostRecord | undefined {
    const host = this.findHost(hostId);
    if (!host) {
      return undefined;
    }

    host.status = status;
    host.lastSeenAt = this.#now().toISOString();
    this.#journalOp({ op: "updateHostStatus", args: { host: clone(host) } });
    return host;
  }

  createSession(input: CreateSessionInput): SessionRecord {
    const now = this.#now().toISOString();
    const session: SessionRecord = {
      id: randomUUID(),
      shareLinkId: input.shareLinkId,
      friendActorId: input.friendActorId,
      friendDisplayName: input.friendDisplayName,
      hostId: input.hostId,
      adapterId: input.adapterId,
      status: "waiting",
      startedAt: now,
      lastEventAt: now,
    };
    this.#data.sessions.push(session);
    this.#journalOp({ op: "createSession", args: { session: clone(session) } });
    return session;
  }

  findSession(sessionId: string): SessionRecord | undefined {
    return this.#data.sessions.find((session) => session.id === sessionId);
  }

  findTask(taskId: string): TaskRecord | undefined {
    return this.#data.tasks.find((task) => task.id === taskId);
  }

  activeSessionCount(shareLinkId: string): number {
    const activeStatuses = new Set<SessionRecord["status"]>([
      "waiting",
      "starting",
      "running",
      "needs_input",
      "needs_user_auth",
      "needs_user_confirm",
      "needs_owner_approval",
    ]);
    return this.#data.sessions.filter((session) => {
      return session.shareLinkId === shareLinkId && activeStatuses.has(session.status);
    }).length;
  }

  updateSession(input: {
    sessionId: string;
    runtimeId?: string;
    status?: SessionRecord["status"];
  }): SessionRecord | undefined {
    const session = this.#data.sessions.find((entry) => entry.id === input.sessionId);
    if (!session) {
      return undefined;
    }

    if (input.runtimeId !== undefined) {
      session.runtimeId = input.runtimeId;
    }
    if (input.status) {
      session.status = input.status;
      if (["completed", "failed", "cancelled"].includes(input.status)) {
        session.endedAt = this.#now().toISOString();
      } else {
        delete session.endedAt;
      }
    }
    session.lastEventAt = this.#now().toISOString();
    this.#journalOp({ op: "updateSession", args: { session: clone(session) } });
    return session;
  }

  cancelTasksForSession(sessionId: string): TaskRecord[] {
    const cancelled = [];
    for (const task of this.#data.tasks) {
      if (task.sessionId !== sessionId) {
        continue;
      }
      if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
        continue;
      }

      task.status = "cancelled";
      task.completedAt = this.#now().toISOString();
      cancelled.push(task);
    }
    if (cancelled.length > 0) {
      this.#journalOp({
        op: "cancelTasksForSession",
        args: { tasks: cancelled.map((task) => clone(task)) },
      });
    } else {
      // Preserve legacy semantics: still drive a journal/save on a no-op
      // call so call sites that relied on `#save()` side effects don't
      // regress. Cheap because no-op journals just bump the counter.
      this.#maybeCompact();
    }
    return cancelled;
  }

  createTask(input: CreateTaskInput): TaskRecord {
    const task: TaskRecord = {
      id: randomUUID(),
      sessionId: input.sessionId,
      prompt: input.prompt,
      status: "waiting",
      createdAt: this.#now().toISOString(),
    };
    this.#data.tasks.push(task);
    this.#journalOp({ op: "createTask", args: { task: clone(task) } });
    return task;
  }

  updateTask(input: {
    taskId: string;
    status?: TaskRecord["status"];
    resultRef?: string;
    failureReason?: string;
  }): TaskRecord | undefined {
    const task = this.#data.tasks.find((entry) => entry.id === input.taskId);
    if (!task) {
      return undefined;
    }

    // Terminal-state guard: once a task reaches `cancelled` / `completed` /
    // `failed`, no further transition is permitted. A late `task.completed`
    // event racing a cancel must NOT overwrite the cancelled record — we
    // surface the dropped transition through the audit log so it shows up
    // in owner forensics and return the existing record unchanged.
    const terminal = isTerminalTaskStatus(task.status);
    const attemptingTransition = input.status && input.status !== task.status;
    if (terminal && attemptingTransition) {
      const tag = "[relayStore] late terminal overwrite blocked";
      console.warn(
        `${tag} taskId=${task.id} current=${task.status} attempted=${input.status}`,
      );
      this.appendAuditLog({
        ownerId: "system",
        sessionId: task.sessionId,
        actorType: "system",
        eventType: "task.terminal_overwrite_blocked",
        summary: tag,
        metadata: {
          taskId: task.id,
          currentStatus: task.status,
          attemptedStatus: input.status,
        },
      });
      return task;
    }

    if (input.status) {
      task.status = input.status;
      if (input.status === "running" && !task.startedAt) {
        task.startedAt = this.#now().toISOString();
      }
      if (["completed", "failed", "cancelled"].includes(input.status)) {
        task.completedAt = this.#now().toISOString();
      }
    }
    if (input.resultRef !== undefined) {
      task.resultRef = input.resultRef;
    }
    if (input.failureReason !== undefined) {
      task.failureReason = input.failureReason;
    }
    this.#journalOp({ op: "updateTask", args: { task: clone(task) } });
    return task;
  }

  appendAuditLog(input: AppendAuditInput): AuditLogRecord {
    const audit: AuditLogRecord = {
      id: randomUUID(),
      ownerId: input.ownerId,
      shareLinkId: input.shareLinkId,
      sessionId: input.sessionId,
      actorType: input.actorType,
      eventType: input.eventType,
      summary: input.summary,
      metadata: input.metadata,
      createdAt: this.#now().toISOString(),
    };
    this.#data.auditLogs.push(audit);
    this.#journalOp({ op: "appendAuditLog", args: { audit: clone(audit) } });
    return audit;
  }

  createFriendAuthRequest(input: CreateFriendAuthRequestInput): FriendAuthRequestRecord {
    const request: FriendAuthRequestRecord = {
      id: randomUUID(),
      shareLinkId: input.shareLinkId,
      sessionId: input.sessionId,
      friendActorId: input.friendActorId,
      provider: input.provider,
      policyVersion: input.policyVersion,
      status: "pending",
      requestedAt: this.#now().toISOString(),
    };
    this.#data.friendAuthRequests.push(request);
    this.#journalOp({
      op: "createFriendAuthRequest",
      args: { request: clone(request) },
    });
    return request;
  }

  createApprovalRequest(input: CreateApprovalInput): ApprovalRequestRecord {
    const request: ApprovalRequestRecord = {
      id: randomUUID(),
      ownerId: input.ownerId ?? "unknown",
      sessionId: input.sessionId,
      taskId: input.taskId,
      actionType: input.actionType,
      permissionSource: input.permissionSource,
      summary: input.summary,
      riskLevel: input.riskLevel,
      requiredDecision: input.requiredDecision,
      status: "pending",
      requestedAt: this.#now().toISOString(),
    };
    this.#data.approvalRequests.push(request);
    this.#journalOp({ op: "createApprovalRequest", args: { request: clone(request) } });
    return request;
  }

  resolveApprovalRequest(input: ResolveApprovalInput): ApprovalRequestRecord | undefined {
    const request = this.#data.approvalRequests.find((entry) => entry.id === input.requestId);
    if (!request) {
      return undefined;
    }

    request.status = input.status;
    request.resolvedBy = input.resolvedBy;
    request.resolvedAt = this.#now().toISOString();
    this.#journalOp({ op: "resolveApprovalRequest", args: { request: clone(request) } });
    return request;
  }

  listApprovalRequests(filter: {
    status?: ApprovalRequestRecord["status"];
  } = {}): ApprovalRequestRecord[] {
    return this.#data.approvalRequests.filter((request) => {
      return !filter.status || request.status === filter.status;
    });
  }

  appendRuntimeEvent(input: AppendRuntimeEventInput): RuntimeEventRecord {
    const runtimeEvent: RuntimeEventRecord = {
      id: randomUUID(),
      sessionId: input.sessionId,
      taskId: input.taskId,
      event: JSON.parse(JSON.stringify(input.event)) as RuntimeEvent,
      createdAt: this.#now().toISOString(),
    };
    this.#data.runtimeEvents.push(runtimeEvent);
    this.#journalOp({
      op: "appendRuntimeEvent",
      args: { event: clone(runtimeEvent) },
    });
    return runtimeEvent;
  }

  listRuntimeEvents(filter: {
    sessionId?: string;
    taskId?: string;
  } = {}): RuntimeEventRecord[] {
    return this.#data.runtimeEvents.filter((entry) => {
      return (!filter.sessionId || entry.sessionId === filter.sessionId)
        && (!filter.taskId || entry.taskId === filter.taskId);
    });
  }

  enqueueHostCommand(input: EnqueueHostCommandInput): HostCommandRecord {
    const record: HostCommandRecord = {
      id: randomUUID(),
      hostId: input.hostId,
      command: JSON.parse(JSON.stringify(input.command)) as HostCommand,
      status: "queued",
      createdAt: this.#now().toISOString(),
    };
    this.#data.hostCommands.push(record);
    this.#journalOp({ op: "enqueueHostCommand", args: { command: clone(record) } });
    return record;
  }

  claimNextHostCommand(hostId: string): HostCommandRecord | undefined {
    const record = this.#data.hostCommands.find((entry) => {
      return entry.hostId === hostId && entry.status === "queued";
    });
    if (!record) {
      return undefined;
    }

    record.status = "claimed";
    record.claimedAt = this.#now().toISOString();
    this.#journalOp({ op: "claimNextHostCommand", args: { command: clone(record) } });
    return record;
  }

  findHostCommand(commandId: string): HostCommandRecord | undefined {
    return this.#data.hostCommands.find((entry) => entry.id === commandId);
  }

  /**
   * Reverts any `claimed` host command whose `claimedAt` is older than
   * `olderThanMs` back to `queued` so a reconnecting Host can pick it up
   * again. Terminal commands (`completed` / `failed` / `cancelled`) are
   * never touched.
   */
  reclaimStaleHostCommands(input: { olderThanMs: number }): number {
    const nowMs = this.#now().getTime();
    const reclaimed: HostCommandRecord[] = [];
    for (const record of this.#data.hostCommands) {
      if (record.status !== "claimed") {
        continue;
      }
      const claimedAtMs = record.claimedAt ? Date.parse(record.claimedAt) : NaN;
      if (!Number.isFinite(claimedAtMs)) {
        continue;
      }
      if (nowMs - claimedAtMs <= input.olderThanMs) {
        continue;
      }
      record.status = "queued";
      record.claimedAt = undefined;
      reclaimed.push(record);
    }
    if (reclaimed.length > 0) {
      this.#journalOp({
        op: "reclaimStaleHostCommands",
        args: { commands: reclaimed.map((record) => clone(record)) },
      });
    }
    return reclaimed.length;
  }

  completeHostCommand(input: {
    commandId: string;
    status: Extract<HostCommandRecord["status"], "completed" | "failed" | "cancelled">;
    failureReason?: string;
  }): HostCommandRecord | undefined {
    const record = this.findHostCommand(input.commandId);
    if (!record) {
      return undefined;
    }

    record.status = input.status;
    record.completedAt = this.#now().toISOString();
    record.failureReason = input.failureReason;
    this.#journalOp({ op: "completeHostCommand", args: { command: clone(record) } });
    return record;
  }

  appendPreviewFrame(input: AppendPreviewFrameInput): PreviewFrameRecord {
    const frame: PreviewFrameRecord = {
      id: randomUUID(),
      sessionId: input.sessionId,
      taskId: input.taskId,
      contentType: input.contentType,
      data: input.data,
      byteLength: input.byteLength,
      createdAt: this.#now().toISOString(),
    };
    this.#data.previewFrames.push(frame);
    prunePreviewFrames(this.#data.previewFrames, {
      sessionId: input.sessionId,
      taskId: input.taskId,
      keep: 20,
    });
    const retainedIds = this.#data.previewFrames
      .filter((entry) => entry.sessionId === input.sessionId && entry.taskId === input.taskId)
      .map((entry) => entry.id);
    this.#journalOp({
      op: "appendPreviewFrame",
      args: { frame: clone(frame), retainedIds },
    });
    return frame;
  }

  listPreviewFrames(filter: { sessionId: string; taskId: string }): PreviewFrameRecord[] {
    return this.#data.previewFrames.filter((frame) => {
      return frame.sessionId === filter.sessionId && frame.taskId === filter.taskId;
    });
  }

  /**
   * Classify a session by liveness so callers can render a friendly stale
   * banner instead of dumping the friend into a dead thread.
   */
  findStaleSession(input: StaleSessionLookup): StaleSessionResult {
    const session = this.findSession(input.sessionId);
    if (!session) {
      return { kind: "stale" };
    }

    const task = input.taskId ? this.findTask(input.taskId) : undefined;

    const lastEventMs = Date.parse(session.lastEventAt);
    const ageMs = Number.isFinite(lastEventMs)
      ? this.#now().getTime() - lastEventMs
      : Infinity;
    if (ageMs > input.staleAfterMs) {
      return { kind: "stale", session, task };
    }

    const sessionTerminal = session.status === "completed"
      || session.status === "failed"
      || session.status === "cancelled";
    const taskTerminal = task
      && (task.status === "completed" || task.status === "failed" || task.status === "cancelled");

    if (sessionTerminal || taskTerminal) {
      return { kind: "resumable", session, task };
    }

    return { kind: "fresh", session, task };
  }

  #journalOp(op: RelayJournalOp): void {
    if (!this.#filePath || !this.#journalPath) {
      // In-memory consumers — zero on-disk footprint.
      return;
    }

    // Lazy-upgrade legacy snapshots (no `epoch` written yet) by compacting
    // *before* the first journal line so the journal lines we are about to
    // write are pinned to a durable epoch and can be replayed on restart.
    if (!this.#snapshotEpochPersisted) {
      this.#compact();
    }

    appendJournal(this.#journalPath, {
      ...op,
      at: this.#now().toISOString(),
      epoch: this.#epoch,
    });
    this.#opsSinceCompact += 1;
    this.#maybeCompact();
  }

  #maybeCompact(): void {
    if (!this.#filePath) {
      return;
    }
    const ageMs = Date.now() - this.#lastCompactAtMs;
    if (
      this.#opsSinceCompact < SNAPSHOT_COMPACT_OP_THRESHOLD
      && ageMs < SNAPSHOT_COMPACT_MS_THRESHOLD
    ) {
      return;
    }
    this.#compact();
  }

  #compact(): void {
    if (!this.#filePath || !this.#journalPath) {
      return;
    }

    const newEpoch = randomUUID();
    const dir = dirname(this.#filePath);
    mkdirSync(dir, { recursive: true });
    const tmpPath = `${this.#filePath}.tmp`;
    const body: RelaySnapshotFile = { ...this.#data, epoch: newEpoch };
    const serialized = `${JSON.stringify(body, null, 2)}\n`;
    // Write + fsync the snapshot atomically before truncating the journal.
    // A crash between the fsync and the rename leaves the previous snapshot
    // + previous journal both intact; a crash after the rename but before
    // truncation simply discards prior-epoch journal lines on next load.
    const handle = openSync(tmpPath, "w");
    try {
      writeSync(handle, serialized);
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
    renameSync(tmpPath, this.#filePath);
    try {
      unlinkSync(this.#journalPath);
    } catch {
      // Already gone — fine.
    }
    this.#epoch = newEpoch;
    this.#snapshotEpochPersisted = true;
    this.#opsSinceCompact = 0;
    this.#lastCompactAtMs = Date.now();
  }

  #load(): { data: RelayData; epoch: string; snapshotEpochPersisted: boolean } {
    if (!this.#filePath || !existsSync(this.#filePath)) {
      return { data: emptyData(), epoch: randomUUID(), snapshotEpochPersisted: false };
    }

    const raw = readFileSync(this.#filePath, "utf8");
    let parsed: Partial<RelaySnapshotFile> | undefined;
    try {
      parsed = JSON.parse(raw) as Partial<RelaySnapshotFile>;
    } catch (error) {
      console.warn(
        `[relayStore] snapshot at ${this.#filePath} is unparsable, recovering by replaying journal: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      parsed = undefined;
    }

    const base: RelayData = parsed
      ? {
        hosts: parsed.hosts ?? [],
        shareLinks: parsed.shareLinks ?? [],
        sessions: parsed.sessions ?? [],
        tasks: parsed.tasks ?? [],
        runtimeEvents: parsed.runtimeEvents ?? [],
        friendAuthRequests: parsed.friendAuthRequests ?? [],
        hostCommands: parsed.hostCommands ?? [],
        approvalRequests: parsed.approvalRequests ?? [],
        previewFrames: normalizePreviewFrames(parsed.previewFrames ?? []),
        auditLogs: parsed.auditLogs ?? [],
      }
      : emptyData();
    const persistedEpoch = typeof parsed?.epoch === "string" && parsed.epoch.length > 0
      ? parsed.epoch
      : undefined;
    const epoch = persistedEpoch ?? randomUUID();
    const snapshotEpochPersisted = persistedEpoch !== undefined;

    if (this.#journalPath) {
      const replay = replayJournal(this.#journalPath, epoch, base);
      return { data: replay.snapshot, epoch, snapshotEpochPersisted };
    }

    return { data: base, epoch, snapshotEpochPersisted };
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isTerminalTaskStatus(status: TaskRecord["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function emptyData(): RelayData {
  return {
    hosts: [],
    shareLinks: [],
    sessions: [],
    tasks: [],
    runtimeEvents: [],
    friendAuthRequests: [],
    hostCommands: [],
    approvalRequests: [],
    previewFrames: [],
    auditLogs: [],
  };
}

function normalizePreviewFrames(input: unknown): PreviewFrameRecord[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const frames: PreviewFrameRecord[] = [];
  for (const entry of input) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Partial<PreviewFrameRecord> & {
      mimeType?: unknown;
      contentType?: unknown;
      byteLength?: unknown;
      taskId?: unknown;
      sessionId?: unknown;
      data?: unknown;
      createdAt?: unknown;
      id?: unknown;
    };

    const sessionId = typeof record.sessionId === "string" ? record.sessionId : "";
    const data = typeof record.data === "string" ? record.data : "";
    const createdAt = typeof record.createdAt === "string" ? record.createdAt : new Date(0).toISOString();
    const id = typeof record.id === "string" ? record.id : randomUUID();
    const taskId = typeof record.taskId === "string" ? record.taskId : "unknown";

    const rawContentType = typeof record.contentType === "string"
      ? record.contentType
      : typeof record.mimeType === "string"
      ? record.mimeType
      : "image/png";
    const contentType = rawContentType === "image/png"
        || rawContentType === "image/jpeg"
        || rawContentType === "image/webp"
        || rawContentType === "text/plain"
      ? rawContentType
      : "image/png";

    const byteLength = typeof record.byteLength === "number"
      ? record.byteLength
      : estimateBase64ByteLength(data) ?? data.length;

    if (!sessionId) {
      continue;
    }

    frames.push({
      id,
      sessionId,
      taskId,
      contentType,
      data,
      byteLength,
      createdAt,
    });
  }

  return frames;
}

function estimateBase64ByteLength(base64: string): number | undefined {
  const normalized = base64.replace(/\s+/g, "");
  if (!normalized) {
    return 0;
  }
  const remainder = normalized.length % 4;
  if (remainder === 1) {
    return undefined;
  }
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.floor((normalized.length * 3) / 4) - padding;
}

function prunePreviewFrames(
  frames: PreviewFrameRecord[],
  input: { sessionId: string; taskId: string; keep: number },
) {
  const matching = frames
    .filter((frame) => frame.sessionId === input.sessionId && frame.taskId === input.taskId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (matching.length <= input.keep) {
    return;
  }

  const toRemove = new Set(matching.slice(0, matching.length - input.keep).map((frame) => frame.id));
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    if (toRemove.has(frames[index].id)) {
      frames.splice(index, 1);
    }
  }
}

function defaultSharePolicy(allowedAdapterIds: string[]): SharePolicyRecord {
  return {
    maxTotalBudget: 20,
    maxTaskBudget: 2,
    maxConcurrentSessions: 1,
    allowedAdapterIds: [...allowedAdapterIds],
    previewMode: "read_only",
    permissionMode: "user_identity",
    highRiskActionMode: "owner_approve",
    blockedActions: ["destructive_shell"],
    approvalRequiredActions: [
      "send_message",
      "purchase",
      "delete_file",
      "owner_account_access",
      "sensitive_secret_read",
    ],
    allowedDomains: [],
    maxRequestsPerMinute: 30,
    sessionTtlMs: 30 * 60 * 1000,
  };
}

