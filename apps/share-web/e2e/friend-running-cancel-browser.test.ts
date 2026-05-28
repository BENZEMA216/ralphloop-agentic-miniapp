import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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

type ProductizedFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<Response>;

type ResponsiveLayoutMetrics = {
  viewport: { width: number; height: number };
  document: { scrollWidth: number; clientWidth: number };
  shell: BrowserRect;
  sidebar: BrowserRect;
  chat: BrowserRect;
  topbar: BrowserRect;
  thread: BrowserRect;
  composer: BrowserRect;
  preview: BrowserRect;
  previewVisibility: string;
  previewPointerEvents: string;
};

test("friend browser stop terminates a running outbound host child process", {
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
  const calls: string[] = [];
  const started = deferred<void>();
  const runtimeState = createHostClientRuntimeState();

  try {
    browser = await launchChrome();
    const registered = await server.fetch(`${baseUrl}/v1/hosts/register`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ralphloop-bootstrap-secret": bootstrapSecret,
      },
      body: JSON.stringify({
        ownerId: "owner-1",
        hostId: "host-1",
        deviceName: "Browser QA Host",
        hostVersion: "0.2.0",
        supportedAdapters: ["opencode"],
        capabilities: ["outbound_commands"],
      }),
    });
    const registeredBody = await registered.json() as { deviceKey: string };
    assert.equal(registered.status, 201);

    const created = await server.fetch(`${baseUrl}/v1/owner/share-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: "owner-1",
        hostId: "host-1",
        name: "Ralphloop Browser Cancel Agent",
      }),
    });
    assert.equal(created.status, 201);

    await browser.navigate(`${baseUrl}/app/share/local-friend/classic`);
    await browser.waitForExpression("Boolean(document.querySelector('#chat-prompt'))");
    await browser.evaluate(`
      (() => {
        const prompt = document.querySelector('#chat-prompt');
        prompt.value = 'Start a long-running browser e2e cancellation task';
        prompt.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('#chat-form').requestSubmit();
        return true;
      })()
    `);
    await browser.waitForExpression("document.querySelector('#chat-status')?.textContent === '运行中'");
    await browser.waitForExpression("document.querySelector('#chat-stop')?.disabled === false");

    const taskRun = runHostCommandOnce({
      relayBaseUrl: baseUrl,
      hostId: "host-1",
      deviceKey: registeredBody.deviceKey,
      adapters: { opencode: runningUntilBrowserCancelAdapter({ calls, onTaskStarted: started.resolve }) },
      fetch: server.fetch,
      runtimeState,
    });
    await started.promise;

    await browser.evaluate(`
      (() => {
        document.querySelector('#chat-stop').click();
        return true;
      })()
    `);
    await browser.waitForExpression("document.querySelector('#chat-status')?.textContent === '已取消'");

    const cancelRun = await runHostCommandOnce({
      relayBaseUrl: baseUrl,
      hostId: "host-1",
      deviceKey: registeredBody.deviceKey,
      adapters: { opencode: runningUntilBrowserCancelAdapter({ calls, onTaskStarted: started.resolve }) },
      fetch: server.fetch,
      runtimeState,
    });
    const taskRunCount = await taskRun;
    assert.equal(taskRunCount, 1);
    assert.equal(cancelRun, 1);

    await browser.waitForExpression("document.querySelector('#chat-thread')?.textContent.includes('任务已取消')");
    const uiState = await browser.evaluate<{
      status: string;
      stopDisabled: boolean;
      threadText: string;
      sessionCount: number;
    }>(`
      (() => ({
        status: document.querySelector('#chat-status')?.textContent || '',
        stopDisabled: document.querySelector('#chat-stop')?.disabled === true,
        threadText: document.querySelector('#chat-thread')?.textContent || '',
        sessionCount: document.querySelectorAll('[data-testid="friend-session-item"]').length,
      }))()
    `);

    assert.equal(uiState.status, "已取消");
    assert.equal(uiState.stopDisabled, true);
    assert.match(uiState.threadText, /Start a long-running browser e2e cancellation task/);
    assert.match(uiState.threadText, /任务已取消/);
    assert.doesNotMatch(uiState.threadText, /should not complete after browser stop/);
    assert.equal(uiState.sessionCount, 1);
    assert.deepEqual(calls, [
      "start:opencode",
      "submit:Start a long-running browser e2e cancellation task",
      "child-started",
      "stop:opencode:running-runtime:friend_cancelled",
      "child-exit:SIGTERM",
      "submit-aborted",
    ]);
    assert.deepEqual(browser.consoleErrors, []);
    assert.deepEqual(browser.exceptions, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("friend browser chat layout stays usable across desktop and mobile viewports", {
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
    await createBrowserShareLink({ serverFetch: server.fetch, baseUrl, bootstrapSecret });

    await browser.setViewport({ width: 1440, height: 1000, mobile: false });
    await browser.navigate(`${baseUrl}/app/share/local-friend/classic`);
    await browser.waitForExpression("Boolean(document.querySelector('[data-testid=\"friend-chat-shell\"]'))");
    const desktop = await browser.evaluate<ResponsiveLayoutMetrics>(responsiveLayoutProbe());
    assertResponsiveDesktopLayout(desktop);
    const desktopScreenshot = await browser.captureScreenshot();
    assert.ok(desktopScreenshot.length > 10_000);

    await browser.setViewport({ width: 390, height: 844, mobile: true });
    await browser.navigate(`${baseUrl}/app/share/local-friend/classic`);
    await browser.waitForExpression("Boolean(document.querySelector('[data-testid=\"friend-chat-shell\"]'))");
    const mobileClosed = await browser.evaluate<ResponsiveLayoutMetrics>(responsiveLayoutProbe());
    assertResponsiveMobileLayout(mobileClosed, { previewOpen: false });

    await browser.evaluate(`
      (() => {
        document.querySelector('[data-testid="friend-preview-toggle"]').click();
        return true;
      })()
    `);
    await browser.waitForExpression("document.querySelector('[data-testid=\"friend-preview-drawer\"]')?.classList.contains('is-open')");
    const mobileOpen = await browser.evaluate<ResponsiveLayoutMetrics>(responsiveLayoutProbe());
    assertResponsiveMobileLayout(mobileOpen, { previewOpen: true });
    const mobileScreenshot = await browser.captureScreenshot();
    assert.ok(mobileScreenshot.length > 10_000);

    assert.deepEqual(browser.consoleErrors, []);
    assert.deepEqual(browser.exceptions, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});

function runningUntilBrowserCancelAdapter(input: {
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
        runtimeId: `${startInput.adapterId}:running-runtime`,
        status: "running",
      };
    },
    async submitTask(taskInput) {
      input.calls.push(`submit:${taskInput.prompt}`);
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], {
        stdio: "ignore",
      });
      input.calls.push("child-started");
      input.onTaskStarted();
      const childExitSignal = await new Promise<string>((resolve) => {
        const abort = () => {
          child.kill("SIGTERM");
        };
        child.once("exit", (code, signal) => {
          taskInput.signal?.removeEventListener("abort", abort);
          resolve(signal ?? String(code ?? "unknown"));
        });
        if (taskInput.signal?.aborted) {
          abort();
          return;
        }
        taskInput.signal?.addEventListener("abort", abort, { once: true });
      });
      input.calls.push(`child-exit:${childExitSignal}`);
      input.calls.push("submit-aborted");
      return {
        adapterId: taskInput.runtime.adapterId,
        runtimeId: taskInput.runtime.runtimeId,
        taskId: taskInput.taskId ?? "browser-cancel-task",
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
        text: "should not complete after browser stop",
      };
      yield { type: "task.completed", taskId: streamInput.task.taskId };
    },
    async stop(stopInput) {
      input.calls.push(`stop:${stopInput.runtime.runtimeId}:${stopInput.reason ?? ""}`);
    },
  };
}

async function createBrowserShareLink(input: {
  serverFetch: ProductizedFetch;
  baseUrl: string;
  bootstrapSecret: string;
}) {
  const registered = await input.serverFetch(`${input.baseUrl}/v1/hosts/register`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ralphloop-bootstrap-secret": input.bootstrapSecret,
    },
    body: JSON.stringify({
      ownerId: "owner-1",
      hostId: "host-1",
      deviceName: "Browser Layout QA Host",
      hostVersion: "0.2.0",
      supportedAdapters: ["opencode"],
      capabilities: ["outbound_commands"],
    }),
  });
  assert.equal(registered.status, 201);

  const created = await input.serverFetch(`${input.baseUrl}/v1/owner/share-links`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ownerId: "owner-1",
      hostId: "host-1",
      name: "Ralphloop Browser Layout Agent",
    }),
  });
  assert.equal(created.status, 201);
}

function responsiveLayoutProbe(): string {
  return `
    (() => {
      const rect = (selector) => {
        const element = document.querySelector(selector);
        if (!element) {
          return { top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0 };
        }
        const bounds = element.getBoundingClientRect();
        return {
          top: bounds.top,
          right: bounds.right,
          bottom: bounds.bottom,
          left: bounds.left,
          width: bounds.width,
          height: bounds.height,
        };
      };
      const preview = document.querySelector('[data-testid="friend-preview-drawer"]');
      const previewStyle = preview ? getComputedStyle(preview) : { visibility: "", pointerEvents: "" };
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        document: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
        shell: rect('[data-testid="friend-chat-shell"]'),
        sidebar: rect('[data-testid="friend-session-sidebar"]'),
        chat: rect('.friend-chat-main'),
        topbar: rect('.friend-chat-topbar'),
        thread: rect('[data-testid="friend-chat-thread"]'),
        composer: rect('[data-testid="friend-chat-composer"]'),
        preview: rect('[data-testid="friend-preview-drawer"]'),
        previewVisibility: previewStyle.visibility,
        previewPointerEvents: previewStyle.pointerEvents,
      };
    })()
  `;
}

function assertResponsiveDesktopLayout(metrics: ResponsiveLayoutMetrics) {
  assertNoDocumentHorizontalOverflow(metrics);
  assertRectInsideViewport(metrics.shell, metrics.viewport.width);
  assertRectInsideViewport(metrics.sidebar, metrics.viewport.width);
  assertRectInsideViewport(metrics.chat, metrics.viewport.width);
  assert.equal(metrics.sidebar.right <= metrics.chat.left, true);
  assert.equal(metrics.topbar.bottom <= metrics.thread.top, true);
  assert.equal(metrics.thread.bottom <= metrics.composer.top, true);
  assert.equal(metrics.thread.height >= 420, true);
  assert.equal(metrics.composer.width >= 600, true);
}

function assertResponsiveMobileLayout(
  metrics: ResponsiveLayoutMetrics,
  options: { previewOpen: boolean },
) {
  assertNoDocumentHorizontalOverflow(metrics);
  assertRectInsideViewport(metrics.shell, metrics.viewport.width);
  assertRectInsideViewport(metrics.sidebar, metrics.viewport.width);
  assertRectInsideViewport(metrics.chat, metrics.viewport.width);
  assertRectInsideViewport(metrics.thread, metrics.viewport.width);
  assertRectInsideViewport(metrics.composer, metrics.viewport.width);
  assert.equal(metrics.sidebar.bottom <= metrics.chat.top, true);
  assert.equal(metrics.thread.bottom <= metrics.composer.top, true);
  assert.equal(metrics.composer.height >= 130, true);

  if (options.previewOpen) {
    assert.equal(metrics.previewVisibility, "visible");
    assert.equal(metrics.previewPointerEvents, "auto");
    assertRectInsideViewport(metrics.preview, metrics.viewport.width);
    assert.equal(metrics.preview.height >= metrics.viewport.height - 1, true);
    return;
  }

  assert.equal(metrics.previewVisibility, "hidden");
  assert.equal(metrics.previewPointerEvents, "none");
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
