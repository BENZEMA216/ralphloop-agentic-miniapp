import type { AgentAdapter } from "../adapters/types.ts";

import type { RuntimeHandle, TaskHandle } from "../adapters/types.ts";
import {
  type HostCommandExpectation,
  type HostRuntimeStartCommand,
  type HostRuntimeStopCommand,
  type HostTaskSubmitCommand,
  validateHostCommandBinding,
} from "./hostCommands.ts";

export type ConnectedHostRuntime = {
  hostId: string;
  adapters: Record<string, AgentAdapter>;
};

type ConnectedRuntimeHandle = {
  hostId: string;
  sessionId: string;
  adapterId: string;
  adapter: AgentAdapter;
  runtime: RuntimeHandle;
};

export class HostRuntimeRegistry {
  readonly #hosts = new Map<string, ConnectedHostRuntime>();
  readonly #runtimesById = new Map<string, ConnectedRuntimeHandle>();
  readonly #runtimeIdBySession = new Map<string, string>();

  connectHost(runtime: ConnectedHostRuntime): void {
    this.#hosts.set(runtime.hostId, {
      hostId: runtime.hostId,
      adapters: { ...runtime.adapters },
    });
  }

  disconnectHost(hostId: string): void {
    this.#hosts.delete(hostId);
  }

  hasHost(hostId: string): boolean {
    return this.#hosts.has(hostId);
  }

  findAdapter(hostId: string, adapterId: string): AgentAdapter | undefined {
    return this.#hosts.get(hostId)?.adapters[adapterId];
  }

  async startRuntime(input: {
    command: HostRuntimeStartCommand;
    expected: HostCommandExpectation;
  }): Promise<{ runtime: RuntimeHandle; adapter: AgentAdapter }> {
    const validation = validateHostCommandBinding({
      command: input.command,
      expected: input.expected,
    });
    if (!validation.ok) {
      throw new Error(validation.error);
    }

    const adapter = this.findAdapter(input.command.hostId, input.command.adapterId);
    if (!adapter) {
      throw new Error("shared_agent_unavailable");
    }

    const runtime = await adapter.start({ adapterId: input.command.adapterId });
    this.#runtimesById.set(runtime.runtimeId, {
      hostId: input.command.hostId,
      sessionId: input.command.sessionId,
      adapterId: input.command.adapterId,
      adapter,
      runtime,
    });
    this.#runtimeIdBySession.set(input.command.sessionId, runtime.runtimeId);
    return { runtime, adapter };
  }

  async submitTask(input: {
    command: HostTaskSubmitCommand;
    expected: HostCommandExpectation;
    runtime: RuntimeHandle;
  }): Promise<TaskHandle> {
    const validation = validateHostCommandBinding({
      command: input.command,
      expected: input.expected,
    });
    if (!validation.ok) {
      throw new Error(validation.error);
    }

    if (input.runtime.adapterId !== input.command.adapterId) {
      throw new Error("host_command_binding_invalid");
    }

    const adapter = this.findAdapter(input.command.hostId, input.command.adapterId);
    if (!adapter) {
      throw new Error("shared_agent_unavailable");
    }

    return adapter.submitTask({
      runtime: input.runtime,
      prompt: input.command.prompt,
      taskId: input.command.taskId,
    });
  }

  async stopRuntime(input: {
    command: HostRuntimeStopCommand;
    expected: HostCommandExpectation;
  }): Promise<void> {
    const validation = validateHostCommandBinding({
      command: input.command,
      expected: input.expected,
    });
    if (!validation.ok) {
      throw new Error(validation.error);
    }

    const runtimeId = input.command.runtimeId ?? this.#runtimeIdBySession.get(input.command.sessionId);
    if (!runtimeId) {
      throw new Error("runtime_not_found");
    }

    const connected = this.#runtimesById.get(runtimeId);
    if (
      !connected
      || connected.hostId !== input.command.hostId
      || connected.sessionId !== input.command.sessionId
      || connected.adapterId !== input.command.adapterId
    ) {
      throw new Error("runtime_not_found");
    }

    await connected.adapter.stop({
      runtime: connected.runtime,
      reason: input.command.reason,
    });

    this.#runtimesById.delete(runtimeId);
    if (this.#runtimeIdBySession.get(input.command.sessionId) === runtimeId) {
      this.#runtimeIdBySession.delete(input.command.sessionId);
    }
  }
}
