import assert from "node:assert/strict";
import { test } from "node:test";

import { RelayStore } from "../../src/productization/relayStore.ts";
import {
  createFriendSessionV1,
  createOwnerShareLinkV1,
  getFriendSharePageV1,
  listOwnerAdaptersV1,
  listOwnerHostsV1,
  pauseOwnerShareLinkV1,
  recordHostHeartbeat,
  registerHost,
  revokeOwnerShareLinkV1,
} from "../../src/productization/routes.ts";

function fixedStore(): RelayStore {
  return new RelayStore({
    now: () => new Date("2026-05-21T00:00:00.000Z"),
  });
}

test("host registration and heartbeat expose online adapter inventory", () => {
  const store = fixedStore();

  const registered = registerHost({
    store,
    ownerId: "owner-1",
    hostId: "host-1",
    deviceName: "Benzema Mac",
    hostVersion: "0.1.0",
    supportedAdapters: ["opencode"],
  });

  assert.equal(registered.status, 201);
  assert.equal(registered.body.host.status, "online");
  assert.deepEqual(registered.body.host.supportedAdapters, ["opencode"]);

  const heartbeat = recordHostHeartbeat({
    store,
    hostId: "host-1",
    supportedAdapters: ["opencode", "codex"],
  });
  assert.equal(heartbeat.status, 200);
  assert.deepEqual(heartbeat.body.host.supportedAdapters, ["opencode", "codex"]);

  const auditTypes = store.snapshot().auditLogs.map((entry) => entry.eventType);
  assert.deepEqual(auditTypes, ["host.registered", "host.heartbeat"]);
});

test("heartbeat timeout marks host offline and friend sees a neutral unavailable response", () => {
  let nowMs = Date.parse("2026-05-21T00:00:00.000Z");
  const store = new RelayStore({
    now: () => new Date(nowMs),
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

  const initialFriend = getFriendSharePageV1({
    store,
    token: "local-friend",
    now: () => new Date(nowMs),
  });
  assert.equal(initialFriend.status, 200);
  assert.equal(initialFriend.body.available, true);

  nowMs += 31_000;

  const friendAfterTimeout = getFriendSharePageV1({
    store,
    token: "local-friend",
    now: () => new Date(nowMs),
  });
  assert.equal(friendAfterTimeout.status, 503);
  assert.deepEqual(friendAfterTimeout.body, { available: false, error: "shared_agent_unavailable" });

  const ownerHosts = listOwnerHostsV1({ store, ownerId: "owner-1" });
  assert.equal(ownerHosts.status, 200);
  assert.equal(ownerHosts.body.hosts[0].status, "offline");
});

test("heartbeat transitions an offline host back online and refreshes supported adapters", () => {
  let nowMs = Date.parse("2026-05-21T00:00:00.000Z");
  const store = new RelayStore({
    now: () => new Date(nowMs),
  });

  registerHost({
    store,
    ownerId: "owner-1",
    hostId: "host-1",
    deviceName: "Benzema Mac",
    hostVersion: "0.1.0",
    supportedAdapters: ["opencode"],
  });

  nowMs += 31_000;

  const ownerHosts = listOwnerHostsV1({ store, ownerId: "owner-1" });
  assert.equal(ownerHosts.status, 200);
  assert.equal(ownerHosts.body.hosts[0].status, "offline");

  const heartbeat = recordHostHeartbeat({
    store,
    hostId: "host-1",
    supportedAdapters: ["opencode", "codex"],
  });
  assert.equal(heartbeat.status, 200);
  assert.equal(heartbeat.body.host.status, "online");
  assert.deepEqual(heartbeat.body.host.supportedAdapters, ["opencode", "codex"]);
});

test("owner lists only their registered hosts and adapter inventory", () => {
  const store = fixedStore();
  registerHost({
    store,
    ownerId: "owner-1",
    hostId: "host-1",
    deviceName: "Benzema Mac",
    hostVersion: "0.1.0",
    supportedAdapters: ["opencode", "codex"],
  });
  registerHost({
    store,
    ownerId: "owner-2",
    hostId: "host-2",
    deviceName: "Other Mac",
    hostVersion: "0.1.0",
    supportedAdapters: ["claude-code"],
  });

  const listed = listOwnerHostsV1({ store, ownerId: "owner-1" });

  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.hosts.map((host) => host.id), ["host-1"]);
  assert.equal(listed.body.hosts[0].status, "online");
  assert.deepEqual(listed.body.hosts[0].supportedAdapters, ["opencode", "codex"]);
});

test("owner adapter inventory merges target framework status with owner host support", async () => {
  const store = fixedStore();
  registerHost({
    store,
    ownerId: "owner-1",
    hostId: "host-1",
    deviceName: "Benzema Mac",
    hostVersion: "0.1.0",
    supportedAdapters: ["opencode", "codex"],
  });
  registerHost({
    store,
    ownerId: "owner-2",
    hostId: "host-2",
    deviceName: "Other Mac",
    hostVersion: "0.1.0",
    supportedAdapters: ["claude-code"],
  });

  const listed = await listOwnerAdaptersV1({
    store,
    ownerId: "owner-1",
    adapterInventory: {
      async detectAll() {
        return [
          {
            id: "opencode",
            displayName: "OpenCode",
            status: "available",
            startCapability: "server",
            taskCapability: "server_api",
            eventCapability: "http_events",
            desktopPreviewCapability: "web",
          },
          {
            id: "codex",
            displayName: "Codex",
            status: "not_installed",
            startCapability: "process",
            taskCapability: "cli_once",
            eventCapability: "jsonl",
            desktopPreviewCapability: "none",
          },
          {
            id: "claude-code",
            displayName: "Claude Code",
            status: "not_installed",
            startCapability: "process",
            taskCapability: "cli_once",
            eventCapability: "stream_json",
            desktopPreviewCapability: "none",
          },
        ];
      },
    },
  });

  const byId = new Map(listed.body.adapters.map((adapter) => [adapter.id, adapter]));

  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.adapters.map((adapter) => adapter.id), ["opencode", "codex", "claude-code"]);
  assert.deepEqual(byId.get("opencode")?.connectedHostIds, ["host-1"]);
  assert.equal(byId.get("codex")?.status, "available");
  assert.deepEqual(byId.get("codex")?.connectedHostIds, ["host-1"]);
  assert.deepEqual(byId.get("claude-code")?.connectedHostIds, []);
  assert.equal(JSON.stringify(listed.body).includes("host-2"), false);
});

test("owner creates a private share link and friend opens a cost-free page contract", () => {
  const store = fixedStore();
  registerHost({
    store,
    ownerId: "owner-1",
    hostId: "host-1",
    deviceName: "Benzema Mac",
    hostVersion: "0.1.0",
    supportedAdapters: ["opencode"],
  });

  const created = createOwnerShareLinkV1({
    store,
    ownerId: "owner-1",
    hostId: "host-1",
    name: "Ralphloop Agent",
    baseUrl: "https://share.example",
    tokenFactory: () => "local-friend",
  });

  assert.equal(created.status, 201);
  assert.equal(created.body.shareLink.status, "active");
  assert.equal(created.body.shareLink.token, "local-friend");
  assert.equal(created.body.shareLink.url, "https://share.example/app/share/local-friend/assistant-ui");
  assert.equal(created.body.shareLink.policy.permissionMode, "user_identity");
  assert.equal(created.body.shareLink.policy.previewMode, "read_only");

  const friend = getFriendSharePageV1({
    store,
    token: "local-friend",
  });
  const serialized = JSON.stringify(friend.body);

  assert.equal(friend.status, 200);
  assert.equal(friend.body.available, true);
  assert.match(serialized, /Ralphloop Agent/);
  assert.equal(serialized.includes("tokenHash"), false);
  assert.equal(serialized.includes("maxTotalBudget"), false);
  assert.equal(serialized.includes("cost"), false);
  assert.equal(serialized.includes("budget"), false);
});

test("owner share link creation retries token collisions instead of creating duplicate URLs", () => {
  const store = fixedStore();
  const tokens = ["local-friend", "local-friend", "local-friend-2"];
  registerHost({
    store,
    ownerId: "owner-1",
    hostId: "host-1",
    deviceName: "Benzema Mac",
    hostVersion: "0.1.0",
    supportedAdapters: ["opencode"],
  });

  const first = createOwnerShareLinkV1({
    store,
    ownerId: "owner-1",
    hostId: "host-1",
    name: "Ralphloop Agent",
    baseUrl: "https://share.example",
    tokenFactory: () => tokens.shift() ?? "fallback-friend",
  });
  const second = createOwnerShareLinkV1({
    store,
    ownerId: "owner-1",
    hostId: "host-1",
    name: "Ralphloop Agent 2",
    baseUrl: "https://share.example",
    tokenFactory: () => tokens.shift() ?? "fallback-friend",
  });

  assert.equal(first.status, 201);
  assert.equal(first.body.shareLink.token, "local-friend");
  assert.equal(second.status, 201);
  assert.equal(second.body.shareLink.token, "local-friend-2");
  assert.equal(second.body.shareLink.url, "https://share.example/app/share/local-friend-2/assistant-ui");
});

test("owner share link policy can select one supported adapter and rejects unsupported adapters", () => {
  const store = fixedStore();
  registerHost({
    store,
    ownerId: "owner-1",
    hostId: "host-1",
    deviceName: "Benzema Mac",
    hostVersion: "0.1.0",
    supportedAdapters: ["codex", "claude-code"],
  });

  const created = createOwnerShareLinkV1({
    store,
    ownerId: "owner-1",
    hostId: "host-1",
    name: "Ralphloop Agent",
    baseUrl: "https://share.example",
    tokenFactory: () => "local-friend",
    policy: { allowedAdapterIds: ["codex"] },
  });

  assert.equal(created.status, 201);
  assert.deepEqual(created.body.shareLink.policy.allowedAdapterIds, ["codex"]);
  assert.equal(getFriendSharePageV1({ store, token: "local-friend" }).body.agent.adapterId, "codex");

  const rejected = createOwnerShareLinkV1({
    store,
    ownerId: "owner-1",
    hostId: "host-1",
    name: "Unsupported Agent",
    baseUrl: "https://share.example",
    tokenFactory: () => "bad-link",
    policy: { allowedAdapterIds: ["hermes"] },
  });

  assert.equal(rejected.status, 422);
  assert.deepEqual(rejected.body, { error: "adapter_not_available" });
});

test("paused and revoked productization links reject friend access", () => {
  const store = fixedStore();
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

  const paused = pauseOwnerShareLinkV1({ store, token: "local-friend" });
  assert.equal(paused.status, 200);
  assert.equal(getFriendSharePageV1({ store, token: "local-friend" }).status, 423);

  const revoked = revokeOwnerShareLinkV1({ store, token: "local-friend" });
  assert.equal(revoked.status, 200);
  assert.equal(getFriendSharePageV1({ store, token: "local-friend" }).status, 404);
});

test("friend sessions receive an opaque actor id and optional display name", () => {
  const store = fixedStore();
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

  const created = createFriendSessionV1({
    store,
    token: "local-friend",
    displayName: "Friend One",
  });
  assert.equal(created.status, 201);
  assert.match(created.body.session.friendActorId, /^anon_[a-f0-9-]+$/);
  assert.equal(created.body.session.displayName, "Friend One");

  const persisted = store.snapshot().sessions[0];
  assert.equal(persisted.friendActorId, created.body.session.friendActorId);
  assert.equal(persisted.friendDisplayName, "Friend One");
});

test("friend sessions reject overly long display names", () => {
  const store = fixedStore();
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

  const created = createFriendSessionV1({
    store,
    token: "local-friend",
    displayName: "x".repeat(200),
  });
  assert.equal(created.status, 422);
  assert.deepEqual(created.body, { available: false, error: "display_name_invalid" });
});
