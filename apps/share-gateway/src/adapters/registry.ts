import { execFile } from "node:child_process";

import type {
  AgentAdapterInfo,
  DesktopPreviewCapability,
  RuntimeEventCapability,
  RuntimeStartCapability,
  RuntimeTaskCapability,
} from "./types.ts";

export type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type CommandRunner = (
  command: string,
  args: string[],
  options?: { timeoutMs?: number },
) => Promise<CommandResult>;

type AdapterDefinition = Omit<AgentAdapterInfo, "status" | "version"> & {
  command: string;
  versionArgs: string[];
  parseVersion?: (result: CommandResult) => string | undefined;
};

type AdapterRegistryOptions = {
  commandRunner?: CommandRunner;
};

const adapterDefinitions: AdapterDefinition[] = [
  {
    id: "opencode",
    displayName: "OpenCode",
    command: "opencode",
    versionArgs: ["--version"],
    startCapability: "server",
    taskCapability: "server_api",
    eventCapability: "http_events",
    desktopPreviewCapability: "web",
  },
  {
    id: "codex",
    displayName: "Codex",
    command: "codex",
    versionArgs: ["--version"],
    startCapability: "process",
    taskCapability: "cli_once",
    eventCapability: "jsonl",
    desktopPreviewCapability: "none",
  },
  {
    id: "claude-code",
    displayName: "Claude Code",
    command: "claude",
    versionArgs: ["--version"],
    startCapability: "process",
    taskCapability: "cli_once",
    eventCapability: "stream_json",
    desktopPreviewCapability: "none",
  },
  {
    id: "hermes",
    displayName: "Hermes Agent",
    command: "hermes",
    versionArgs: ["--version"],
    startCapability: "process",
    taskCapability: "cli_once",
    eventCapability: "stdout_text",
    desktopPreviewCapability: "none",
  },
  {
    id: "agent-zero",
    displayName: "Agent Zero",
    command: "agent-zero",
    versionArgs: ["--version"],
    startCapability: "server",
    taskCapability: "server_api",
    eventCapability: "http_events",
    desktopPreviewCapability: "browser",
  },
];

export class AdapterRegistry {
  readonly #commandRunner: CommandRunner;

  constructor(options: AdapterRegistryOptions = {}) {
    this.#commandRunner = options.commandRunner ?? runCommand;
  }

  getAdapter(id: string): AdapterDefinition | undefined {
    return adapterDefinitions.find((adapter) => adapter.id === id);
  }

  async detectAll(): Promise<AgentAdapterInfo[]> {
    return Promise.all(adapterDefinitions.map((adapter) => this.detect(adapter)));
  }

  async detect(adapter: AdapterDefinition | string): Promise<AgentAdapterInfo> {
    const definition = typeof adapter === "string" ? this.getRequiredAdapter(adapter) : adapter;

    try {
      const result = await this.#commandRunner(definition.command, definition.versionArgs, {
        timeoutMs: 2_000,
      });

      if (result.code !== 0) {
        return toAdapterInfo(definition, "not_configured");
      }

      return toAdapterInfo(
        definition,
        "available",
        definition.parseVersion?.(result) ?? firstNonEmptyLine(result.stdout, result.stderr),
      );
    } catch {
      return toAdapterInfo(definition, "not_installed");
    }
  }

  getRequiredAdapter(id: string): AdapterDefinition {
    const adapter = this.getAdapter(id);

    if (!adapter) {
      throw new Error(`Unknown agent adapter: ${id}`);
    }

    return adapter;
  }
}

function toAdapterInfo(
  definition: AdapterDefinition,
  status: AgentAdapterInfo["status"],
  version?: string,
): AgentAdapterInfo {
  return {
    id: definition.id,
    displayName: definition.displayName,
    status,
    version,
    startCapability: definition.startCapability as RuntimeStartCapability,
    taskCapability: definition.taskCapability as RuntimeTaskCapability,
    eventCapability: definition.eventCapability as RuntimeEventCapability,
    desktopPreviewCapability: definition.desktopPreviewCapability as DesktopPreviewCapability,
  };
}

function firstNonEmptyLine(...values: string[]): string | undefined {
  for (const value of values) {
    const line = value.split(/\r?\n/).find((entry) => entry.trim().length > 0);

    if (line) {
      return line.trim();
    }
  }

  return undefined;
}

function runCommand(
  command: string,
  args: string[],
  options: { timeoutMs?: number } = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: options.timeoutMs ?? 2_000 }, (error, stdout, stderr) => {
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
