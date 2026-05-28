import assert from "node:assert/strict";
import { test } from "node:test";

import { AdapterRegistry } from "../../src/adapters/registry.ts";
import type { CommandRunner } from "../../src/adapters/registry.ts";

function availableCommandRunner(available: Record<string, string>): CommandRunner {
  return async (command) => {
    if (Object.hasOwn(available, command)) {
      return { code: 0, stdout: available[command], stderr: "" };
    }

    const error = new Error(`${command} not found`);
    Object.assign(error, { code: "ENOENT" });
    throw error;
  };
}

test("detectAll returns the first MVP adapter inventory in stable order", async () => {
  const registry = new AdapterRegistry({
    commandRunner: availableCommandRunner({
      codex: "codex-cli 0.130.0\n",
      claude: "2.1.145 (Claude Code)\n",
      opencode: "1.2.27\n",
    }),
  });

  const adapters = await registry.detectAll();

  assert.deepEqual(
    adapters.map((adapter) => adapter.id),
    ["opencode", "codex", "claude-code", "hermes", "agent-zero"],
  );
});

test("detectAll marks installed CLIs available and missing adapters not_installed", async () => {
  const registry = new AdapterRegistry({
    commandRunner: availableCommandRunner({
      codex: "codex-cli 0.130.0\n",
      claude: "2.1.145 (Claude Code)\n",
      opencode: "1.2.27\n",
    }),
  });

  const adapters = await registry.detectAll();
  const byId = new Map(adapters.map((adapter) => [adapter.id, adapter]));

  assert.equal(byId.get("opencode")?.status, "available");
  assert.equal(byId.get("opencode")?.version, "1.2.27");
  assert.equal(byId.get("opencode")?.startCapability, "server");
  assert.equal(byId.get("opencode")?.taskCapability, "server_api");
  assert.equal(byId.get("opencode")?.eventCapability, "http_events");

  assert.equal(byId.get("codex")?.status, "available");
  assert.equal(byId.get("codex")?.version, "codex-cli 0.130.0");
  assert.equal(byId.get("codex")?.taskCapability, "cli_once");
  assert.equal(byId.get("codex")?.eventCapability, "jsonl");

  assert.equal(byId.get("claude-code")?.status, "available");
  assert.equal(byId.get("claude-code")?.version, "2.1.145 (Claude Code)");
  assert.equal(byId.get("claude-code")?.eventCapability, "stream_json");

  assert.equal(byId.get("hermes")?.displayName, "Hermes Agent");
  assert.equal(byId.get("hermes")?.status, "not_installed");
  assert.equal(byId.get("agent-zero")?.displayName, "Agent Zero");
  assert.equal(byId.get("agent-zero")?.status, "not_installed");
});

test("getAdapter returns undefined for unknown ids", () => {
  const registry = new AdapterRegistry({
    commandRunner: availableCommandRunner({}),
  });

  assert.equal(registry.getAdapter("missing"), undefined);
});
