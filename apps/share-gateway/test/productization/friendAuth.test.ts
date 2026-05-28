import assert from "node:assert/strict";
import { test } from "node:test";

import { computePolicyVersion } from "../../src/productization/hostCommands.ts";
import { RelayStore } from "../../src/productization/relayStore.ts";
import {
  createFriendSessionV1,
  createOwnerShareLinkV1,
  registerHost,
  startFriendAuthV1,
} from "../../src/productization/routes.ts";

test("friend auth start creates a session-bound pending auth request (manual/file)", () => {
  const store = new RelayStore({
    now: () => new Date("2026-05-22T00:00:00.000Z"),
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

  const sessionResponse = createFriendSessionV1({ store, token: "local-friend" });
  assert.equal(sessionResponse.status, 201);
  const sessionId = sessionResponse.body.session.id;

  const manual = startFriendAuthV1({
    store,
    token: "local-friend",
    sessionId,
    provider: "manual",
  });
  assert.equal(manual.status, 201);
  assert.equal(manual.body.auth.provider, "manual");
  assert.equal(manual.body.auth.status, "pending");
  assert.equal(typeof manual.body.auth.id, "string");
  assert.ok(manual.body.auth.id.length > 0);

  const file = startFriendAuthV1({
    store,
    token: "local-friend",
    sessionId,
    provider: "file",
  });
  assert.equal(file.status, 201);
  assert.equal(file.body.auth.provider, "file");
  assert.equal(file.body.auth.status, "pending");
  assert.equal(typeof file.body.auth.id, "string");
  assert.ok(file.body.auth.id.length > 0);

  const link = store.findShareLinkByToken("local-friend");
  assert.ok(link);
  const snapshot = store.snapshot();
  assert.equal(snapshot.friendAuthRequests.length, 2);
  for (const request of snapshot.friendAuthRequests) {
    assert.equal(request.shareLinkId, link.id);
    assert.equal(request.sessionId, sessionId);
    assert.equal(request.friendActorId, sessionResponse.body.session.friendActorId);
    assert.equal(request.status, "pending");
    assert.equal(request.policyVersion, computePolicyVersion(link.policy));
  }

  const audit = snapshot.auditLogs.filter((entry) => entry.eventType === "auth.started");
  assert.equal(audit.length, 2);
  for (const entry of audit) {
    assert.equal(entry.actorType, "friend");
    assert.equal(entry.shareLinkId, link.id);
    assert.equal(entry.sessionId, sessionId);
    const serialized = JSON.stringify(entry);
    assert.equal(serialized.includes("deviceKey"), false);
    assert.equal(serialized.includes("bootstrapSecret"), false);
    assert.equal(serialized.includes("cost"), false);
  }
});

test("unconfigured auth providers return auth_not_configured without leaking secrets", () => {
  const store = new RelayStore({
    now: () => new Date("2026-05-22T00:00:00.000Z"),
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

  const sessionResponse = createFriendSessionV1({ store, token: "local-friend" });
  assert.equal(sessionResponse.status, 201);

  const response = startFriendAuthV1({
    store,
    token: "local-friend",
    sessionId: sessionResponse.body.session.id,
    provider: "google",
  });
  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { available: false, error: "auth_not_configured" });
  assert.equal(JSON.stringify(response.body).includes("secret"), false);
  assert.equal(JSON.stringify(response.body).includes("token"), false);
  assert.equal(JSON.stringify(response.body).includes("cost"), false);
});
