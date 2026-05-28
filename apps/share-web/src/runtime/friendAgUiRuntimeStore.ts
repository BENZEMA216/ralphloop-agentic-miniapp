import type { AgUiEvent } from "../../../share-gateway/src/productization/agUiEvents.ts";
import {
  createAssistantUiExternalStoreFromAgUiEvents,
  type AssistantUiExternalStoreMessage,
  type AssistantUiExternalStoreState,
} from "./agUiExternalStore.ts";
import { createFriendAgUiRuntimeClient } from "./friendAgUiRuntimeClient.ts";

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

type ThreadStatus = "regular" | "archived";

type FriendRuntimeThreadInput = {
  id: string;
  title: string;
  status?: ThreadStatus;
  taskId?: string;
  events?: AgUiEvent[];
};

export type FriendRuntimeThreadSummary = {
  id: string;
  title: string;
  status: ThreadStatus;
};

export type FriendRuntimeStoreSnapshot = {
  currentThreadId: string;
  status: AssistantUiExternalStoreState["status"];
  isRunning: boolean;
  messages: AssistantUiExternalStoreMessage[];
  threads: FriendRuntimeThreadSummary[];
  archivedThreads: FriendRuntimeThreadSummary[];
};

export type FriendAssistantUiThreadListAdapter = {
  threadId: string;
  threads: FriendRuntimeThreadSummary[];
  archivedThreads: FriendRuntimeThreadSummary[];
  onSwitchToNewThread(): Promise<void>;
  onSwitchToThread(threadId: string): Promise<void>;
  onRename(threadId: string, title: string): void;
  onArchive(threadId: string): void;
  onUnarchive(threadId: string): void;
  onDelete(threadId: string): void;
};

export type FriendAssistantUiExternalStoreAdapter = {
  messages: AssistantUiExternalStoreMessage[];
  isRunning: boolean;
  onNew(message: AppendMessageLike): Promise<void>;
  onCancel(): Promise<void>;
  adapters: {
    threadList: FriendAssistantUiThreadListAdapter;
  };
};

type RuntimeThread = {
  id: string;
  title: string;
  status: ThreadStatus;
  taskId: string;
  state: AssistantUiExternalStoreState;
};

function baseUrlWithoutTrailingSlash(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}

function endpoint(input: { baseUrl: string; token: string; path: string }): string {
  return `${baseUrlWithoutTrailingSlash(input.baseUrl)}/v1/share/${encodeURIComponent(input.token)}${input.path}`;
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

function textFromMessage(message: AppendMessageLike): string {
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

function defaultExternalStoreState(): AssistantUiExternalStoreState {
  return createAssistantUiExternalStoreFromAgUiEvents([]);
}

function titleFromPrompt(prompt: string): string {
  const normalized = prompt.trim().replace(/\s+/g, " ");
  return normalized.length > 48 ? `${normalized.slice(0, 45)}...` : normalized;
}

function summarize(thread: RuntimeThread): FriendRuntimeThreadSummary {
  return {
    id: thread.id,
    title: thread.title,
    status: thread.status,
  };
}

export function createFriendAgUiRuntimeStore(input: {
  baseUrl: string;
  token: string;
  currentThreadId?: string;
  threads: FriendRuntimeThreadInput[];
  fetch?: FetchLike;
}) {
  const fetchImpl = input.fetch ?? fetch;
  const threads = new Map<string, RuntimeThread>();
  const clients = new Map<string, ReturnType<typeof createFriendAgUiRuntimeClient>>();

  for (const threadInput of input.threads) {
    const state = threadInput.events
      ? createAssistantUiExternalStoreFromAgUiEvents(threadInput.events)
      : defaultExternalStoreState();
    threads.set(threadInput.id, {
      id: threadInput.id,
      title: threadInput.title,
      status: threadInput.status ?? "regular",
      taskId: threadInput.taskId ?? state.currentRunId ?? "",
      state,
    });
  }

  let currentThreadId = input.currentThreadId ?? input.threads[0]?.id ?? "";

  function clientForThread(threadId: string) {
    const thread = threads.get(threadId);
    if (!thread) {
      throw new Error(`Unknown thread: ${threadId}`);
    }
    const existing = clients.get(threadId);
    if (existing) {
      return existing;
    }
    const client = createFriendAgUiRuntimeClient({
      baseUrl: input.baseUrl,
      token: input.token,
      sessionId: thread.id,
      initialTaskId: thread.taskId,
      fetch: fetchImpl,
    });
    clients.set(threadId, client);
    return client;
  }

  function currentThread(): RuntimeThread | undefined {
    return threads.get(currentThreadId);
  }

  function sortedSummaries(status: ThreadStatus) {
    return [...threads.values()]
      .filter((thread) => thread.status === status)
      .map(summarize);
  }

  function getSnapshot(): FriendRuntimeStoreSnapshot {
    const thread = currentThread();
    const state = thread?.state ?? defaultExternalStoreState();
    return {
      currentThreadId,
      status: state.status,
      isRunning: state.isRunning,
      messages: state.messages,
      threads: sortedSummaries("regular"),
      archivedThreads: sortedSummaries("archived"),
    };
  }

  async function createThread(title = "新会话"): Promise<FriendRuntimeStoreSnapshot> {
    const response = await fetchImpl(endpoint({
      baseUrl: input.baseUrl,
      token: input.token,
      path: "/sessions",
    }), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = await readJson(response);
    assertOk(response, body, "session_create_failed");
    const session = body.session as { id?: string; status?: string } | undefined;
    const sessionId = String(session?.id ?? "");
    if (!sessionId) {
      throw new Error("session_id_missing");
    }
    threads.set(sessionId, {
      id: sessionId,
      title,
      status: "regular",
      taskId: "",
      state: defaultExternalStoreState(),
    });
    currentThreadId = sessionId;
    return getSnapshot();
  }

  async function switchToThread(threadId: string): Promise<FriendRuntimeStoreSnapshot> {
    if (!threads.has(threadId)) {
      throw new Error(`Unknown thread: ${threadId}`);
    }
    currentThreadId = threadId;
    return getSnapshot();
  }

  async function onNew(message: AppendMessageLike): Promise<FriendRuntimeStoreSnapshot> {
    if (!currentThreadId || !threads.has(currentThreadId)) {
      await createThread();
    }
    const thread = currentThread();
    if (!thread) {
      throw new Error("No active thread");
    }
    const prompt = textFromMessage(message);
    const state = await clientForThread(thread.id).onNew(message);
    thread.state = state;
    thread.taskId = state.currentRunId ?? clientForThread(thread.id).currentTaskId;
    if (thread.title === "新会话") {
      thread.title = titleFromPrompt(prompt);
    }
    return getSnapshot();
  }

  async function onCancel(): Promise<FriendRuntimeStoreSnapshot> {
    const thread = currentThread();
    if (!thread) {
      throw new Error("No active thread");
    }
    const state = await clientForThread(thread.id).onCancel();
    thread.state = state;
    thread.taskId = state.currentRunId ?? thread.taskId;
    return getSnapshot();
  }

  function renameThread(threadId: string, title: string) {
    const thread = threads.get(threadId);
    if (!thread) {
      throw new Error(`Unknown thread: ${threadId}`);
    }
    thread.title = title.trim() || thread.title;
  }

  function archiveThread(threadId: string) {
    const thread = threads.get(threadId);
    if (!thread) {
      throw new Error(`Unknown thread: ${threadId}`);
    }
    thread.status = "archived";
  }

  function unarchiveThread(threadId: string) {
    const thread = threads.get(threadId);
    if (!thread) {
      throw new Error(`Unknown thread: ${threadId}`);
    }
    thread.status = "regular";
  }

  function deleteThread(threadId: string) {
    threads.delete(threadId);
    clients.delete(threadId);
    if (currentThreadId === threadId) {
      currentThreadId = sortedSummaries("regular")[0]?.id ?? sortedSummaries("archived")[0]?.id ?? "";
    }
  }

  function getAssistantUiExternalStoreAdapter(): FriendAssistantUiExternalStoreAdapter {
    const snapshot = getSnapshot();
    return {
      messages: snapshot.messages,
      isRunning: snapshot.isRunning,
      onNew: async (message) => {
        await onNew(message);
      },
      onCancel: async () => {
        await onCancel();
      },
      adapters: {
        threadList: {
          threadId: snapshot.currentThreadId,
          threads: snapshot.threads,
          archivedThreads: snapshot.archivedThreads,
          onSwitchToNewThread: async () => {
            await createThread();
          },
          onSwitchToThread: async (threadId) => {
            await switchToThread(threadId);
          },
          onRename: renameThread,
          onArchive: archiveThread,
          onUnarchive: unarchiveThread,
          onDelete: deleteThread,
        },
      },
    };
  }

  return {
    getSnapshot,
    getAssistantUiExternalStoreAdapter,
    createThread,
    switchToThread,
    onNew,
    onCancel,
    renameThread,
    archiveThread,
    unarchiveThread,
    deleteThread,
  };
}
