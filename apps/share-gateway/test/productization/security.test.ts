import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

/**
 * Aggregate every byte the RelayStore wrote to disk for `filePath` (the
 * compacted snapshot plus the append-only journal that lives alongside it).
 * The security suite asserts these bytes never contain raw share tokens,
 * device keys, or bootstrap secrets regardless of whether the latest state
 * lives in the snapshot or has not been compacted yet.
 */
function readPersistedRelay(filePath: string): string {
  const parts: string[] = [];
  if (existsSync(filePath)) {
    parts.push(readFileSync(filePath, "utf8"));
  }
  const journalPath = `${filePath}.journal.jsonl`;
  if (existsSync(journalPath)) {
    parts.push(readFileSync(journalPath, "utf8"));
  }
  return parts.join("\n");
}

import { RelayStore } from "../../src/productization/relayStore.ts";
import {
  createOwnerShareLinkV1,
  getFriendSharePageV1,
  registerHost,
} from "../../src/productization/routes.ts";
import { createProductizedShareServer } from "../../src/productization/httpServer.ts";

const forbiddenFriendFields = [
  "tokenHash",
  "rawToken",
  "maxTotalBudget",
  "maxTaskBudget",
  "cost",
  "budget",
  "price",
  "付费计划",
  "模型价格",
  "预算余额",
];

test("friend share responses hide costs, token hashes, and policy internals", () => {
  const store = new RelayStore({
    now: () => new Date("2026-05-21T00:00:00.000Z"),
  });
  registerHost({
    store,
    ownerId: "owner-1",
    hostId: "host-1",
    deviceName: "Benzema Mac",
    hostVersion: "0.1.0",
    supportedAdapters: ["opencode"],
  });
  createOwnerShareLinkV1({
    store,
    ownerId: "owner-1",
    hostId: "host-1",
    name: "Ralphloop Agent",
    baseUrl: "https://share.example",
    tokenFactory: () => "local-friend",
  });

  const response = getFriendSharePageV1({ store, token: "local-friend" });
  const serialized = JSON.stringify(response.body);

  assert.equal(response.status, 200);
  for (const field of forbiddenFriendFields) {
    assert.equal(serialized.includes(field), false, `friend response leaked ${field}`);
  }
});

test("invalid tokens return neutral errors without owner or host internals", () => {
  const store = new RelayStore();
  const response = getFriendSharePageV1({ store, token: "missing-token" });
  const serialized = JSON.stringify(response.body);

  assert.equal(response.status, 404);
  assert.equal(serialized.includes("owner-"), false);
  assert.equal(serialized.includes("host-"), false);
  assert.equal(serialized.includes("adapter"), false);
});

test("persistent relay data never stores raw share tokens", () => {
  const directory = mkdtempSync(join(tmpdir(), "ralphloop-security-"));
  const filePath = join(directory, "relay.json");
  try {
    const store = new RelayStore({
      filePath,
      now: () => new Date("2026-05-21T00:00:00.000Z"),
    });
    registerHost({
      store,
      ownerId: "owner-1",
      hostId: "host-1",
      deviceName: "Benzema Mac",
      hostVersion: "0.1.0",
      supportedAdapters: ["opencode"],
    });
    createOwnerShareLinkV1({
      store,
      ownerId: "owner-1",
      hostId: "host-1",
      name: "Ralphloop Agent",
      baseUrl: "https://share.example",
      tokenFactory: () => "local-friend",
    });

    const persisted = readPersistedRelay(filePath);
    assert.equal(persisted.includes("local-friend"), false);
    assert.match(persisted, /tokenHash/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("persistent relay data never stores raw host device keys", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ralphloop-security-"));
  const filePath = join(directory, "relay.json");
  const bootstrapSecret = "test-bootstrap-secret";
  let server: ReturnType<typeof createProductizedShareServer> | undefined;

  try {
    const store = new RelayStore({ filePath });
    server = createProductizedShareServer({
      store,
      hostBootstrapSecret: bootstrapSecret,
    });
    const fetch = server.fetch;

    await server.listen(0);
    const baseUrl = server.url();

    const registered = await fetch(`${baseUrl}/v1/hosts/register`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ralphloop-bootstrap-secret": bootstrapSecret,
      },
      body: JSON.stringify({
        ownerId: "owner-1",
        hostId: "host-1",
        deviceName: "Benzema Mac",
        hostVersion: "0.1.0",
        supportedAdapters: ["opencode"],
      }),
    });
    const body = await registered.json();
    assert.equal(registered.status, 201);
    assert.equal(typeof body.deviceKey, "string");

    const persisted = readPersistedRelay(filePath);
    assert.equal(persisted.includes(body.deviceKey), false);
    assert.match(persisted, /deviceKeyHash/);
    assert.equal(persisted.includes(bootstrapSecret), false);
  } finally {
    await server?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("owner and friend responses never leak host auth materials", async () => {
  const bootstrapSecret = "test-bootstrap-secret";
  const server = createProductizedShareServer({
    tokenFactory: () => "local-friend",
    hostBootstrapSecret: bootstrapSecret,
  });
  const fetch = server.fetch;

  await server.listen(0);
  const baseUrl = server.url();

  try {
    const registered = await fetch(`${baseUrl}/v1/hosts/register`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ralphloop-bootstrap-secret": bootstrapSecret,
      },
      body: JSON.stringify({
        ownerId: "owner-1",
        hostId: "host-1",
        deviceName: "Benzema Mac",
        hostVersion: "0.1.0",
        supportedAdapters: ["opencode"],
      }),
    });
    assert.equal(registered.status, 201);

    const created = await fetch(`${baseUrl}/v1/owner/share-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: "owner-1",
        hostId: "host-1",
        name: "Ralphloop Agent",
      }),
    });
    assert.equal(created.status, 201);

    const hosts = await fetch(`${baseUrl}/v1/owner/hosts?ownerId=owner-1`);
    const hostsBody = await hosts.json();
    assert.equal(hosts.status, 200);
    const hostsSerialized = JSON.stringify(hostsBody);
    assert.equal(hostsSerialized.includes("deviceKey"), false);
    assert.equal(hostsSerialized.includes("deviceKeyHash"), false);
    assert.equal(hostsSerialized.includes("bootstrapSecret"), false);

    const friend = await fetch(`${baseUrl}/v1/share/local-friend`);
    const friendBody = await friend.json();
    assert.equal(friend.status, 200);
    const friendSerialized = JSON.stringify(friendBody);
    assert.equal(friendSerialized.includes("deviceKey"), false);
    assert.equal(friendSerialized.includes("deviceKeyHash"), false);
    assert.equal(friendSerialized.includes("bootstrapSecret"), false);

    const audit = await fetch(`${baseUrl}/v1/owner/audit-logs?ownerId=owner-1`);
    const auditBody = await audit.json();
    assert.equal(audit.status, 200);
    const auditSerialized = JSON.stringify(auditBody);
    assert.equal(auditSerialized.includes("deviceKey"), false);
    assert.equal(auditSerialized.includes("deviceKeyHash"), false);
    assert.equal(auditSerialized.includes("bootstrapSecret"), false);
    assert.equal(auditSerialized.includes(bootstrapSecret), false);
  } finally {
    await server.close();
  }
});

test("friend auth gateway responses stay neutral and do not leak secrets or cost fields", async () => {
  const bootstrapSecret = "test-bootstrap-secret";
  const server = createProductizedShareServer({
    tokenFactory: () => "local-friend",
    hostBootstrapSecret: bootstrapSecret,
  });
  const fetch = server.fetch;

  await server.listen(0);
  const baseUrl = server.url();

  try {
    const registered = await fetch(`${baseUrl}/v1/hosts/register`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ralphloop-bootstrap-secret": bootstrapSecret,
      },
      body: JSON.stringify({
        ownerId: "owner-1",
        hostId: "host-1",
        deviceName: "Benzema Mac",
        hostVersion: "0.1.0",
        supportedAdapters: ["opencode"],
      }),
    });
    assert.equal(registered.status, 201);

    const created = await fetch(`${baseUrl}/v1/owner/share-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: "owner-1",
        hostId: "host-1",
        name: "Ralphloop Agent",
      }),
    });
    assert.equal(created.status, 201);

    const session = await fetch(`${baseUrl}/v1/share/local-friend/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Friend" }),
    });
    assert.equal(session.status, 201);
    const sessionBody = await session.json();

    const started = await fetch(`${baseUrl}/v1/share/local-friend/auth/manual/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: sessionBody.session.id }),
    });
    const startedBody = await started.json();
    assert.equal(started.status, 201);

    const serialized = JSON.stringify(startedBody);
    assert.equal(serialized.includes("deviceKey"), false);
    assert.equal(serialized.includes("deviceKeyHash"), false);
    assert.equal(serialized.includes("bootstrapSecret"), false);
    assert.equal(serialized.includes(bootstrapSecret), false);
    for (const field of forbiddenFriendFields) {
      assert.equal(serialized.includes(field), false, `friend auth response leaked ${field}`);
    }

    const audit = await fetch(`${baseUrl}/v1/owner/audit-logs?ownerId=owner-1`);
    assert.equal(audit.status, 200);
    const auditBody = await audit.json();
    const auditSerialized = JSON.stringify(auditBody);
    assert.equal(auditSerialized.includes("deviceKey"), false);
    assert.equal(auditSerialized.includes("deviceKeyHash"), false);
    assert.equal(auditSerialized.includes("bootstrapSecret"), false);
    assert.equal(auditSerialized.includes(bootstrapSecret), false);
  } finally {
    await server.close();
  }
});
