/**
 * Owner screenshot archive (Workstream G.2).
 *
 * Drives the productized owner page (/app/owner) across three viewports —
 * mobile (375x812), tablet (834x1112), and desktop (1440x900) — and captures
 * both the active state (with seeded share links) and the empty state (no
 * share links yet). PNGs land under .gstack/qa-reports/browser-screenshots/
 * owner/<viewport>-<state>.png, which is gitignored so artifacts never enter
 * the tree.
 *
 * Assertions:
 * - Every archived PNG must be > 4 KB (catches empty / corrupt captures).
 * - No console errors or runtime exceptions during the run.
 */

import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { createProductizedShareServer } from "../../share-gateway/src/productization/httpServer.ts";
import { archiveScreenshot, findChromePath, launchChrome } from "./browserHarness.ts";

type OwnerArchiveViewport = {
  label: string;
  width: number;
  height: number;
  mobile: boolean;
};

const OWNER_ARCHIVE_VIEWPORTS: OwnerArchiveViewport[] = [
  { label: "mobile", width: 375, height: 812, mobile: true },
  { label: "tablet", width: 834, height: 1112, mobile: false },
  { label: "desktop", width: 1440, height: 900, mobile: false },
];

const ARCHIVE_DIR = join(process.cwd(), ".gstack", "qa-reports", "browser-screenshots", "owner");

test("owner page screenshot archive covers mobile/tablet/desktop active and empty states", {
  skip: !findChromePath() ? "Chrome is required" : false,
}, async () => {
  const archivedPaths: string[] = [];
  for (const viewport of OWNER_ARCHIVE_VIEWPORTS) {
    archivedPaths.push(...await captureOwnerStatesForViewport(viewport));
  }

  // Defensive: every archived screenshot should be a real PNG (>4 KB).
  for (const path of archivedPaths) {
    const size = statSync(path).size;
    assert.equal(size > 4_096, true, `expected ${path} to exceed 4 KB, got ${size} bytes`);
  }

  // Sanity: we captured 3 viewports x 2 states = 6 PNGs.
  assert.equal(archivedPaths.length, OWNER_ARCHIVE_VIEWPORTS.length * 2);
});

async function captureOwnerStatesForViewport(viewport: OwnerArchiveViewport): Promise<string[]> {
  const bootstrapSecret = "test-bootstrap-secret";
  let tokenCounter = 0;
  const server = createProductizedShareServer({
    tokenFactory: () => `owner-archive-${viewport.label}-${++tokenCounter}`,
    hostBootstrapSecret: bootstrapSecret,
  });
  await server.listen(0);
  const baseUrl = server.url();

  let browser: Awaited<ReturnType<typeof launchChrome>> | undefined;
  const archivedPaths: string[] = [];
  try {
    browser = await launchChrome();
    await browser.setViewport({ width: viewport.width, height: viewport.height, mobile: viewport.mobile });

    // --- Empty state: host registered but no share links yet. ---
    await registerOwnerArchiveHost({ baseUrl, bootstrapSecret, fetch: server.fetch });
    await browser.navigate(`${baseUrl}/app/owner`);
    await browser.waitForExpression("Boolean(document.querySelector('.owner-shell'))");
    await browser.waitForExpression("document.querySelector('#host-status')?.textContent === '在线'");
    await browser.waitForExpression("document.querySelectorAll('.share-link-list-item').length === 0");

    archivedPaths.push(
      await archiveScreenshot({
        page: browser,
        name: `${viewport.label}-empty`,
        archiveDir: ARCHIVE_DIR,
      }),
    );

    // --- Active state: seed share links so the list renders content. ---
    await seedOwnerShareLinks({ baseUrl, fetch: server.fetch });
    await browser.navigate(`${baseUrl}/app/owner`);
    await browser.waitForExpression("Boolean(document.querySelector('.owner-shell'))");
    await browser.waitForExpression("document.querySelector('#host-status')?.textContent === '在线'");
    await browser.waitForExpression("document.querySelectorAll('.share-link-list-item').length === 2");
    await browser.waitForExpression("Boolean(document.querySelector('.share-link-edit-form'))");

    archivedPaths.push(
      await archiveScreenshot({
        page: browser,
        name: `${viewport.label}-active`,
        archiveDir: ARCHIVE_DIR,
      }),
    );

    assert.deepEqual(browser.consoleErrors, [], `${viewport.label}: no console errors`);
    assert.deepEqual(browser.exceptions, [], `${viewport.label}: no runtime exceptions`);
  } catch (error) {
    // Make sure partial PNGs don't poison the archive on failure.
    for (const path of archivedPaths) {
      await rm(path, { force: true });
    }
    throw error;
  } finally {
    await browser?.close();
    await server.close();
  }
  return archivedPaths;
}

async function registerOwnerArchiveHost(input: {
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
      deviceName: "Owner Screenshot Archive Host",
      hostVersion: "0.2.0",
      supportedAdapters: ["opencode", "codex"],
      capabilities: ["outbound_commands"],
    }),
  });
  assert.equal(registered.status, 201);
}

async function seedOwnerShareLinks(input: {
  baseUrl: string;
  fetch: typeof fetch;
}) {
  for (const name of ["Owner Archive Primary Agent", "Owner Archive Secondary Agent"]) {
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
