export type AdapterStatus =
  | "available"
  | "not_installed"
  | "not_configured"
  | "unsupported";

export type RuntimeStartCapability = "none" | "process" | "server";
export type RuntimeTaskCapability = "cli_once" | "server_api";
export type RuntimeEventCapability =
  | "stdout_text"
  | "jsonl"
  | "stream_json"
  | "http_events";
export type DesktopPreviewCapability = "none" | "web" | "vnc" | "browser";

export type AgentAdapterInfo = {
  id: string;
  displayName: string;
  status: AdapterStatus;
  version?: string;
  startCapability: RuntimeStartCapability;
  taskCapability: RuntimeTaskCapability;
  eventCapability: RuntimeEventCapability;
  desktopPreviewCapability: DesktopPreviewCapability;
};

export type RuntimeEvent =
  | { type: "task.accepted"; taskId: string }
  | { type: "task.plan"; taskId: string; text: string }
  | { type: "task.progress"; taskId: string; text: string }
  | { type: "task.needs_user_auth"; taskId: string; provider: string; scopeSummary: string }
  | { type: "task.needs_user_confirm"; taskId: string; actionSummary: string }
  | { type: "task.needs_owner_approval"; taskId: string; actionSummary: string }
  | { type: "task.output"; taskId: string; text: string }
  | { type: "task.completed"; taskId: string }
  | { type: "task.failed"; taskId: string; message: string }
  | { type: "task.cancelled"; taskId: string };

export type StartRuntimeInput = {
  adapterId: string;
  workingDirectory?: string;
  port?: number;
  environment?: Record<string, string>;
};

export type RuntimeHandle = {
  adapterId: string;
  runtimeId: string;
  status: "running" | "stopped";
  endpoint?: string;
  pid?: number;
};

export type SubmitTaskInput = {
  runtime: RuntimeHandle;
  prompt: string;
  taskId?: string;
  workingDirectory?: string;
  signal?: AbortSignal;
};

export type TaskHandle = {
  adapterId: string;
  runtimeId: string;
  taskId: string;
  status: "accepted" | "running" | "completed" | "failed" | "cancelled";
};

export type StreamEventsInput = {
  runtime: RuntimeHandle;
  task: TaskHandle;
  signal?: AbortSignal;
};

export type StopRuntimeInput = {
  runtime: RuntimeHandle;
  reason?: string;
};

export interface AgentAdapter {
  detect(): Promise<AgentAdapterInfo>;
  start(input: StartRuntimeInput): Promise<RuntimeHandle>;
  submitTask(input: SubmitTaskInput): Promise<TaskHandle>;
  streamEvents(input: StreamEventsInput): AsyncIterable<RuntimeEvent>;
  stop(input: StopRuntimeInput): Promise<void>;
}

export type { ProviderAdapter, ProviderCapabilityDescriptor } from "./provider.ts";
