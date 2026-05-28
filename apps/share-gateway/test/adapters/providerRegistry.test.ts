import assert from "node:assert/strict";
import { test } from "node:test";

import { CodexAdapter } from "../../src/adapters/codex.ts";
import type { CommandRunner as CodexCommandRunner } from "../../src/adapters/codex.ts";
import { ClaudeCodeAdapter } from "../../src/adapters/claude.ts";
import { OpenCodeAdapter } from "../../src/adapters/opencode.ts";
import {
  ProviderRegistry,
  UnknownProviderError,
} from "../../src/adapters/providerRegistry.ts";
import type { ProviderAdapter } from "../../src/adapters/provider.ts";

function codexRunner(): CodexCommandRunner {
  return async () => ({ code: 0, stdout: "codex-cli 0.130.0\n", stderr: "" });
}

function buildRegistry(): ProviderRegistry {
  return new ProviderRegistry([
    { id: "codex", factory: () => new CodexAdapter({ commandRunner: codexRunner() }) },
    { id: "claude-code", factory: () => new ClaudeCodeAdapter() },
    { id: "opencode", factory: () => new OpenCodeAdapter() },
  ]);
}

test("ProviderRegistry.get returns an adapter for a registered id", () => {
  const registry = buildRegistry();
  const adapter = registry.get("codex");
  assert.ok(adapter, "expected an adapter instance");
  assert.equal(typeof adapter.detect, "function");
  assert.equal(typeof adapter.start, "function");
  assert.equal(typeof adapter.submitTask, "function");
  assert.equal(typeof adapter.streamEvents, "function");
  assert.equal(typeof adapter.stop, "function");
});

test("ProviderRegistry.get returns a fresh instance per call", () => {
  const registry = buildRegistry();
  const first = registry.get("codex");
  const second = registry.get("codex");
  assert.notStrictEqual(first, second, "expected distinct instances per get()");
});

test("ProviderRegistry.get throws unknown_adapter for an unknown id", () => {
  const registry = buildRegistry();
  assert.throws(() => registry.get("missing-adapter"), (error) => {
    assert.ok(error instanceof UnknownProviderError);
    assert.equal(error.adapterId, "missing-adapter");
    assert.match((error as Error).message, /unknown_adapter/);
    return true;
  });
});

test("ProviderRegistry.list returns all registered ids in insertion order", () => {
  const registry = buildRegistry();
  assert.deepEqual(registry.list(), ["codex", "claude-code", "opencode"]);
});

test("ProviderRegistry.register adds a new adapter", () => {
  const registry = buildRegistry();
  const customAdapter: ProviderAdapter = {
    async detect() {
      return {
        id: "custom-acp",
        displayName: "Custom",
        status: "available",
        startCapability: "process",
        taskCapability: "cli_once",
        eventCapability: "stdout_text",
        desktopPreviewCapability: "none",
      };
    },
    async start() {
      return { adapterId: "custom-acp", runtimeId: "custom:1", status: "running" };
    },
    async submitTask() {
      return {
        adapterId: "custom-acp",
        runtimeId: "custom:1",
        taskId: "t",
        status: "completed",
      };
    },
    async *streamEvents() {
      yield { type: "task.accepted", taskId: "t" };
      yield { type: "task.completed", taskId: "t" };
    },
    async stop() {},
  };

  registry.register({ id: "custom-acp", factory: () => customAdapter });

  assert.equal(registry.has("custom-acp"), true);
  assert.deepEqual(registry.list(), ["codex", "claude-code", "opencode", "custom-acp"]);
  assert.strictEqual(registry.get("custom-acp"), customAdapter);
});

test("ProviderRegistry.register replaces an existing adapter id", () => {
  const registry = buildRegistry();
  const replacement = new CodexAdapter({ commandRunner: codexRunner() });
  registry.register({ id: "codex", factory: () => replacement });
  assert.strictEqual(registry.get("codex"), replacement);
});

test("ProviderRegistry.register rejects malformed entries", () => {
  const registry = new ProviderRegistry();
  assert.throws(
    () => registry.register({ id: "", factory: () => new CodexAdapter() }),
    /id is required/,
  );
  assert.throws(
    () =>
      registry.register({
        id: "broken",
        // @ts-expect-error testing runtime guard
        factory: "not-a-function",
      }),
    /factory for "broken" must be a function/,
  );
});

test("ProviderRegistry.get contract-checks the factory output", () => {
  const registry = new ProviderRegistry();
  registry.register({
    id: "broken",
    // @ts-expect-error intentional bad factory
    factory: () => ({ detect: () => Promise.resolve({}) }),
  });
  assert.throws(
    () => registry.get("broken"),
    /provider_contract_violation/,
  );
});

test("ProviderRegistry.has reports membership", () => {
  const registry = buildRegistry();
  assert.equal(registry.has("codex"), true);
  assert.equal(registry.has("missing"), false);
});
