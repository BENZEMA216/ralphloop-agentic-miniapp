/**
 * Pixel baseline diff test (Workstream G.3).
 *
 * Captures three canonical assistant-ui states and compares them against
 * committed baseline PNGs under `apps/share-web/e2e/baselines/`. Run with
 * `UPDATE_BASELINES=1` to (re)generate baselines.
 *
 * The viewport, fixture, and timing are pinned so the baseline is stable
 * across runs on the same machine. The 2% diff ratio (the
 * pixelBaseline default) absorbs minor antialiasing / font-metric drift.
 *
 * States:
 *   1. empty-thread — bare assistant-ui shell, no seeded messages.
 *   2. after-user-message — user bubble visible while the Agent is still
 *      running. We do NOT process the host command, so the loading state
 *      stays deterministic.
 *   3. after-task-completion — the host command has been processed, the
 *      Agent bubble carries the deterministic follow-up output.
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import type { AgentAdapter } from "../../share-gateway/src/adapters/types.ts";
import { createHostClientRuntimeState, runHostCommandOnce } from "../../share-gateway/src/productization/hostClient.ts";
import { createProductizedShareServer } from "../../share-gateway/src/productization/httpServer.ts";
import { findChromePath, launchChrome } from "./browserHarness.ts";
import { comparePngToBaseline } from "./pixelBaseline.ts";

const BASELINE_DIR = join(fileURLToPath(new URL("./", import.meta.url)), "baselines");

// Pin the viewport so screenshots are byte-stable across machines that run
// the same headless Chrome build.
const PIXEL_BASELINE_VIEWPORT = { width: 1280, height: 800, mobile: false } as const;

test("pixel baseline: three canonical assistant-ui states", {
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
    await browser.setViewport(PIXEL_BASELINE_VIEWPORT);

    // --- 1. empty-thread: a bare share link, no seeded session. ---
    const fixture = await createBareAssistantUiFixture({
      baseUrl,
      bootstrapSecret,
      fetch: server.fetch,
    });
    await browser.navigate(`${baseUrl}/app/share/local-friend/assistant-ui`);
    await browser.waitForExpression("Boolean(document.querySelector('[data-ralphloop-assistant-ui-shell=\"true\"]'))");
    await browser.waitForExpression("Boolean(document.querySelector('#assistant-ui-composer-input'))");
    await browser.waitForExpression("document.querySelector('[data-ralphloop-assistant-ui-shell=\"true\"]')?.getAttribute('data-message-count') === '0'");
    const emptyBytes = await captureCurrentPng(browser);
    await assertBaselineMatch({ name: "empty-thread", current: emptyBytes });

    // --- 2. after-user-message: user bubble visible, agent still running. ---
    const followUpPrompt = "Pixel baseline capture";
    await browser.evaluate(`
      (() => {
        const input = document.querySelector('#assistant-ui-composer-input');
        input.value = ${JSON.stringify(followUpPrompt)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('#assistant-ui-composer-form').requestSubmit();
        return true;
      })()
    `);
    await browser.waitForExpression(`document.body.textContent.includes(${JSON.stringify(followUpPrompt)})`);
    await browser.waitForExpression("document.querySelector('[data-assistant-ui-thread=\"true\"]')?.getAttribute('data-assistant-ui-thread-status') === 'running'");
    await browser.waitForExpression("document.querySelectorAll('.assistant-ui-message-loading').length === 1");
    const afterUserBytes = await captureCurrentPng(browser);
    await assertBaselineMatch({ name: "after-user-message", current: afterUserBytes });

    // --- 3. after-task-completion: drive a deterministic completion. ---
    const processed = await runHostCommandOnce({
      relayBaseUrl: baseUrl,
      hostId: "host-1",
      deviceKey: fixture.deviceKey,
      adapters: { opencode: pixelBaselineAdapter() },
      fetch: server.fetch,
      runtimeState,
    });
    assert.equal(processed, 1);
    await browser.waitForExpression(
      `document.body.textContent.includes('pixel-baseline output: ${followUpPrompt}')`,
      5_000,
    );
    await browser.waitForExpression("document.querySelector('[data-assistant-ui-thread=\"true\"]')?.getAttribute('data-assistant-ui-thread-status') === 'completed'");
    const afterCompletionBytes = await captureCurrentPng(browser);
    await assertBaselineMatch({ name: "after-task-completion", current: afterCompletionBytes });

    assert.deepEqual(browser.consoleErrors, []);
    assert.deepEqual(browser.exceptions, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});

async function captureCurrentPng(browser: Awaited<ReturnType<typeof launchChrome>>): Promise<Buffer> {
  const base64 = await browser.captureScreenshot();
  assert.ok(base64.length > 0, "captureScreenshot returned an empty PNG");
  return Buffer.from(base64, "base64");
}

async function assertBaselineMatch(input: { name: string; current: Buffer }) {
  const result = await comparePngToBaseline({
    name: input.name,
    current: input.current,
    baselineDir: BASELINE_DIR,
    maxDiffRatio: 0.02,
  });
  if (!result.ok) {
    assert.fail(
      `pixel baseline mismatch for ${input.name}: diffRatio=${result.diffRatio.toFixed(4)}` +
        (result.diffPath ? `, diff at ${result.diffPath}` : ""),
    );
  }
}

async function createBareAssistantUiFixture(input: {
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
      deviceName: "Pixel Baseline Host",
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
      name: "Ralphloop Pixel Baseline Agent",
    }),
  });
  assert.equal(created.status, 201);

  return { deviceKey: registeredBody.deviceKey };
}

function pixelBaselineAdapter(): AgentAdapter {
  const promptsByTaskId = new Map<string, string>();
  return {
    async detect() {
      throw new Error("detect not used");
    },
    async start(startInput) {
      return {
        adapterId: startInput.adapterId,
        runtimeId: `${startInput.adapterId}:pixel-baseline-runtime`,
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
        text: `pixel-baseline output: ${prompt}`,
      };
      yield { type: "task.completed", taskId: streamInput.task.taskId };
    },
    async stop() {
      // No persistent process in this deterministic baseline adapter.
    },
  };
}
