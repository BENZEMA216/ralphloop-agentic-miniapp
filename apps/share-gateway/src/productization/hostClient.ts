import type { ProviderRegistry } from "../adapters/providerRegistry.ts";
import type { AgentAdapter, RuntimeEvent } from "../adapters/types.ts";
import {
  createSessionProcessTable,
  SessionProcessTable,
  type SessionSlot,
} from "./sessionProcessTable.ts";
import type { HostCommandRecord } from "./types.ts";

type HostClientFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<Response>;

export type HostClientAdapterSource =
  | Record<string, AgentAdapter>
  | ProviderRegistry;

export type RunHostCommandOnceInput = {
  relayBaseUrl: string;
  hostId: string;
  deviceKey: string;
  fetch?: HostClientFetch;
  runtimeState?: HostClientRuntimeState;
} & (
  | { adapters: Record<string, AgentAdapter>; providerRegistry?: ProviderRegistry }
  | { adapters?: Record<string, AgentAdapter>; providerRegistry: ProviderRegistry }
);

function resolveAdapter(
  source: HostClientAdapterSource,
  adapterId: string,
): AgentAdapter | undefined {
  if (isProviderRegistry(source)) {
    return source.has(adapterId) ? source.get(adapterId) : undefined;
  }
  return source[adapterId];
}

function isProviderRegistry(value: unknown): value is ProviderRegistry {
  return (
    !!value
    && typeof value === "object"
    && typeof (value as ProviderRegistry).get === "function"
    && typeof (value as ProviderRegistry).has === "function"
    && typeof (value as ProviderRegistry).list === "function"
  );
}

export async function runHostCommandOnce(input: RunHostCommandOnceInput): Promise<number> {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const baseUrl = input.relayBaseUrl.replace(/\/$/, "");
  const runtimeState = input.runtimeState ?? createHostClientRuntimeState();
  const adapterSource: HostClientAdapterSource = input.providerRegistry ?? input.adapters ?? {};
  const commandsResponse = await fetchImpl(`${baseUrl}/v1/hosts/${encodeURIComponent(input.hostId)}/commands`, {
    headers: {
      "x-ralphloop-device-key": input.deviceKey,
    },
  });
  if (!commandsResponse.ok) {
    throw new Error(`host command poll failed: ${commandsResponse.status}`);
  }

  const body = await commandsResponse.json() as { commands?: HostCommandRecord[] };
  const commands = body.commands ?? [];
  for (const record of commands) {
    await executeHostCommand({
      fetch: fetchImpl,
      baseUrl,
      hostId: input.hostId,
      deviceKey: input.deviceKey,
      adapterSource,
      record,
      runtimeState,
    });
  }

  return commands.length;
}

/**
 * Back-compat alias for callers that referenced the legacy
 * HostClientRuntimeState shape (e.g. `productization/devOutbound.ts`,
 * `apps/share-web/e2e/*-browser.test.ts`). The new home is
 * `SessionProcessTable`; the alias keeps the type name working.
 */
export type HostClientRuntimeState = SessionProcessTable;

export function createHostClientRuntimeState(): HostClientRuntimeState {
  return createSessionProcessTable();
}

async function executeHostCommand(input: {
  fetch: HostClientFetch;
  baseUrl: string;
  hostId: string;
  deviceKey: string;
  adapterSource: HostClientAdapterSource;
  record: HostCommandRecord;
  runtimeState: HostClientRuntimeState;
}) {
  const command = input.record.command;
  if (command.commandType === "session.cancel") {
    await input.runtimeState.cancel(
      command.sessionId,
      command.reason ?? "session_cancelled",
    );
    await postHostEvents({
      fetch: input.fetch,
      baseUrl: input.baseUrl,
      hostId: input.hostId,
      deviceKey: input.deviceKey,
      commandId: input.record.id,
      sessionId: command.sessionId,
      taskId: "",
      events: [],
    });
    return;
  }

  if (command.commandType !== "task.submit") {
    return;
  }

  const adapter = resolveAdapter(input.adapterSource, command.adapterId);
  const events: RuntimeEvent[] = [];
  let runtimeId: string | undefined;
  const abortController = new AbortController();
  let slot: SessionSlot | undefined;
  if (adapter) {
    try {
      slot = input.runtimeState.acquire({
        sessionId: command.sessionId,
        adapter,
        abortController,
      });
    } catch {
      // Session already busy — surface a failed event downstream instead
      // of crashing the host poll loop. The existing slot owns the task;
      // this submit was a stale retry.
    }
  }

  try {
    if (!adapter) {
      throw new Error("adapter_unavailable");
    }

    const runtime = await adapter.start({ adapterId: command.adapterId });
    runtimeId = runtime.runtimeId;
    if (slot) {
      slot.runtime = runtime;
    }
    const task = await adapter.submitTask({
      runtime,
      taskId: command.taskId,
      prompt: command.prompt,
      signal: abortController.signal,
    });

    for await (const event of adapter.streamEvents({ runtime, task, signal: abortController.signal })) {
      if (abortController.signal.aborted) {
        break;
      }
      events.push(event);
    }
  } catch (error) {
    if (!abortController.signal.aborted && !isAbortError(error)) {
      events.push({
        type: "task.failed",
        taskId: command.taskId,
        message: error instanceof Error ? error.message : "host_task_failed",
      });
    }
  } finally {
    if (slot) {
      input.runtimeState.release(slot);
    }
  }

  if (abortController.signal.aborted || slot?.stopRequested) {
    // D.6 defensive guard: a cancel that flipped `stopRequested` after the
    // stream yielded a terminal event must not let that terminal event
    // overwrite the cancelled record. Strip task.completed / task.failed
    // and synthesize task.cancelled if the adapter did not already emit it.
    const terminalEvents = events.filter((event) => event.type !== "task.completed" && event.type !== "task.failed");
    if (!terminalEvents.some((event) => event.type === "task.cancelled")) {
      terminalEvents.push({ type: "task.cancelled", taskId: command.taskId });
    }
    events.splice(0, events.length, ...terminalEvents);
  }

  await postHostEvents({
    fetch: input.fetch,
    baseUrl: input.baseUrl,
    hostId: input.hostId,
    deviceKey: input.deviceKey,
    commandId: input.record.id,
    sessionId: command.sessionId,
    taskId: command.taskId,
    runtimeId,
    events,
  });
}

async function postHostEvents(input: {
  fetch: HostClientFetch;
  baseUrl: string;
  hostId: string;
  deviceKey: string;
  commandId: string;
  sessionId: string;
  taskId: string;
  runtimeId?: string;
  events: RuntimeEvent[];
}) {
  const response = await input.fetch(`${input.baseUrl}/v1/hosts/${encodeURIComponent(input.hostId)}/events`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ralphloop-device-key": input.deviceKey,
    },
    body: JSON.stringify({
      commandId: input.commandId,
      sessionId: input.sessionId,
      taskId: input.taskId,
      runtimeId: input.runtimeId,
      events: input.events,
    }),
  });
  if (!response.ok) {
    throw new Error(`host event post failed: ${response.status}`);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.message === "AbortError");
}
