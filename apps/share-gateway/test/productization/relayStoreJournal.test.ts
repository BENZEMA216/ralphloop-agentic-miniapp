import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  appendJournal,
  replayJournal,
  type RelayJournalOp,
} from "../../src/productization/relayStoreJournal.ts";
import type { RelayData } from "../../src/productization/types.ts";

function tempJournalPath(): { directory: string; filePath: string } {
  const directory = mkdtempSync(join(tmpdir(), "ralphloop-journal-"));
  return { directory, filePath: join(directory, "relay.journal.jsonl") };
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

test("appendJournal writes one well-formed JSON line per call and replay applies it", () => {
  const { directory, filePath } = tempJournalPath();
  try {
    const epoch = "epoch-1";
    const op1: RelayJournalOp = {
      op: "upsertHost",
      args: {
        host: {
          id: "host-1",
          ownerId: "owner-1",
          deviceName: "Test Mac",
          hostVersion: "0.1.0",
          status: "online",
          lastSeenAt: "2026-05-21T00:00:00.000Z",
          supportedAdapters: ["opencode"],
          capabilities: [],
          registeredAt: "2026-05-21T00:00:00.000Z",
        },
      },
    };
    const op2: RelayJournalOp = {
      op: "createShareLink",
      args: {
        link: {
          id: "link-1",
          ownerId: "owner-1",
          hostId: "host-1",
          tokenHash: "hash-1",
          name: "Test Link",
          status: "active",
          createdAt: "2026-05-21T00:00:00.000Z",
          expiresAt: "2026-05-22T00:00:00.000Z",
          budgetUsed: 0,
          policy: {
            maxTotalBudget: 20,
            maxTaskBudget: 2,
            maxConcurrentSessions: 1,
            allowedAdapterIds: ["opencode"],
            previewMode: "read_only",
            permissionMode: "user_identity",
            highRiskActionMode: "owner_approve",
            blockedActions: ["destructive_shell"],
            approvalRequiredActions: ["send_message"],
            allowedDomains: [],
            maxRequestsPerMinute: 30,
            sessionTtlMs: 1_800_000,
          },
        },
      },
    };

    appendJournal(filePath, { op: op1.op, args: op1.args, at: "2026-05-21T00:00:00.000Z", epoch });
    appendJournal(filePath, { op: op2.op, args: op2.args, at: "2026-05-21T00:00:01.000Z", epoch });

    const raw = readFileSync(filePath, "utf8");
    const lines = raw.split("\n").filter((line) => line.length > 0);
    assert.equal(lines.length, 2);
    for (const line of lines) {
      assert.doesNotThrow(() => JSON.parse(line));
    }
    assert.equal(raw.endsWith("\n"), true);

    const { snapshot } = replayJournal(filePath, epoch, emptyData());
    assert.equal(snapshot.hosts.length, 1);
    assert.equal(snapshot.hosts[0].id, "host-1");
    assert.equal(snapshot.shareLinks.length, 1);
    assert.equal(snapshot.shareLinks[0].tokenHash, "hash-1");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("replayJournal skips a truncated last line with a warning and keeps prior ops", () => {
  const { directory, filePath } = tempJournalPath();
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((arg) => String(arg)).join(" "));
  };
  try {
    const epoch = "epoch-2";
    appendJournal(filePath, {
      op: "upsertHost",
      args: {
        host: {
          id: "host-1",
          ownerId: "owner-1",
          deviceName: "Test Mac",
          hostVersion: "0.1.0",
          status: "online",
          lastSeenAt: "2026-05-21T00:00:00.000Z",
          supportedAdapters: ["opencode"],
          capabilities: [],
          registeredAt: "2026-05-21T00:00:00.000Z",
        },
      },
      at: "2026-05-21T00:00:00.000Z",
      epoch,
    });
    // Append a partial (truncated) line — no closing brace, no trailing newline.
    appendFileSync(filePath, '{"op":"upsertHost","args":{"host":{"id":"host-tr', "utf8");

    const { snapshot } = replayJournal(filePath, epoch, emptyData());
    assert.equal(snapshot.hosts.length, 1);
    assert.equal(snapshot.hosts[0].id, "host-1");
    assert.ok(
      warnings.some((message) => message.includes("relayStoreJournal")),
      `expected a relayStoreJournal warning, got: ${warnings.join(" | ")}`,
    );
  } finally {
    console.warn = originalWarn;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("replayJournal ignores lines with non-matching epoch", () => {
  const { directory, filePath } = tempJournalPath();
  try {
    appendJournal(filePath, {
      op: "upsertHost",
      args: {
        host: {
          id: "host-old",
          ownerId: "owner-1",
          deviceName: "Test Mac",
          hostVersion: "0.1.0",
          status: "online",
          lastSeenAt: "2026-05-21T00:00:00.000Z",
          supportedAdapters: ["opencode"],
          capabilities: [],
          registeredAt: "2026-05-21T00:00:00.000Z",
        },
      },
      at: "2026-05-21T00:00:00.000Z",
      epoch: "epoch-old",
    });
    appendJournal(filePath, {
      op: "upsertHost",
      args: {
        host: {
          id: "host-new",
          ownerId: "owner-1",
          deviceName: "Test Mac",
          hostVersion: "0.1.0",
          status: "online",
          lastSeenAt: "2026-05-21T00:00:00.000Z",
          supportedAdapters: ["opencode"],
          capabilities: [],
          registeredAt: "2026-05-21T00:00:00.000Z",
        },
      },
      at: "2026-05-21T00:00:01.000Z",
      epoch: "epoch-new",
    });

    const { snapshot } = replayJournal(filePath, "epoch-new", emptyData());
    assert.equal(snapshot.hosts.length, 1);
    assert.equal(snapshot.hosts[0].id, "host-new");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("replayJournal returns the base snapshot unchanged when the file is missing", () => {
  const { directory, filePath } = tempJournalPath();
  try {
    const base = emptyData();
    base.hosts.push({
      id: "host-baseline",
      ownerId: "owner-1",
      deviceName: "Test Mac",
      hostVersion: "0.1.0",
      status: "online",
      lastSeenAt: "2026-05-21T00:00:00.000Z",
      supportedAdapters: ["opencode"],
      capabilities: [],
      registeredAt: "2026-05-21T00:00:00.000Z",
    });
    const { snapshot } = replayJournal(filePath, "epoch-missing", base);
    assert.equal(snapshot.hosts.length, 1);
    assert.equal(snapshot.hosts[0].id, "host-baseline");
    // Replay must not mutate the input base.
    base.hosts.push({
      id: "host-mutated",
      ownerId: "owner-1",
      deviceName: "Test Mac",
      hostVersion: "0.1.0",
      status: "online",
      lastSeenAt: "2026-05-21T00:00:00.000Z",
      supportedAdapters: ["opencode"],
      capabilities: [],
      registeredAt: "2026-05-21T00:00:00.000Z",
    });
    assert.equal(snapshot.hosts.length, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("replayJournal skips a malformed JSON line in the middle but applies later valid lines", () => {
  const { directory, filePath } = tempJournalPath();
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((arg) => String(arg)).join(" "));
  };
  try {
    const epoch = "epoch-mixed";
    // Manually write: valid line, garbage line, valid line.
    const goodLineA = JSON.stringify({
      op: "upsertHost",
      args: {
        host: {
          id: "host-a",
          ownerId: "owner-1",
          deviceName: "Test Mac",
          hostVersion: "0.1.0",
          status: "online",
          lastSeenAt: "2026-05-21T00:00:00.000Z",
          supportedAdapters: ["opencode"],
          capabilities: [],
          registeredAt: "2026-05-21T00:00:00.000Z",
        },
      },
      at: "2026-05-21T00:00:00.000Z",
      epoch,
    });
    const goodLineB = JSON.stringify({
      op: "upsertHost",
      args: {
        host: {
          id: "host-b",
          ownerId: "owner-1",
          deviceName: "Test Mac",
          hostVersion: "0.1.0",
          status: "online",
          lastSeenAt: "2026-05-21T00:00:01.000Z",
          supportedAdapters: ["opencode"],
          capabilities: [],
          registeredAt: "2026-05-21T00:00:01.000Z",
        },
      },
      at: "2026-05-21T00:00:01.000Z",
      epoch,
    });
    writeFileSync(filePath, `${goodLineA}\n{not json\n${goodLineB}\n`, "utf8");

    const { snapshot } = replayJournal(filePath, epoch, emptyData());
    const ids = snapshot.hosts.map((host) => host.id).sort();
    assert.deepEqual(ids, ["host-a", "host-b"]);
    assert.ok(
      warnings.some((message) => message.includes("relayStoreJournal")),
      "expected a warn for the malformed middle line",
    );
  } finally {
    console.warn = originalWarn;
    rmSync(directory, { recursive: true, force: true });
  }
});
