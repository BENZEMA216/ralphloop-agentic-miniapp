import assert from "node:assert/strict";
import { test } from "node:test";

import { listOwnerAdapters } from "../../src/routes/adapters.ts";
import {
  ShareLinkStore,
  createOwnerShareLink,
  getSharedAgentPage,
  pauseShareLink,
  revokeShareLink,
} from "../../src/routes/shareLinks.ts";

test("GET /owner/adapters returns adapter inventory", async () => {
  const response = await listOwnerAdapters({
    detectAll: async () => [
      {
        id: "opencode",
        displayName: "OpenCode",
        status: "available",
        version: "1.2.27",
        startCapability: "server",
        taskCapability: "server_api",
        eventCapability: "http_events",
        desktopPreviewCapability: "web",
      },
    ],
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.adapters.map((adapter) => adapter.id), ["opencode"]);
});

test("POST /owner/share-links creates a link without advanced configuration", () => {
  const store = new ShareLinkStore();

  const response = createOwnerShareLink({
    store,
    input: { adapterId: "opencode" },
    tokenFactory: () => "local-friend",
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.shareLink.token, "local-friend");
  assert.equal(response.body.shareLink.status, "active");
  assert.equal(response.body.shareLink.policy.defaultPermissionMode, "user_identity");
  assert.equal(response.body.shareLink.policy.desktopPreviewMode, "read_only");
  assert.equal(response.body.shareLink.policy.highRiskActionMode, "owner_approve");
});

test("GET /share/:token returns available state for an active link without cost fields", () => {
  const store = new ShareLinkStore();
  createOwnerShareLink({
    store,
    input: { adapterId: "opencode", name: "Friend Agent" },
    tokenFactory: () => "local-friend",
  });

  const response = getSharedAgentPage({ store, token: "local-friend" });

  assert.equal(response.status, 200);
  assert.equal(response.body.available, true);
  assert.equal(response.body.agent.name, "Friend Agent");
  assert.equal(JSON.stringify(response.body).includes("cost"), false);
  assert.equal(JSON.stringify(response.body).includes("budget"), false);
});

test("paused and revoked links are unavailable to friends", () => {
  const store = new ShareLinkStore();
  createOwnerShareLink({
    store,
    input: { adapterId: "opencode" },
    tokenFactory: () => "local-friend",
  });

  pauseShareLink({ store, token: "local-friend" });
  const paused = getSharedAgentPage({ store, token: "local-friend" });
  assert.equal(paused.status, 423);
  assert.equal(paused.body.available, false);

  revokeShareLink({ store, token: "local-friend" });
  const revoked = getSharedAgentPage({ store, token: "local-friend" });
  assert.equal(revoked.status, 404);
  assert.equal(revoked.body.available, false);
});
