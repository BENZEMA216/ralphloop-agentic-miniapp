import assert from "node:assert/strict";
import { test } from "node:test";

import { RelayStore } from "../../src/productization/relayStore.ts";
import {
  appendHostPreviewFrameV1,
  createOwnerShareLinkV1,
  getFriendPreviewV1,
  registerHost,
  rejectPreviewInteractionV1,
} from "../../src/productization/routes.ts";

function fixedStore(): RelayStore {
  return new RelayStore({
    now: () => new Date("2026-05-21T00:00:00.000Z"),
  });
}

function setupSession(store: RelayStore) {
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
  if (!("shareLink" in created.body)) {
    throw new Error("share link failed");
  }
  const link = store.findShareLinkByToken("local-friend");
  if (!link) {
    throw new Error("link missing");
  }
  const session = store.createSession({
    shareLinkId: link.id,
    friendActorId: "anonymous-friend",
    hostId: "host-1",
    adapterId: "opencode",
  });
  return session;
}

test("preview frames persist for a session", () => {
  const store = fixedStore();
  const session = setupSession(store);
  const task = store.createTask({ sessionId: session.id, prompt: "preview" });

  const frame = store.appendPreviewFrame({
    sessionId: session.id,
    taskId: task.id,
    contentType: "image/png",
    data: "AA==",
    byteLength: 1,
  });

  assert.equal(frame.sessionId, session.id);
  assert.equal(frame.taskId, task.id);
  assert.deepEqual(store.listPreviewFrames({ sessionId: session.id, taskId: task.id }).map((entry) => entry.id), [
    frame.id,
  ]);
});

test("friend can fetch preview frames only for the matching share token session", () => {
  const store = fixedStore();
  const session = setupSession(store);
  const task = store.createTask({ sessionId: session.id, prompt: "preview" });

  const append = appendHostPreviewFrameV1({
    store,
    ownerId: "owner-1",
    sessionId: session.id,
    taskId: task.id,
    contentType: "image/png",
    data: "AA==",
  });
  assert.equal(append.status, 201);

  const preview = getFriendPreviewV1({
    store,
    token: "local-friend",
    sessionId: session.id,
    taskId: task.id,
    now: () => new Date("2026-05-21T00:00:00.000Z"),
  });

  assert.equal(preview.status, 200);
  assert.equal(preview.body.frames.length, 1);
  assert.equal(preview.body.frames[0].data, "AA==");
  assert.equal(JSON.stringify(preview.body).includes("cost"), false);
});

test("preview rejects invalid token or mismatched session", () => {
  const store = fixedStore();
  const session = setupSession(store);
  const task = store.createTask({ sessionId: session.id, prompt: "preview" });

  assert.equal(getFriendPreviewV1({ store, token: "missing", sessionId: session.id, taskId: task.id }).status, 404);
  assert.equal(getFriendPreviewV1({ store, token: "local-friend", sessionId: "wrong", taskId: task.id }).status, 404);
});

test("preview interaction is rejected by default and audited", () => {
  const store = fixedStore();
  const session = setupSession(store);

  const response = rejectPreviewInteractionV1({
    store,
    ownerId: "owner-1",
    sessionId: session.id,
    inputType: "click",
  });

  assert.equal(response.status, 403);
  assert.deepEqual(response.body, {
    ok: false,
    error: "preview_read_only",
  });
  assert.equal(store.snapshot().auditLogs.at(-1)?.eventType, "preview.interaction_blocked");
});

test("preview frames are rejected when not bound to a session task", () => {
  const store = fixedStore();
  const session = setupSession(store);

  const append = appendHostPreviewFrameV1({
    store,
    ownerId: "owner-1",
    sessionId: session.id,
    taskId: "missing-task",
    contentType: "image/png",
    data: "AA==",
  });

  assert.equal(append.status, 404);
  assert.deepEqual(append.body, { error: "task_not_found" });
});

test("preview frames reject oversized payloads and record audit", () => {
  const store = fixedStore();
  const session = setupSession(store);
  const task = store.createTask({ sessionId: session.id, prompt: "preview" });

  const oversized = Buffer.alloc(256 * 1024 + 1).toString("base64");
  const append = appendHostPreviewFrameV1({
    store,
    ownerId: "owner-1",
    sessionId: session.id,
    taskId: task.id,
    contentType: "image/png",
    data: oversized,
  });

  assert.equal(append.status, 413);
  assert.deepEqual(append.body, { error: "preview_frame_rejected" });
  assert.equal(store.snapshot().auditLogs.at(-1)?.eventType, "preview.frame_rejected");
});

test("stale preview returns a neutral stale response", () => {
  const baseTime = new Date("2026-05-21T00:00:00.000Z");
  const store = new RelayStore({
    now: () => baseTime,
  });
  const session = setupSession(store);
  const task = store.createTask({ sessionId: session.id, prompt: "preview" });

  const append = appendHostPreviewFrameV1({
    store,
    ownerId: "owner-1",
    sessionId: session.id,
    taskId: task.id,
    contentType: "image/png",
    data: "AA==",
  });
  assert.equal(append.status, 201);

  const preview = getFriendPreviewV1({
    store,
    token: "local-friend",
    sessionId: session.id,
    taskId: task.id,
    now: () => new Date(baseTime.getTime() + 31_000),
  });

  assert.equal(preview.status, 200);
  assert.deepEqual(preview.body, { frames: [], available: false, error: "preview_stale" });
});
