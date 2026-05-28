import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";

import { ClaudeCodeAdapter } from "../../src/adapters/claude.ts";
import type { CommandRunner as ClaudeCommandRunner } from "../../src/adapters/claude.ts";
import { CodexAdapter } from "../../src/adapters/codex.ts";
import type { CommandRunner as CodexCommandRunner } from "../../src/adapters/codex.ts";
import { HostRuntimeRegistry } from "../../src/productization/hostRuntime.ts";
import { RelayStore } from "../../src/productization/relayStore.ts";
import {
  createOwnerShareLinkV1,
  registerHost,
  submitFriendTaskV1,
} from "../../src/productization/routes.ts";

type ExecResult = {
  code: number;
  stdout: string;
  stderr: string;
};

function execRunner(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd: options.cwd, timeout: options.timeoutMs }, (error, stdout, stderr) => {
      if (error && "code" in error && error.code === "ENOENT") {
        reject(error);
        return;
      }

      resolve({
        code: typeof error?.code === "number" ? error.code : 0,
        stdout,
        stderr,
      });
    });
  });
}

function safeCodexRunner(): CodexCommandRunner {
  return async (command, args, options) => {
    if (command === "codex" && args[0] === "exec") {
      return execRunner(command, ["exec", "--help"], { timeoutMs: 2_000 });
    }
    return execRunner(command, args, options);
  };
}

function safeClaudeRunner(): ClaudeCommandRunner {
  return async (command, args, options) => {
    if (command === "claude" && args.includes("--output-format")) {
      return execRunner(command, ["--help"], { timeoutMs: 2_000 });
    }
    return execRunner(command, args, options);
  };
}

function setupStore(adapterId: string) {
  const store = new RelayStore({
    now: () => new Date("2026-05-22T00:00:00.000Z"),
  });
  registerHost({
    store,
    ownerId: "owner-1",
    hostId: "host-1",
    deviceName: "Benzema Mac",
    hostVersion: "0.1.0",
    supportedAdapters: [adapterId],
  });
  const link = createOwnerShareLinkV1({
    store,
    ownerId: "owner-1",
    hostId: "host-1",
    name: "Ralphloop Agent",
    baseUrl: "https://share.example",
    tokenFactory: () => "smoke-token",
    policy: { allowedAdapterIds: [adapterId] },
  });

  assert.equal(link.status, 201);
  assert.equal(link.body.shareLink.token, "smoke-token");
  return { store, token: "smoke-token" };
}

test("productized runtime can submit a safe read-only task through at least one real CLI adapter (or report not_installed/not_configured)", async () => {
  const candidates: Array<{
    adapterId: "codex" | "claude-code";
    adapter: CodexAdapter | ClaudeCodeAdapter;
  }> = [
    { adapterId: "codex", adapter: new CodexAdapter({ commandRunner: safeCodexRunner() }) },
    {
      adapterId: "claude-code",
      adapter: new ClaudeCodeAdapter({
        permissionMode: "plan",
        disallowedTools: ["Bash", "Write", "Edit", "MultiEdit"],
        commandRunner: safeClaudeRunner(),
      }),
    },
  ];

  const detected = await Promise.all(candidates.map(async (candidate) => ({
    adapterId: candidate.adapterId,
    info: await candidate.adapter.detect(),
  })));

  const firstInstalled = detected.find((candidate) => candidate.info.status !== "not_installed");
  if (!firstInstalled) {
    assert.deepEqual(
      detected.map((entry) => entry.info.status),
      ["not_installed", "not_installed"],
    );
    return;
  }

  const candidate = candidates.find((entry) => entry.adapterId === firstInstalled.adapterId);
  assert.ok(candidate);

  const { store, token } = setupStore(firstInstalled.adapterId);
  const runtimes = new HostRuntimeRegistry();
  runtimes.connectHost({
    hostId: "host-1",
    adapters: {
      [firstInstalled.adapterId]: candidate.adapter,
    },
  });

  const response = await submitFriendTaskV1({
    store,
    runtimes,
    token,
    prompt: "Smoke test (read-only)",
  });

  assert.equal(response.status, 202);
  assert.equal(response.body.task?.status, "completed");
  assert.equal(
    response.body.events.some((event) => event.type === "task.completed"),
    true,
    "expected a completed event from the adapter runtime events stream",
  );
});
