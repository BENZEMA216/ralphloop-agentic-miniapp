import { ClaudeCodeAdapter } from "../adapters/claude.ts";
import { CodexAdapter } from "../adapters/codex.ts";
import { OpenCodeAdapter } from "../adapters/opencode.ts";
import type { AgentAdapter, AgentAdapterInfo } from "../adapters/types.ts";

export type DevAdapterMode = "demo" | "real";

export function supportedDevAdapterIds(adapters: AgentAdapterInfo[]): string[] {
  const available = adapters
    .filter((adapter) => adapter.status === "available")
    .map((adapter) => adapter.id);

  return available.length > 0 ? available : ["opencode"];
}

export function createDevAdapterMap(input: {
  adapterIds: string[];
  mode: DevAdapterMode;
}): Record<string, AgentAdapter> {
  return Object.fromEntries(
    input.adapterIds.map((adapterId) => {
      const adapter = input.mode === "real"
        ? createRealAdapter(adapterId) ?? createDemoAdapter(adapterId)
        : createDemoAdapter(adapterId);
      return [adapterId, adapter];
    }),
  );
}

function createRealAdapter(adapterId: string): AgentAdapter | undefined {
  switch (adapterId) {
    case "opencode":
      return new OpenCodeAdapter();
    case "codex":
      return new CodexAdapter();
    case "claude-code":
      return new ClaudeCodeAdapter({
        permissionMode: "default",
        disallowedTools: ["Bash", "Write", "Edit", "MultiEdit"],
      });
    default:
      return undefined;
  }
}

function createDemoAdapter(adapterId: string): AgentAdapter {
  return {
    async detect() {
      throw new Error("detect not used in demo adapter");
    },
    async start(input) {
      return {
        adapterId: input.adapterId,
        runtimeId: `${input.adapterId}:demo`,
        status: "running",
      };
    },
    async submitTask(input) {
      return {
        adapterId: input.runtime.adapterId,
        runtimeId: input.runtime.runtimeId,
        taskId: input.taskId ?? "task-demo",
        status: "completed",
      };
    },
    async *streamEvents(input) {
      yield {
        type: "task.output",
        taskId: input.task.taskId,
        text: `Ralphloop ${adapterId} demo adapter completed the task.`,
      };
      yield { type: "task.completed", taskId: input.task.taskId };
    },
    async stop() {},
  };
}
