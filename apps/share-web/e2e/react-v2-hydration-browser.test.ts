import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { test } from "node:test";

import type { AgentAdapter } from "../../share-gateway/src/adapters/types.ts";
import { createHostClientRuntimeState, runHostCommandOnce } from "../../share-gateway/src/productization/hostClient.ts";
import { createProductizedShareServer } from "../../share-gateway/src/productization/httpServer.ts";
import { findChromePath, launchChrome } from "./browserHarness.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
const v2DistIndex = resolve(repoRoot, "apps", "share-web-react", "dist", "index.html");

function ensureReactV2Build(): void {
  if (existsSync(v2DistIndex)) {
    return;
  }
  try {
    execSync("npm run build:web-react --silent", {
      cwd: repoRoot,
      stdio: "inherit",
      env: { ...process.env, NODE_ENV: "production" },
    });
  } catch (error) {
    throw new Error(
      `Failed to build apps/share-web-react before /v2 smoke test: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!existsSync(v2DistIndex)) {
    throw new Error("apps/share-web-react build did not emit dist/index.html");
  }
}

function v2FollowUpAdapter(): AgentAdapter {
  const promptsByTaskId = new Map<string, string>();
  return {
    async detect() {
      throw new Error("detect not used");
    },
    async start(startInput) {
      return {
        adapterId: startInput.adapterId,
        runtimeId: `${startInput.adapterId}:react-v2-runtime`,
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
        text: `react v2 follow-up: ${prompt}`,
      };
      yield { type: "task.completed", taskId: streamInput.task.taskId };
    },
    async stop() {
      // Deterministic in-memory adapter — nothing to stop.
    },
  };
}

async function createV2ShareFixture(input: {
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
      deviceName: "React v2 Browser Host",
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
      name: "Ralphloop React v2 Browser Agent",
    }),
  });
  assert.equal(created.status, 201);

  return {
    deviceKey: registeredBody.deviceKey,
  };
}

test("react v2 share entry hydrates and exchanges a message in real Chrome", {
  skip: !findChromePath() ? "Chrome is required" : false,
}, async () => {
  ensureReactV2Build();
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
    const fixture = await createV2ShareFixture({ baseUrl, bootstrapSecret, fetch: server.fetch });

    await browser.navigate(`${baseUrl}/app/share/local-friend/v2`);
    await browser.waitForExpression(
      "Boolean(document.querySelector('[data-ralphloop-react-app=\"true\"]'))",
      10_000,
    );
    await browser.waitForExpression(
      "Boolean(document.querySelector('#assistant-ui-composer-input'))",
      10_000,
    );

    const prompt = "Hello from the react v2 hydration smoke test";
    await browser.evaluate(`
      (() => {
        const input = document.querySelector('#assistant-ui-composer-input');
        const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        valueSetter.call(input, ${JSON.stringify(prompt)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const form = document.querySelector('#assistant-ui-composer-form');
        form.requestSubmit();
        return true;
      })()
    `);

    await browser.waitForExpression(
      `document.body.textContent.includes(${JSON.stringify(prompt)})`,
      10_000,
    );

    const processed = await runHostCommandOnce({
      relayBaseUrl: baseUrl,
      hostId: "host-1",
      deviceKey: fixture.deviceKey,
      adapters: { opencode: v2FollowUpAdapter() },
      fetch: server.fetch,
      runtimeState,
    });
    assert.equal(processed, 1);

    await browser.waitForExpression(
      "Array.from(document.querySelectorAll('[data-message-role=\"assistant\"]')).some((node) => (node.textContent || '').trim().length > 0)",
      10_000,
    );
    await browser.waitForExpression(
      `document.body.textContent.includes('react v2 follow-up: ${prompt}')`,
      10_000,
    );

    const result = await browser.evaluate<{
      reactAppPresent: boolean;
      assistantBubbles: string[];
      userBubbles: string[];
      text: string;
      leaks: boolean;
    }>(`
      (() => {
        const html = document.documentElement.innerHTML;
        return {
          reactAppPresent: Boolean(document.querySelector('[data-ralphloop-react-app="true"]')),
          assistantBubbles: Array.from(document.querySelectorAll('[data-message-role="assistant"]'))
            .map((node) => (node.textContent || '').trim()),
          userBubbles: Array.from(document.querySelectorAll('[data-message-role="user"]'))
            .map((node) => (node.textContent || '').trim()),
          text: document.body.textContent || '',
          leaks: /cost|budget|tokenHash|deviceKey|bootstrap|模型价格/.test(html),
        };
      })()
    `);

    assert.equal(result.reactAppPresent, true);
    assert.ok(result.assistantBubbles.some((bubble) => bubble.length > 0));
    assert.ok(result.userBubbles.some((bubble) => bubble.includes(prompt)));
    assert.match(result.text, new RegExp(`react v2 follow-up: ${prompt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.equal(result.leaks, false);
    assert.deepEqual(browser.consoleErrors, []);
    assert.deepEqual(browser.exceptions, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});
