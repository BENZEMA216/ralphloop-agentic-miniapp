import assert from "node:assert/strict";
import { test } from "node:test";

import { createProductizedShareServer } from "../../share-gateway/src/productization/httpServer.ts";
import {
  assertNoDocumentHorizontalOverflow,
  assertRectInsideViewport,
  findChromePath,
  launchChrome,
  type BrowserRect,
} from "./browserHarness.ts";

type OwnerLayoutMetrics = {
  viewport: { width: number; height: number };
  document: { scrollWidth: number; clientWidth: number };
  shell: BrowserRect;
  topbar: BrowserRect;
  workspace: BrowserRect;
  shareAction: BrowserRect;
  shareList: BrowserRect;
  firstShareItem: BrowserRect;
  firstEditForm: BrowserRect;
  nameInput: BrowserRect;
  adapterList: BrowserRect;
  saveButton: BrowserRect;
};

test("owner browser share-link management stays usable across desktop and mobile viewports", {
  skip: !findChromePath() ? "Chrome is required" : false,
}, async () => {
  const bootstrapSecret = "test-bootstrap-secret";
  let tokenCounter = 0;
  const server = createProductizedShareServer({
    tokenFactory: () => `owner-browser-link-${++tokenCounter}`,
    hostBootstrapSecret: bootstrapSecret,
  });
  await server.listen(0);
  const baseUrl = server.url();
  let browser: Awaited<ReturnType<typeof launchChrome>> | undefined;

  try {
    browser = await launchChrome();
    await createOwnerBrowserFixture({ baseUrl, bootstrapSecret, fetch: server.fetch });

    await browser.setViewport({ width: 1440, height: 1000, mobile: false });
    await browser.navigate(`${baseUrl}/app/owner`);
    await waitForOwnerShareLinks(browser);
    await browser.evaluate(`
      (() => {
        const input = document.querySelector('.share-link-name-input');
        input.value = 'Owner Browser Edited Agent';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('.share-link-edit-form').requestSubmit();
        return true;
      })()
    `);
    await browser.waitForExpression("document.querySelector('#control-status')?.textContent === '已保存链接配置'");
    await browser.evaluate("document.querySelector('.pause-share-link')?.click() || true");
    await browser.waitForExpression("Boolean(document.querySelector('.resume-share-link'))");
    await browser.evaluate("document.querySelector('.resume-share-link')?.click() || true");
    await browser.waitForExpression("Boolean(document.querySelector('.pause-share-link'))");

    const desktop = await browser.evaluate<OwnerLayoutMetrics>(ownerLayoutProbe());
    assertOwnerDesktopLayout(desktop);
    const desktopScreenshot = await browser.captureScreenshot();
    assert.ok(desktopScreenshot.length > 10_000);

    await browser.setViewport({ width: 390, height: 844, mobile: true });
    await browser.navigate(`${baseUrl}/app/owner`);
    await waitForOwnerShareLinks(browser);
    const mobile = await browser.evaluate<OwnerLayoutMetrics>(ownerLayoutProbe());
    assertOwnerMobileLayout(mobile);
    const mobileScreenshot = await browser.captureScreenshot();
    assert.ok(mobileScreenshot.length > 10_000);

    const ownerState = await browser.evaluate<{
      hostStatus: string;
      shareListText: string;
      statusText: string;
      shareItemCount: number;
    }>(`
      (() => ({
        hostStatus: document.querySelector('#host-status')?.textContent || '',
        shareListText: document.querySelector('#share-link-list')?.textContent || '',
        statusText: document.querySelector('#control-status')?.textContent || '',
        shareItemCount: document.querySelectorAll('.share-link-list-item').length,
      }))()
    `);
    assert.equal(ownerState.hostStatus, "在线");
    assert.match(ownerState.shareListText, /Owner Browser Edited Agent/);
    assert.equal(ownerState.shareItemCount, 2);
    assert.deepEqual(browser.consoleErrors, []);
    assert.deepEqual(browser.exceptions, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});

async function createOwnerBrowserFixture(input: {
  baseUrl: string;
  bootstrapSecret: string;
  fetch: typeof fetch;
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
      deviceName: "Owner Browser QA Host",
      hostVersion: "0.2.0",
      supportedAdapters: ["opencode", "codex"],
      capabilities: ["outbound_commands"],
    }),
  });
  assert.equal(registered.status, 201);

  for (const name of ["Owner Browser Primary Agent", "Owner Browser Secondary Agent"]) {
    const created = await input.fetch(`${input.baseUrl}/v1/owner/share-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: "owner-1",
        hostId: "host-1",
        name,
      }),
    });
    assert.equal(created.status, 201);
  }
}

async function waitForOwnerShareLinks(browser: Awaited<ReturnType<typeof launchChrome>>) {
  await browser.waitForExpression("document.querySelector('#host-status')?.textContent === '在线'");
  await browser.waitForExpression("document.querySelectorAll('.share-link-list-item').length === 2");
  await browser.waitForExpression("Boolean(document.querySelector('.share-link-edit-form'))");
}

function ownerLayoutProbe(): string {
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
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        document: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
        shell: rect('.owner-shell'),
        topbar: rect('.topbar'),
        workspace: rect('.workspace-grid'),
        shareAction: rect('.action-surface'),
        shareList: rect('#share-link-list'),
        firstShareItem: rect('.share-link-list-item'),
        firstEditForm: rect('.share-link-edit-form'),
        nameInput: rect('.share-link-name-input'),
        adapterList: rect('.share-link-adapter-list'),
        saveButton: rect('.save-share-link'),
      };
    })()
  `;
}

function assertOwnerDesktopLayout(metrics: OwnerLayoutMetrics) {
  assertNoDocumentHorizontalOverflow(metrics);
  assertRectInsideViewport(metrics.shell, metrics.viewport.width);
  assertRectInsideViewport(metrics.topbar, metrics.viewport.width);
  assertRectInsideViewport(metrics.workspace, metrics.viewport.width);
  assertRectInsideViewport(metrics.shareAction, metrics.viewport.width);
  assertRectInsideViewport(metrics.shareList, metrics.viewport.width);
  assertRectInsideViewport(metrics.firstShareItem, metrics.viewport.width);
  assertRectInsideViewport(metrics.firstEditForm, metrics.viewport.width);
  assert.equal(metrics.workspace.width >= 900, true);
  assert.equal(metrics.firstEditForm.width >= 680, true);
  assert.equal(metrics.topbar.bottom <= metrics.workspace.top, true);
}

function assertOwnerMobileLayout(metrics: OwnerLayoutMetrics) {
  assertNoDocumentHorizontalOverflow(metrics);
  assertRectInsideViewport(metrics.shell, metrics.viewport.width);
  assertRectInsideViewport(metrics.topbar, metrics.viewport.width);
  assertRectInsideViewport(metrics.workspace, metrics.viewport.width);
  assertRectInsideViewport(metrics.shareAction, metrics.viewport.width);
  assertRectInsideViewport(metrics.shareList, metrics.viewport.width);
  assertRectInsideViewport(metrics.firstShareItem, metrics.viewport.width);
  assertRectInsideViewport(metrics.firstEditForm, metrics.viewport.width);
  assertRectInsideViewport(metrics.nameInput, metrics.viewport.width);
  assertRectInsideViewport(metrics.adapterList, metrics.viewport.width);
  assertRectInsideViewport(metrics.saveButton, metrics.viewport.width);
  assert.equal(metrics.workspace.width <= metrics.viewport.width, true);
  assert.equal(metrics.shareAction.top >= metrics.workspace.top, true);
  assert.equal(metrics.nameInput.bottom <= metrics.adapterList.top, true);
  assert.equal(metrics.adapterList.bottom <= metrics.saveButton.top, true);
}
