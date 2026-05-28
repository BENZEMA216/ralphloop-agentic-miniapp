import assert from "node:assert/strict";
import { test } from "node:test";

import { createOwnerPageModel } from "../src/pages/owner/index.ts";

const adapters = [
  {
    id: "opencode",
    displayName: "OpenCode",
    status: "available",
    version: "1.2.27",
    startCapability: "server",
    taskCapability: "server_api",
    eventCapability: "http_events",
    desktopPreviewCapability: "web",
  },
  {
    id: "hermes",
    displayName: "Hermes Agent",
    status: "not_installed",
    startCapability: "process",
    taskCapability: "cli_once",
    eventCapability: "stdout_text",
    desktopPreviewCapability: "none",
  },
] as const;

test("owner page shows available Agent frameworks", () => {
  const page = createOwnerPageModel({ adapters, baseUrl: "http://localhost:5179" });

  assert.deepEqual(page.adapterPicker.options.map((option) => option.label), [
    "OpenCode",
    "Hermes Agent",
  ]);
  assert.equal(page.adapterPicker.options[0].disabled, false);
  assert.equal(page.adapterPicker.options[1].disabled, true);
});

test("owner page selects the only available adapter by default", () => {
  const page = createOwnerPageModel({ adapters, baseUrl: "http://localhost:5179" });

  assert.equal(page.adapterPicker.selectedAdapterId, "opencode");
  assert.equal(page.canGenerateShareLink, true);
});

test("owner page can generate a copyable share link without advanced settings", () => {
  const page = createOwnerPageModel({
    adapters,
    baseUrl: "http://localhost:5179",
    shareLink: {
      token: "local-friend",
      status: "active",
    },
  });

  assert.equal(page.shareLinkPanel.copyableUrl, "http://localhost:5179/share/local-friend");
  assert.equal(page.shareLinkPanel.status, "active");
  assert.equal(page.advancedSettingsRequired, false);
});

test("owner page keeps a quiet workspace layout instead of a marketing layout", () => {
  const page = createOwnerPageModel({ adapters, baseUrl: "http://localhost:5179" });

  assert.equal(page.layout, "workspace");
  assert.equal(page.heroMarketing, false);
});
