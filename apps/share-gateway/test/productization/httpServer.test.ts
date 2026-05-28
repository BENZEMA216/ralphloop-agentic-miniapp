import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

import type { AdapterStatus, AgentAdapter, AgentAdapterInfo } from "../../src/adapters/types.ts";
import { HostRuntimeRegistry } from "../../src/productization/hostRuntime.ts";
import { createProductizedShareServer } from "../../src/productization/httpServer.ts";
import { RelayStore } from "../../src/productization/relayStore.ts";
import { appendHostPreviewFrameV1, gateRuntimeActionV1 } from "../../src/productization/routes.ts";

const bootstrapSecret = "test-bootstrap-secret";

function adapter(): AgentAdapter {
  return {
    async detect() {
      throw new Error("detect not used");
    },
    async start(input) {
      return {
        adapterId: input.adapterId,
        runtimeId: `${input.adapterId}:runtime`,
        status: "running",
      };
    },
    async submitTask(input) {
      return {
        adapterId: input.runtime.adapterId,
        runtimeId: input.runtime.runtimeId,
        taskId: input.taskId ?? "task-1",
        status: "completed",
      };
    },
    async *streamEvents(input) {
      yield { type: "task.output", taskId: input.task.taskId, text: "done" };
      yield { type: "task.completed", taskId: input.task.taskId };
    },
    async stop() {},
  };
}

function acceptedThenOutputAdapter(): AgentAdapter {
  return {
    async detect() {
      throw new Error("detect not used");
    },
    async start(input) {
      return {
        adapterId: input.adapterId,
        runtimeId: `${input.adapterId}:runtime`,
        status: "running",
      };
    },
    async submitTask(input) {
      return {
        adapterId: input.runtime.adapterId,
        runtimeId: input.runtime.runtimeId,
        taskId: input.taskId ?? "task-1",
        status: "completed",
      };
    },
    async *streamEvents(input) {
      yield { type: "task.accepted", taskId: input.task.taskId };
      yield { type: "task.output", taskId: input.task.taskId, text: "accepted event output" };
      yield { type: "task.completed", taskId: input.task.taskId };
    },
    async stop() {},
  };
}

function delayedAdapter(input: {
  delayMsForPrompt?: (prompt: string) => number;
  outputForPrompt?: (prompt: string) => string;
} = {}): AgentAdapter {
  const promptsByTaskId = new Map<string, string>();

  return {
    async detect() {
      throw new Error("detect not used");
    },
    async start(runtimeInput) {
      return {
        adapterId: runtimeInput.adapterId,
        runtimeId: `${runtimeInput.adapterId}:runtime`,
        status: "running",
      };
    },
    async submitTask(taskInput) {
      const taskId = taskInput.taskId ?? `task-${promptsByTaskId.size + 1}`;
      promptsByTaskId.set(taskId, taskInput.prompt);
      return {
        adapterId: taskInput.runtime.adapterId,
        runtimeId: taskInput.runtime.runtimeId,
        taskId,
        status: "completed",
      };
    },
    async *streamEvents(streamInput) {
      const prompt = promptsByTaskId.get(streamInput.task.taskId) ?? "";
      const delayMs = input.delayMsForPrompt?.(prompt) ?? 0;
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      yield {
        type: "task.output",
        taskId: streamInput.task.taskId,
        text: input.outputForPrompt?.(prompt) ?? `local output: ${prompt}`,
      };
      yield { type: "task.completed", taskId: streamInput.task.taskId };
    },
    async stop() {},
  };
}

function adapterInfo(id: string, displayName: string, status: AdapterStatus): AgentAdapterInfo {
  return {
    id,
    displayName,
    status,
    startCapability: id === "opencode" || id === "agent-zero" ? "server" : "process",
    taskCapability: id === "opencode" || id === "agent-zero" ? "server_api" : "cli_once",
    eventCapability: id === "opencode" || id === "agent-zero" ? "http_events" : "jsonl",
    desktopPreviewCapability: id === "opencode" ? "web" : id === "agent-zero" ? "browser" : "none",
  };
}

type FakeEvent = {
  type: string;
  target?: unknown;
  key?: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  preventDefault?(): void;
};

class FakeClassList {
  #classes: Set<string>;

  constructor(classes: string[] = []) {
    this.#classes = new Set(classes);
  }

  add(...classNames: string[]) {
    for (const className of classNames) {
      this.#classes.add(className);
    }
  }

  remove(...classNames: string[]) {
    for (const className of classNames) {
      this.#classes.delete(className);
    }
  }

  toggle(className: string, force?: boolean): boolean {
    if (force === true) {
      this.#classes.add(className);
      return true;
    }
    if (force === false) {
      this.#classes.delete(className);
      return false;
    }
    if (this.#classes.has(className)) {
      this.#classes.delete(className);
      return false;
    }
    this.#classes.add(className);
    return true;
  }

  contains(className: string): boolean {
    return this.#classes.has(className);
  }
}

class FakeLocalStorage {
  #values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.#values.set(key, String(value));
  }

  removeItem(key: string) {
    this.#values.delete(key);
  }

  clear() {
    this.#values.clear();
  }
}

class FakeElement {
  id: string;
  name = "";
  value = "";
  checked = false;
  textContent = "";
  innerHTML = "";
  href = "";
  disabled = false;
  dataset: Record<string, string> = {};
  classList = new FakeClassList();
  scrollTop = 0;
  scrollHeight = 0;
  elements: FakeElement[] = [];
  #attributes = new Map<string, string>();
  #listeners = new Map<string, Array<(event: FakeEvent) => unknown>>();

  constructor(id: string) {
    this.id = id;
  }

  addEventListener(type: string, listener: (event: FakeEvent) => unknown) {
    const listeners = this.#listeners.get(type) ?? [];
    listeners.push(listener);
    this.#listeners.set(type, listeners);
  }

  async dispatchEvent(event: FakeEvent) {
    const listeners = this.#listeners.get(event.type) ?? [];
    for (const listener of listeners) {
      await listener(event);
    }
  }

  setAttribute(name: string, value: string) {
    this.#attributes.set(name, value);
    if (name === "disabled") {
      this.disabled = true;
      return;
    }
    this[name as keyof this] = value as this[keyof this];
  }

  getAttribute(name: string): string | null {
    if (name === "disabled") {
      return this.disabled ? "" : null;
    }
    if (name === "href") {
      return this.href || null;
    }
    return this.#attributes.get(name) ?? null;
  }

  removeAttribute(name: string) {
    this.#attributes.delete(name);
    if (name === "disabled") {
      this.disabled = false;
      return;
    }
    if (name === "href") {
      this.href = "";
    }
  }
}

class FakeDocument {
  #elements = new Map<string, FakeElement>();
  #selectors = new Map<string, FakeElement>();

  constructor(ids: string[], selectors: Record<string, FakeElement> = {}) {
    for (const id of ids) {
      this.#elements.set(id, new FakeElement(id));
    }
    for (const [selector, element] of Object.entries(selectors)) {
      this.#selectors.set(selector, element);
    }
  }

  getElementById(id: string): FakeElement {
    let element = this.#elements.get(id);
    if (!element) {
      element = new FakeElement(id);
      this.#elements.set(id, element);
    }
    return element;
  }

  querySelector(selector: string): FakeElement | undefined {
    return this.#selectors.get(selector);
  }
}

class FakeFormData {
  #values = new Map<string, string[]>();

  constructor(form: FakeElement) {
    for (const element of form.elements) {
      if (element.name) {
        const values = this.#values.get(element.name) ?? [];
        values.push(element.value);
        this.#values.set(element.name, values);
      }
    }
  }

  get(name: string): string | undefined {
    return this.#values.get(name)?.[0];
  }

  getAll(name: string): string[] {
    return this.#values.get(name) ?? [];
  }
}

function extractInlineScript(html: string): string {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, "expected page to contain an inline script");
  return match[1];
}

function createFriendDocument(): FakeDocument {
  const previewFrame = new FakeElement("preview-frame");
  const document = new FakeDocument([
    "chat-form",
    "chat-prompt",
    "chat-status",
    "chat-thread",
    "chat-submit",
    "chat-stop",
    "session-list",
    "new-session",
    "preview-toggle",
    "preview-drawer",
    "preview-close",
    "preview-frame",
    "task-form",
    "task-prompt",
    "task-status",
    "task-result",
    "friend-confirmations",
    "refresh-confirmations",
  ], {
    ".preview-frame": previewFrame,
  });
  const chatForm = document.getElementById("chat-form");
  const chatPrompt = document.getElementById("chat-prompt");
  chatPrompt.name = "prompt";
  chatForm.elements = [chatPrompt];
  const taskForm = document.getElementById("task-form");
  const taskPrompt = document.getElementById("task-prompt");
  taskPrompt.name = "prompt";
  taskForm.elements = [taskPrompt];
  return document;
}

function createOwnerDocument(): FakeDocument {
  return new FakeDocument([
    "create-share-link",
    "revoke-share-link",
    "refresh-audit-log",
    "share-link",
    "host-id",
    "host-device",
    "host-status",
    "host-reconnect",
    "host-offline-reason",
    "host-auth",
    "host-last-seen",
    "adapter-list",
    "audit-log",
    "control-status",
    "approval-queue",
    "refresh-approvals",
    "share-link-list",
    "refresh-share-links",
    "session-list",
    "refresh-sessions",
    "task-history",
    "refresh-task-history",
  ]);
}

function fakeClickTarget(className: string, dataset: Record<string, string>): unknown {
  return {
    classList: new FakeClassList([className]),
    dataset,
  };
}

async function runPageScript(input: {
  html: string;
  document: FakeDocument;
  baseUrl: string;
  localStorage?: FakeLocalStorage;
  fetch: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<Response>;
}) {
  const localStorage = input.localStorage ?? new FakeLocalStorage();
  const window = {
    location: { origin: input.baseUrl },
    localStorage,
    setTimeout: () => 0,
    clearTimeout: () => undefined,
  };
  const context = {
    document: input.document,
    window,
    localStorage,
    FormData: FakeFormData,
    URL,
    console,
    atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
    fetch: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
      const resolved = new URL(url, input.baseUrl).toString();
      return input.fetch(resolved, init);
    },
    setTimeout: window.setTimeout,
    clearTimeout: window.clearTimeout,
  };
  runInNewContext(extractInlineScript(input.html), context);
  await settlePageTasks();
}

async function settlePageTasks() {
  for (let index = 0; index < 6; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function waitForFriendChatStatus(
  document: FakeDocument,
  expectedStatus: string,
  attempts = 30,
) {
  for (let index = 0; index < attempts; index += 1) {
    await settlePageTasks();
    if (document.getElementById("chat-status").textContent === expectedStatus) {
      return;
    }
  }
  assert.equal(document.getElementById("chat-status").textContent, expectedStatus);
}

async function submitFriendTask(document: FakeDocument, prompt: string) {
  await submitFriendChatMessage(document, prompt);
}

async function submitFriendChatMessage(document: FakeDocument, prompt: string) {
  await dispatchFriendChatMessage(document, prompt);
  await settlePageTasks();
}

async function dispatchFriendChatMessage(document: FakeDocument, prompt: string) {
  const chatForm = document.getElementById("chat-form");
  const chatPrompt = document.getElementById("chat-prompt");
  chatPrompt.value = prompt;
  await chatForm.dispatchEvent({
    type: "submit",
    preventDefault() {},
  });
}

async function pressFriendComposerKey(
  document: FakeDocument,
  input: { prompt: string; key: string; shiftKey?: boolean },
): Promise<boolean> {
  const chatPrompt = document.getElementById("chat-prompt");
  let defaultPrevented = false;
  chatPrompt.value = input.prompt;
  await chatPrompt.dispatchEvent({
    type: "keydown",
    key: input.key,
    shiftKey: input.shiftKey,
    preventDefault() {
      defaultPrevented = true;
    },
  });
  await settlePageTasks();
  return defaultPrevented;
}

async function clickFriendStop(document: FakeDocument) {
  await document.getElementById("chat-stop").dispatchEvent({
    type: "click",
  });
  await waitForFriendChatStatus(document, "已取消");
}

async function clickFriendNewSession(document: FakeDocument) {
  await document.getElementById("new-session").dispatchEvent({
    type: "click",
  });
  await settlePageTasks();
}

async function clickFriendSession(document: FakeDocument, sessionId: string) {
  await document.getElementById("session-list").dispatchEvent({
    type: "click",
    target: {
      classList: new FakeClassList(["session-title"]),
      dataset: {},
      closest: (selector: string) => selector === ".friend-session-item"
        ? { dataset: { sessionId } }
        : undefined,
    },
  });
  await settlePageTasks();
}

async function clickFriendPreviewToggle(document: FakeDocument) {
  await document.getElementById("preview-toggle").dispatchEvent({
    type: "click",
  });
  await settlePageTasks();
}

async function clickFriendPreviewClose(document: FakeDocument) {
  await document.getElementById("preview-close").dispatchEvent({
    type: "click",
  });
  await settlePageTasks();
}

async function clickFriendApproval(document: FakeDocument, action: "approve" | "deny", requestId: string) {
  await document.getElementById("chat-thread").dispatchEvent({
    type: "click",
    target: fakeClickTarget(`${action}-friend-confirmation`, { requestId }),
  });
  await settlePageTasks();
}

type FriendUiSession = {
  id: string;
  title?: string;
  messages?: Array<{ content?: string; taskId?: string; type?: string }>;
  currentTaskId?: string;
};

function readFriendUiSessions(localStorage: FakeLocalStorage, token = "local-friend"): FriendUiSession[] {
  return JSON.parse(localStorage.getItem(`ralphloop:friend:sessions:${token}`) ?? "[]") as FriendUiSession[];
}

function readActiveFriendUiSessionId(localStorage: FakeLocalStorage, token = "local-friend"): string {
  return localStorage.getItem(`ralphloop:friend:sessions:${token}:active`) ?? "";
}

function seedFriendUiSession(
  localStorage: FakeLocalStorage,
  input: { sessionId: string; taskId: string; token?: string },
) {
  const token = input.token ?? "local-friend";
  localStorage.setItem(`ralphloop:friend:sessions:${token}:active`, input.sessionId);
  localStorage.setItem(`ralphloop:friend:sessions:${token}`, JSON.stringify([
    {
      id: input.sessionId,
      title: "本地 Agent 输出",
      status: "waiting",
      updatedAt: "2026-05-24T00:00:00.000Z",
      messages: [],
      messageKeys: [],
      currentTaskId: input.taskId,
    },
  ]));
}

async function clickOwnerShareLinkAction(document: FakeDocument, className: string, shareLinkId: string) {
  await document.getElementById("share-link-list").dispatchEvent({
    type: "click",
    target: fakeClickTarget(className, { shareLinkId }),
  });
  await settlePageTasks();
}

async function submitOwnerShareLinkEdit(
  document: FakeDocument,
  input: { shareLinkId: string; name: string; allowedAdapterIds: string[] },
) {
  const form = new FakeElement("share-link-edit-form");
  form.classList = new FakeClassList(["share-link-edit-form"]);
  form.dataset.shareLinkId = input.shareLinkId;

  const nameInput = new FakeElement("share-link-name-input");
  nameInput.name = "name";
  nameInput.value = input.name;
  const adapterInputs = input.allowedAdapterIds.map((adapterId) => {
    const element = new FakeElement(`share-link-adapter-${adapterId}`);
    element.name = "allowedAdapterIds";
    element.value = adapterId;
    return element;
  });
  form.elements = [nameInput, ...adapterInputs];

  await document.getElementById("share-link-list").dispatchEvent({
    type: "submit",
    target: form,
    preventDefault() {},
  });
  await settlePageTasks();
}

test("productized HTTP host register and heartbeat require auth headers", async () => {
  let nowTick = 0;
  const baseTime = new Date("2026-05-21T00:00:00.000Z");
  const store = new RelayStore({
    now: () => new Date(baseTime.getTime() + nowTick++ * 1000),
  });
  const server = createProductizedShareServer({
    store,
    hostBootstrapSecret: bootstrapSecret,
  });
  const fetch = server.fetch;

  await server.listen(0);
  const baseUrl = server.url();

  try {
    const unauthRegister = await fetch(`${baseUrl}/v1/hosts/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: "owner-1",
        hostId: "host-1",
        deviceName: "Benzema Mac",
        hostVersion: "0.1.0",
        supportedAdapters: ["opencode"],
      }),
    });
    assert.equal(unauthRegister.status, 401);
    assert.deepEqual(await unauthRegister.json(), { error: "host_auth_required" });

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
    const registeredBody = await registered.json();
    assert.equal(typeof registeredBody.deviceKey, "string");
    assert.equal(registeredBody.deviceKey.length > 0, true);

    const registeredHost = store.findHost("host-1");
    assert.equal(registeredHost?.id, "host-1");
    const lastSeenAtBefore = registeredHost?.lastSeenAt;

    const unauthHeartbeat = await fetch(`${baseUrl}/v1/hosts/host-1/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ supportedAdapters: ["opencode"] }),
    });
    assert.equal(unauthHeartbeat.status, 401);
    assert.deepEqual(await unauthHeartbeat.json(), { error: "host_auth_required" });
    assert.equal(store.findHost("host-1")?.lastSeenAt, lastSeenAtBefore);

    const wrongHeartbeat = await fetch(`${baseUrl}/v1/hosts/host-1/heartbeat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ralphloop-device-key": "wrong-key",
      },
      body: JSON.stringify({ supportedAdapters: ["opencode"] }),
    });
    assert.equal(wrongHeartbeat.status, 403);
    assert.deepEqual(await wrongHeartbeat.json(), { error: "host_auth_invalid" });

    const secondRegistered = await fetch(`${baseUrl}/v1/hosts/register`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ralphloop-bootstrap-secret": bootstrapSecret,
      },
      body: JSON.stringify({
        ownerId: "owner-1",
        hostId: "host-2",
        deviceName: "Other Mac",
        hostVersion: "0.1.0",
        supportedAdapters: ["opencode"],
      }),
    });
    assert.equal(secondRegistered.status, 201);
    const secondBody = await secondRegistered.json();
    assert.equal(typeof secondBody.deviceKey, "string");
    assert.equal(secondBody.deviceKey.length > 0, true);

    const crossHostHeartbeat = await fetch(`${baseUrl}/v1/hosts/host-2/heartbeat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ralphloop-device-key": registeredBody.deviceKey,
      },
      body: JSON.stringify({ supportedAdapters: ["opencode"] }),
    });
    assert.equal(crossHostHeartbeat.status, 403);
    assert.deepEqual(await crossHostHeartbeat.json(), { error: "host_auth_invalid" });

    const heartbeat = await fetch(`${baseUrl}/v1/hosts/host-1/heartbeat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ralphloop-device-key": registeredBody.deviceKey,
      },
      body: JSON.stringify({ supportedAdapters: ["opencode"] }),
    });
    assert.equal(heartbeat.status, 200);

    const heartbeatTwo = await fetch(`${baseUrl}/v1/hosts/host-2/heartbeat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ralphloop-device-key": secondBody.deviceKey,
      },
      body: JSON.stringify({ supportedAdapters: ["opencode"] }),
    });
    assert.equal(heartbeatTwo.status, 200);
  } finally {
    await server.close();
  }
});

test("productized HTTP root path opens the owner experience", async () => {
  const server = createProductizedShareServer({
    hostBootstrapSecret: bootstrapSecret,
  });
  const fetch = server.fetch;

  await server.listen(0);
  const baseUrl = server.url();

  try {
    const root = await fetch(`${baseUrl}/`);
    assert.equal(root.status, 200);
    const html = await root.text();
    assert.match(html, /Ralphloop Owner/);
    assert.match(html, /分享你的桌面 Agent/);

    const favicon = await fetch(`${baseUrl}/favicon.ico`);
    assert.equal(favicon.status, 204);
  } finally {
    await server.close();
  }
});

test("productized HTTP API serves host, owner, and friend task flow", async () => {
  const runtimes = new HostRuntimeRegistry();
  runtimes.connectHost({ hostId: "host-1", adapters: { opencode: adapter() } });
  const server = createProductizedShareServer({
    runtimes,
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
    const registeredBody = await registered.json();
    assert.equal(typeof registeredBody.deviceKey, "string");

    const hosts = await fetch(`${baseUrl}/v1/owner/hosts?ownerId=owner-1`);
    assert.equal(hosts.status, 200);
    const hostsBody = await hosts.json();
    assert.deepEqual(hostsBody.hosts.map((host) => host.id), ["host-1"]);
    assert.deepEqual(hostsBody.hosts[0].supportedAdapters, ["opencode"]);

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
    const createdBody = await created.json();
    assert.equal(createdBody.shareLink.token, "local-friend");
    assert.equal(createdBody.shareLink.url, `${baseUrl}/app/share/local-friend/assistant-ui`);

    const friend = await fetch(`${baseUrl}/v1/share/local-friend`);
    assert.equal(friend.status, 200);
    const friendBody = await friend.json();
    assert.equal(friendBody.available, true);
    assert.equal(JSON.stringify(friendBody).includes("cost"), false);
    assert.equal(JSON.stringify(friendBody).includes("tokenHash"), false);

    const session = await fetch(`${baseUrl}/v1/share/local-friend/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Friend" }),
    });
    assert.equal(session.status, 201);
    const sessionBody = await session.json();

    const task = await fetch(`${baseUrl}/v1/share/local-friend/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: sessionBody.session.id,
        prompt: "Summarize the runtime",
        estimatedTaskBudget: 1,
      }),
    });
    assert.equal(task.status, 202);
    const taskBody = await task.json();
    assert.equal(taskBody.task.status, "completed");
    assert.deepEqual(taskBody.events.map((event) => event.type), ["task.output", "task.completed"]);
    assert.equal(JSON.stringify(taskBody).includes("budget"), false);

    const events = await fetch(
      `${baseUrl}/v1/share/local-friend/events?sessionId=${sessionBody.session.id}&taskId=${taskBody.task.id}`,
    );
    assert.equal(events.status, 200);
    const eventsBody = await events.json();
    assert.deepEqual(eventsBody.events.map((event) => event.type), ["task.output", "task.completed"]);
    assert.equal(eventsBody.events[0].taskId, taskBody.task.id);
    assert.equal(JSON.stringify(eventsBody).includes("cost"), false);
    assert.equal(JSON.stringify(eventsBody).includes("budget"), false);
    assert.equal(JSON.stringify(eventsBody).includes("tokenHash"), false);

    const wrongTokenEvents = await fetch(
      `${baseUrl}/v1/share/wrong-token/events?sessionId=${sessionBody.session.id}&taskId=${taskBody.task.id}`,
    );
    assert.equal(wrongTokenEvents.status, 404);
    assert.deepEqual(await wrongTokenEvents.json(), {
      events: [],
      available: false,
      error: "share_link_unavailable",
    });
  } finally {
    await server.close();
  }
});

test("productized HTTP owner inventory supports selected adapter share policy", async () => {
  const runtimes = new HostRuntimeRegistry();
  runtimes.connectHost({
    hostId: "host-1",
    adapters: {
      codex: adapter(),
      "claude-code": adapter(),
    },
  });
  const server = createProductizedShareServer({
    runtimes,
    tokenFactory: () => "codex-friend",
    hostBootstrapSecret: bootstrapSecret,
  });
  const fetch = server.fetch;

  await server.listen(0);
  const baseUrl = server.url();

  try {
    await fetch(`${baseUrl}/v1/hosts/register`, {
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
        supportedAdapters: ["codex", "claude-code"],
      }),
    });

    const hosts = await fetch(`${baseUrl}/v1/owner/hosts?ownerId=owner-1`);
    assert.equal(hosts.status, 200);
    const hostsBody = await hosts.json();
    assert.deepEqual(hostsBody.hosts[0].supportedAdapters, ["codex", "claude-code"]);

    const created = await fetch(`${baseUrl}/v1/owner/share-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: "owner-1",
        hostId: "host-1",
        name: "Ralphloop Codex Agent",
        policy: { allowedAdapterIds: ["codex"] },
      }),
    });
    assert.equal(created.status, 201);
    const createdBody = await created.json();
    assert.deepEqual(createdBody.shareLink.policy.allowedAdapterIds, ["codex"]);

    const friend = await fetch(`${baseUrl}/v1/share/codex-friend`);
    assert.equal(friend.status, 200);
    const friendBody = await friend.json();
    assert.equal(friendBody.agent.adapterId, "codex");

    const rejected = await fetch(`${baseUrl}/v1/owner/share-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: "owner-1",
        hostId: "host-1",
        name: "Bad Agent",
        policy: { allowedAdapterIds: ["hermes"] },
      }),
    });
    assert.equal(rejected.status, 422);
    assert.deepEqual(await rejected.json(), { error: "adapter_not_available" });
  } finally {
    await server.close();
  }
});

test("productized HTTP owner adapters expose target framework inventory scoped to owner hosts", async () => {
  const server = createProductizedShareServer({
    adapterInventory: {
      async detectAll() {
        return [
          adapterInfo("opencode", "OpenCode", "available"),
          adapterInfo("codex", "Codex", "not_installed"),
          adapterInfo("claude-code", "Claude Code", "not_installed"),
          adapterInfo("hermes", "Hermes Agent", "not_installed"),
          adapterInfo("agent-zero", "Agent Zero", "not_installed"),
        ];
      },
    },
    hostBootstrapSecret: bootstrapSecret,
  });
  const fetch = server.fetch;

  await server.listen(0);
  const baseUrl = server.url();

  try {
    await fetch(`${baseUrl}/v1/hosts/register`, {
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
        supportedAdapters: ["opencode", "codex"],
      }),
    });
    await fetch(`${baseUrl}/v1/hosts/register`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ralphloop-bootstrap-secret": bootstrapSecret,
      },
      body: JSON.stringify({
        ownerId: "owner-2",
        hostId: "host-2",
        deviceName: "Other Mac",
        hostVersion: "0.1.0",
        supportedAdapters: ["claude-code"],
      }),
    });

    const response = await fetch(`${baseUrl}/v1/owner/adapters?ownerId=owner-1`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(
      body.adapters.map((entry) => entry.id),
      ["opencode", "codex", "claude-code", "hermes", "agent-zero"],
    );
    const byId = new Map(body.adapters.map((entry) => [entry.id, entry]));
    assert.equal(byId.get("opencode")?.status, "available");
    assert.deepEqual(byId.get("opencode")?.connectedHostIds, ["host-1"]);
    assert.equal(byId.get("codex")?.status, "available");
    assert.deepEqual(byId.get("codex")?.connectedHostIds, ["host-1"]);
    assert.equal(byId.get("claude-code")?.status, "not_installed");
    assert.deepEqual(byId.get("claude-code")?.connectedHostIds, []);
    assert.equal(JSON.stringify(body).includes("host-2"), false);
    assert.equal(JSON.stringify(body).includes("owner-2"), false);
    assert.equal(JSON.stringify(body).includes("cost"), false);
    assert.equal(JSON.stringify(body).includes("budget"), false);
    assert.equal(JSON.stringify(body).includes("tokenHash"), false);
  } finally {
    await server.close();
  }
});

test("productized HTTP owner can patch share link name and policy", async () => {
  const runtimes = new HostRuntimeRegistry();
  runtimes.connectHost({
    hostId: "host-1",
    adapters: {
      opencode: adapter(),
      codex: adapter(),
    },
  });
  const server = createProductizedShareServer({
    runtimes,
    tokenFactory: () => "local-friend",
    hostBootstrapSecret: bootstrapSecret,
  });
  const fetch = server.fetch;

  await server.listen(0);
  const baseUrl = server.url();

  try {
    await fetch(`${baseUrl}/v1/hosts/register`, {
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
        supportedAdapters: ["opencode", "codex"],
      }),
    });

    const created = await fetch(`${baseUrl}/v1/owner/share-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: "owner-1",
        hostId: "host-1",
        name: "Ralphloop Agent",
        policy: { allowedAdapterIds: ["opencode"], maxTotalBudget: 4 },
      }),
    });
    assert.equal(created.status, 201);
    const createdBody = await created.json();

    const denied = await fetch(`${baseUrl}/v1/owner/share-links/${createdBody.shareLink.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerId: "owner-2", name: "Wrong owner" }),
    });
    assert.equal(denied.status, 404);
    assert.deepEqual(await denied.json(), { error: "share_link_unavailable" });

    const unsupported = await fetch(`${baseUrl}/v1/owner/share-links/${createdBody.shareLink.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: "owner-1",
        policy: { allowedAdapterIds: ["hermes"] },
      }),
    });
    assert.equal(unsupported.status, 422);
    assert.deepEqual(await unsupported.json(), { error: "adapter_not_available" });

    const patched = await fetch(`${baseUrl}/v1/owner/share-links/${createdBody.shareLink.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: "owner-1",
        name: "Ralphloop Codex Agent",
        policy: {
          allowedAdapterIds: ["codex"],
          maxTotalBudget: 8,
        },
      }),
    });
    assert.equal(patched.status, 200);
    const patchedBody = await patched.json();
    assert.equal(patchedBody.shareLink.name, "Ralphloop Codex Agent");
    assert.deepEqual(patchedBody.shareLink.allowedAdapterIds, ["codex"]);
    assert.equal(patchedBody.shareLink.maxTotalBudget, 8);
    assert.equal(JSON.stringify(patchedBody).includes("tokenHash"), false);

    const friend = await fetch(`${baseUrl}/v1/share/local-friend`);
    assert.equal(friend.status, 200);
    assert.equal((await friend.json()).agent.adapterId, "codex");

    const audit = await fetch(`${baseUrl}/v1/owner/audit-logs?ownerId=owner-1`);
    const auditBody = await audit.json();
    assert.equal(auditBody.auditLogs.some((entry) => entry.eventType === "share_link.updated"), true);

    await fetch(`${baseUrl}/v1/owner/share-links/${createdBody.shareLink.id}/revoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerId: "owner-1" }),
    });
    const patchAfterRevoke = await fetch(`${baseUrl}/v1/owner/share-links/${createdBody.shareLink.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerId: "owner-1", name: "Revived" }),
    });
    assert.equal(patchAfterRevoke.status, 409);
    assert.deepEqual(await patchAfterRevoke.json(), { error: "share_link_final" });
  } finally {
    await server.close();
  }
});

test("productized HTTP friend can create and reuse an explicit session", async () => {
  const runtimes = new HostRuntimeRegistry();
  runtimes.connectHost({ hostId: "host-1", adapters: { opencode: adapter() } });
  const server = createProductizedShareServer({
    runtimes,
    tokenFactory: () => "local-friend",
    hostBootstrapSecret: bootstrapSecret,
  });
  const fetch = server.fetch;
  await server.listen(0);
  const baseUrl = server.url();

  try {
    await fetch(`${baseUrl}/v1/hosts/register`, {
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
    await fetch(`${baseUrl}/v1/owner/share-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: "owner-1",
        hostId: "host-1",
        name: "Ralphloop Agent",
      }),
    });

    const session = await fetch(`${baseUrl}/v1/share/local-friend/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Friend One" }),
    });
    assert.equal(session.status, 201);
    const sessionBody = await session.json();
    assert.equal(sessionBody.session.status, "waiting");
    assert.equal(sessionBody.session.adapterId, "opencode");
    assert.equal(JSON.stringify(sessionBody).includes("shareLinkId"), false);
    assert.equal(JSON.stringify(sessionBody).includes("hostId"), false);
    assert.equal(JSON.stringify(sessionBody).includes("cost"), false);
    assert.equal(JSON.stringify(sessionBody).includes("budget"), false);

    const task = await fetch(`${baseUrl}/v1/share/local-friend/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: sessionBody.session.id,
        prompt: "Run in explicit session",
      }),
    });
    assert.equal(task.status, 202);
    const taskBody = await task.json();
    assert.equal(taskBody.task.status, "completed");

    const followUpTask = await fetch(`${baseUrl}/v1/share/local-friend/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: sessionBody.session.id,
        prompt: "Continue in the same explicit session",
      }),
    });
    assert.equal(followUpTask.status, 202);
    const followUpTaskBody = await followUpTask.json();
    assert.equal(followUpTaskBody.task.status, "completed");

    const firstEvents = await fetch(
      `${baseUrl}/v1/share/local-friend/events?sessionId=${sessionBody.session.id}&taskId=${taskBody.task.id}`,
    );
    assert.equal(firstEvents.status, 200);
    assert.deepEqual((await firstEvents.json()).events.map((event) => event.type), ["task.output", "task.completed"]);

    const followUpEvents = await fetch(
      `${baseUrl}/v1/share/local-friend/events?sessionId=${sessionBody.session.id}&taskId=${followUpTaskBody.task.id}`,
    );
    assert.equal(followUpEvents.status, 200);
    assert.deepEqual((await followUpEvents.json()).events.map((event) => event.type), ["task.output", "task.completed"]);

    const secondSession = await fetch(`${baseUrl}/v1/share/local-friend/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Friend Two" }),
    });
    assert.equal(secondSession.status, 201);
    const secondSessionBody = await secondSession.json();

    const leakedEvents = await fetch(
      `${baseUrl}/v1/share/local-friend/events?sessionId=${secondSessionBody.session.id}&taskId=${taskBody.task.id}`,
    );
    assert.equal(leakedEvents.status, 404);
    assert.deepEqual(await leakedEvents.json(), {
      events: [],
      available: false,
      error: "events_unavailable",
    });

    const sessions = await fetch(`${baseUrl}/v1/owner/sessions?ownerId=owner-1`);
    const sessionsBody = await sessions.json();
    assert.equal(sessionsBody.sessions.length, 2);
    const sessionsById = new Map(sessionsBody.sessions.map((entry) => [entry.id, entry]));
    assert.equal(sessionsById.get(sessionBody.session.id)?.status, "completed");
    assert.equal(sessionsById.get(secondSessionBody.session.id)?.status, "waiting");

    const createdLinks = await fetch(`${baseUrl}/v1/owner/share-links?ownerId=owner-1`);
    const linkId = (await createdLinks.json()).shareLinks[0].id;
    await fetch(`${baseUrl}/v1/owner/share-links/${linkId}/pause`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerId: "owner-1" }),
    });
    const pausedSession = await fetch(`${baseUrl}/v1/share/local-friend/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Friend" }),
    });
    assert.equal(pausedSession.status, 423);
    assert.deepEqual(await pausedSession.json(), {
      available: false,
      error: "share_link_paused",
    });
  } finally {
    await server.close();
  }
});

test("productized HTTP friend preview API is scoped to the share token and session", async () => {
  const store = new RelayStore();
  const runtimes = new HostRuntimeRegistry();
  runtimes.connectHost({ hostId: "host-1", adapters: { opencode: adapter() } });
  const server = createProductizedShareServer({
    store,
    runtimes,
    tokenFactory: () => "local-friend",
    hostBootstrapSecret: bootstrapSecret,
  });
  const fetch = server.fetch;
  await server.listen(0);
  const baseUrl = server.url();

  try {
    await fetch(`${baseUrl}/v1/hosts/register`, {
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
    const createdBody = await created.json();

    const session = await fetch(`${baseUrl}/v1/share/local-friend/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Friend" }),
    });
    assert.equal(session.status, 201);
    const sessionBody = await session.json();

    const task = store.createTask({ sessionId: sessionBody.session.id, prompt: "preview task" });

    const append = appendHostPreviewFrameV1({
      store,
      ownerId: "owner-1",
      sessionId: sessionBody.session.id,
      taskId: task.id,
      contentType: "image/png",
      data: "AA==",
    });
    assert.equal(append.status, 201);

    const preview = await fetch(
      `${baseUrl}/v1/share/local-friend/preview?sessionId=${sessionBody.session.id}&taskId=${task.id}`,
    );
    assert.equal(preview.status, 200);
    const previewBody = await preview.json();
    assert.equal(previewBody.frames.length, 1);
    assert.equal(previewBody.frames[0].sessionId, sessionBody.session.id);
    assert.equal(previewBody.frames[0].taskId, task.id);
    assert.equal(previewBody.frames[0].contentType, "image/png");
    assert.equal(previewBody.frames[0].data, "AA==");
    assert.equal(JSON.stringify(previewBody).includes("cost"), false);
    assert.equal(JSON.stringify(previewBody).includes("budget"), false);
    assert.equal(JSON.stringify(previewBody).includes("tokenHash"), false);
    assert.equal(JSON.stringify(previewBody).includes("ownerId"), false);

    const wrongSession = await fetch(`${baseUrl}/v1/share/local-friend/preview?sessionId=wrong-session`);
    assert.equal(wrongSession.status, 404);
    assert.deepEqual(await wrongSession.json(), {
      frames: [],
      available: false,
      error: "preview_unavailable",
    });

    const paused = await fetch(`${baseUrl}/v1/owner/share-links/${createdBody.shareLink.id}/pause`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerId: "owner-1" }),
    });
    assert.equal(paused.status, 200);

    const pausedPreview = await fetch(
      `${baseUrl}/v1/share/local-friend/preview?sessionId=${sessionBody.session.id}&taskId=${task.id}`,
    );
    assert.equal(pausedPreview.status, 423);
    assert.deepEqual(await pausedPreview.json(), {
      frames: [],
      available: false,
      error: "share_link_paused",
    });
  } finally {
    await server.close();
  }
});

test("productized HTTP friend auth start creates pending auth requests and rejects unconfigured providers", async () => {
  const store = new RelayStore({
    now: () => new Date("2026-05-22T00:00:00.000Z"),
  });
  const runtimes = new HostRuntimeRegistry();
  runtimes.connectHost({ hostId: "host-1", adapters: { opencode: adapter() } });
  const server = createProductizedShareServer({
    store,
    runtimes,
    tokenFactory: () => "local-friend",
    hostBootstrapSecret: bootstrapSecret,
  });
  const fetch = server.fetch;
  await server.listen(0);
  const baseUrl = server.url();

  try {
    await fetch(`${baseUrl}/v1/hosts/register`, {
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
    await fetch(`${baseUrl}/v1/owner/share-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: "owner-1",
        hostId: "host-1",
        name: "Ralphloop Agent",
      }),
    });

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
    assert.equal(started.status, 201);
    const startedBody = await started.json();
    assert.equal(startedBody.auth.provider, "manual");
    assert.equal(startedBody.auth.status, "pending");
    assert.equal(typeof startedBody.auth.id, "string");
    assert.equal(JSON.stringify(startedBody).includes("cost"), false);
    assert.equal(JSON.stringify(startedBody).includes("budget"), false);
    assert.equal(JSON.stringify(startedBody).includes("tokenHash"), false);
    assert.equal(JSON.stringify(startedBody).includes("ownerId"), false);

    const notConfigured = await fetch(`${baseUrl}/v1/share/local-friend/auth/google/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: sessionBody.session.id }),
    });
    assert.equal(notConfigured.status, 400);
    assert.deepEqual(await notConfigured.json(), { available: false, error: "auth_not_configured" });

    assert.equal(store.snapshot().friendAuthRequests.length, 1);
    assert.equal(store.snapshot().friendAuthRequests[0].sessionId, sessionBody.session.id);
  } finally {
    await server.close();
  }
});

test("productized HTTP task flow does not fallback without connected host runtime", async () => {
  const server = createProductizedShareServer({
    tokenFactory: () => "local-friend",
    hostBootstrapSecret: bootstrapSecret,
  });
  const fetch = server.fetch;
  await server.listen(0);
  const baseUrl = server.url();

  try {
    await fetch(`${baseUrl}/v1/hosts/register`, {
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
    await fetch(`${baseUrl}/v1/owner/share-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: "owner-1",
        hostId: "host-1",
        name: "Ralphloop Agent",
      }),
    });

    const task = await fetch(`${baseUrl}/v1/share/local-friend/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "Run task" }),
    });

    assert.equal(task.status, 503);
    assert.deepEqual(await task.json(), {
      events: [],
      available: false,
      error: "shared_agent_unavailable",
    });
  } finally {
    await server.close();
  }
});

test("productized HTTP friend rate limit returns neutral errors and owner audit reason", async () => {
  const runtimes = new HostRuntimeRegistry();
  runtimes.connectHost({ hostId: "host-1", adapters: { opencode: adapter() } });
  const server = createProductizedShareServer({
    runtimes,
    tokenFactory: () => "local-friend",
    hostBootstrapSecret: bootstrapSecret,
  });
  const fetch = server.fetch;
  await server.listen(0);
  const baseUrl = server.url();

  try {
    await fetch(`${baseUrl}/v1/hosts/register`, {
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
    await fetch(`${baseUrl}/v1/owner/share-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: "owner-1",
        hostId: "host-1",
        name: "Ralphloop Agent",
        policy: { maxRequestsPerMinute: 1 },
      }),
    });

    const first = await fetch(`${baseUrl}/v1/share/local-friend/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Friend" }),
    });
    assert.equal(first.status, 201);

    const second = await fetch(`${baseUrl}/v1/share/local-friend/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Friend" }),
    });
    assert.equal(second.status, 429);
    assert.deepEqual(await second.json(), {
      available: false,
      error: "shared_agent_unavailable",
    });

    const audit = await fetch(`${baseUrl}/v1/owner/audit-logs?ownerId=owner-1`);
    assert.equal(audit.status, 200);
    const auditBody = await audit.json();
    assert.equal(auditBody.auditLogs.some((entry) => entry.eventType === "rate_limit.rejected"), true);
    assert.equal(JSON.stringify(auditBody).includes("tokenHash"), false);
  } finally {
    await server.close();
  }
});

test("productized HTTP owner controls expose audit, sessions, revoke, and cancel", async () => {
  const runtimes = new HostRuntimeRegistry();
  runtimes.connectHost({ hostId: "host-1", adapters: { opencode: adapter() } });
  const server = createProductizedShareServer({
    runtimes,
    tokenFactory: () => "local-friend",
    hostBootstrapSecret: bootstrapSecret,
  });
  const fetch = server.fetch;
  await server.listen(0);
  const baseUrl = server.url();

  try {
    await fetch(`${baseUrl}/v1/hosts/register`, {
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
    const created = await fetch(`${baseUrl}/v1/owner/share-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: "owner-1",
        hostId: "host-1",
        name: "Ralphloop Agent",
      }),
    });
    const createdBody = await created.json();

    const task = await fetch(`${baseUrl}/v1/share/local-friend/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "Run task",
        estimatedTaskBudget: 1,
      }),
    });
    assert.equal(task.status, 202);

    const audit = await fetch(`${baseUrl}/v1/owner/audit-logs?ownerId=owner-1`);
    assert.equal(audit.status, 200);
    const auditBody = await audit.json();
    assert.equal(auditBody.auditLogs.some((entry) => entry.eventType === "task.submitted"), true);
    assert.equal(JSON.stringify(auditBody).includes("tokenHash"), false);

    const sessions = await fetch(`${baseUrl}/v1/owner/sessions?ownerId=owner-1`);
    assert.equal(sessions.status, 200);
    const sessionsBody = await sessions.json();
    assert.equal(sessionsBody.sessions.length, 1);
    assert.equal(sessionsBody.sessions[0].adapterId, "opencode");

    const deniedCancel = await fetch(`${baseUrl}/v1/owner/sessions/${sessionsBody.sessions[0].id}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerId: "owner-2" }),
    });
    assert.equal(deniedCancel.status, 404);

    const cancelled = await fetch(`${baseUrl}/v1/owner/sessions/${sessionsBody.sessions[0].id}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerId: "owner-1" }),
    });
    assert.equal(cancelled.status, 200);
    assert.equal((await cancelled.json()).session.status, "cancelled");

    const deniedRevoke = await fetch(`${baseUrl}/v1/owner/share-links/${createdBody.shareLink.id}/revoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerId: "owner-2" }),
    });
    assert.equal(deniedRevoke.status, 404);

    const revoked = await fetch(`${baseUrl}/v1/owner/share-links/${createdBody.shareLink.id}/revoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerId: "owner-1" }),
    });
    assert.equal(revoked.status, 200);
    assert.deepEqual(await revoked.json(), { ok: true });

    const taskAfterRevoke = await fetch(`${baseUrl}/v1/share/local-friend/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "Run again" }),
    });
    assert.equal(taskAfterRevoke.status, 404);
  } finally {
    await server.close();
  }
});

test("productized HTTP owner can pause and resume share links by id", async () => {
  const runtimes = new HostRuntimeRegistry();
  runtimes.connectHost({ hostId: "host-1", adapters: { opencode: adapter() } });
  const server = createProductizedShareServer({
    runtimes,
    tokenFactory: () => "local-friend",
    hostBootstrapSecret: bootstrapSecret,
  });
  const fetch = server.fetch;
  await server.listen(0);
  const baseUrl = server.url();

  try {
    await fetch(`${baseUrl}/v1/hosts/register`, {
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
    const created = await fetch(`${baseUrl}/v1/owner/share-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: "owner-1",
        hostId: "host-1",
        name: "Ralphloop Agent",
      }),
    });
    const createdBody = await created.json();

    const deniedPause = await fetch(`${baseUrl}/v1/owner/share-links/${createdBody.shareLink.id}/pause`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerId: "owner-2" }),
    });
    assert.equal(deniedPause.status, 404);
    assert.deepEqual(await deniedPause.json(), { error: "share_link_unavailable" });

    const paused = await fetch(`${baseUrl}/v1/owner/share-links/${createdBody.shareLink.id}/pause`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerId: "owner-1" }),
    });
    assert.equal(paused.status, 200);
    assert.deepEqual(await paused.json(), { ok: true });

    const friendWhilePaused = await fetch(`${baseUrl}/v1/share/local-friend`);
    assert.equal(friendWhilePaused.status, 423);
    assert.deepEqual(await friendWhilePaused.json(), {
      available: false,
      error: "share_link_paused",
    });

    const taskWhilePaused = await fetch(`${baseUrl}/v1/share/local-friend/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "Run while paused" }),
    });
    assert.equal(taskWhilePaused.status, 423);
    assert.deepEqual(await taskWhilePaused.json(), {
      events: [],
      available: false,
      error: "share_link_paused",
    });

    const deniedResume = await fetch(`${baseUrl}/v1/owner/share-links/${createdBody.shareLink.id}/resume`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerId: "owner-2" }),
    });
    assert.equal(deniedResume.status, 404);
    assert.deepEqual(await deniedResume.json(), { error: "share_link_unavailable" });

    const resumed = await fetch(`${baseUrl}/v1/owner/share-links/${createdBody.shareLink.id}/resume`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerId: "owner-1" }),
    });
    assert.equal(resumed.status, 200);
    assert.deepEqual(await resumed.json(), { ok: true });

    const friendAfterResume = await fetch(`${baseUrl}/v1/share/local-friend`);
    assert.equal(friendAfterResume.status, 200);
    assert.equal((await friendAfterResume.json()).available, true);

    const taskAfterResume = await fetch(`${baseUrl}/v1/share/local-friend/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "Run after resume" }),
    });
    assert.equal(taskAfterResume.status, 202);

    const audit = await fetch(`${baseUrl}/v1/owner/audit-logs?ownerId=owner-1`);
    const auditBody = await audit.json();
    assert.equal(auditBody.auditLogs.some((entry) => entry.eventType === "share_link.paused"), true);
    assert.equal(auditBody.auditLogs.some((entry) => entry.eventType === "share_link.resumed"), true);

    const revoked = await fetch(`${baseUrl}/v1/owner/share-links/${createdBody.shareLink.id}/revoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerId: "owner-1" }),
    });
    assert.equal(revoked.status, 200);
    const resumeAfterRevoke = await fetch(`${baseUrl}/v1/owner/share-links/${createdBody.shareLink.id}/resume`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerId: "owner-1" }),
    });
    assert.equal(resumeAfterRevoke.status, 409);
    assert.deepEqual(await resumeAfterRevoke.json(), { error: "share_link_final" });
  } finally {
    await server.close();
  }
});

test("productized HTTP owner history exposes share links, usage, and task history", async () => {
  const tokens = ["owner-friend", "other-friend"];
  const runtimes = new HostRuntimeRegistry();
  runtimes.connectHost({
    hostId: "host-1",
    adapters: { opencode: adapter() },
  });
  runtimes.connectHost({
    hostId: "host-2",
    adapters: { codex: adapter() },
  });
  const server = createProductizedShareServer({
    runtimes,
    tokenFactory: () => tokens.shift() ?? "fallback-friend",
    hostBootstrapSecret: bootstrapSecret,
  });
  const fetch = server.fetch;
  await server.listen(0);
  const baseUrl = server.url();

  try {
    await fetch(`${baseUrl}/v1/hosts/register`, {
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
    await fetch(`${baseUrl}/v1/hosts/register`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ralphloop-bootstrap-secret": bootstrapSecret,
      },
      body: JSON.stringify({
        ownerId: "owner-2",
        hostId: "host-2",
        deviceName: "Other Mac",
        hostVersion: "0.1.0",
        supportedAdapters: ["codex"],
      }),
    });
    const ownerCreated = await fetch(`${baseUrl}/v1/owner/share-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: "owner-1",
        hostId: "host-1",
        name: "Ralphloop Agent",
        policy: { maxTotalBudget: 4, maxTaskBudget: 2 },
      }),
    });
    const ownerCreatedBody = await ownerCreated.json();
    await fetch(`${baseUrl}/v1/owner/share-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: "owner-2",
        hostId: "host-2",
        name: "Other Agent",
      }),
    });

    const ownerTask = await fetch(`${baseUrl}/v1/share/owner-friend/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "Owner task",
        estimatedTaskBudget: 2,
      }),
    });
    assert.equal(ownerTask.status, 202);
    const ownerTaskBody = await ownerTask.json();
    const otherTask = await fetch(`${baseUrl}/v1/share/other-friend/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "Other task",
        estimatedTaskBudget: 1,
      }),
    });
    assert.equal(otherTask.status, 202);

    const links = await fetch(`${baseUrl}/v1/owner/share-links?ownerId=owner-1`);
    assert.equal(links.status, 200);
    const linksBody = await links.json();
    assert.equal(linksBody.shareLinks.length, 1);
    assert.equal(linksBody.shareLinks[0].id, ownerCreatedBody.shareLink.id);
    assert.equal(linksBody.shareLinks[0].budgetUsed, 2);
    assert.equal(linksBody.shareLinks[0].maxTotalBudget, 4);
    assert.equal(linksBody.shareLinks[0].maxTaskBudget, 2);
    assert.deepEqual(linksBody.shareLinks[0].allowedAdapterIds, ["opencode"]);
    assert.equal(JSON.stringify(linksBody).includes("tokenHash"), false);
    assert.equal(JSON.stringify(linksBody).includes("Other Agent"), false);

    const tasks = await fetch(`${baseUrl}/v1/owner/tasks?ownerId=owner-1`);
    assert.equal(tasks.status, 200);
    const tasksBody = await tasks.json();
    assert.equal(tasksBody.tasks.length, 1);
    assert.equal(tasksBody.tasks[0].id, ownerTaskBody.task.id);
    assert.equal(tasksBody.tasks[0].prompt, "Owner task");
    assert.match(tasksBody.tasks[0].friendActorId, /^anon_[a-f0-9-]+$/);
    assert.equal(tasksBody.tasks[0].adapterId, "opencode");
    assert.equal(tasksBody.tasks[0].status, "completed");
    assert.equal(JSON.stringify(tasksBody).includes("Other task"), false);
  } finally {
    await server.close();
  }
});

test("productized HTTP approval APIs are scoped to owner and friend", async () => {
  const store = new RelayStore();
  const runtimes = new HostRuntimeRegistry();
  runtimes.connectHost({ hostId: "host-1", adapters: { opencode: adapter() } });
  const server = createProductizedShareServer({
    store,
    runtimes,
    tokenFactory: () => "local-friend",
    hostBootstrapSecret: bootstrapSecret,
  });
  const fetch = server.fetch;
  await server.listen(0);
  const baseUrl = server.url();

  try {
    await fetch(`${baseUrl}/v1/hosts/register`, {
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
    await fetch(`${baseUrl}/v1/owner/share-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: "owner-1",
        hostId: "host-1",
        name: "Ralphloop Agent",
      }),
    });

    const task = await fetch(`${baseUrl}/v1/share/local-friend/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "Run task",
        estimatedTaskBudget: 1,
      }),
    });
    assert.equal(task.status, 202);
    const taskBody = await task.json();
    const sessions = await fetch(`${baseUrl}/v1/owner/sessions?ownerId=owner-1`);
    const sessionsBody = await sessions.json();
    const sessionId = sessionsBody.sessions[0].id;

    const ownerApproval = gateRuntimeActionV1({
      store,
      ownerId: "owner-1",
      sessionId,
      taskId: taskBody.task.id,
      action: "owner_account_access",
      permissionSource: "owner_delegated",
      summary: "Open owner Gmail",
    });
    assert.equal(ownerApproval.status, 202);
    const ownerApprovalId = ownerApproval.body.approvalRequest.id;

    const ownerQueue = await fetch(`${baseUrl}/v1/owner/approvals?ownerId=owner-1&status=pending`);
    assert.equal(ownerQueue.status, 200);
    const ownerQueueBody = await ownerQueue.json();
    assert.deepEqual(ownerQueueBody.approvalRequests.map((request) => request.id), [ownerApprovalId]);

    const otherOwnerQueue = await fetch(`${baseUrl}/v1/owner/approvals?ownerId=owner-2&status=pending`);
    assert.deepEqual((await otherOwnerQueue.json()).approvalRequests, []);

    const deniedOwnerResolve = await fetch(`${baseUrl}/v1/owner/approvals/${ownerApprovalId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerId: "owner-2" }),
    });
    assert.equal(deniedOwnerResolve.status, 404);

    const approvedOwner = await fetch(`${baseUrl}/v1/owner/approvals/${ownerApprovalId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerId: "owner-1" }),
    });
    assert.equal(approvedOwner.status, 200);
    const approvedOwnerBody = await approvedOwner.json();
    assert.equal(approvedOwnerBody.approvalRequest.status, "approved");
    assert.equal(approvedOwnerBody.approvalRequest.resolvedBy, "owner");

    const deniedOwnerApproval = gateRuntimeActionV1({
      store,
      ownerId: "owner-1",
      sessionId,
      taskId: taskBody.task.id,
      action: "owner_account_access",
      permissionSource: "owner_delegated",
      summary: "Open owner Calendar",
    });
    const deniedOwner = await fetch(
      `${baseUrl}/v1/owner/approvals/${deniedOwnerApproval.body.approvalRequest.id}/deny`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ownerId: "owner-1" }),
      },
    );
    assert.equal(deniedOwner.status, 200);
    assert.equal((await deniedOwner.json()).approvalRequest.status, "denied");

    const friendConfirmation = gateRuntimeActionV1({
      store,
      ownerId: "owner-1",
      sessionId,
      taskId: taskBody.task.id,
      action: "send_email",
      permissionSource: "user_identity",
      summary: "Send email as friend",
    });
    assert.equal(friendConfirmation.status, 202);
    const confirmationId = friendConfirmation.body.approvalRequest.id;

    const confirmations = await fetch(
      `${baseUrl}/v1/share/local-friend/confirmations?sessionId=${sessionId}`,
    );
    assert.equal(confirmations.status, 200);
    const confirmationsBody = await confirmations.json();
    assert.deepEqual(confirmationsBody.confirmations.map((request) => request.id), [confirmationId]);
    assert.equal(JSON.stringify(confirmationsBody).includes("ownerId"), false);

    const wrongSession = await fetch(`${baseUrl}/v1/share/local-friend/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Other Friend" }),
    });
    assert.equal(wrongSession.status, 201);
    const wrongSessionBody = await wrongSession.json();

    const approvedFriend = await fetch(
      `${baseUrl}/v1/share/local-friend/confirmations/${confirmationId}/approve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: wrongSessionBody.session.id }),
      },
    );
    assert.equal(approvedFriend.status, 404);
    assert.deepEqual(await approvedFriend.json(), { error: "confirmation_not_found" });

    const approvedFriendCorrect = await fetch(
      `${baseUrl}/v1/share/local-friend/confirmations/${confirmationId}/approve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      },
    );
    assert.equal(approvedFriendCorrect.status, 200);
    const approvedFriendBody = await approvedFriendCorrect.json();
    assert.equal(approvedFriendBody.confirmation.status, "approved");
    assert.equal(approvedFriendBody.confirmation.resolvedBy, "friend");
    assert.equal(JSON.stringify(approvedFriendBody).includes("ownerId"), false);

    const deniedFriendConfirmation = gateRuntimeActionV1({
      store,
      ownerId: "owner-1",
      sessionId,
      taskId: taskBody.task.id,
      action: "send_email",
      permissionSource: "user_identity",
      summary: "Send another email",
    });
    const deniedFriend = await fetch(
      `${baseUrl}/v1/share/local-friend/confirmations/${deniedFriendConfirmation.body.approvalRequest.id}/deny`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      },
    );
    assert.equal(deniedFriend.status, 200);
    assert.equal((await deniedFriend.json()).confirmation.status, "denied");
  } finally {
    await server.close();
  }
});

test("productized web pages expose owner and friend flows without friend cost fields", async () => {
  const runtimes = new HostRuntimeRegistry();
  runtimes.connectHost({ hostId: "host-1", adapters: { opencode: adapter() } });
  const server = createProductizedShareServer({
    runtimes,
    tokenFactory: () => "local-friend",
    hostBootstrapSecret: bootstrapSecret,
  });
  const fetch = server.fetch;

  await server.listen(0);
  const baseUrl = server.url();

  try {
    await fetch(`${baseUrl}/v1/hosts/register`, {
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

    const owner = await fetch(`${baseUrl}/app/owner`);
    assert.equal(owner.status, 200);
    const ownerHtml = await owner.text();
    assert.match(ownerHtml, /Ralphloop/);
    assert.match(ownerHtml, /app-shell/);
    assert.match(ownerHtml, /status-pill/);
    assert.match(ownerHtml, /data-testid="owner-host-auth"/);
    assert.match(ownerHtml, /data-testid="owner-host-status"/);
    assert.match(ownerHtml, /data-testid="owner-host-reconnect"/);
    assert.match(ownerHtml, /data-testid="owner-kill-result"/);
    assert.match(ownerHtml, /share-output/);
    assert.match(ownerHtml, /adapter-list/);
    assert.match(ownerHtml, /selectedAdapterId/);
    assert.match(ownerHtml, /name="adapterId"/);
    assert.match(ownerHtml, /create-share-link/);
    assert.match(ownerHtml, /owner-controls/);
    assert.match(ownerHtml, /revoke-share-link/);
    assert.match(ownerHtml, /audit-log/);
    assert.match(ownerHtml, /refresh-audit-log/);
    assert.match(ownerHtml, /approval-queue/);
    assert.match(ownerHtml, /refresh-approvals/);
    assert.match(ownerHtml, /approve-owner-approval/);
    assert.match(ownerHtml, /deny-owner-approval/);
    assert.match(ownerHtml, /share-link-list/);
    assert.match(ownerHtml, /refresh-share-links/);
    assert.match(ownerHtml, /pause-share-link/);
    assert.match(ownerHtml, /resume-share-link/);
    assert.match(ownerHtml, /revoke-listed-share-link/);
    assert.match(ownerHtml, /share-link-edit-form/);
    assert.match(ownerHtml, /share-link-name-input/);
    assert.match(ownerHtml, /allowedAdapterIds/);
    assert.match(ownerHtml, /save-share-link/);
    assert.match(ownerHtml, /assistantUiShareUrl/);
    assert.match(ownerHtml, /assistant-ui-share-open/);
    assert.match(ownerHtml, /updateShareLinkFromForm/);
    assert.match(ownerHtml, /revokeShareLink/);
    assert.match(ownerHtml, /session-list/);
    assert.match(ownerHtml, /refresh-sessions/);
    assert.match(ownerHtml, /cancel-owner-session/);
    assert.match(ownerHtml, /task-history/);
    assert.match(ownerHtml, /refresh-task-history/);
    assert.match(ownerHtml, /\/v1\/owner\/hosts/);
    assert.match(ownerHtml, /\/v1\/owner\/share-links/);
    assert.match(ownerHtml, /创建失败/);
    assert.match(ownerHtml, /response\.ok/);
    assert.match(ownerHtml, /finally/);
    assert.match(ownerHtml, /\/pause/);
    assert.match(ownerHtml, /\/resume/);
    assert.match(ownerHtml, /\/v1\/owner\/sessions/);
    assert.match(ownerHtml, /\/cancel/);
    assert.match(ownerHtml, /\/v1\/owner\/audit-logs/);
    assert.match(ownerHtml, /\/v1\/owner\/approvals/);
    assert.match(ownerHtml, /\/v1\/owner\/tasks/);

    await fetch(`${baseUrl}/v1/owner/share-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: "owner-1",
        hostId: "host-1",
        name: "Ralphloop Agent",
      }),
    });

    const defaultFriend = await fetch(`${baseUrl}/app/share/local-friend`, { redirect: "manual" });
    assert.equal(defaultFriend.status, 302);
    assert.equal(defaultFriend.headers.get("location"), "/app/share/local-friend/assistant-ui");

    const friend = await fetch(`${baseUrl}/app/share/local-friend/classic`);
    assert.equal(friend.status, 200);
    const friendHtml = await friend.text();
    assert.match(friendHtml, /Ralphloop Agent/);
    assert.match(friendHtml, /app-shell/);
    assert.match(friendHtml, /friend-chat-shell/);
    assert.match(friendHtml, /data-testid="friend-chat-shell"/);
    assert.match(friendHtml, /data-testid="friend-session-sidebar"/);
    assert.match(friendHtml, /data-testid="friend-new-session"/);
    assert.match(friendHtml, /data-testid="friend-session-item"/);
    assert.match(friendHtml, /data-testid="friend-chat-thread"/);
    assert.match(friendHtml, /data-testid="friend-chat-message"/);
    assert.match(friendHtml, /data-testid="friend-chat-composer"/);
    assert.match(friendHtml, /data-testid="friend-chat-submit"/);
    assert.match(friendHtml, /data-testid="friend-chat-stop"/);
    assert.match(friendHtml, /data-testid="friend-preview-toggle"/);
    assert.match(friendHtml, /data-testid="friend-preview-drawer"/);
    assert.match(friendHtml, /data-testid="friend-preview-close"/);
    assert.match(friendHtml, /data-testid="friend-approval-card"/);
    assert.match(friendHtml, /data-testid="friend-assistant-ui-link"/);
    assert.match(friendHtml, /\/app\/share\/local-friend\/assistant-ui/);
    assert.match(friendHtml, /sessionStore/);
    assert.match(friendHtml, /activeSessionId/);
    assert.match(friendHtml, /localStorage/);
    assert.match(friendHtml, /给 Agent 发送消息/);
    assert.match(friendHtml, /\/v1\/share\/local-friend\/sessions/);
    assert.match(friendHtml, /newSession/);
    assert.match(friendHtml, /switchSession/);
    assert.match(friendHtml, /\/v1\/share\/local-friend\/tasks/);
    assert.match(friendHtml, /\/v1\/share\/local-friend\/events/);
    assert.match(friendHtml, /pollTaskUntilTerminal/);
    assert.match(friendHtml, /terminalTaskEventTypes/);
    assert.match(friendHtml, /appendChatMessage/);
    assert.match(friendHtml, /stopActiveTask/);
    assert.match(friendHtml, /keydown/);
    assert.match(friendHtml, /data-task-id/);
    assert.match(friendHtml, /\/v1\/share\/local-friend\/preview/);
    assert.match(friendHtml, /preview-drawer/);
    assert.match(friendHtml, /refreshPreview/);
    assert.match(friendHtml, /renderPreviewFrame/);
    assert.match(friendHtml, /approve-friend-confirmation/);
    assert.match(friendHtml, /deny-friend-confirmation/);
    assert.match(friendHtml, /\/v1\/share\/local-friend\/confirmations/);
    assert.match(friendHtml, /只读预览/);
    assert.equal(friendHtml.includes("cost"), false);
    assert.equal(friendHtml.includes("budget"), false);
    assert.equal(friendHtml.includes("tokenHash"), false);
    assert.equal(friendHtml.includes("模型价格"), false);
  } finally {
    await server.close();
  }
});

test("productized friend page script keeps multi-turn thread and clears composer after successful submit", async () => {
  const runtimes = new HostRuntimeRegistry();
  runtimes.connectHost({ hostId: "host-1", adapters: { opencode: adapter() } });
  const server = createProductizedShareServer({
    runtimes,
    tokenFactory: () => "local-friend",
    hostBootstrapSecret: bootstrapSecret,
  });
  const fetch = server.fetch;

  await server.listen(0);
  const baseUrl = server.url();

  try {
    await fetch(`${baseUrl}/v1/hosts/register`, {
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
    await fetch(`${baseUrl}/v1/owner/share-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: "owner-1",
        hostId: "host-1",
        name: "Ralphloop Agent",
      }),
    });

    const friend = await fetch(`${baseUrl}/app/share/local-friend/classic`);
    assert.equal(friend.status, 200);
    const document = createFriendDocument();
    await runPageScript({
      html: await friend.text(),
      document,
      baseUrl,
      fetch,
    });

    await submitFriendTask(document, "   ");
    const taskStatus = document.getElementById("chat-status");
    const taskPrompt = document.getElementById("chat-prompt");
    const taskResult = document.getElementById("chat-thread");
    assert.equal(taskStatus.textContent, "请输入任务");
    assert.match(taskResult.innerHTML, /这个会话还没有消息/);
    assert.doesNotMatch(taskResult.innerHTML, /data-task-id/);
    assert.equal(taskPrompt.value, "   ");

    await submitFriendTask(document, "round one please acknowledge");
    assert.equal(taskStatus.textContent, "已完成");
    assert.match(taskResult.innerHTML, /round one please acknowledge/);
    assert.match(taskResult.innerHTML, /done/);
    assert.equal(taskPrompt.value, "");

    await submitFriendTask(document, "round two please continue same thread");
    assert.equal(taskStatus.textContent, "已完成");
    assert.match(taskResult.innerHTML, /round one please acknowledge/);
    assert.match(taskResult.innerHTML, /round two please continue same thread/);
    assert.match(taskResult.innerHTML, /任务已完成/);
    assert.equal((taskResult.innerHTML.match(/data-task-id=/g) ?? []).length >= 4, true);
    assert.equal(/cost|budget|tokenHash|模型价格/.test(taskResult.innerHTML), false);
    assert.equal(taskPrompt.value, "");
  } finally {
    await server.close();
  }
});

test("productized friend composer submits with Enter and preserves Shift Enter drafts", async () => {
  const runtimes = new HostRuntimeRegistry();
  runtimes.connectHost({ hostId: "host-1", adapters: { opencode: adapter() } });
  const server = createProductizedShareServer({
    runtimes,
    tokenFactory: () => "local-friend",
    hostBootstrapSecret: bootstrapSecret,
  });
  const fetch = server.fetch;

  await server.listen(0);
  const baseUrl = server.url();

  try {
    await fetch(`${baseUrl}/v1/hosts/register`, {
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
    await fetch(`${baseUrl}/v1/owner/share-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: "owner-1",
        hostId: "host-1",
        name: "Ralphloop Agent",
      }),
    });

    const friend = await fetch(`${baseUrl}/app/share/local-friend/classic`);
    assert.equal(friend.status, 200);
    const document = createFriendDocument();
    await runPageScript({
      html: await friend.text(),
      document,
      baseUrl,
      fetch,
    });

    const shiftEnterPrevented = await pressFriendComposerKey(document, {
      prompt: "draft line",
      key: "Enter",
      shiftKey: true,
    });
    assert.equal(shiftEnterPrevented, false);
    assert.equal(document.getElementById("chat-prompt").value, "draft line");
    assert.doesNotMatch(document.getElementById("chat-thread").innerHTML, /draft line/);

    const enterPrevented = await pressFriendComposerKey(document, {
      prompt: "send by enter",
      key: "Enter",
    });
    await waitForFriendChatStatus(document, "已完成");
    assert.equal(enterPrevented, true);
    assert.match(document.getElementById("chat-thread").innerHTML, /send by enter/);
    assert.match(document.getElementById("chat-thread").innerHTML, /done/);
    assert.equal(document.getElementById("chat-prompt").value, "");
  } finally {
    await server.close();
  }
});

test("productized friend chatbot reuses the pending bootstrap session for the first quick submit", async () => {
  const runtimes = new HostRuntimeRegistry();
  runtimes.connectHost({ hostId: "host-1", adapters: { opencode: adapter() } });
  const server = createProductizedShareServer({
    runtimes,
    tokenFactory: () => "local-friend",
    hostBootstrapSecret: bootstrapSecret,
  });
  const fetch = server.fetch;

  await server.listen(0);
  const baseUrl = server.url();

  try {
    await fetch(`${baseUrl}/v1/hosts/register`, {
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
    await fetch(`${baseUrl}/v1/owner/share-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: "owner-1",
        hostId: "host-1",
        name: "Ralphloop Agent",
      }),
    });

    const friend = await fetch(`${baseUrl}/app/share/local-friend/classic`);
    assert.equal(friend.status, 200);
    const document = createFriendDocument();
    const localStorage = new FakeLocalStorage();
    let releaseBootstrapSession!: () => void;
    const bootstrapSessionGate = new Promise<void>((resolve) => {
      releaseBootstrapSession = resolve;
    });
    let sessionPostCount = 0;
    await runPageScript({
      html: await friend.text(),
      document,
      baseUrl,
      localStorage,
      fetch: async (url, init) => {
        if (url.endsWith("/v1/share/local-friend/sessions") && init?.method === "POST") {
          sessionPostCount += 1;
          if (sessionPostCount === 1) {
            await bootstrapSessionGate;
          }
        }
        return fetch(url, init);
      },
    });

    const submitted = dispatchFriendChatMessage(document, "first quick submit while session is bootstrapping");
    await settlePageTasks();
    assert.equal(sessionPostCount, 1);
    releaseBootstrapSession();
    await submitted;
    await waitForFriendChatStatus(document, "已完成");

    const chatThreadHtml = document.getElementById("chat-thread").innerHTML;
    assert.equal(sessionPostCount, 1);
    assert.match(chatThreadHtml, /first quick submit while session is bootstrapping/);
    assert.match(chatThreadHtml, /done/);
    assert.equal(document.getElementById("chat-status").textContent, "已完成");
  } finally {
    await server.close();
  }
});

test("productized friend chatbot hides internal accepted events from the conversation", async () => {
  const runtimes = new HostRuntimeRegistry();
  runtimes.connectHost({ hostId: "host-1", adapters: { opencode: acceptedThenOutputAdapter() } });
  const server = createProductizedShareServer({
    runtimes,
    tokenFactory: () => "local-friend",
    hostBootstrapSecret: bootstrapSecret,
  });
  const fetch = server.fetch;

  await server.listen(0);
  const baseUrl = server.url();

  try {
    await fetch(`${baseUrl}/v1/hosts/register`, {
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
    await fetch(`${baseUrl}/v1/owner/share-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: "owner-1",
        hostId: "host-1",
        name: "Ralphloop Agent",
      }),
    });

    const friend = await fetch(`${baseUrl}/app/share/local-friend/classic`);
    assert.equal(friend.status, 200);
    const document = createFriendDocument();
    const localStorage = new FakeLocalStorage();
    await runPageScript({
      html: await friend.text(),
      document,
      baseUrl,
      localStorage,
      fetch,
    });

    await submitFriendChatMessage(document, "please run without raw internal events");

    const chatThreadHtml = document.getElementById("chat-thread").innerHTML;
    assert.match(chatThreadHtml, /accepted event output/);
    assert.doesNotMatch(chatThreadHtml, /task\.accepted/);
    assert.doesNotMatch(chatThreadHtml, />事件</);
    assert.equal((chatThreadHtml.match(/data-event-type="task\.output"/g) ?? []).length, 1);

    const [storedSession] = readFriendUiSessions(localStorage);
    assert.equal(storedSession.messages?.some((message) => message.type === "task.accepted"), false);
  } finally {
    await server.close();
  }
});

test("productized friend chatbot filters cached accepted events from existing sessions", async () => {
  const runtimes = new HostRuntimeRegistry();
  runtimes.connectHost({ hostId: "host-1", adapters: { opencode: adapter() } });
  const server = createProductizedShareServer({
    runtimes,
    tokenFactory: () => "local-friend",
    hostBootstrapSecret: bootstrapSecret,
  });
  const fetch = server.fetch;

  await server.listen(0);
  const baseUrl = server.url();

  try {
    await fetch(`${baseUrl}/v1/hosts/register`, {
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
    await fetch(`${baseUrl}/v1/owner/share-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: "owner-1",
        hostId: "host-1",
        name: "Ralphloop Agent",
      }),
    });
    const session = await fetch(`${baseUrl}/v1/share/local-friend/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Friend" }),
    });
    const sessionBody = await session.json();

    const friend = await fetch(`${baseUrl}/app/share/local-friend/classic`);
    assert.equal(friend.status, 200);
    const document = createFriendDocument();
    const localStorage = new FakeLocalStorage();
    localStorage.setItem("ralphloop:friend:sessions:local-friend:active", sessionBody.session.id);
    localStorage.setItem("ralphloop:friend:sessions:local-friend", JSON.stringify([
      {
        id: sessionBody.session.id,
        title: "旧会话",
        status: "completed",
        currentTaskId: "task-old",
        messages: [
          { role: "assistant", type: "task.accepted", taskId: "task-old", content: "task.accepted" },
          { role: "assistant", type: "task.output", taskId: "task-old", content: "cached output" },
        ],
        messageKeys: [],
      },
    ]));

    await runPageScript({
      html: await friend.text(),
      document,
      baseUrl,
      localStorage,
      fetch,
    });

    const chatThreadHtml = document.getElementById("chat-thread").innerHTML;
    assert.match(chatThreadHtml, /cached output/);
    assert.doesNotMatch(chatThreadHtml, /task\.accepted/);
    assert.doesNotMatch(chatThreadHtml, />事件</);
  } finally {
    await server.close();
  }
});

test("productized friend chatbot can stop the active outbound session", async () => {
  const server = createProductizedShareServer({
    tokenFactory: () => "local-friend",
    hostBootstrapSecret: bootstrapSecret,
  });
  const fetch = server.fetch;

  await server.listen(0);
  const baseUrl = server.url();

  try {
    await fetch(`${baseUrl}/v1/hosts/register`, {
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
        capabilities: ["outbound_commands"],
      }),
    });
    await fetch(`${baseUrl}/v1/owner/share-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: "owner-1",
        hostId: "host-1",
        name: "Ralphloop Agent",
      }),
    });

    const friend = await fetch(`${baseUrl}/app/share/local-friend/classic`);
    assert.equal(friend.status, 200);
    const document = createFriendDocument();
    const localStorage = new FakeLocalStorage();
    await runPageScript({
      html: await friend.text(),
      document,
      baseUrl,
      localStorage,
      fetch,
    });

    await submitFriendChatMessage(document, "please start a task that I can stop");
    assert.equal(document.getElementById("chat-status").textContent, "运行中");
    assert.equal(document.getElementById("chat-stop").disabled, false);

    await clickFriendStop(document);

    const chatThreadHtml = document.getElementById("chat-thread").innerHTML;
    assert.equal(document.getElementById("chat-status").textContent, "已取消");
    assert.equal(document.getElementById("chat-stop").disabled, true);
    assert.match(chatThreadHtml, /任务已取消/);

    const [storedSession] = readFriendUiSessions(localStorage);
    assert.equal(storedSession.status, "cancelled");
    assert.equal(storedSession.messages?.some((message) => message.type === "task.cancelled"), true);
  } finally {
    await server.close();
  }
});

test("productized friend chatbot creates and switches sessions without mixing messages", async () => {
  const runtimes = new HostRuntimeRegistry();
  runtimes.connectHost({ hostId: "host-1", adapters: { opencode: adapter() } });
  const server = createProductizedShareServer({
    runtimes,
    tokenFactory: () => "local-friend",
    hostBootstrapSecret: bootstrapSecret,
  });
  const fetch = server.fetch;

  await server.listen(0);
  const baseUrl = server.url();

  try {
    await fetch(`${baseUrl}/v1/hosts/register`, {
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
    await fetch(`${baseUrl}/v1/owner/share-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: "owner-1",
        hostId: "host-1",
        name: "Ralphloop Agent",
      }),
    });

    const friend = await fetch(`${baseUrl}/app/share/local-friend/classic`);
    assert.equal(friend.status, 200);
    const document = createFriendDocument();
    const localStorage = new FakeLocalStorage();
    await runPageScript({
      html: await friend.text(),
      document,
      baseUrl,
      localStorage,
      fetch,
    });

    let sessions = readFriendUiSessions(localStorage);
    assert.equal(sessions.length, 1);
    const firstSessionId = readActiveFriendUiSessionId(localStorage);
    assert.equal(firstSessionId, sessions[0].id);

    await submitFriendChatMessage(document, "first session asks for repo status");
    assert.match(document.getElementById("chat-thread").innerHTML, /first session asks for repo status/);
    assert.match(document.getElementById("chat-thread").innerHTML, /done/);

    await clickFriendNewSession(document);
    sessions = readFriendUiSessions(localStorage);
    assert.equal(sessions.length, 2);
    const secondSessionId = readActiveFriendUiSessionId(localStorage);
    assert.notEqual(secondSessionId, firstSessionId);
    assert.doesNotMatch(document.getElementById("chat-thread").innerHTML, /first session asks/);

    await submitFriendChatMessage(document, "second session drafts a note");
    assert.match(document.getElementById("chat-thread").innerHTML, /second session drafts a note/);
    assert.doesNotMatch(document.getElementById("chat-thread").innerHTML, /first session asks/);

    await clickFriendSession(document, firstSessionId);
    assert.equal(readActiveFriendUiSessionId(localStorage), firstSessionId);
    assert.match(document.getElementById("chat-thread").innerHTML, /first session asks for repo status/);
    assert.doesNotMatch(document.getElementById("chat-thread").innerHTML, /second session drafts a note/);

    await clickFriendSession(document, secondSessionId);
    assert.equal(readActiveFriendUiSessionId(localStorage), secondSessionId);
    assert.match(document.getElementById("chat-thread").innerHTML, /second session drafts a note/);
    assert.doesNotMatch(document.getElementById("chat-thread").innerHTML, /first session asks/);
    assert.equal(/cost|budget|tokenHash|模型价格/.test(document.getElementById("chat-thread").innerHTML), false);
  } finally {
    await server.close();
  }
});

test("productized friend chatbot preview drawer toggles without changing the thread", async () => {
  const runtimes = new HostRuntimeRegistry();
  runtimes.connectHost({ hostId: "host-1", adapters: { opencode: adapter() } });
  const server = createProductizedShareServer({
    runtimes,
    tokenFactory: () => "local-friend",
    hostBootstrapSecret: bootstrapSecret,
  });
  const fetch = server.fetch;

  await server.listen(0);
  const baseUrl = server.url();

  try {
    await fetch(`${baseUrl}/v1/hosts/register`, {
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
    await fetch(`${baseUrl}/v1/owner/share-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: "owner-1",
        hostId: "host-1",
        name: "Ralphloop Agent",
      }),
    });

    const friend = await fetch(`${baseUrl}/app/share/local-friend/classic`);
    assert.equal(friend.status, 200);
    const document = createFriendDocument();
    await runPageScript({
      html: await friend.text(),
      document,
      baseUrl,
      fetch,
    });

    const previewDrawer = document.getElementById("preview-drawer");
    assert.equal(previewDrawer.getAttribute("aria-hidden"), "true");
    assert.equal(previewDrawer.classList.contains("is-open"), false);

    await submitFriendChatMessage(document, "show preview after this task");
    const threadHtml = document.getElementById("chat-thread").innerHTML;

    await clickFriendPreviewToggle(document);
    assert.equal(previewDrawer.getAttribute("aria-hidden"), "false");
    assert.equal(previewDrawer.classList.contains("is-open"), true);
    assert.equal(document.getElementById("chat-thread").innerHTML, threadHtml);

    await clickFriendPreviewClose(document);
    assert.equal(previewDrawer.getAttribute("aria-hidden"), "true");
    assert.equal(previewDrawer.classList.contains("is-open"), false);
    assert.equal(document.getElementById("chat-thread").innerHTML, threadHtml);
  } finally {
    await server.close();
  }
});

test("productized friend chatbot renders and resolves confirmation cards inline", async () => {
  const store = new RelayStore();
  const runtimes = new HostRuntimeRegistry();
  runtimes.connectHost({ hostId: "host-1", adapters: { opencode: adapter() } });
  const server = createProductizedShareServer({
    store,
    runtimes,
    tokenFactory: () => "local-friend",
    hostBootstrapSecret: bootstrapSecret,
  });
  const fetch = server.fetch;

  await server.listen(0);
  const baseUrl = server.url();

  try {
    await fetch(`${baseUrl}/v1/hosts/register`, {
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
    await fetch(`${baseUrl}/v1/owner/share-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: "owner-1",
        hostId: "host-1",
        name: "Ralphloop Agent",
      }),
    });

    const friend = await fetch(`${baseUrl}/app/share/local-friend/classic`);
    assert.equal(friend.status, 200);
    const document = createFriendDocument();
    const localStorage = new FakeLocalStorage();
    await runPageScript({
      html: await friend.text(),
      document,
      baseUrl,
      localStorage,
      fetch,
    });

    const sessionId = readActiveFriendUiSessionId(localStorage);
    const confirmation = gateRuntimeActionV1({
      store,
      ownerId: "owner-1",
      sessionId,
      taskId: "task-needs-confirmation",
      action: "send_email",
      permissionSource: "user_identity",
      summary: "Send email as friend",
    });
    assert.equal(confirmation.status, 202);
    const confirmationId = confirmation.body.approvalRequest.id;

    await clickFriendSession(document, sessionId);
    const chatThread = document.getElementById("chat-thread");
    assert.match(chatThread.innerHTML, /data-testid="friend-approval-card"/);
    assert.match(chatThread.innerHTML, /Send email as friend/);
    assert.match(chatThread.innerHTML, /approve-friend-confirmation/);
    assert.match(chatThread.innerHTML, /deny-friend-confirmation/);

    await clickFriendApproval(document, "approve", confirmationId);
    assert.doesNotMatch(chatThread.innerHTML, /Send email as friend/);
    const ownerApprovals = await fetch(`${baseUrl}/v1/owner/approvals?ownerId=owner-1&status=approved`);
    const ownerApprovalsBody = await ownerApprovals.json();
    assert.deepEqual(ownerApprovalsBody.approvalRequests.map((request) => request.id), [confirmationId]);
  } finally {
    await server.close();
  }
});

test("productized friend chatbot renders local host output as one consistent Agent message", async () => {
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
        capabilities: ["outbound_commands"],
      }),
    });
    assert.equal(registered.status, 201);
    const registeredBody = await registered.json();

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

    const submitted = await fetch(`${baseUrl}/v1/share/local-friend/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: sessionBody.session.id,
        prompt: "Run local reasoning and explain the result",
      }),
    });
    assert.equal(submitted.status, 202);
    const submittedBody = await submitted.json();
    assert.equal(submittedBody.task.status, "waiting");

    const claimed = await fetch(`${baseUrl}/v1/hosts/host-1/commands`, {
      headers: { "x-ralphloop-device-key": registeredBody.deviceKey },
    });
    assert.equal(claimed.status, 200);
    const claimedBody = await claimed.json();
    const command = claimedBody.commands[0];

    const localOutput = [
      "I inspected the local workspace.",
      "The shared Agent can answer from the creator runtime.",
    ];
    const recorded = await fetch(`${baseUrl}/v1/hosts/host-1/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ralphloop-device-key": registeredBody.deviceKey,
      },
      body: JSON.stringify({
        commandId: command.id,
        sessionId: command.command.sessionId,
        taskId: command.command.taskId,
        runtimeId: "opencode:outbound-runtime",
        events: [
          { type: "task.output", taskId: "host-local-task", text: localOutput[0] },
          { type: "task.output", taskId: "host-local-task", text: localOutput[1] },
          { type: "task.completed", taskId: "host-local-task" },
        ],
      }),
    });
    assert.equal(recorded.status, 202);

    const friend = await fetch(`${baseUrl}/app/share/local-friend/classic`);
    assert.equal(friend.status, 200);
    const document = createFriendDocument();
    const localStorage = new FakeLocalStorage();
    seedFriendUiSession(localStorage, {
      sessionId: sessionBody.session.id,
      taskId: submittedBody.task.id,
    });
    let agUiEventRequestCount = 0;

    await runPageScript({
      html: await friend.text(),
      document,
      baseUrl,
      localStorage,
      fetch: async (url, init) => {
        if (url.startsWith(`${baseUrl}/v1/share/local-friend/events`)) {
          const parsedUrl = new URL(url);
          if (parsedUrl.searchParams.get("format") !== "ag-ui") {
            return new Response(JSON.stringify({
              events: [],
              available: false,
              error: "ag_ui_format_required",
            }), {
              status: 400,
              headers: { "content-type": "application/json" },
            });
          }
          agUiEventRequestCount += 1;
        }
        return fetch(url, init);
      },
    });

    const chatThreadHtml = document.getElementById("chat-thread").innerHTML;
    assert.equal(agUiEventRequestCount >= 1, true);
    assert.equal(document.getElementById("chat-status").textContent, "已完成");
    assert.match(chatThreadHtml, /Run local reasoning and explain the result/);
    assert.match(chatThreadHtml, /<span class="chat-message-role">Agent<\/span>/);
    assert.match(chatThreadHtml, /I inspected the local workspace\.\nThe shared Agent can answer from the creator runtime\./);
    assert.equal((chatThreadHtml.match(/data-event-type="task\.output"/g) ?? []).length, 1);
    assert.equal((chatThreadHtml.match(/I inspected the local workspace/g) ?? []).length, 1);
    assert.equal((chatThreadHtml.match(/The shared Agent can answer/g) ?? []).length, 1);
    assert.equal(/cost|budget|tokenHash|deviceKey|bootstrap|模型价格/.test(chatThreadHtml), false);

    const [storedSession] = readFriendUiSessions(localStorage);
    const outputMessages = storedSession.messages?.filter((message) => message.type === "task.output") ?? [];
    assert.equal(outputMessages.length, 1);
    assert.equal(outputMessages[0].content, localOutput.join("\n"));
  } finally {
    await server.close();
  }
});

test("productized assistant-ui share page renders a session shell from local host AG-UI events", async () => {
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
        capabilities: ["outbound_commands"],
      }),
    });
    assert.equal(registered.status, 201);
    const registeredBody = await registered.json();

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

    const submitted = await fetch(`${baseUrl}/v1/share/local-friend/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: sessionBody.session.id,
        prompt: "Use the creator desktop agent and summarize the real output",
      }),
    });
    assert.equal(submitted.status, 202);
    const submittedBody = await submitted.json();
    assert.equal(submittedBody.task.status, "waiting");

    const claimed = await fetch(`${baseUrl}/v1/hosts/host-1/commands`, {
      headers: { "x-ralphloop-device-key": registeredBody.deviceKey },
    });
    assert.equal(claimed.status, 200);
    const claimedBody = await claimed.json();
    const command = claimedBody.commands[0];

    const recorded = await fetch(`${baseUrl}/v1/hosts/host-1/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ralphloop-device-key": registeredBody.deviceKey,
      },
      body: JSON.stringify({
        commandId: command.id,
        sessionId: command.command.sessionId,
        taskId: command.command.taskId,
        runtimeId: "opencode:outbound-runtime",
        events: [
          {
            type: "task.output",
            taskId: "host-local-task",
            text: "This answer came from the creator host runtime.",
          },
          { type: "task.completed", taskId: "host-local-task" },
        ],
      }),
    });
    assert.equal(recorded.status, 202);

    const assistantUi = await fetch(
      `${baseUrl}/app/share/local-friend/assistant-ui?sessionId=${sessionBody.session.id}&taskId=${submittedBody.task.id}`,
    );
    assert.equal(assistantUi.status, 200);
    const html = await assistantUi.text();

    assert.match(html, /Ralphloop Assistant UI/);
    assert.match(html, /data-ralphloop-assistant-ui-shell="true"/);
    assert.match(html, /data-assistant-ui-layout="chatbot"/);
    assert.match(html, new RegExp(`data-current-thread-id="${sessionBody.session.id}"`));
    assert.match(html, /data-message-count="2"/);
    assert.match(html, /data-thread-count="1"/);
    assert.match(html, /data-assistant-ui-thread-list="true"/);
    assert.match(html, /data-assistant-ui-thread="true"/);
    assert.match(html, /data-assistant-ui-message-list="true"/);
    assert.match(html, /class="assistant-ui-thread-rail"/);
    assert.match(html, /class="assistant-ui-thread-panel"/);
    assert.match(html, /class="assistant-ui-message assistant-ui-message-user"/);
    assert.match(html, /class="assistant-ui-message assistant-ui-message-assistant"/);
    assert.match(html, /data-assistant-ui-thread-status="completed"/);
    assert.match(html, /Use the creator desktop agent and summarize the real output/);
    assert.match(html, /This answer came from the creator host runtime\./);
    assert.doesNotMatch(html, /cost|budget|tokenHash|deviceKey|bootstrap|模型价格/);
  } finally {
    await server.close();
  }
});

test("productized react v2 entry serves hydrated state and preserves assistant-ui markers", async () => {
  const server = createProductizedShareServer({
    tokenFactory: () => "local-friend",
    hostBootstrapSecret: bootstrapSecret,
  });
  const fetch = server.fetch;

  await server.listen(0);
  const baseUrl = server.url();

  try {
    await fetch(`${baseUrl}/v1/hosts/register`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ralphloop-bootstrap-secret": bootstrapSecret,
      },
      body: JSON.stringify({
        ownerId: "owner-1",
        hostId: "host-1",
        deviceName: "React v2 host",
        hostVersion: "0.2.0",
        supportedAdapters: ["opencode"],
        capabilities: ["outbound_commands"],
      }),
    });
    const created = await fetch(`${baseUrl}/v1/owner/share-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: "owner-1",
        hostId: "host-1",
        name: "Ralphloop React v2 agent",
      }),
    });
    assert.equal(created.status, 201);

    const v2 = await fetch(`${baseUrl}/app/share/local-friend/v2`);
    assert.equal(v2.status, 200);
    const v2Html = await v2.text();
    assert.match(v2Html, /data-ralphloop-react-app="true"/);
    assert.match(v2Html, /<script type="application\/json" id="ralphloop-state">/);
    assert.match(v2Html, /"token":"local-friend"/);
    assert.match(v2Html, /\/app\/share\/local-friend\/v2\/assets\//);
    assert.doesNotMatch(v2Html, /__TOKEN__/);
    assert.doesNotMatch(v2Html, /cost|budget|tokenHash|deviceKey|bootstrap|模型价格/);

    const v2WithSession = await fetch(
      `${baseUrl}/app/share/local-friend/v2?sessionId=session-x&taskId=task-x`,
    );
    assert.equal(v2WithSession.status, 200);
    const v2SessionHtml = await v2WithSession.text();
    assert.match(v2SessionHtml, /"currentThreadId":"session-x"/);
    assert.match(v2SessionHtml, /"taskId":"task-x"/);

    const assistantUi = await fetch(`${baseUrl}/app/share/local-friend/assistant-ui`);
    assert.equal(assistantUi.status, 200);
    const assistantUiHtml = await assistantUi.text();
    assert.match(assistantUiHtml, /data-ralphloop-assistant-ui-shell="true"/);

    const classic = await fetch(`${baseUrl}/app/share/local-friend/classic`);
    assert.equal(classic.status, 200);
  } finally {
    await server.close();
  }
});

test("productized friend chatbot queues rapid same-session messages in user send order", async () => {
  const runtimes = new HostRuntimeRegistry();
  runtimes.connectHost({
    hostId: "host-1",
    adapters: {
      opencode: delayedAdapter({
        delayMsForPrompt: (prompt) => prompt.includes("first rapid") ? 45 : 1,
      }),
    },
  });
  const server = createProductizedShareServer({
    runtimes,
    tokenFactory: () => "local-friend",
    hostBootstrapSecret: bootstrapSecret,
  });
  const fetch = server.fetch;

  await server.listen(0);
  const baseUrl = server.url();

  try {
    await fetch(`${baseUrl}/v1/hosts/register`, {
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
    await fetch(`${baseUrl}/v1/owner/share-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: "owner-1",
        hostId: "host-1",
        name: "Ralphloop Agent",
      }),
    });

    const friend = await fetch(`${baseUrl}/app/share/local-friend/classic`);
    assert.equal(friend.status, 200);
    const document = createFriendDocument();
    const localStorage = new FakeLocalStorage();
    await runPageScript({
      html: await friend.text(),
      document,
      baseUrl,
      localStorage,
      fetch,
    });

    await dispatchFriendChatMessage(document, "first rapid message");
    await dispatchFriendChatMessage(document, "second rapid message");
    await new Promise((resolve) => setTimeout(resolve, 140));
    await settlePageTasks();

    const chatThreadHtml = document.getElementById("chat-thread").innerHTML;
    assert.equal(document.getElementById("chat-status").textContent, "已完成");
    assert.match(chatThreadHtml, /first rapid message/);
    assert.match(chatThreadHtml, /second rapid message/);
    assert.match(chatThreadHtml, /local output: first rapid message/);
    assert.match(chatThreadHtml, /local output: second rapid message/);
    assert.equal(chatThreadHtml.includes("session_unavailable"), false);
    assert.equal(chatThreadHtml.indexOf("first rapid message") < chatThreadHtml.indexOf("second rapid message"), true);
    assert.equal(
      chatThreadHtml.indexOf("local output: first rapid message")
        < chatThreadHtml.indexOf("local output: second rapid message"),
      true,
    );

    const [storedSession] = readFriendUiSessions(localStorage);
    const userMessages = storedSession.messages?.filter((message) => message.type === "user.task") ?? [];
    const outputMessages = storedSession.messages?.filter((message) => message.type === "task.output") ?? [];
    assert.deepEqual(userMessages.map((message) => message.content), [
      "first rapid message",
      "second rapid message",
    ]);
    assert.deepEqual(outputMessages.map((message) => message.content), [
      "local output: first rapid message",
      "local output: second rapid message",
    ]);
  } finally {
    await server.close();
  }
});

test("productized friend chatbot keeps the user message and shows a friendly failure on task request errors", async () => {
  const runtimes = new HostRuntimeRegistry();
  runtimes.connectHost({ hostId: "host-1", adapters: { opencode: adapter() } });
  const server = createProductizedShareServer({
    runtimes,
    tokenFactory: () => "local-friend",
    hostBootstrapSecret: bootstrapSecret,
  });
  const fetch = server.fetch;

  await server.listen(0);
  const baseUrl = server.url();

  try {
    await fetch(`${baseUrl}/v1/hosts/register`, {
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
    await fetch(`${baseUrl}/v1/owner/share-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: "owner-1",
        hostId: "host-1",
        name: "Ralphloop Agent",
      }),
    });

    const friend = await fetch(`${baseUrl}/app/share/local-friend/classic`);
    assert.equal(friend.status, 200);
    const document = createFriendDocument();
    const localStorage = new FakeLocalStorage();
    await runPageScript({
      html: await friend.text(),
      document,
      baseUrl,
      localStorage,
      fetch: async (url, init) => {
        if (url.endsWith("/v1/share/local-friend/tasks") && init?.method === "POST") {
          throw new TypeError("network down: internal details");
        }
        return fetch(url, init);
      },
    });

    await submitFriendChatMessage(document, "message should survive network failure");

    const chatThreadHtml = document.getElementById("chat-thread").innerHTML;
    assert.equal(document.getElementById("chat-status").textContent, "提交失败");
    assert.match(chatThreadHtml, /message should survive network failure/);
    assert.match(chatThreadHtml, /任务提交失败，请稍后重试/);
    assert.doesNotMatch(chatThreadHtml, /network down|internal details|TypeError/);

    const [storedSession] = readFriendUiSessions(localStorage);
    assert.equal(storedSession.messages?.some((message) => message.type === "user.task"), true);
    assert.equal(storedSession.messages?.some((message) => message.type === "task.failed"), true);
  } finally {
    await server.close();
  }
});

test("productized friend chatbot keeps parallel session responses bound to the originating session", async () => {
  const runtimes = new HostRuntimeRegistry();
  runtimes.connectHost({
    hostId: "host-1",
    adapters: {
      opencode: delayedAdapter({
        delayMsForPrompt: (prompt) => prompt.includes("first parallel") ? 50 : 1,
      }),
    },
  });
  const server = createProductizedShareServer({
    runtimes,
    tokenFactory: () => "local-friend",
    hostBootstrapSecret: bootstrapSecret,
  });
  const fetch = server.fetch;

  await server.listen(0);
  const baseUrl = server.url();

  try {
    await fetch(`${baseUrl}/v1/hosts/register`, {
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
    await fetch(`${baseUrl}/v1/owner/share-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: "owner-1",
        hostId: "host-1",
        name: "Ralphloop Agent",
        policy: { maxConcurrentSessions: 2 },
      }),
    });

    const friend = await fetch(`${baseUrl}/app/share/local-friend/classic`);
    assert.equal(friend.status, 200);
    const document = createFriendDocument();
    const localStorage = new FakeLocalStorage();
    await runPageScript({
      html: await friend.text(),
      document,
      baseUrl,
      localStorage,
      fetch,
    });

    const firstSessionId = readActiveFriendUiSessionId(localStorage);
    await dispatchFriendChatMessage(document, "first parallel session message");
    await clickFriendNewSession(document);
    const secondSessionId = readActiveFriendUiSessionId(localStorage);
    assert.notEqual(secondSessionId, firstSessionId);

    await dispatchFriendChatMessage(document, "second parallel session message");
    await new Promise((resolve) => setTimeout(resolve, 150));
    await settlePageTasks();

    const secondThreadHtml = document.getElementById("chat-thread").innerHTML;
    assert.match(secondThreadHtml, /second parallel session message/);
    assert.match(secondThreadHtml, /local output: second parallel session message/);
    assert.doesNotMatch(secondThreadHtml, /first parallel session message/);
    assert.doesNotMatch(secondThreadHtml, /local output: first parallel session message/);

    await clickFriendSession(document, firstSessionId);
    const firstThreadHtml = document.getElementById("chat-thread").innerHTML;
    assert.match(firstThreadHtml, /first parallel session message/);
    assert.match(firstThreadHtml, /local output: first parallel session message/);
    assert.doesNotMatch(firstThreadHtml, /second parallel session message/);
    assert.doesNotMatch(firstThreadHtml, /local output: second parallel session message/);
  } finally {
    await server.close();
  }
});

test("productized owner page script manages existing share links from the list", async () => {
  const runtimes = new HostRuntimeRegistry();
  runtimes.connectHost({ hostId: "host-1", adapters: { opencode: adapter() } });
  const server = createProductizedShareServer({
    runtimes,
    tokenFactory: () => "local-friend",
    hostBootstrapSecret: bootstrapSecret,
  });
  const fetch = server.fetch;

  await server.listen(0);
  const baseUrl = server.url();

  try {
    await fetch(`${baseUrl}/v1/hosts/register`, {
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
    const createdBody = await created.json();
    const shareLinkId = createdBody.shareLink.id;

    const owner = await fetch(`${baseUrl}/app/owner`);
    assert.equal(owner.status, 200);
    const document = createOwnerDocument();
    await runPageScript({
      html: await owner.text(),
      document,
      baseUrl,
      fetch,
    });

    const shareLinkList = document.getElementById("share-link-list");
    assert.match(shareLinkList.innerHTML, /active/);
    assert.match(shareLinkList.innerHTML, /暂停/);
    assert.match(shareLinkList.innerHTML, /链接仅创建时显示/);
    assert.doesNotMatch(shareLinkList.innerHTML, /undefined\/assistant-ui/);

    await clickOwnerShareLinkAction(document, "pause-share-link", shareLinkId);
    const pausedLinks = await fetch(`${baseUrl}/v1/owner/share-links?ownerId=owner-1`);
    assert.equal((await pausedLinks.json()).shareLinks[0].status, "paused");
    assert.match(shareLinkList.innerHTML, /paused/);
    assert.match(shareLinkList.innerHTML, /启用/);
    const pausedFriend = await fetch(`${baseUrl}/app/share/local-friend/classic`);
    assert.equal(pausedFriend.status, 200);

    await clickOwnerShareLinkAction(document, "resume-share-link", shareLinkId);
    const resumedLinks = await fetch(`${baseUrl}/v1/owner/share-links?ownerId=owner-1`);
    assert.equal((await resumedLinks.json()).shareLinks[0].status, "active");
    assert.match(shareLinkList.innerHTML, /active/);
    const resumedFriend = await fetch(`${baseUrl}/app/share/local-friend/classic`);
    assert.equal(resumedFriend.status, 200);

    await clickOwnerShareLinkAction(document, "revoke-listed-share-link", shareLinkId);
    const revokedLinks = await fetch(`${baseUrl}/v1/owner/share-links?ownerId=owner-1`);
    assert.equal((await revokedLinks.json()).shareLinks[0].status, "revoked");
    assert.match(shareLinkList.innerHTML, /revoked/);
    assert.match(shareLinkList.innerHTML, /不可恢复/);
    assert.match(document.getElementById("control-status").textContent, /已请求撤销链接/);
    const revokedFriend = await fetch(`${baseUrl}/app/share/local-friend/classic`);
    assert.equal(revokedFriend.status, 200);
  } finally {
    await server.close();
  }
});

test("productized owner page script edits existing share link name and allowed adapters", async () => {
  const runtimes = new HostRuntimeRegistry();
  runtimes.connectHost({ hostId: "host-1", adapters: { opencode: adapter(), codex: adapter() } });
  const server = createProductizedShareServer({
    runtimes,
    tokenFactory: () => "local-friend",
    hostBootstrapSecret: bootstrapSecret,
  });
  const fetch = server.fetch;

  await server.listen(0);
  const baseUrl = server.url();

  try {
    await fetch(`${baseUrl}/v1/hosts/register`, {
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
        supportedAdapters: ["opencode", "codex"],
      }),
    });
    const created = await fetch(`${baseUrl}/v1/owner/share-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: "owner-1",
        hostId: "host-1",
        name: "Ralphloop Agent",
        policy: { allowedAdapterIds: ["opencode"] },
      }),
    });
    assert.equal(created.status, 201);
    const createdBody = await created.json();
    const shareLinkId = createdBody.shareLink.id;

    const owner = await fetch(`${baseUrl}/app/owner`);
    assert.equal(owner.status, 200);
    const document = createOwnerDocument();
    await runPageScript({
      html: await owner.text(),
      document,
      baseUrl,
      fetch,
    });

    const shareLinkList = document.getElementById("share-link-list");
    assert.match(shareLinkList.innerHTML, /Ralphloop Agent/);
    assert.match(shareLinkList.innerHTML, /opencode/);
    assert.match(shareLinkList.innerHTML, /codex/);
    assert.match(shareLinkList.innerHTML, /保存/);

    await submitOwnerShareLinkEdit(document, {
      shareLinkId,
      name: "Research Agent",
      allowedAdapterIds: ["codex"],
    });

    const links = await fetch(`${baseUrl}/v1/owner/share-links?ownerId=owner-1`);
    const linksBody = await links.json();
    assert.equal(linksBody.shareLinks[0].name, "Research Agent");
    assert.deepEqual(linksBody.shareLinks[0].allowedAdapterIds, ["codex"]);
    assert.match(shareLinkList.innerHTML, /Research Agent/);
    assert.match(shareLinkList.innerHTML, /codex/);
    assert.doesNotMatch(shareLinkList.innerHTML, /tokenHash|deviceKey|bootstrap|模型价格/);
    assert.equal(document.getElementById("control-status").textContent, "已保存链接配置");
  } finally {
    await server.close();
  }
});

test("productized friend app page renders neutral HTML when a share link is unavailable", async () => {
  const runtimes = new HostRuntimeRegistry();
  runtimes.connectHost({ hostId: "host-1", adapters: { opencode: adapter() } });
  const server = createProductizedShareServer({
    runtimes,
    tokenFactory: () => "local-friend",
    hostBootstrapSecret: bootstrapSecret,
  });
  const fetch = server.fetch;

  await server.listen(0);
  const baseUrl = server.url();

  try {
    await fetch(`${baseUrl}/v1/hosts/register`, {
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
    const created = await fetch(`${baseUrl}/v1/owner/share-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: "owner-1",
        hostId: "host-1",
        name: "Ralphloop Agent",
      }),
    });
    const createdBody = await created.json();
    await fetch(`${baseUrl}/v1/owner/share-links/${createdBody.shareLink.id}/pause`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerId: "owner-1" }),
    });

    const pausedFriend = await fetch(`${baseUrl}/app/share/local-friend/classic`);
    const pausedHtml = await pausedFriend.text();
    assert.equal(pausedFriend.status, 200);
    assert.match(pausedFriend.headers.get("content-type") ?? "", /text\/html/);
    assert.match(pausedHtml, /Ralphloop/);
    assert.match(pausedHtml, /链接暂不可用/);
    assert.match(pausedHtml, /请联系分享者/);
    assert.equal(pausedHtml.includes("share_link_paused"), false);
    assert.equal(pausedHtml.includes("tokenHash"), false);
    assert.equal(pausedHtml.includes("cost"), false);
  } finally {
    await server.close();
  }
});

test("assistant-ui share page falls back to a friendly stale banner when the session is unknown", async () => {
  const server = createProductizedShareServer({
    tokenFactory: () => "local-friend",
    hostBootstrapSecret: bootstrapSecret,
  });
  const fetch = server.fetch;

  await server.listen(0);
  const baseUrl = server.url();

  try {
    await fetch(`${baseUrl}/v1/hosts/register`, {
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

    const staleResponse = await fetch(
      `${baseUrl}/app/share/local-friend/assistant-ui?sessionId=expired&taskId=expired`,
    );
    assert.equal(staleResponse.status, 200);
    const staleHtml = await staleResponse.text();

    // The SSR markup advertises that the requested session is stale via a
    // deterministic marker. The friendly Chinese copy matches the existing
    // client-side recovery message (`assistantUiClientScript.ts:31`) so
    // SSR + hydration deliver identical banners.
    assert.match(staleHtml, /data-ralphloop-stale-session="true"/);
    assert.match(staleHtml, /当前会话已失效，请新建会话后重试。/);
    // Sanity: it's still the assistant-ui shell, not the unavailable page.
    assert.match(staleHtml, /data-ralphloop-assistant-ui-shell="true"/);
    // The requested (now-stale) session id is preserved so the client
    // script's stale-recovery flow keeps working — the SSR banner is
    // additive, not a replacement.
    assert.match(staleHtml, /data-current-thread-id="expired"/);
    // Fresh URLs (no stale session) do NOT carry the marker.
    const freshResponse = await fetch(`${baseUrl}/app/share/local-friend/assistant-ui`);
    assert.equal(freshResponse.status, 200);
    const freshHtml = await freshResponse.text();
    assert.doesNotMatch(freshHtml, /data-ralphloop-stale-session="true"/);
    // No raw secrets leak through the banner injection.
    assert.equal(staleHtml.includes("tokenHash"), false);
    assert.equal(staleHtml.includes("deviceKey"), false);
  } finally {
    await server.close();
  }
});
