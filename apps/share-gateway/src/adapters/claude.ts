import { execFile } from "node:child_process";

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

type ClaudeCodeAdapterOptions = {
  commandRunner?: CommandRunner;
  permissionMode?: "acceptEdits" | "bypassPermissions" | "default" | "dontAsk" | "plan" | "auto";
  allowedTools?: string[];
  disallowedTools?: string[];
};

type StoredTask = {
  result: CommandResult;
};

export class ClaudeCodeAdapter implements AgentAdapter, ProviderAdapter {
  readonly #commandRunner: CommandRunner;
  readonly #permissionMode?: ClaudeCodeAdapterOptions["permissionMode"];
  readonly #allowedTools: string[];
  readonly #disallowedTools: string[];
  readonly #tasks = new Map<string, StoredTask>();

  constructor(options: ClaudeCodeAdapterOptions = {}) {
    this.#commandRunner = options.commandRunner ?? runCommand;
    this.#permissionMode = options.permissionMode;
    this.#allowedTools = options.allowedTools ?? [];
    this.#disallowedTools = options.disallowedTools ?? [];
  }

  async detect(): Promise<AgentAdapterInfo> {
    try {
      const result = await this.#commandRunner("claude", ["--version"], { timeoutMs: 2_000 });

      if (result.code !== 0) {
        return claudeInfo("not_configured");
      }

      return claudeInfo("available", firstNonEmptyLine(result.stdout, result.stderr));
    } catch {
      return claudeInfo("not_installed");
    }
  }

  async start(_input: StartRuntimeInput): Promise<RuntimeHandle> {
    return {
      adapterId: "claude-code",
      runtimeId: "claude-code:print",
      status: "running",
    };
  }

  async submitTask(input: SubmitTaskInput): Promise<TaskHandle> {
    const taskId = input.taskId ?? `claude-task:${Date.now()}`;
    const args = [
      "--bare",
      "-p",
      input.prompt,
      "--output-format",
      "stream-json",
      ...permissionArgs(this.#permissionMode, this.#allowedTools, this.#disallowedTools),
    ];
    const result = await this.#commandRunner("claude", args, {
      cwd: input.workingDirectory,
      signal: input.signal,
    });

    this.#tasks.set(taskId, { result });

    return {
      adapterId: "claude-code",
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
        message: "Claude Code task output is unavailable",
      };
      return;
    }

    if (stored.result.code !== 0) {
      yield {
        type: "task.failed",
        taskId: input.task.taskId,
        message: firstNonEmptyLine(stored.result.stderr, extractErrorMessage(stored.result.stdout))
          ?? "Claude Code task failed",
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

function permissionArgs(
  permissionMode: ClaudeCodeAdapterOptions["permissionMode"],
  allowedTools: string[],
  disallowedTools: string[],
): string[] {
  const args = [];

  if (permissionMode) {
    args.push("--permission-mode", permissionMode);
  }

  if (allowedTools.length > 0) {
    args.push("--allowedTools", allowedTools.join(","));
  }

  if (disallowedTools.length > 0) {
    args.push("--disallowedTools", disallowedTools.join(","));
  }

  return args;
}

function claudeInfo(
  status: AgentAdapterInfo["status"],
  version?: string,
): AgentAdapterInfo {
  return {
    id: "claude-code",
    displayName: "Claude Code",
    status,
    version,
    startCapability: "process",
    taskCapability: "cli_once",
    eventCapability: "stream_json",
    desktopPreviewCapability: "none",
  };
}

function extractOutputTexts(stdout: string): string[] {
  const texts = [];

  for (const event of parseJsonLines(stdout)) {
    const type = typeof event.type === "string" ? event.type : "";
    const subtype = typeof event.subtype === "string" ? event.subtype : "";
    if (type.includes("error") || subtype.includes("error")) {
      continue;
    }

    const text = findText(event.message ?? event.content ?? event.result ?? event);
    if (text) {
      texts.push(text);
    }
  }

  return texts;
}

function extractErrorMessage(stdout: string): string | undefined {
  for (const event of parseJsonLines(stdout)) {
    const type = typeof event.type === "string" ? event.type : "";
    const subtype = typeof event.subtype === "string" ? event.subtype : "";
    if (type.includes("error") || subtype.includes("error")) {
      return findText(event.result ?? event.message ?? event);
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
  for (const key of ["text", "content", "message", "result", "summary"]) {
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

        resolve({
          code: error ? typeof error.code === "number" ? error.code : 1 : 0,
          stdout,
          stderr: stderr || (aborted ? "Claude Code command aborted" : ""),
        });
      },
    );
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || "code" in error && error.code === "ABORT_ERR");
}
