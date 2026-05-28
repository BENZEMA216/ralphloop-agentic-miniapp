import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import type { AgentAdapter } from "../../share-gateway/src/adapters/types.ts";
import { createHostClientRuntimeState, runHostCommandOnce } from "../../share-gateway/src/productization/hostClient.ts";
import { createProductizedShareServer } from "../../share-gateway/src/productization/httpServer.ts";
import {
  findChromePath,
  launchChrome,
  saveBrowserScreenshot,
} from "./browserHarness.ts";

type ProductizedFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<Response>;

type BrowserFixture = {
  baseUrl: string;
  deviceKey: string;
  fetch: ProductizedFetch;
};

test("default friend browser link opens assistant-ui chat", {
  skip: !findChromePath() ? "Chrome is required" : false,
}, async () => {
  const bootstrapSecret = "test-bootstrap-secret";
  const server = createProductizedShareServer({
    tokenFactory: () => "local-friend",
    hostBootstrapSecret: bootstrapSecret,
  });
  await server.listen(0);
  const baseUrl = server.url();
  let browser: Awaited<ReturnType<typeof launchChrome>> | undefined;

  try {
    browser = await launchChrome();
    await createBrowserFriendFixture({ baseUrl, bootstrapSecret, fetch: server.fetch });
    await browser.navigate(`${baseUrl}/app/share/local-friend`);
    await browser.waitForExpression("window.location.pathname.endsWith('/app/share/local-friend/assistant-ui')");
    await browser.waitForExpression("Boolean(document.querySelector('[data-ralphloop-assistant-ui-shell=\"true\"]'))");
    const state = await browser.evaluate<{ path: string; text: string }>(`
      ({ path: window.location.pathname, text: document.body.textContent || "" })
    `);
    assert.equal(state.path, "/app/share/local-friend/assistant-ui");
    assert.match(state.text, /Ralphloop Friend Browser Behavior Agent/);
    assert.equal(/cost|budget|tokenHash|deviceKey|bootstrap|模型价格/.test(state.text), false);
    assert.deepEqual(browser.consoleErrors, []);
    assert.deepEqual(browser.exceptions, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("legacy friend browser page links into assistant-ui chat", {
  skip: !findChromePath() ? "Chrome is required" : false,
}, async () => {
  const bootstrapSecret = "test-bootstrap-secret";
  const server = createProductizedShareServer({
    tokenFactory: () => "local-friend",
    hostBootstrapSecret: bootstrapSecret,
  });
  await server.listen(0);
  const baseUrl = server.url();
  let browser: Awaited<ReturnType<typeof launchChrome>> | undefined;

  try {
    browser = await launchChrome();
    await createBrowserFriendFixture({ baseUrl, bootstrapSecret, fetch: server.fetch });
    await browser.navigate(`${baseUrl}/app/share/local-friend/classic`);
    await browser.waitForExpression("Boolean(document.querySelector('[data-testid=\"friend-chat-shell\"]'))");
    await browser.waitForExpression("Boolean(document.querySelector('[data-testid=\"friend-assistant-ui-link\"]'))");

    await browser.evaluate(`
      (() => {
        document.querySelector('[data-testid="friend-assistant-ui-link"]').click();
        return true;
      })()
    `);

    await browser.waitForExpression("window.location.pathname.endsWith('/app/share/local-friend/assistant-ui')");
    await browser.waitForExpression("Boolean(document.querySelector('[data-ralphloop-assistant-ui-shell=\"true\"]'))");
    const state = await browser.evaluate<{ path: string; text: string }>(`
      ({ path: window.location.pathname, text: document.body.textContent || "" })
    `);
    assert.equal(state.path, "/app/share/local-friend/assistant-ui");
    assert.match(state.text, /Ralphloop Friend Browser Behavior Agent/);
    assert.equal(/cost|budget|tokenHash|deviceKey|bootstrap|模型价格/.test(state.text), false);
    assert.deepEqual(browser.consoleErrors, []);
    assert.deepEqual(browser.exceptions, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("friend browser queues rapid same-session messages in send order", {
  skip: !findChromePath() ? "Chrome is required" : false,
}, async () => {
  const bootstrapSecret = "test-bootstrap-secret";
  const server = createProductizedShareServer({
    tokenFactory: () => "local-friend",
    hostBootstrapSecret: bootstrapSecret,
  });
  await server.listen(0);
  const baseUrl = server.url();
  let browser: Awaited<ReturnType<typeof launchChrome>> | undefined;
  const runtimeState = createHostClientRuntimeState();
  const adapter = browserEchoAdapter();

  try {
    browser = await launchChrome();
    const fixture = await createBrowserFriendFixture({ baseUrl, bootstrapSecret, fetch: server.fetch });
    await openFriendChat(browser, baseUrl);

    await submitFriendPrompt(browser, "first browser rapid message");
    await browser.waitForExpression("document.querySelector('#chat-thread')?.textContent.includes('first browser rapid message')");
    await submitFriendPrompt(browser, "second browser rapid message");
    await browser.waitForExpression("document.querySelector('#chat-thread')?.textContent.includes('second browser rapid message')");

    await processHostCommands({
      fixture,
      runtimeState,
      adapters: { opencode: adapter },
      expectedCommands: 2,
    });
    await browser.waitForExpression("document.querySelector('#chat-thread')?.textContent.includes('browser output: second browser rapid message')");
    await browser.waitForExpression("document.querySelector('#chat-status')?.textContent === '已完成'");

    const state = await friendBrowserState(browser);
    assert.equal(state.status, "已完成");
    assert.equal(state.sessionCount, 1);
    assert.equal(state.outputCount, 2, state.threadHtml);
    assert.match(state.threadText, /browser output: first browser rapid message/);
    assert.match(state.threadText, /browser output: second browser rapid message/);
    assert.equal(state.threadText.indexOf("first browser rapid message") < state.threadText.indexOf("second browser rapid message"), true);
    assert.equal(
      state.threadText.indexOf("browser output: first browser rapid message")
        < state.threadText.indexOf("browser output: second browser rapid message"),
      true,
    );
    assert.equal(/cost|budget|tokenHash|deviceKey|bootstrap|模型价格/.test(state.threadText), false);

    const screenshotPath = await saveBrowserScreenshot({
      browser,
      artifactName: "friend-rapid-same-session",
    });
    assert.match(screenshotPath, /friend-rapid-same-session\.png$/);
    assert.deepEqual(browser.consoleErrors, []);
    assert.deepEqual(browser.exceptions, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("friend browser keeps parallel session outputs bound to their originating session", {
  skip: !findChromePath() ? "Chrome is required" : false,
}, async () => {
  const bootstrapSecret = "test-bootstrap-secret";
  const server = createProductizedShareServer({
    tokenFactory: () => "local-friend",
    hostBootstrapSecret: bootstrapSecret,
  });
  await server.listen(0);
  const baseUrl = server.url();
  let browser: Awaited<ReturnType<typeof launchChrome>> | undefined;
  const runtimeState = createHostClientRuntimeState();
  const adapter = browserEchoAdapter();

  try {
    browser = await launchChrome();
    const fixture = await createBrowserFriendFixture({ baseUrl, bootstrapSecret, fetch: server.fetch });
    await openFriendChat(browser, baseUrl);

    const firstSessionId = await activeFriendSessionId(browser);
    await submitFriendPrompt(browser, "first browser parallel session message");
    await browser.waitForExpression("document.querySelector('#chat-thread')?.textContent.includes('first browser parallel session message')");

    await browser.evaluate("document.querySelector('[data-testid=\"friend-new-session\"]')?.click() || true");
    await browser.waitForExpression("document.querySelectorAll('[data-testid=\"friend-session-item\"]').length === 2");
    const secondSessionId = await activeFriendSessionId(browser);
    assert.notEqual(secondSessionId, firstSessionId);

    await submitFriendPrompt(browser, "second browser parallel session message");
    await browser.waitForExpression("document.querySelector('#chat-thread')?.textContent.includes('second browser parallel session message')");

    await processHostCommands({
      fixture,
      runtimeState,
      adapters: { opencode: adapter },
      expectedCommands: 2,
    });
    await browser.waitForExpression("document.querySelector('#chat-thread')?.textContent.includes('browser output: second browser parallel session message')");

    const secondState = await friendBrowserState(browser);
    assert.match(secondState.threadText, /second browser parallel session message/);
    assert.match(secondState.threadText, /browser output: second browser parallel session message/);
    assert.doesNotMatch(secondState.threadText, /first browser parallel session message/);
    assert.doesNotMatch(secondState.threadText, /browser output: first browser parallel session message/);
    await saveBrowserScreenshot({
      browser,
      artifactName: "friend-parallel-session-second",
    });

    await switchFriendSession(browser, firstSessionId);
    await browser.waitForExpression("document.querySelector('#chat-thread')?.textContent.includes('browser output: first browser parallel session message')");
    const firstState = await friendBrowserState(browser);
    assert.match(firstState.threadText, /first browser parallel session message/);
    assert.match(firstState.threadText, /browser output: first browser parallel session message/);
    assert.doesNotMatch(firstState.threadText, /second browser parallel session message/);
    assert.doesNotMatch(firstState.threadText, /browser output: second browser parallel session message/);
    await saveBrowserScreenshot({
      browser,
      artifactName: "friend-parallel-session-first",
    });

    assert.deepEqual(browser.consoleErrors, []);
    assert.deepEqual(browser.exceptions, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("friend browser preserves the user message and hides internal error details on task request failure", {
  skip: !findChromePath() ? "Chrome is required" : false,
}, async () => {
  const bootstrapSecret = "test-bootstrap-secret";
  const server = createProductizedShareServer({
    tokenFactory: () => "local-friend",
    hostBootstrapSecret: bootstrapSecret,
  });
  await server.listen(0);
  const baseUrl = server.url();
  let browser: Awaited<ReturnType<typeof launchChrome>> | undefined;

  try {
    browser = await launchChrome();
    await createBrowserFriendFixture({ baseUrl, bootstrapSecret, fetch: server.fetch });
    await openFriendChat(browser, baseUrl);
    await browser.evaluate(`
      (() => {
        const originalFetch = window.fetch.bind(window);
        window.fetch = (url, init) => {
          if (String(url).endsWith('/v1/share/local-friend/tasks') && init?.method === 'POST') {
            return Promise.reject(new TypeError('network down: internal details'));
          }
          return originalFetch(url, init);
        };
        return true;
      })()
    `);

    await submitFriendPrompt(browser, "browser message should survive network failure");
    await browser.waitForExpression("document.querySelector('#chat-status')?.textContent === '提交失败'");

    const state = await friendBrowserState(browser);
    assert.match(state.threadText, /browser message should survive network failure/);
    assert.match(state.threadText, /任务提交失败，请稍后重试/);
    assert.doesNotMatch(state.threadText, /network down|internal details|TypeError/);
    assert.equal(/cost|budget|tokenHash|deviceKey|bootstrap|模型价格/.test(state.threadText), false);
    await saveBrowserScreenshot({
      browser,
      artifactName: "friend-friendly-failure",
    });

    assert.deepEqual(browser.consoleErrors, []);
    assert.deepEqual(browser.exceptions, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});

async function createBrowserFriendFixture(input: {
  baseUrl: string;
  bootstrapSecret: string;
  fetch: ProductizedFetch;
}): Promise<BrowserFixture> {
  const registered = await input.fetch(`${input.baseUrl}/v1/hosts/register`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ralphloop-bootstrap-secret": input.bootstrapSecret,
    },
    body: JSON.stringify({
      ownerId: "owner-1",
      hostId: "host-1",
      deviceName: "Friend Browser Behavior QA Host",
      hostVersion: "0.2.0",
      supportedAdapters: ["opencode"],
      capabilities: ["outbound_commands"],
    }),
  });
  const registeredBody = await registered.json() as { deviceKey: string };
  assert.equal(registered.status, 201);

  const created = await input.fetch(`${input.baseUrl}/v1/owner/share-links`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ownerId: "owner-1",
      hostId: "host-1",
      name: "Ralphloop Friend Browser Behavior Agent",
      policy: { maxConcurrentSessions: 2 },
    }),
  });
  assert.equal(created.status, 201);

  return {
    baseUrl: input.baseUrl,
    deviceKey: registeredBody.deviceKey,
    fetch: input.fetch,
  };
}

function browserEchoAdapter(): AgentAdapter {
  const promptsByTaskId = new Map<string, string>();
  return {
    async detect() {
      throw new Error("detect not used");
    },
    async start(startInput) {
      return {
        adapterId: startInput.adapterId,
        runtimeId: `${startInput.adapterId}:browser-behavior-runtime`,
        status: "running",
      };
    },
    async submitTask(taskInput) {
      const taskId = taskInput.taskId ?? crypto.randomUUID();
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
      yield {
        type: "task.output",
        taskId: streamInput.task.taskId,
        text: `browser output: ${prompt}`,
      };
      yield { type: "task.completed", taskId: streamInput.task.taskId };
    },
    async stop() {
      // No persistent process in this deterministic browser QA adapter.
    },
  };
}

async function openFriendChat(browser: Awaited<ReturnType<typeof launchChrome>>, baseUrl: string) {
  await browser.navigate(`${baseUrl}/app/share/local-friend/classic`);
  await browser.waitForExpression("Boolean(document.querySelector('[data-testid=\"friend-chat-shell\"]'))");
  await browser.waitForExpression("document.querySelector('#chat-status')?.textContent === '等待消息'");
  await browser.waitForExpression("document.querySelectorAll('[data-testid=\"friend-session-item\"]').length === 1");
}

async function submitFriendPrompt(browser: Awaited<ReturnType<typeof launchChrome>>, promptValue: string) {
  await browser.evaluate(`
    (() => {
      const prompt = document.querySelector('#chat-prompt');
      prompt.value = ${JSON.stringify(promptValue)};
      prompt.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#chat-form').requestSubmit();
      return true;
    })()
  `);
}

async function processHostCommands(input: {
  fixture: BrowserFixture;
  runtimeState: ReturnType<typeof createHostClientRuntimeState>;
  adapters: Record<string, AgentAdapter>;
  expectedCommands: number;
}) {
  let processed = 0;
  const startedAt = Date.now();
  while (processed < input.expectedCommands && Date.now() - startedAt < 5_000) {
    processed += await runHostCommandOnce({
      relayBaseUrl: input.fixture.baseUrl,
      hostId: "host-1",
      deviceKey: input.fixture.deviceKey,
      adapters: input.adapters,
      fetch: input.fixture.fetch,
      runtimeState: input.runtimeState,
    });
    if (processed < input.expectedCommands) {
      await delay(50);
    }
  }
  assert.equal(processed, input.expectedCommands);
}

async function activeFriendSessionId(browser: Awaited<ReturnType<typeof launchChrome>>) {
  return await browser.evaluate<string>(`
    (() => localStorage.getItem('ralphloop:friend:sessions:local-friend:active') || '')()
  `);
}

async function switchFriendSession(browser: Awaited<ReturnType<typeof launchChrome>>, sessionId: string) {
  await browser.evaluate(`
    (() => {
      document.querySelector('[data-session-id="${sessionId}"]')?.click();
      return true;
    })()
  `);
}

async function friendBrowserState(browser: Awaited<ReturnType<typeof launchChrome>>) {
  return await browser.evaluate<{
    status: string;
    threadHtml: string;
    threadText: string;
    sessionCount: number;
    outputCount: number;
  }>(`
    (() => ({
      status: document.querySelector('#chat-status')?.textContent || '',
      threadHtml: document.querySelector('#chat-thread')?.innerHTML || '',
      threadText: document.querySelector('#chat-thread')?.textContent || '',
      sessionCount: document.querySelectorAll('[data-testid="friend-session-item"]').length,
      outputCount: Array.from(document.querySelectorAll('#chat-thread [data-event-type]'))
        .filter((element) => element.getAttribute('data-event-type') === 'task.output')
        .length,
    }))()
  `);
}
