import type { AgUiEvent } from "../../../share-gateway/src/productization/agUiEvents.ts";
import {
  createAssistantUiExternalStoreFromAgUiEvents,
  type AssistantUiExternalStoreState,
} from "./agUiExternalStore.ts";

type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<Response>;

type AppendMessageLike = {
  content: Array<{ type: string; text?: string } | Record<string, unknown>>;
};

export type FriendAgUiRuntimeClient = {
  readonly currentTaskId: string;
  loadEvents(taskId?: string): Promise<AssistantUiExternalStoreState>;
  onNew(message: AppendMessageLike): Promise<AssistantUiExternalStoreState>;
  onCancel(): Promise<AssistantUiExternalStoreState>;
};

function baseUrlWithoutTrailingSlash(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}

function endpoint(input: { baseUrl: string; token: string; path: string }): string {
  return `${baseUrlWithoutTrailingSlash(input.baseUrl)}/v1/share/${encodeURIComponent(input.token)}${input.path}`;
}

function extractText(message: AppendMessageLike): string {
  const firstPart = message.content[0];
  if (!firstPart || firstPart.type !== "text") {
    throw new Error("Only text messages are supported");
  }
  const text = String(firstPart.text ?? "");
  if (!text.trim()) {
    throw new Error("Message text is required");
  }
  return text;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}

function assertOk(response: Response, body: Record<string, unknown>, fallback: string) {
  if (!response.ok) {
    throw new Error(String(body.error ?? fallback));
  }
}

function agUiEventsFromBody(body: Record<string, unknown>): AgUiEvent[] {
  return Array.isArray(body.events) ? body.events as AgUiEvent[] : [];
}

export function createFriendAgUiRuntimeClient(input: {
  baseUrl: string;
  token: string;
  sessionId: string;
  initialTaskId?: string;
  fetch?: FetchLike;
}): FriendAgUiRuntimeClient {
  const fetchImpl = input.fetch ?? fetch;
  let currentTaskId = input.initialTaskId ?? "";

  const loadEvents = async (taskId = currentTaskId): Promise<AssistantUiExternalStoreState> => {
    if (!taskId) {
      return createAssistantUiExternalStoreFromAgUiEvents([]);
    }
    const url = endpoint({
      baseUrl: input.baseUrl,
      token: input.token,
      path: `/events?sessionId=${encodeURIComponent(input.sessionId)}&taskId=${encodeURIComponent(taskId)}&format=ag-ui`,
    });
    const response = await fetchImpl(url);
    const body = await readJson(response);
    assertOk(response, body, "events_unavailable");
    return createAssistantUiExternalStoreFromAgUiEvents(agUiEventsFromBody(body));
  };

  return {
    get currentTaskId() {
      return currentTaskId;
    },
    loadEvents,
    async onNew(message) {
      const prompt = extractText(message);
      const response = await fetchImpl(endpoint({
        baseUrl: input.baseUrl,
        token: input.token,
        path: "/tasks",
      }), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: input.sessionId,
          prompt,
        }),
      });
      const body = await readJson(response);
      assertOk(response, body, "task_submit_failed");
      const task = body.task as { id?: string } | undefined;
      currentTaskId = String(task?.id ?? "");
      if (!currentTaskId) {
        throw new Error("task_id_missing");
      }
      return await loadEvents(currentTaskId);
    },
    async onCancel() {
      if (!currentTaskId) {
        throw new Error("No active task to cancel");
      }
      const response = await fetchImpl(endpoint({
        baseUrl: input.baseUrl,
        token: input.token,
        path: `/sessions/${encodeURIComponent(input.sessionId)}/cancel`,
      }), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId: currentTaskId }),
      });
      const body = await readJson(response);
      assertOk(response, body, "cancel_failed");
      return await loadEvents(currentTaskId);
    },
  };
}
