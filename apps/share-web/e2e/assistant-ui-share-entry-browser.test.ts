import assert from "node:assert/strict";
import { test } from "node:test";

import type { AgentAdapter } from "../../share-gateway/src/adapters/types.ts";
import { createHostClientRuntimeState, runHostCommandOnce } from "../../share-gateway/src/productization/hostClient.ts";
import { createProductizedShareServer } from "../../share-gateway/src/productization/httpServer.ts";
import {
  assertNoDocumentHorizontalOverflow,
  assertRectInsideViewport,
  findChromePath,
  launchChrome,
  type BrowserRect,
} from "./browserHarness.ts";

type AssistantUiLayoutMetrics = {
  viewport: { width: number; height: number };
  document: { scrollWidth: number; clientWidth: number };
  shell: BrowserRect;
  rail: BrowserRect;
  panel: BrowserRect;
  messageList: BrowserRect;
  preview: BrowserRect;
  layout: string;
  status: string;
  messageCount: string;
  threadCount: string;
  previewHidden: string;
  previewOpen: boolean;
  previewPointerEvents: string;
  hasPreviewToggle: boolean;
  hasUserBubble: boolean;
  hasAssistantBubble: boolean;
  visiblePrompt: boolean;
  visibleOutput: boolean;
  leaks: boolean;
};

test("assistant-ui share entry renders a productized chatbot layout in browser", {
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
    const target = await createAssistantUiShareFixture({ baseUrl, bootstrapSecret, fetch: server.fetch });

    await browser.setViewport({ width: 1440, height: 1000, mobile: false });
    await browser.navigate(target.url);
    await browser.waitForExpression("Boolean(document.querySelector('[data-ralphloop-assistant-ui-shell=\"true\"]'))");
    const desktop = await browser.evaluate<AssistantUiLayoutMetrics>(assistantUiLayoutProbe(target.prompt));
    assertAssistantUiDesktopLayout(desktop);
    assertAssistantUiPreviewClosed(desktop);
    await browser.evaluate(`
      (() => {
        document.querySelector('#assistant-ui-preview-toggle')?.click();
        return true;
      })()
    `);
    await browser.waitForExpression("document.querySelector('#assistant-ui-preview-drawer')?.classList.contains('is-open')");
    await browser.waitForExpression("(() => { const rect = document.querySelector('#assistant-ui-preview-drawer')?.getBoundingClientRect(); return Boolean(rect && rect.right <= window.innerWidth + 1 && rect.left >= -1); })()");
    const desktopPreviewOpen = await browser.evaluate<AssistantUiLayoutMetrics>(assistantUiLayoutProbe(target.prompt));
    assertAssistantUiPreviewOpen(desktopPreviewOpen);
    await browser.evaluate(`
      (() => {
        document.querySelector('#assistant-ui-preview-close')?.click();
        return true;
      })()
    `);
    await browser.waitForExpression("document.querySelector('#assistant-ui-preview-drawer')?.getAttribute('aria-hidden') === 'true'");
    const desktopScreenshot = await browser.captureScreenshot();
    assert.ok(desktopScreenshot.length > 10_000);

    await browser.setViewport({ width: 390, height: 844, mobile: true });
    await browser.navigate(target.url);
    await browser.waitForExpression("Boolean(document.querySelector('[data-ralphloop-assistant-ui-shell=\"true\"]'))");
    const mobile = await browser.evaluate<AssistantUiLayoutMetrics>(assistantUiLayoutProbe(target.prompt));
    assertAssistantUiMobileLayout(mobile);
    const mobileScreenshot = await browser.captureScreenshot();
    assert.ok(mobileScreenshot.length > 10_000);

    assert.deepEqual(browser.consoleErrors, []);
    assert.deepEqual(browser.exceptions, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("assistant-ui share entry can send a follow-up message through the host runtime", {
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

  try {
    browser = await launchChrome();
    const target = await createAssistantUiShareFixture({ baseUrl, bootstrapSecret, fetch: server.fetch });
    await browser.navigate(target.url);
    await browser.waitForExpression("Boolean(document.querySelector('[data-ralphloop-assistant-ui-shell=\"true\"]'))");
    await browser.waitForExpression("Boolean(document.querySelector('#assistant-ui-composer-input'))");

    const followUp = "Continue from assistant-ui page";
    await browser.evaluate(`
      (() => {
        const input = document.querySelector('#assistant-ui-composer-input');
        input.value = ${JSON.stringify(followUp)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('#assistant-ui-composer-form').requestSubmit();
        return true;
      })()
    `);
    await browser.waitForExpression(`document.body.textContent.includes(${JSON.stringify(followUp)})`);

    const processed = await runHostCommandOnce({
      relayBaseUrl: baseUrl,
      hostId: "host-1",
      deviceKey: target.deviceKey,
      adapters: { opencode: assistantUiFollowUpAdapter() },
      fetch: server.fetch,
      runtimeState,
    });
    assert.equal(processed, 1);

    await browser.waitForExpression(
      "document.body.textContent.includes('assistant-ui follow-up output: Continue from assistant-ui page')",
      5_000,
    );
    const state = await browser.evaluate<{
      messageCount: string;
      status: string;
      text: string;
      sendDisabled: boolean;
      leaks: boolean;
    }>(`
      (() => {
        const shell = document.querySelector('[data-ralphloop-assistant-ui-shell="true"]');
        const panel = document.querySelector('[data-assistant-ui-thread="true"]');
        const html = document.documentElement.innerHTML;
        return {
          messageCount: shell?.getAttribute('data-message-count') || '',
          status: panel?.getAttribute('data-assistant-ui-thread-status') || '',
          text: document.body.textContent || '',
          sendDisabled: document.querySelector('#assistant-ui-send')?.disabled === true,
          leaks: /cost|budget|tokenHash|deviceKey|bootstrap|模型价格/.test(html),
        };
      })()
    `);

    assert.equal(state.messageCount, "4", state.text);
    assert.equal(state.status, "completed");
    assert.equal(state.sendDisabled, false);
    assert.match(state.text, /Check assistant-ui productized browser layout/);
    assert.match(state.text, /Assistant UI browser layout output\./);
    assert.match(state.text, /Continue from assistant-ui page/);
    assert.match(state.text, /assistant-ui follow-up output: Continue from assistant-ui page/);
    assert.equal(state.leaks, false);
    assert.deepEqual(browser.consoleErrors, []);
    assert.deepEqual(browser.exceptions, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("assistant-ui default share link can send the first message without keeping a preview thread", {
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

  try {
    browser = await launchChrome();
    const fixture = await createBareAssistantUiShareFixture({ baseUrl, bootstrapSecret, fetch: server.fetch });
    await browser.navigate(`${baseUrl}/app/share/local-friend`);
    await browser.waitForExpression("window.location.pathname.endsWith('/app/share/local-friend/assistant-ui')");
    await browser.waitForExpression("Boolean(document.querySelector('#assistant-ui-composer-input'))");

    const firstPrompt = "Start from the default assistant-ui share link";
    await browser.evaluate(`
      (() => {
        const input = document.querySelector('#assistant-ui-composer-input');
        input.value = ${JSON.stringify(firstPrompt)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('#assistant-ui-composer-form').requestSubmit();
        return true;
      })()
    `);
    await browser.waitForExpression(`document.body.textContent.includes(${JSON.stringify(firstPrompt)})`);

    const processed = await runHostCommandOnce({
      relayBaseUrl: baseUrl,
      hostId: "host-1",
      deviceKey: fixture.deviceKey,
      adapters: { opencode: assistantUiFollowUpAdapter() },
      fetch: server.fetch,
      runtimeState,
    });
    assert.equal(processed, 1);
    await browser.waitForExpression(
      "document.body.textContent.includes('assistant-ui follow-up output: Start from the default assistant-ui share link')",
      5_000,
    );

    const state = await browser.evaluate<{
      messageCount: string;
      threadCount: string;
      currentThreadId: string;
      status: string;
      text: string;
      railLabels: string[];
      sendDisabled: boolean;
      url: string;
      storedThreads: string;
      leaks: boolean;
    }>(`
      (() => {
        const base = ${assistantUiThreadStateProbe()};
        return {
          ...base,
          url: window.location.href,
          storedThreads: localStorage.getItem('ralphloop:assistant-ui:threads:local-friend') || '',
        };
      })()
    `);
    assert.equal(state.threadCount, "1", state.text);
    assert.equal(state.messageCount, "2", state.text);
    assert.equal(state.status, "completed");
    assert.equal(state.sendDisabled, false);
    assert.notEqual(state.currentThreadId, "assistant-ui-preview");
    assert.match(state.url, /sessionId=/);
    assert.doesNotMatch(state.url, /assistant-ui-preview/);
    assert.deepEqual(state.railLabels, ["Start from the default assistant"]);
    assert.match(state.text, /Start from the default assistant-ui share link/);
    assert.match(state.text, /assistant-ui follow-up output: Start from the default assistant-ui share link/);
    assert.doesNotMatch(state.storedThreads, /assistant-ui-preview/);
    assert.equal(state.leaks, false);
    assert.deepEqual(browser.consoleErrors, []);
    assert.deepEqual(browser.exceptions, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("assistant-ui share entry shows an Agent loading message while a follow-up is running", {
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

  try {
    browser = await launchChrome();
    const target = await createAssistantUiShareFixture({ baseUrl, bootstrapSecret, fetch: server.fetch });
    await browser.navigate(target.url);
    await browser.waitForExpression("Boolean(document.querySelector('#assistant-ui-composer-input'))");

    const followUp = "Show assistant-ui loading while real output is pending";
    await browser.evaluate(`
      (() => {
        const input = document.querySelector('#assistant-ui-composer-input');
        input.value = ${JSON.stringify(followUp)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('#assistant-ui-composer-form').requestSubmit();
        return true;
      })()
    `);
    await browser.waitForExpression(`document.body.textContent.includes(${JSON.stringify(followUp)})`);
    await browser.waitForExpression("document.querySelector('[data-assistant-ui-thread=\"true\"]')?.getAttribute('data-assistant-ui-thread-status') === 'running'");

    const running = await browser.evaluate<{
      messageCount: string;
      status: string;
      text: string;
      loadingCount: number;
      sendDisabled: boolean;
      stopDisabled: boolean;
      leaks: boolean;
      messages: string[];
    }>(`
      (() => {
        const shell = document.querySelector('[data-ralphloop-assistant-ui-shell="true"]');
        const panel = document.querySelector('[data-assistant-ui-thread="true"]');
        const html = document.documentElement.innerHTML;
        return {
          messageCount: shell?.getAttribute('data-message-count') || '',
          status: panel?.getAttribute('data-assistant-ui-thread-status') || '',
          text: document.body.textContent || '',
          loadingCount: document.querySelectorAll('.assistant-ui-message-loading').length,
          sendDisabled: document.querySelector('#assistant-ui-send')?.disabled === true,
          stopDisabled: document.querySelector('#assistant-ui-stop')?.disabled === true,
          leaks: /cost|budget|tokenHash|deviceKey|bootstrap|模型价格/.test(html),
          messages: Array.from(document.querySelectorAll('.assistant-ui-message')).map((item) => item.textContent || ''),
        };
      })()
    `);

    assert.equal(running.status, "running");
    assert.equal(running.messageCount, "4", running.text);
    assert.equal(running.loadingCount, 1);
    assert.equal(running.sendDisabled, true);
    assert.equal(running.stopDisabled, false);
    assert.match(running.text, /Check assistant-ui productized browser layout/);
    assert.match(running.text, /Assistant UI browser layout output\./);
    assert.match(running.text, /Show assistant-ui loading while real output is pending/);
    assert.match(running.messages.join("\n"), /Agent 正在处理/);
    assert.equal(running.leaks, false);

    const processed = await runHostCommandOnce({
      relayBaseUrl: baseUrl,
      hostId: "host-1",
      deviceKey: target.deviceKey,
      adapters: { opencode: assistantUiFollowUpAdapter() },
      fetch: server.fetch,
      runtimeState,
    });
    assert.equal(processed, 1);

    await browser.waitForExpression(
      "document.body.textContent.includes('assistant-ui follow-up output: Show assistant-ui loading while real output is pending')",
      5_000,
    );
    const completed = await browser.evaluate<{
      messageCount: string;
      status: string;
      text: string;
      loadingCount: number;
      sendDisabled: boolean;
      leaks: boolean;
      messages: string[];
    }>(`
      (() => {
        const shell = document.querySelector('[data-ralphloop-assistant-ui-shell="true"]');
        const panel = document.querySelector('[data-assistant-ui-thread="true"]');
        const html = document.documentElement.innerHTML;
        return {
          messageCount: shell?.getAttribute('data-message-count') || '',
          status: panel?.getAttribute('data-assistant-ui-thread-status') || '',
          text: document.body.textContent || '',
          loadingCount: document.querySelectorAll('.assistant-ui-message-loading').length,
          sendDisabled: document.querySelector('#assistant-ui-send')?.disabled === true,
          leaks: /cost|budget|tokenHash|deviceKey|bootstrap|模型价格/.test(html),
          messages: Array.from(document.querySelectorAll('.assistant-ui-message')).map((item) => item.textContent || ''),
        };
      })()
    `);

    assert.equal(completed.status, "completed");
    assert.equal(completed.messageCount, "4", completed.text);
    assert.equal(completed.loadingCount, 0);
    assert.equal(completed.sendDisabled, false);
    assert.match(completed.text, /assistant-ui follow-up output: Show assistant-ui loading while real output is pending/);
    assert.doesNotMatch(completed.messages.join("\n"), /Agent 正在处理/);
    assert.equal(completed.leaks, false);
    assert.deepEqual(browser.consoleErrors, []);
    assert.deepEqual(browser.exceptions, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("assistant-ui share entry recovers when running follow-up events become unavailable", {
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
    const target = await createAssistantUiShareFixture({ baseUrl, bootstrapSecret, fetch: server.fetch });
    await browser.navigate(target.url);
    await browser.waitForExpression("Boolean(document.querySelector('#assistant-ui-composer-input'))");
    await browser.evaluate(`
      (() => {
        const originalFetch = window.fetch.bind(window);
        window.fetch = (url, init) => {
          const urlText = String(url);
          if (urlText.includes('/v1/share/local-friend/events?') && (!init || !init.method || init.method === 'GET')) {
            return Promise.resolve(new Response(JSON.stringify({
              events: [],
              available: false,
              error: 'events_unavailable',
            }), {
              status: 404,
              headers: { 'content-type': 'application/json' },
            }));
          }
          return originalFetch(url, init);
        };
        return true;
      })()
    `);

    const followUp = "Recover when assistant-ui event history disappears";
    await browser.evaluate(`
      (() => {
        const input = document.querySelector('#assistant-ui-composer-input');
        input.value = ${JSON.stringify(followUp)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('#assistant-ui-composer-form').requestSubmit();
        return true;
      })()
    `);
    await browser.waitForExpression(`document.body.textContent.includes(${JSON.stringify(followUp)})`);
    await browser.waitForExpression(
      "document.querySelector('[data-assistant-ui-thread=\"true\"]')?.getAttribute('data-assistant-ui-thread-status') === 'failed'",
      3_000,
    );
    await browser.waitForExpression("document.body.textContent.includes('当前会话已失效，请新建会话后重试。')");
    await browser.waitForExpression("document.querySelector('#assistant-ui-send')?.disabled === false");

    const state = await browser.evaluate<{
      messageCount: string;
      status: string;
      text: string;
      loadingCount: number;
      sendDisabled: boolean;
      stopDisabled: boolean;
      leaks: boolean;
      messages: string[];
    }>(`
      (() => {
        const shell = document.querySelector('[data-ralphloop-assistant-ui-shell="true"]');
        const panel = document.querySelector('[data-assistant-ui-thread="true"]');
        const html = document.documentElement.innerHTML;
        return {
          messageCount: shell?.getAttribute('data-message-count') || '',
          status: panel?.getAttribute('data-assistant-ui-thread-status') || '',
          text: document.body.textContent || '',
          loadingCount: document.querySelectorAll('.assistant-ui-message-loading').length,
          sendDisabled: document.querySelector('#assistant-ui-send')?.disabled === true,
          stopDisabled: document.querySelector('#assistant-ui-stop')?.disabled === true,
          leaks: /cost|budget|tokenHash|deviceKey|bootstrap|模型价格/.test(html),
          messages: Array.from(document.querySelectorAll('.assistant-ui-message')).map((item) => item.textContent || ''),
        };
      })()
    `);

    assert.equal(state.status, "failed");
    assert.equal(state.messageCount, "4", state.text);
    assert.equal(state.loadingCount, 0);
    assert.equal(state.sendDisabled, false);
    assert.equal(state.stopDisabled, true);
    assert.match(state.text, /Check assistant-ui productized browser layout/);
    assert.match(state.text, /Assistant UI browser layout output\./);
    assert.match(state.text, /Recover when assistant-ui event history disappears/);
    assert.match(state.messages.join("\n"), /当前会话已失效，请新建会话后重试。/);
    assert.doesNotMatch(state.messages.join("\n"), /Agent 正在处理/);
    assert.doesNotMatch(state.messages.join("\n"), /events_unavailable|404|not_found/);
    assert.equal(state.leaks, false);
    assert.deepEqual(browser.consoleErrors, []);
    assert.deepEqual(browser.exceptions, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("assistant-ui share entry explains stale session URLs after reload", {
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
    await createAssistantUiShareFixture({ baseUrl, bootstrapSecret, fetch: server.fetch });
    const staleSessionId = crypto.randomUUID();
    const staleTaskId = crypto.randomUUID();
    await browser.navigate(`${baseUrl}/app/share/local-friend/assistant-ui?sessionId=${staleSessionId}&taskId=${staleTaskId}`);
    await browser.waitForExpression("Boolean(document.querySelector('[data-ralphloop-assistant-ui-shell=\"true\"]'))");
    await browser.waitForExpression(
      "document.querySelector('[data-assistant-ui-thread=\"true\"]')?.getAttribute('data-assistant-ui-thread-status') === 'failed'",
      3_000,
    );
    await browser.waitForExpression("document.body.textContent.includes('当前会话已失效，请新建会话后重试。')");

    const state = await browser.evaluate<{
      messageCount: string;
      status: string;
      loadingCount: number;
      sendDisabled: boolean;
      stopDisabled: boolean;
      currentThreadId: string;
      currentUrl: string;
      messages: string[];
      leaks: boolean;
    }>(`
      (() => {
        const shell = document.querySelector('[data-ralphloop-assistant-ui-shell="true"]');
        const panel = document.querySelector('[data-assistant-ui-thread="true"]');
        const html = document.documentElement.innerHTML;
        return {
          messageCount: shell?.getAttribute('data-message-count') || '',
          status: panel?.getAttribute('data-assistant-ui-thread-status') || '',
          loadingCount: document.querySelectorAll('.assistant-ui-message-loading').length,
          sendDisabled: document.querySelector('#assistant-ui-send')?.disabled === true,
          stopDisabled: document.querySelector('#assistant-ui-stop')?.disabled === true,
          currentThreadId: shell?.getAttribute('data-current-thread-id') || '',
          currentUrl: window.location.href,
          messages: Array.from(document.querySelectorAll('.assistant-ui-message')).map((item) => item.textContent || ''),
          leaks: /cost|budget|tokenHash|deviceKey|bootstrap|模型价格/.test(html),
        };
      })()
    `);

    assert.equal(state.status, "failed");
    assert.equal(state.messageCount, "1");
    assert.equal(state.loadingCount, 0);
    assert.equal(state.sendDisabled, false);
    assert.equal(state.stopDisabled, true);
    assert.equal(state.currentThreadId, staleSessionId);
    assert.equal(new URL(state.currentUrl).searchParams.has("taskId"), false);
    assert.match(state.messages.join("\n"), /当前会话已失效，请新建会话后重试。/);
    assert.doesNotMatch(state.messages.join("\n"), /events_unavailable|404|not_found/);
    assert.equal(state.leaks, false);
    assert.deepEqual(browser.consoleErrors, []);
    assert.deepEqual(browser.exceptions, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("assistant-ui share entry preserves the user message on task request failure", {
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
    const target = await createAssistantUiShareFixture({ baseUrl, bootstrapSecret, fetch: server.fetch });
    await browser.navigate(target.url);
    await browser.waitForExpression("Boolean(document.querySelector('#assistant-ui-composer-input'))");
    await browser.evaluate(`
      (() => {
        const originalFetch = window.fetch.bind(window);
        window.fetch = (url, init) => {
          if (String(url).endsWith('/v1/share/local-friend/tasks') && init?.method === 'POST') {
            return Promise.reject(new TypeError('assistant-ui network down: internal details'));
          }
          return originalFetch(url, init);
        };
        return true;
      })()
    `);

    const failingPrompt = "assistant-ui message should survive network failure";
    await browser.evaluate(`
      (() => {
        const input = document.querySelector('#assistant-ui-composer-input');
        input.value = ${JSON.stringify(failingPrompt)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('#assistant-ui-composer-form').requestSubmit();
        return true;
      })()
    `);

    await browser.waitForExpression("document.querySelector('[data-assistant-ui-thread=\"true\"]')?.getAttribute('data-assistant-ui-thread-status') === 'failed'");
    await browser.waitForExpression("document.body.textContent.includes('任务提交失败，请稍后重试。')");
    await browser.waitForExpression("document.querySelector('#assistant-ui-send')?.disabled === false");
    const state = await browser.evaluate<{
      messageCount: string;
      status: string;
      text: string;
      sendDisabled: boolean;
      leaks: boolean;
    }>(assistantUiThreadStateProbe());

    assert.equal(state.messageCount, "4", state.text);
    assert.equal(state.status, "failed");
    assert.equal(state.sendDisabled, false);
    assert.match(state.text, /Check assistant-ui productized browser layout/);
    assert.match(state.text, /Assistant UI browser layout output\./);
    assert.match(state.text, /assistant-ui message should survive network failure/);
    assert.match(state.text, /任务提交失败，请稍后重试。/);
    assert.doesNotMatch(state.text, /network down|internal details|TypeError/);
    assert.equal(state.leaks, false);
    assert.deepEqual(browser.consoleErrors, []);
    assert.deepEqual(browser.exceptions, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("assistant-ui share entry can stop a running follow-up through the host runtime", {
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
  const calls: string[] = [];
  const started = deferred<void>();

  try {
    browser = await launchChrome();
    const target = await createAssistantUiShareFixture({ baseUrl, bootstrapSecret, fetch: server.fetch });
    await browser.navigate(target.url);
    await browser.waitForExpression("Boolean(document.querySelector('#assistant-ui-composer-input'))");

    const followUp = "Stop this assistant-ui follow-up";
    await browser.evaluate(`
      (() => {
        const input = document.querySelector('#assistant-ui-composer-input');
        input.value = ${JSON.stringify(followUp)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('#assistant-ui-composer-form').requestSubmit();
        return true;
      })()
    `);
    await browser.waitForExpression(`document.body.textContent.includes(${JSON.stringify(followUp)})`);
    await browser.waitForExpression("document.querySelector('[data-assistant-ui-thread=\"true\"]')?.getAttribute('data-assistant-ui-thread-status') === 'running'");
    await browser.waitForExpression("document.querySelector('#assistant-ui-stop')?.disabled === false");

    const taskRun = runHostCommandOnce({
      relayBaseUrl: baseUrl,
      hostId: "host-1",
      deviceKey: target.deviceKey,
      adapters: {
        opencode: runningUntilAssistantUiCancelAdapter({
          calls,
          onTaskStarted: started.resolve,
        }),
      },
      fetch: server.fetch,
      runtimeState,
    });
    await started.promise;

    await browser.evaluate(`
      (() => {
        document.querySelector('#assistant-ui-stop').click();
        return true;
      })()
    `);
    await browser.waitForExpression("document.querySelector('[data-assistant-ui-thread=\"true\"]')?.getAttribute('data-assistant-ui-thread-status') === 'cancelled'");

    const cancelRun = await runHostCommandOnce({
      relayBaseUrl: baseUrl,
      hostId: "host-1",
      deviceKey: target.deviceKey,
      adapters: { opencode: assistantUiFollowUpAdapter() },
      fetch: server.fetch,
      runtimeState,
    });
    const taskRunCount = await taskRun;
    assert.equal(taskRunCount, 1);
    assert.equal(cancelRun, 1);

    await browser.waitForExpression("document.body.textContent.includes('任务已取消')");
    await browser.waitForExpression("document.querySelector('#assistant-ui-send')?.disabled === false");
    const state = await browser.evaluate<{
      messageCount: string;
      status: string;
      text: string;
      stopDisabled: boolean;
      sendDisabled: boolean;
      leaks: boolean;
      messages: string[];
    }>(`
      (() => {
        const shell = document.querySelector('[data-ralphloop-assistant-ui-shell="true"]');
        const panel = document.querySelector('[data-assistant-ui-thread="true"]');
        const html = document.documentElement.innerHTML;
        return {
          messageCount: shell?.getAttribute('data-message-count') || '',
          status: panel?.getAttribute('data-assistant-ui-thread-status') || '',
          text: document.body.textContent || '',
          stopDisabled: document.querySelector('#assistant-ui-stop')?.disabled === true,
          sendDisabled: document.querySelector('#assistant-ui-send')?.disabled === true,
          leaks: /cost|budget|tokenHash|deviceKey|bootstrap|模型价格/.test(html),
          messages: Array.from(document.querySelectorAll('.assistant-ui-message')).map((item) => item.textContent || ''),
        };
      })()
    `);

    assert.equal(state.status, "cancelled");
    assert.equal(state.stopDisabled, true);
    assert.equal(state.sendDisabled, false);
    assert.match(state.text, /Check assistant-ui productized browser layout/);
    assert.match(state.text, /Assistant UI browser layout output\./);
    assert.match(state.text, /Stop this assistant-ui follow-up/);
    assert.match(state.text, /任务已取消/);
    assert.doesNotMatch(state.text, /should not complete after assistant-ui stop/);
    assert.deepEqual(state.messages, [
      "YouCheck assistant-ui productized browser layout",
      "AgentAssistant UI browser layout output.",
      "YouStop this assistant-ui follow-up",
      "Agent任务已取消。",
    ]);
    assert.equal(state.messageCount, "4");
    assert.equal(state.leaks, false);
    assert.deepEqual(calls, [
      "start:opencode",
      "submit:Stop this assistant-ui follow-up",
      "stop:opencode:assistant-ui-running-runtime:friend_cancelled",
      "submit-aborted",
    ]);
    assert.deepEqual(browser.consoleErrors, []);
    assert.deepEqual(browser.exceptions, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("assistant-ui share entry can cancel a running follow-up with Escape", {
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
    const target = await createAssistantUiShareFixture({ baseUrl, bootstrapSecret, fetch: server.fetch });
    await browser.navigate(target.url);
    await browser.waitForExpression("Boolean(document.querySelector('#assistant-ui-composer-input'))");

    const followUp = "Cancel this assistant-ui follow-up with Escape";
    await browser.evaluate(`
      (() => {
        const input = document.querySelector('#assistant-ui-composer-input');
        input.value = ${JSON.stringify(followUp)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('#assistant-ui-composer-form').requestSubmit();
        return true;
      })()
    `);
    await browser.waitForExpression(`document.body.textContent.includes(${JSON.stringify(followUp)})`);
    await browser.waitForExpression("document.querySelector('[data-assistant-ui-thread=\"true\"]')?.getAttribute('data-assistant-ui-thread-status') === 'running'");
    await browser.waitForExpression("document.querySelector('#assistant-ui-stop')?.disabled === false");

    await browser.evaluate(`
      (() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        return true;
      })()
    `);
    await browser.waitForExpression("document.querySelector('[data-assistant-ui-thread=\"true\"]')?.getAttribute('data-assistant-ui-thread-status') === 'cancelled'");
    await browser.waitForExpression("document.body.textContent.includes('任务已取消')");
    await browser.waitForExpression("document.querySelector('#assistant-ui-send')?.disabled === false");

    const state = await browser.evaluate<{
      messageCount: string;
      status: string;
      text: string;
      stopDisabled: boolean;
      sendDisabled: boolean;
      leaks: boolean;
      messages: string[];
    }>(`
      (() => {
        const shell = document.querySelector('[data-ralphloop-assistant-ui-shell="true"]');
        const panel = document.querySelector('[data-assistant-ui-thread="true"]');
        const html = document.documentElement.innerHTML;
        return {
          messageCount: shell?.getAttribute('data-message-count') || '',
          status: panel?.getAttribute('data-assistant-ui-thread-status') || '',
          text: document.body.textContent || '',
          stopDisabled: document.querySelector('#assistant-ui-stop')?.disabled === true,
          sendDisabled: document.querySelector('#assistant-ui-send')?.disabled === true,
          leaks: /cost|budget|tokenHash|deviceKey|bootstrap|模型价格/.test(html),
          messages: Array.from(document.querySelectorAll('.assistant-ui-message')).map((item) => item.textContent || ''),
        };
      })()
    `);

    assert.equal(state.status, "cancelled");
    assert.equal(state.stopDisabled, true);
    assert.equal(state.sendDisabled, false);
    assert.equal(state.messageCount, "4", state.text);
    assert.match(state.text, /Check assistant-ui productized browser layout/);
    assert.match(state.text, /Assistant UI browser layout output\./);
    assert.match(state.text, /Cancel this assistant-ui follow-up with Escape/);
    assert.match(state.text, /任务已取消/);
    assert.deepEqual(state.messages, [
      "YouCheck assistant-ui productized browser layout",
      "AgentAssistant UI browser layout output.",
      "YouCancel this assistant-ui follow-up with Escape",
      "Agent任务已取消。",
    ]);
    assert.equal(state.leaks, false);
    assert.deepEqual(browser.consoleErrors, []);
    assert.deepEqual(browser.exceptions, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("assistant-ui share entry can create and switch real friend sessions", {
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

  try {
    browser = await launchChrome();
    const target = await createAssistantUiShareFixture({ baseUrl, bootstrapSecret, fetch: server.fetch });
    await browser.navigate(target.url);
    await browser.waitForExpression("Boolean(document.querySelector('.assistant-ui-new-thread'))");

    await browser.evaluate(`
      (() => {
        document.querySelector('.assistant-ui-new-thread').click();
        return true;
      })()
    `);
    await browser.waitForExpression("document.querySelector('[data-ralphloop-assistant-ui-shell=\"true\"]')?.getAttribute('data-thread-count') === '2'");
    await browser.waitForExpression(
      `document.querySelector('[data-ralphloop-assistant-ui-shell="true"]')?.getAttribute('data-current-thread-id') !== ${JSON.stringify(target.sessionId)}`,
    );

    const newThreadPrompt = "Message in a brand new assistant-ui session";
    await browser.evaluate(`
      (() => {
        const input = document.querySelector('#assistant-ui-composer-input');
        input.value = ${JSON.stringify(newThreadPrompt)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('#assistant-ui-composer-form').requestSubmit();
        return true;
      })()
    `);
    await browser.waitForExpression(`document.body.textContent.includes(${JSON.stringify(newThreadPrompt)})`);

    const processed = await runHostCommandOnce({
      relayBaseUrl: baseUrl,
      hostId: "host-1",
      deviceKey: target.deviceKey,
      adapters: { opencode: assistantUiFollowUpAdapter() },
      fetch: server.fetch,
      runtimeState,
    });
    assert.equal(processed, 1);
    await browser.waitForExpression(
      "document.body.textContent.includes('assistant-ui follow-up output: Message in a brand new assistant-ui session')",
      5_000,
    );

    const newThreadState = await browser.evaluate<{
      messageCount: string;
      threadCount: string;
      currentThreadId: string;
      status: string;
      text: string;
      railLabels: string[];
      leaks: boolean;
    }>(assistantUiThreadStateProbe());
    assert.equal(newThreadState.threadCount, "2");
    assert.notEqual(newThreadState.currentThreadId, target.sessionId);
    assert.equal(newThreadState.messageCount, "2", newThreadState.text);
    assert.equal(newThreadState.status, "completed");
    assert.match(newThreadState.text, /Message in a brand new assistant-ui session/);
    assert.match(newThreadState.text, /assistant-ui follow-up output: Message in a brand new assistant-ui session/);
    assert.doesNotMatch(newThreadState.text, /Assistant UI browser layout output\./);
    assert.equal(newThreadState.railLabels.length, 2);
    assert.equal(newThreadState.leaks, false);

    await browser.evaluate(`
      (() => {
        const oldThreadButton = document.querySelector('[data-assistant-ui-thread-id="${target.sessionId}"]');
        oldThreadButton.click();
        return true;
      })()
    `);
    await browser.waitForExpression(
      `document.querySelector('[data-ralphloop-assistant-ui-shell="true"]')?.getAttribute('data-current-thread-id') === ${JSON.stringify(target.sessionId)}`,
    );
    const oldThreadState = await browser.evaluate<{
      messageCount: string;
      currentThreadId: string;
      status: string;
      text: string;
      leaks: boolean;
    }>(assistantUiThreadStateProbe());
    assert.equal(oldThreadState.currentThreadId, target.sessionId);
    assert.equal(oldThreadState.messageCount, "2", oldThreadState.text);
    assert.equal(oldThreadState.status, "completed");
    assert.match(oldThreadState.text, /Check assistant-ui productized browser layout/);
    assert.match(oldThreadState.text, /Assistant UI browser layout output\./);
    assert.doesNotMatch(oldThreadState.text, /Message in a brand new assistant-ui session/);
    assert.equal(oldThreadState.leaks, false);
    assert.deepEqual(browser.consoleErrors, []);
    assert.deepEqual(browser.exceptions, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("assistant-ui share entry restores local thread list after reload", {
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

  try {
    browser = await launchChrome();
    const target = await createAssistantUiShareFixture({ baseUrl, bootstrapSecret, fetch: server.fetch });
    await browser.navigate(target.url);
    await browser.waitForExpression("Boolean(document.querySelector('.assistant-ui-new-thread'))");

    await browser.evaluate(`
      (() => {
        document.querySelector('.assistant-ui-new-thread').click();
        return true;
      })()
    `);
    await browser.waitForExpression("document.querySelector('[data-ralphloop-assistant-ui-shell=\"true\"]')?.getAttribute('data-thread-count') === '2'");
    await browser.waitForExpression(
      `document.querySelector('[data-ralphloop-assistant-ui-shell="true"]')?.getAttribute('data-current-thread-id') !== ${JSON.stringify(target.sessionId)}`,
    );

    const newThreadPrompt = "Persist this assistant-ui session after reload";
    await browser.evaluate(`
      (() => {
        const input = document.querySelector('#assistant-ui-composer-input');
        input.value = ${JSON.stringify(newThreadPrompt)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('#assistant-ui-composer-form').requestSubmit();
        return true;
      })()
    `);
    await browser.waitForExpression(`document.body.textContent.includes(${JSON.stringify(newThreadPrompt)})`);

    const processed = await runHostCommandOnce({
      relayBaseUrl: baseUrl,
      hostId: "host-1",
      deviceKey: target.deviceKey,
      adapters: { opencode: assistantUiFollowUpAdapter() },
      fetch: server.fetch,
      runtimeState,
    });
    assert.equal(processed, 1);
    await browser.waitForExpression(
      "document.body.textContent.includes('assistant-ui follow-up output: Persist this assistant-ui session after reload')",
      5_000,
    );

    const beforeReload = await browser.evaluate<{
      messageCount: string;
      threadCount: string;
      currentThreadId: string;
      status: string;
      text: string;
      leaks: boolean;
    }>(assistantUiThreadStateProbe());
    assert.equal(beforeReload.threadCount, "2");
    assert.notEqual(beforeReload.currentThreadId, target.sessionId);
    assert.equal(beforeReload.messageCount, "2", beforeReload.text);
    assert.equal(beforeReload.status, "completed");
    assert.equal(beforeReload.leaks, false);
    const newThreadId = beforeReload.currentThreadId;
    const reloadUrl = await browser.evaluate<string>("window.location.href");

    await browser.navigate(reloadUrl);
    await browser.waitForExpression("Boolean(document.querySelector('[data-ralphloop-assistant-ui-shell=\"true\"]'))");
    await browser.waitForExpression("document.querySelector('[data-ralphloop-assistant-ui-shell=\"true\"]')?.getAttribute('data-thread-count') === '2'");

    const reloaded = await browser.evaluate<{
      messageCount: string;
      threadCount: string;
      currentThreadId: string;
      status: string;
      text: string;
      leaks: boolean;
    }>(assistantUiThreadStateProbe());
    assert.equal(reloaded.threadCount, "2");
    assert.equal(reloaded.currentThreadId, newThreadId);
    assert.equal(reloaded.messageCount, "2", reloaded.text);
    assert.equal(reloaded.status, "completed");
    assert.match(reloaded.text, /Persist this assistant-ui session after reload/);
    assert.match(reloaded.text, /assistant-ui follow-up output: Persist this assistant-ui session after reload/);
    assert.doesNotMatch(reloaded.text, /Assistant UI browser layout output\./);
    assert.equal(reloaded.leaks, false);

    await browser.evaluate(`
      (() => {
        const oldThreadButton = document.querySelector('[data-assistant-ui-thread-id="${target.sessionId}"]');
        oldThreadButton.click();
        return true;
      })()
    `);
    await browser.waitForExpression(
      `document.querySelector('[data-ralphloop-assistant-ui-shell="true"]')?.getAttribute('data-current-thread-id') === ${JSON.stringify(target.sessionId)}`,
    );
    await browser.waitForExpression("document.body.textContent.includes('Assistant UI browser layout output.')");

    const oldThreadState = await browser.evaluate<{
      messageCount: string;
      currentThreadId: string;
      status: string;
      text: string;
      leaks: boolean;
    }>(assistantUiThreadStateProbe());
    assert.equal(oldThreadState.currentThreadId, target.sessionId);
    assert.equal(oldThreadState.messageCount, "2", oldThreadState.text);
    assert.equal(oldThreadState.status, "completed");
    assert.match(oldThreadState.text, /Check assistant-ui productized browser layout/);
    assert.match(oldThreadState.text, /Assistant UI browser layout output\./);
    assert.doesNotMatch(oldThreadState.text, /Persist this assistant-ui session after reload/);
    assert.equal(oldThreadState.leaks, false);
    assert.deepEqual(browser.consoleErrors, []);
    assert.deepEqual(browser.exceptions, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});

async function createAssistantUiShareFixture(input: {
  baseUrl: string;
  bootstrapSecret: string;
  fetch: ReturnType<typeof createProductizedShareServer>["fetch"];
}) {
  const registered = await input.fetch(`${input.baseUrl}/v1/hosts/register`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ralphloop-bootstrap-secret": input.bootstrapSecret,
    },
    body: JSON.stringify({
      ownerId: "owner-1",
      hostId: "host-1",
      deviceName: "Assistant UI Browser Host",
      hostVersion: "0.2.0",
      supportedAdapters: ["opencode"],
      capabilities: ["outbound_commands"],
    }),
  });
  assert.equal(registered.status, 201);
  const registeredBody = await registered.json() as { deviceKey: string };

  const created = await input.fetch(`${input.baseUrl}/v1/owner/share-links`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ownerId: "owner-1",
      hostId: "host-1",
      name: "Ralphloop Assistant UI Browser Agent",
    }),
  });
  assert.equal(created.status, 201);

  const session = await input.fetch(`${input.baseUrl}/v1/share/local-friend/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName: "Browser Friend" }),
  });
  assert.equal(session.status, 201);
  const sessionBody = await session.json() as { session: { id: string } };

  const prompt = "Check assistant-ui productized browser layout";
  const submitted = await input.fetch(`${input.baseUrl}/v1/share/local-friend/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: sessionBody.session.id,
      prompt,
    }),
  });
  assert.equal(submitted.status, 202);
  const submittedBody = await submitted.json() as { task: { id: string; status: string } };
  assert.equal(submittedBody.task.status, "waiting");

  const claimed = await input.fetch(`${input.baseUrl}/v1/hosts/host-1/commands`, {
    headers: { "x-ralphloop-device-key": registeredBody.deviceKey },
  });
  assert.equal(claimed.status, 200);
  const claimedBody = await claimed.json() as {
    commands: Array<{ id: string; command: { sessionId: string; taskId: string } }>;
  };
  const command = claimedBody.commands[0];

  const recorded = await input.fetch(`${input.baseUrl}/v1/hosts/host-1/events`, {
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
          taskId: "browser-layout-task",
          text: "Assistant UI browser layout output.",
        },
        { type: "task.completed", taskId: "browser-layout-task" },
      ],
    }),
  });
  assert.equal(recorded.status, 202);

  return {
    deviceKey: registeredBody.deviceKey,
    prompt,
    sessionId: sessionBody.session.id,
    url: `${input.baseUrl}/app/share/local-friend/assistant-ui?sessionId=${sessionBody.session.id}&taskId=${submittedBody.task.id}`,
  };
}

async function createBareAssistantUiShareFixture(input: {
  baseUrl: string;
  bootstrapSecret: string;
  fetch: ReturnType<typeof createProductizedShareServer>["fetch"];
}) {
  const registered = await input.fetch(`${input.baseUrl}/v1/hosts/register`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ralphloop-bootstrap-secret": input.bootstrapSecret,
    },
    body: JSON.stringify({
      ownerId: "owner-1",
      hostId: "host-1",
      deviceName: "Assistant UI Default Link Host",
      hostVersion: "0.2.0",
      supportedAdapters: ["opencode"],
      capabilities: ["outbound_commands"],
    }),
  });
  assert.equal(registered.status, 201);
  const registeredBody = await registered.json() as { deviceKey: string };

  const created = await input.fetch(`${input.baseUrl}/v1/owner/share-links`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ownerId: "owner-1",
      hostId: "host-1",
      name: "Ralphloop Assistant UI Default Link Agent",
    }),
  });
  assert.equal(created.status, 201);

  return {
    deviceKey: registeredBody.deviceKey,
  };
}

function assistantUiFollowUpAdapter(): AgentAdapter {
  const promptsByTaskId = new Map<string, string>();
  return {
    async detect() {
      throw new Error("detect not used");
    },
    async start(startInput) {
      return {
        adapterId: startInput.adapterId,
        runtimeId: `${startInput.adapterId}:assistant-ui-follow-up-runtime`,
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
        text: `assistant-ui follow-up output: ${prompt}`,
      };
      yield { type: "task.completed", taskId: streamInput.task.taskId };
    },
    async stop() {
      // No persistent process in this deterministic browser QA adapter.
    },
  };
}

function runningUntilAssistantUiCancelAdapter(input: {
  calls: string[];
  onTaskStarted(): void;
}): AgentAdapter {
  return {
    async detect() {
      throw new Error("detect not used");
    },
    async start(startInput) {
      input.calls.push(`start:${startInput.adapterId}`);
      return {
        adapterId: startInput.adapterId,
        runtimeId: `${startInput.adapterId}:assistant-ui-running-runtime`,
        status: "running",
      };
    },
    async submitTask(taskInput) {
      input.calls.push(`submit:${taskInput.prompt}`);
      input.onTaskStarted();
      await new Promise<void>((resolve) => {
        if (taskInput.signal?.aborted) {
          resolve();
          return;
        }
        taskInput.signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      input.calls.push("submit-aborted");
      return {
        adapterId: taskInput.runtime.adapterId,
        runtimeId: taskInput.runtime.runtimeId,
        taskId: taskInput.taskId ?? "assistant-ui-cancel-task",
        status: "cancelled",
      };
    },
    async *streamEvents(streamInput) {
      if (streamInput.signal?.aborted || streamInput.task.status === "cancelled") {
        yield { type: "task.cancelled", taskId: streamInput.task.taskId };
        return;
      }
      yield {
        type: "task.output",
        taskId: streamInput.task.taskId,
        text: "should not complete after assistant-ui stop",
      };
      yield { type: "task.completed", taskId: streamInput.task.taskId };
    },
    async stop(stopInput) {
      input.calls.push(`stop:${stopInput.runtime.runtimeId}:${stopInput.reason ?? ""}`);
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function assistantUiThreadStateProbe(): string {
  return `
    (() => {
      const shell = document.querySelector('[data-ralphloop-assistant-ui-shell="true"]');
      const panel = document.querySelector('[data-assistant-ui-thread="true"]');
      const html = document.documentElement.innerHTML;
      return {
        messageCount: shell?.getAttribute('data-message-count') || '',
        threadCount: shell?.getAttribute('data-thread-count') || '',
        currentThreadId: shell?.getAttribute('data-current-thread-id') || '',
        status: panel?.getAttribute('data-assistant-ui-thread-status') || '',
        text: document.body.textContent || '',
        railLabels: Array.from(document.querySelectorAll('.assistant-ui-thread-switch')).map((item) => item.textContent || ''),
        sendDisabled: document.querySelector('#assistant-ui-send')?.disabled === true,
        leaks: /cost|budget|tokenHash|deviceKey|bootstrap|模型价格/.test(html),
      };
    })()
  `;
}

function assistantUiLayoutProbe(prompt: string): string {
  return `
    (() => {
      const rect = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return { top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0 };
        const value = element.getBoundingClientRect();
        return {
          top: value.top,
          right: value.right,
          bottom: value.bottom,
          left: value.left,
          width: value.width,
          height: value.height,
        };
      };
      const shell = document.querySelector('[data-ralphloop-assistant-ui-shell="true"]');
      const panel = document.querySelector('[data-assistant-ui-thread="true"]');
      const html = document.documentElement.innerHTML;
      const text = document.body.textContent || '';
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        document: {
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        },
        shell: rect('[data-ralphloop-assistant-ui-shell="true"]'),
        rail: rect('.assistant-ui-thread-rail'),
        panel: rect('.assistant-ui-thread-panel'),
        messageList: rect('.assistant-ui-message-list'),
        preview: rect('#assistant-ui-preview-drawer'),
        layout: shell?.getAttribute('data-assistant-ui-layout') || '',
        status: panel?.getAttribute('data-assistant-ui-thread-status') || '',
        messageCount: shell?.getAttribute('data-message-count') || '',
        threadCount: shell?.getAttribute('data-thread-count') || '',
        previewHidden: document.querySelector('#assistant-ui-preview-drawer')?.getAttribute('aria-hidden') || '',
        previewOpen: Boolean(document.querySelector('#assistant-ui-preview-drawer')?.classList.contains('is-open')),
        previewPointerEvents: (() => {
          const element = document.querySelector('#assistant-ui-preview-drawer');
          return element ? getComputedStyle(element).pointerEvents : '';
        })(),
        hasPreviewToggle: Boolean(document.querySelector('#assistant-ui-preview-toggle')),
        hasUserBubble: Boolean(document.querySelector('.assistant-ui-message-user')),
        hasAssistantBubble: Boolean(document.querySelector('.assistant-ui-message-assistant')),
        visiblePrompt: text.includes(${JSON.stringify(prompt)}),
        visibleOutput: text.includes('Assistant UI browser layout output.'),
        leaks: /cost|budget|tokenHash|deviceKey|bootstrap|模型价格/.test(html),
      };
    })()
  `;
}

function assertAssistantUiDesktopLayout(metrics: AssistantUiLayoutMetrics) {
  assertNoDocumentHorizontalOverflow(metrics);
  assert.equal(metrics.layout, "chatbot");
  assert.equal(metrics.status, "completed");
  assert.equal(metrics.messageCount, "2");
  assert.equal(metrics.threadCount, "1");
  assert.equal(metrics.hasPreviewToggle, true);
  assert.equal(metrics.hasUserBubble, true);
  assert.equal(metrics.hasAssistantBubble, true);
  assert.equal(metrics.visiblePrompt, true);
  assert.equal(metrics.visibleOutput, true);
  assert.equal(metrics.leaks, false);
  assertRectInsideViewport(metrics.shell, metrics.viewport.width);
  assertRectInsideViewport(metrics.rail, metrics.viewport.width);
  assertRectInsideViewport(metrics.panel, metrics.viewport.width);
  assertRectInsideViewport(metrics.messageList, metrics.viewport.width);
  assert.equal(metrics.rail.right <= metrics.panel.left + 1, true);
}

function assertAssistantUiMobileLayout(metrics: AssistantUiLayoutMetrics) {
  assertNoDocumentHorizontalOverflow(metrics);
  assert.equal(metrics.layout, "chatbot");
  assert.equal(metrics.status, "completed");
  assert.equal(metrics.messageCount, "2");
  assert.equal(metrics.threadCount, "1");
  assert.equal(metrics.hasPreviewToggle, true);
  assert.equal(metrics.hasUserBubble, true);
  assert.equal(metrics.hasAssistantBubble, true);
  assert.equal(metrics.visiblePrompt, true);
  assert.equal(metrics.visibleOutput, true);
  assert.equal(metrics.leaks, false);
  assertRectInsideViewport(metrics.shell, metrics.viewport.width);
  assertRectInsideViewport(metrics.rail, metrics.viewport.width);
  assertRectInsideViewport(metrics.panel, metrics.viewport.width);
  assertRectInsideViewport(metrics.messageList, metrics.viewport.width);
  assert.equal(metrics.rail.bottom <= metrics.panel.top + 1, true);
}

function assertAssistantUiPreviewClosed(metrics: AssistantUiLayoutMetrics) {
  assert.equal(metrics.previewHidden, "true");
  assert.equal(metrics.previewOpen, false);
  assert.equal(metrics.previewPointerEvents, "none");
}

function assertAssistantUiPreviewOpen(metrics: AssistantUiLayoutMetrics) {
  assert.equal(metrics.previewHidden, "false");
  assert.equal(metrics.previewOpen, true);
  assert.equal(metrics.previewPointerEvents, "auto");
  assertRectInsideViewport(metrics.preview, metrics.viewport.width);
}
