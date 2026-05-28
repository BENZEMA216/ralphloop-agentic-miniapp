import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import type {
  ApprovalRequestRecord,
  AuditLogRecord,
  FriendAuthRequestRecord,
  HostCommandRecord,
  HostRecord,
  PreviewFrameRecord,
  RelayData,
  RuntimeEventRecord,
  SessionRecord,
  ShareLinkRecord,
  TaskRecord,
} from "./types.ts";

/**
 * Append-only journal for `RelayStore`. Each line is a self-contained JSON
 * envelope of the shape `{ op, args, at, epoch }`. Lines whose `epoch` does
 * not match the snapshot epoch on load are ignored (they belong to a prior
 * compaction generation and were already folded into the snapshot).
 *
 * The full operation set mirrors the public mutating methods of
 * `RelayStore`. The op payload always carries the post-mutation record(s)
 * the store produced — replay is therefore a pure state replacement, not a
 * re-execution of business logic.
 */
export type RelayJournalOp =
  | { op: "upsertHost"; args: { host: HostRecord } }
  | { op: "recordHostHeartbeat"; args: { host: HostRecord } }
  | { op: "markHostsOffline"; args: { hosts: HostRecord[] } }
  | { op: "updateHostStatus"; args: { host: HostRecord } }
  | { op: "createShareLink"; args: { link: ShareLinkRecord } }
  | { op: "updateShareLink"; args: { link: ShareLinkRecord } }
  | { op: "addShareLinkBudgetUsage"; args: { link: ShareLinkRecord } }
  | { op: "updateShareLinkStatus"; args: { link: ShareLinkRecord } }
  | { op: "createSession"; args: { session: SessionRecord } }
  | { op: "updateSession"; args: { session: SessionRecord } }
  | { op: "createTask"; args: { task: TaskRecord } }
  | { op: "updateTask"; args: { task: TaskRecord } }
  | { op: "cancelTasksForSession"; args: { tasks: TaskRecord[] } }
  | { op: "appendAuditLog"; args: { audit: AuditLogRecord } }
  | { op: "createFriendAuthRequest"; args: { request: FriendAuthRequestRecord } }
  | { op: "createApprovalRequest"; args: { request: ApprovalRequestRecord } }
  | { op: "resolveApprovalRequest"; args: { request: ApprovalRequestRecord } }
  | { op: "appendRuntimeEvent"; args: { event: RuntimeEventRecord } }
  | { op: "enqueueHostCommand"; args: { command: HostCommandRecord } }
  | { op: "claimNextHostCommand"; args: { command: HostCommandRecord } }
  | { op: "completeHostCommand"; args: { command: HostCommandRecord } }
  | { op: "reclaimStaleHostCommands"; args: { commands: HostCommandRecord[] } }
  | {
      op: "appendPreviewFrame";
      args: { frame: PreviewFrameRecord; retainedIds: string[] };
    };

export type RelayJournalEnvelope = RelayJournalOp & {
  /** ISO timestamp of when the mutation was applied in memory. */
  at: string;
  /** Snapshot epoch this op belongs to. */
  epoch: string;
};

export type AppendJournalInput = RelayJournalOp & { at: string; epoch: string };

const WARN_TAG = "[relayStoreJournal]";

export function appendJournal(filePath: string, input: AppendJournalInput): void {
  const dir = dirname(filePath);
  if (dir && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  // Always terminate with `\n` so a truncated mid-write does not merge with
  // the next append. `fs.appendFileSync` is atomic for small writes on
  // local filesystems.
  const line = `${JSON.stringify(input)}\n`;
  appendFileSync(filePath, line, "utf8");
}

export function replayJournal(
  filePath: string,
  snapshotEpoch: string,
  baseSnapshot: RelayData,
): { snapshot: RelayData; journalAt: string | undefined } {
  const snapshot = cloneRelayData(baseSnapshot);
  if (!existsSync(filePath)) {
    return { snapshot, journalAt: undefined };
  }

  const raw = readFileSync(filePath, "utf8");
  if (raw.length === 0) {
    return { snapshot, journalAt: undefined };
  }

  // A well-formed journal always ends with a newline. If the trailing
  // newline is missing the file is truncated mid-write — drop the partial
  // last segment with a warning.
  const endsWithNewline = raw.endsWith("\n");
  const segments = raw.split("\n");
  // The last element after splitting on "\n" is always "" for a
  // newline-terminated file; or the partial line for a truncated file.
  const tail = segments.pop();
  if (!endsWithNewline && tail && tail.length > 0) {
    console.warn(
      `${WARN_TAG} dropping truncated trailing line in ${filePath} (${tail.length} bytes)`,
    );
  }

  let lastAt: string | undefined;
  for (let index = 0; index < segments.length; index += 1) {
    const line = segments[index];
    if (line.length === 0) {
      continue;
    }
    let parsed: RelayJournalEnvelope;
    try {
      parsed = JSON.parse(line) as RelayJournalEnvelope;
    } catch (error) {
      console.warn(
        `${WARN_TAG} skipping unparsable journal line ${index + 1} in ${filePath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      continue;
    }

    if (!parsed || typeof parsed !== "object" || typeof parsed.op !== "string") {
      console.warn(
        `${WARN_TAG} skipping malformed envelope on line ${index + 1} in ${filePath}`,
      );
      continue;
    }

    if (parsed.epoch !== snapshotEpoch) {
      // Ops from a prior epoch were folded into the snapshot during the
      // last compaction; ignore them on replay.
      continue;
    }

    applyOp(snapshot, parsed);
    lastAt = parsed.at;
  }

  return { snapshot, journalAt: lastAt };
}

function applyOp(snapshot: RelayData, envelope: RelayJournalEnvelope): void {
  switch (envelope.op) {
    case "upsertHost":
    case "recordHostHeartbeat":
    case "updateHostStatus":
      replaceById(snapshot.hosts, envelope.args.host);
      return;
    case "markHostsOffline":
      for (const host of envelope.args.hosts) {
        replaceById(snapshot.hosts, host);
      }
      return;
    case "createShareLink":
    case "updateShareLink":
    case "addShareLinkBudgetUsage":
    case "updateShareLinkStatus":
      replaceById(snapshot.shareLinks, envelope.args.link);
      return;
    case "createSession":
    case "updateSession":
      replaceById(snapshot.sessions, envelope.args.session);
      return;
    case "createTask":
    case "updateTask":
      replaceById(snapshot.tasks, envelope.args.task);
      return;
    case "cancelTasksForSession":
      for (const task of envelope.args.tasks) {
        replaceById(snapshot.tasks, task);
      }
      return;
    case "appendAuditLog":
      replaceById(snapshot.auditLogs, envelope.args.audit);
      return;
    case "createFriendAuthRequest":
      replaceById(snapshot.friendAuthRequests, envelope.args.request);
      return;
    case "createApprovalRequest":
    case "resolveApprovalRequest":
      replaceById(snapshot.approvalRequests, envelope.args.request);
      return;
    case "appendRuntimeEvent":
      replaceById(snapshot.runtimeEvents, envelope.args.event);
      return;
    case "enqueueHostCommand":
    case "claimNextHostCommand":
    case "completeHostCommand":
      replaceById(snapshot.hostCommands, envelope.args.command);
      return;
    case "reclaimStaleHostCommands":
      for (const command of envelope.args.commands) {
        replaceById(snapshot.hostCommands, command);
      }
      return;
    case "appendPreviewFrame": {
      replaceById(snapshot.previewFrames, envelope.args.frame);
      const keep = new Set(envelope.args.retainedIds);
      for (let index = snapshot.previewFrames.length - 1; index >= 0; index -= 1) {
        const frame = snapshot.previewFrames[index];
        if (
          frame.sessionId === envelope.args.frame.sessionId
          && frame.taskId === envelope.args.frame.taskId
          && !keep.has(frame.id)
        ) {
          snapshot.previewFrames.splice(index, 1);
        }
      }
      return;
    }
    default: {
      const exhaustive: never = envelope;
      void exhaustive;
      console.warn(`${WARN_TAG} unknown op encountered, skipping`);
      return;
    }
  }
}

function replaceById<T extends { id: string }>(collection: T[], record: T): void {
  const index = collection.findIndex((entry) => entry.id === record.id);
  if (index >= 0) {
    collection[index] = record;
    return;
  }
  collection.push(record);
}

function cloneRelayData(data: RelayData): RelayData {
  return JSON.parse(JSON.stringify(data)) as RelayData;
}
