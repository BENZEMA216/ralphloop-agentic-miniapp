import { spawn } from "node:child_process";

import type { ProviderAdapter } from "./provider.ts";
import type {
  AgentAdapter,
  AgentAdapterInfo,
  RuntimeEvent,
  RuntimeHandle,
  StartRuntimeInput,
  StopRuntimeInput,
  StreamEventsInput,
  SubmitTaskInput,
  TaskHandle,
} from "./types.ts";

export type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type CommandRunner = (
  command: string,
  args: string[],
  options?: { cwd?: string; timeoutMs?: number; signal?: AbortSignal },
) => Promise<CommandResult>;

type CodexAdapterOptions = {
  commandRunner?: CommandRunner;
};

type StoredTask = {
  result: CommandResult;
};

const CODEX_EXEC_TIMEOUT_MS = 120_000;

export class CodexAdapter implements AgentAdapter, ProviderAdapter {
  readonly #commandRunner: CommandRunner;
  readonly #tasks = new Map<string, StoredTask>();

  constructor(options: CodexAdapterOptions = {}) {
    this.#commandRunner = options.commandRunner ?? runCommand;
  }

  async detect(): Promise<AgentAdapterInfo> {
    try {
      const result = await this.#commandRunner("codex", ["--version"], { timeoutMs: 2_000 });

      if (result.code !== 0) {
        return codexInfo("not_configured");
      }

      return codexInfo("available", firstNonEmptyLine(result.stdout, result.stderr));
    } catch {
      return codexInfo("not_installed");
    }
  }

  async start(_input: StartRuntimeInput): Promise<RuntimeHandle> {
    return {
      adapterId: "codex",
      runtimeId: "codex:exec",
      status: "running",
    };
  }

  async submitTask(input: SubmitTaskInput): Promise<TaskHandle> {
    const taskId = input.taskId ?? `codex-task:${Date.now()}`;
    const result = await this.#commandRunner(
      "codex",
      ["exec", "--json", "--sandbox", "read-only", input.prompt],
      { cwd: input.workingDirectory, timeoutMs: CODEX_EXEC_TIMEOUT_MS, signal: input.signal },
    );

    this.#tasks.set(taskId, { result });

    return {
      adapterId: "codex",
      runtimeId: input.runtime.runtimeId,
      taskId,
      status: result.code === 0 ? "completed" : "failed",
    };
  }

  async *streamEvents(input: StreamEventsInput): AsyncIterable<RuntimeEvent> {
    yield { type: "task.accepted", taskId: input.task.taskId };

    const stored = this.#tasks.get(input.task.taskId);
    if (!stored) {
      yield {
        type: "task.failed",
        taskId: input.task.taskId,
        message: "Codex task output is unavailable",
      };
      return;
    }

    if (stored.result.code !== 0) {
      yield {
        type: "task.failed",
        taskId: input.task.taskId,
        message: firstNonEmptyLine(stored.result.stderr, extractErrorMessage(stored.result.stdout))
          ?? "Codex task failed",
      };
      return;
    }

    for (const text of extractOutputTexts(stored.result.stdout)) {
      yield { type: "task.output", taskId: input.task.taskId, text };
    }

    yield { type: "task.completed", taskId: input.task.taskId };
  }

  async stop(_input: StopRuntimeInput): Promise<void> {
    return;
  }
}

function codexInfo(
  status: AgentAdapterInfo["status"],
  version?: string,
): AgentAdapterInfo {
  return {
    id: "codex",
    displayName: "Codex",
    status,
    version,
    startCapability: "process",
    taskCapability: "cli_once",
    eventCapability: "jsonl",
    desktopPreviewCapability: "none",
  };
}

function extractOutputTexts(stdout: string): string[] {
  const texts = [];

  for (const event of parseJsonLines(stdout)) {
    const type = typeof event.type === "string" ? event.type : "";
    if (type.includes("error") || type.includes("failed")) {
      continue;
    }

    const text = findText(event.item ?? event.message ?? event.output ?? event);
    if (text) {
      texts.push(text);
    }
  }

  return texts;
}

function extractErrorMessage(stdout: string): string | undefined {
  for (const event of parseJsonLines(stdout)) {
    const type = typeof event.type === "string" ? event.type : "";
    if (type.includes("error") || type.includes("failed")) {
      return findText(event);
    }
  }

  return undefined;
}

function parseJsonLines(stdout: string): Array<Record<string, unknown>> {
  const events = [];

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") {
        events.push(parsed as Record<string, unknown>);
      }
    } catch {
      continue;
    }
  }

  return events;
}

function findText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }

  if (!value || typeof value !== "object") {
    return undefined;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const text = findText(entry);
      if (text) {
        return text;
      }
    }
    return undefined;
  }

  const record = value as Record<string, unknown>;
  for (const key of ["text", "content", "message", "final_response", "summary"]) {
    const text = findText(record[key]);
    if (text) {
      return text;
    }
  }

  return undefined;
}

function firstNonEmptyLine(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const line = value?.split(/\r?\n/).find((entry) => entry.trim().length > 0);

    if (line) {
      return line.trim();
    }
  }

  return undefined;
}

function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      options.signal?.removeEventListener("abort", abort);
      callback();
    };

    const timer = options.timeoutMs
      ? setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, options.timeoutMs)
      : undefined;
    const abort = () => {
      child.kill("SIGTERM");
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) {
      abort();
    }

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      finish(() => {
        if ("code" in error && error.code === "ENOENT") {
          reject(error);
          return;
        }
        resolve({
          code: 1,
          stdout,
          stderr: firstNonEmptyLine(stderr, error.message) ?? "Codex command failed",
        });
      });
    });
    child.on("close", (code, signal) => {
      finish(() => {
        const timeoutMessage = timedOut && options.timeoutMs
          ? `Codex command timed out after ${options.timeoutMs}ms`
          : "";
        resolve({
          code: code ?? 1,
          stdout,
          stderr: [stderr, timeoutMessage, signal ? `signal: ${signal}` : ""]
            .filter((entry) => entry.trim().length > 0)
            .join("\n"),
        });
      });
    });
  });
}
