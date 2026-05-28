import { execFile } from "node:child_process";
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

export type ProcessHandle = {
  pid?: number;
  killed: boolean;
  kill(signal?: NodeJS.Signals): boolean;
};

export type ProcessRunner = (
  command: string,
  args: string[],
  options?: { cwd?: string; env?: Record<string, string> },
) => ProcessHandle;

type OpenCodeAdapterOptions = {
  commandRunner?: CommandRunner;
  processRunner?: ProcessRunner;
};

type StoredTask = {
  result: CommandResult;
};

const defaultPort = 4096;
const OPEN_CODE_RUN_TIMEOUT_MS = 120_000;

export class OpenCodeAdapter implements AgentAdapter, ProviderAdapter {
  readonly #commandRunner: CommandRunner;
  readonly #processRunner: ProcessRunner;
  readonly #processes = new Map<string, ProcessHandle>();
  readonly #tasks = new Map<string, StoredTask>();

  constructor(options: OpenCodeAdapterOptions = {}) {
    this.#commandRunner = options.commandRunner ?? runCommand;
    this.#processRunner = options.processRunner ?? runProcess;
  }

  async detect(): Promise<AgentAdapterInfo> {
    try {
      const result = await this.#commandRunner("opencode", ["--version"], { timeoutMs: 2_000 });

      if (result.code !== 0) {
        return openCodeInfo("not_configured");
      }

      return openCodeInfo("available", firstNonEmptyLine(result.stdout, result.stderr));
    } catch {
      return openCodeInfo("not_installed");
    }
  }

  async start(input: StartRuntimeInput): Promise<RuntimeHandle> {
    const port = input.port ?? defaultPort;
    const endpoint = `http://127.0.0.1:${port}`;
    const runtimeId = `opencode:${port}`;
    const process = this.#processRunner(
      "opencode",
      ["serve", "--hostname", "127.0.0.1", "--port", String(port)],
      {
        cwd: input.workingDirectory,
        env: input.environment,
      },
    );

    this.#processes.set(runtimeId, process);

    return {
      adapterId: "opencode",
      runtimeId,
      status: "running",
      endpoint,
      pid: process.pid,
    };
  }

  async submitTask(input: SubmitTaskInput): Promise<TaskHandle> {
    if (!input.runtime.endpoint) {
      throw new Error("OpenCode runtime endpoint is required to submit a task");
    }

    const taskId = input.taskId ?? `opencode-task:${Date.now()}`;
    const result = await this.#commandRunner(
      "opencode",
      [
        "run",
        "--attach",
        input.runtime.endpoint,
        "--format",
        "json",
        input.prompt,
      ],
      { cwd: input.workingDirectory, timeoutMs: OPEN_CODE_RUN_TIMEOUT_MS, signal: input.signal },
    );
    this.#tasks.set(taskId, { result });

    return {
      adapterId: "opencode",
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
        message: "OpenCode task output is unavailable",
      };
      return;
    }

    if (stored.result.code !== 0) {
      yield {
        type: "task.failed",
        taskId: input.task.taskId,
        message: firstNonEmptyLine(stored.result.stderr, extractErrorMessage(stored.result.stdout))
          ?? "OpenCode task failed",
      };
      return;
    }

    for (const text of extractOutputTexts(stored.result.stdout)) {
      yield { type: "task.output", taskId: input.task.taskId, text };
    }

    yield { type: "task.completed", taskId: input.task.taskId };
  }

  async stop(input: StopRuntimeInput): Promise<void> {
    const process = this.#processes.get(input.runtime.runtimeId);

    if (!process || process.killed) {
      return;
    }

    process.kill();
    this.#processes.delete(input.runtime.runtimeId);
  }
}

function openCodeInfo(
  status: AgentAdapterInfo["status"],
  version?: string,
): AgentAdapterInfo {
  return {
    id: "opencode",
    displayName: "OpenCode",
    status,
    version,
    startCapability: "server",
    taskCapability: "server_api",
    eventCapability: "http_events",
    desktopPreviewCapability: "web",
  };
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

  if (texts.length === 0) {
    const fallback = stdout.trim();
    if (fallback && !fallback.startsWith("{")) {
      texts.push(fallback);
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

function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { cwd: options.cwd, timeout: options.timeoutMs, signal: options.signal },
      (error, stdout, stderr) => {
        if (error && "code" in error && error.code === "ENOENT") {
          reject(error);
          return;
        }
        const aborted = isAbortError(error) || options.signal?.aborted === true;
        const timedOut = Boolean(error && options.timeoutMs && !aborted && "killed" in error && error.killed);
        const fallbackError = timedOut
          ? `OpenCode command timed out after ${options.timeoutMs}ms`
          : aborted ? "OpenCode command aborted" : "";

        resolve({
          code: error ? typeof error.code === "number" ? error.code : 1 : 0,
          stdout,
          stderr: stderr || fallbackError,
        });
      },
    );
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || "code" in error && error.code === "ABORT_ERR");
}

function runProcess(
  command: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
): ProcessHandle {
  return spawn(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: "ignore",
  });
}
