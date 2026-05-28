import React from "react";
import { AssistantRuntimeProvider, useExternalStoreRuntime } from "@assistant-ui/react";

import type { AgUiEvent } from "../../share-gateway/src/productization/agUiEvents.ts";
// NOTE: alias `#runtime/*` is configured in tsconfig + vite for editor support,
// but Node's runtime test loader (`node --experimental-strip-types --test`) cannot
// resolve a subpath-imports target that escapes the package root, so the runtime
// import stays relative here.
import { createAssistantUiExternalStoreFromAgUiEvents } from "../../share-web/src/runtime/agUiExternalStore.ts";
import {
  createFriendAgUiRuntimeStore,
  type FriendRuntimeStoreSnapshot,
} from "../../share-web/src/runtime/friendAgUiRuntimeStore.ts";
import { createAssistantUiRuntimeOptions } from "../../share-web/src/runtime/assistantUiRuntimeBinding.ts";

type ThreadStatus = "regular" | "archived";

type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<Response>;

export type RalphloopReactInitialThread = {
  id: string;
  title: string;
  status?: ThreadStatus;
  taskId?: string;
  events?: AgUiEvent[];
};

export type RalphloopReactInitialState = {
  token: string;
  currentThreadId: string;
  taskId?: string;
  threads: RalphloopReactInitialThread[];
};

export type AppProps = {
  initialState: RalphloopReactInitialState;
  fetch?: FetchLike;
  baseUrl?: string;
};

function textFromMessage(message: FriendRuntimeStoreSnapshot["messages"][number]): string {
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function roleLabel(role: FriendRuntimeStoreSnapshot["messages"][number]["role"]): string {
  switch (role) {
    case "assistant":
      return "Agent";
    case "system":
      return "System";
    case "user":
      return "You";
  }
}

function statusLabel(status: FriendRuntimeStoreSnapshot["status"]): string {
  switch (status) {
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    case "running":
      return "运行中";
    case "waiting":
      return "等待中";
    case "idle":
      return "空闲";
  }
}

type RuntimeStore = ReturnType<typeof createFriendAgUiRuntimeStore>;

function HydratedShell(input: {
  store: RuntimeStore;
  snapshot: FriendRuntimeStoreSnapshot;
  onComposerSubmit(prompt: string): void | Promise<void>;
  onCancel(): void | Promise<void>;
}) {
  const runtime = useExternalStoreRuntime(createAssistantUiRuntimeOptions(input.store));
  const snapshot = input.snapshot;
  const currentThread = snapshot.threads.find((thread) => thread.id === snapshot.currentThreadId)
    ?? snapshot.threads[0];

  return React.createElement(
    AssistantRuntimeProvider,
    { runtime },
    React.createElement(
      "main",
      {
        className: "assistant-ui-runtime-shell",
        "data-ralphloop-react-app": "true",
        "data-ralphloop-assistant-ui-shell": "true",
        "data-assistant-ui-layout": "chatbot",
        "data-current-thread-id": snapshot.currentThreadId,
        "data-message-count": String(snapshot.messages.length),
        "data-thread-count": String(snapshot.threads.length),
      },
      React.createElement(
        "aside",
        {
          className: "assistant-ui-thread-rail",
          "data-assistant-ui-thread-list": "true",
        },
        React.createElement(
          "header",
          { className: "assistant-ui-rail-header" },
          React.createElement("p", null, "Sessions"),
        ),
        React.createElement(
          "ol",
          { className: "assistant-ui-thread-list" },
          snapshot.threads.map((thread) =>
            React.createElement(
              "li",
              {
                key: thread.id,
                className: "assistant-ui-thread-list-item",
                "aria-current": thread.id === snapshot.currentThreadId ? "true" : undefined,
              },
              React.createElement("span", null, thread.title),
            ),
          ),
        ),
      ),
      React.createElement(
        "section",
        {
          className: "assistant-ui-thread-panel",
          "data-assistant-ui-thread": "true",
          "data-assistant-ui-thread-status": snapshot.status,
        },
        React.createElement(
          "header",
          { className: "assistant-ui-thread-header" },
          React.createElement(
            "div",
            null,
            React.createElement("p", { className: "assistant-ui-kicker" }, "Agent Chat"),
            React.createElement("h2", null, currentThread?.title ?? "Agent Chat"),
          ),
          React.createElement(
            "div",
            { className: "status-cluster" },
            React.createElement("span", { className: "status-pill" }, statusLabel(snapshot.status)),
          ),
        ),
        React.createElement(
          "ol",
          {
            className: "assistant-ui-message-list",
            "data-assistant-ui-message-list": "true",
          },
          snapshot.messages.map((message) =>
            React.createElement(
              "li",
              {
                key: message.id,
                className: `assistant-ui-message assistant-ui-message-${message.role}`,
                "data-message-role": message.role,
                "data-message-status": message.status?.type ?? "complete",
              },
              React.createElement(
                "strong",
                { className: "assistant-ui-message-role" },
                roleLabel(message.role),
              ),
              React.createElement(
                "p",
                { className: "assistant-ui-message-content" },
                textFromMessage(message),
              ),
            ),
          ),
        ),
        React.createElement(
          ComposerForm,
          {
            isRunning: snapshot.isRunning,
            onSubmitPrompt: input.onComposerSubmit,
            onCancel: input.onCancel,
          },
        ),
      ),
    ),
  );
}

function ComposerForm(input: {
  isRunning: boolean;
  onSubmitPrompt(prompt: string): void | Promise<void>;
  onCancel(): void | Promise<void>;
}) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const isSendDisabled = submitting || input.isRunning;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const textarea = textareaRef.current;
    const prompt = (textarea?.value ?? "").trim();
    if (!prompt) {
      return;
    }
    setSubmitting(true);
    if (textarea) {
      textarea.value = "";
    }
    try {
      await input.onSubmitPrompt(prompt);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      (event.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
    }
  }

  return React.createElement(
    "form",
    {
      id: "assistant-ui-composer-form",
      className: "assistant-ui-composer",
      "data-assistant-ui-composer": "true",
      onSubmit: handleSubmit,
    },
    React.createElement(
      "label",
      { className: "sr-only", htmlFor: "assistant-ui-composer-input" },
      "给 Agent 发送消息",
    ),
    React.createElement("textarea", {
      id: "assistant-ui-composer-input",
      name: "prompt",
      placeholder: "给 Agent 发送消息",
      rows: 2,
      defaultValue: "",
      ref: textareaRef,
      disabled: isSendDisabled,
      onKeyDown: handleKeyDown,
    }),
    React.createElement(
      "div",
      { className: "assistant-ui-composer-actions" },
      React.createElement(
        "span",
        { className: "muted-label" },
        "Enter 发送 · Shift+Enter 换行",
      ),
      React.createElement(
        "div",
        { className: "composer-button-row" },
        React.createElement(
          "button",
          {
            id: "assistant-ui-stop",
            className: "secondary-button danger-outline",
            disabled: !input.isRunning,
            type: "button",
            onClick: () => {
              void input.onCancel();
            },
          },
          "停止",
        ),
        React.createElement(
          "button",
          {
            id: "assistant-ui-send",
            type: "submit",
            disabled: isSendDisabled,
          },
          "发送",
        ),
      ),
    ),
  );
}

function baseUrlWithoutTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

function buildShareEndpoint(input: { baseUrl: string; token: string; path: string }): string {
  return `${baseUrlWithoutTrailingSlash(input.baseUrl)}/v1/share/${encodeURIComponent(input.token)}${input.path}`;
}

async function fetchAgUiEvents(input: {
  baseUrl: string;
  token: string;
  sessionId: string;
  taskId?: string;
  fetchImpl: typeof fetch;
}): Promise<AgUiEvent[]> {
  const params = new URLSearchParams({
    sessionId: input.sessionId,
    format: "ag-ui",
  });
  if (input.taskId) {
    params.set("taskId", input.taskId);
  }
  const url = buildShareEndpoint({
    baseUrl: input.baseUrl,
    token: input.token,
    path: `/events?${params.toString()}`,
  });
  const response = await input.fetchImpl(url);
  if (!response.ok) {
    return [];
  }
  try {
    const body = await response.json() as { events?: AgUiEvent[] };
    return Array.isArray(body.events) ? body.events : [];
  } catch {
    return [];
  }
}

export function App(props: AppProps) {
  // window.fetch needs to be invoked with `this === window`; assigning it to a
  // bare local and calling it indirectly throws TypeError: Illegal invocation.
  const fetchImpl: typeof fetch | undefined = props.fetch
    ?? (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : undefined);
  const baseUrl = props.baseUrl ?? "";
  const token = props.initialState.token;

  const store = React.useMemo(
    () =>
      createFriendAgUiRuntimeStore({
        baseUrl,
        token,
        currentThreadId: props.initialState.currentThreadId,
        threads: props.initialState.threads.map((thread) => ({
          id: thread.id,
          title: thread.title,
          status: thread.status,
          taskId: thread.taskId,
          events: thread.events,
        })),
        fetch: fetchImpl,
      }),
    // store identity is stable for the lifetime of the page
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [snapshot, setSnapshot] = React.useState<FriendRuntimeStoreSnapshot>(() => store.getSnapshot());
  // Tracks the latest event stream that the gateway has accepted for the active
  // thread so the UI can keep refreshing while the host streams output back.
  const [polledEvents, setPolledEvents] = React.useState<AgUiEvent[] | null>(null);
  const pollTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = React.useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const pollSessionEvents = React.useCallback((input: { sessionId: string }) => {
    if (!fetchImpl || !input.sessionId) {
      return;
    }
    stopPolling();
    const startedAt = Date.now();
    let cancelled = false;
    const tick = async () => {
      if (cancelled) {
        return;
      }
      let events: AgUiEvent[] = [];
      try {
        events = await fetchAgUiEvents({
          baseUrl,
          token,
          sessionId: input.sessionId,
          fetchImpl,
        });
      } catch {
        // Network or parse failures are swallowed; the next tick retries.
      }
      if (cancelled) {
        return;
      }
      setPolledEvents(events);
      const state = createAssistantUiExternalStoreFromAgUiEvents(events);
      const terminal = state.status === "completed"
        || state.status === "failed"
        || state.status === "cancelled";
      if (terminal || Date.now() - startedAt > 30_000) {
        pollTimerRef.current = null;
        return;
      }
      pollTimerRef.current = setTimeout(() => {
        void tick();
      }, 350);
    };
    pollTimerRef.current = setTimeout(() => {
      void tick();
    }, 0);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [baseUrl, fetchImpl, stopPolling, token]);

  React.useEffect(() => stopPolling, [stopPolling]);

  const handleSubmit = React.useCallback(async (prompt: string) => {
    const next = await store.onNew({ content: [{ type: "text", text: prompt }] });
    setSnapshot(next);
    setPolledEvents(null);
    pollSessionEvents({ sessionId: next.currentThreadId });
  }, [pollSessionEvents, store]);

  const handleCancel = React.useCallback(async () => {
    try {
      const next = await store.onCancel();
      setSnapshot(next);
    } catch {
      // The store throws when there is no active thread; ignore and rely on the snapshot.
    } finally {
      stopPolling();
    }
  }, [store, stopPolling]);

  // Merge the polled events into the rendered snapshot so the user message and
  // any streamed assistant output appear without waiting for a second submit.
  const mergedSnapshot = React.useMemo<FriendRuntimeStoreSnapshot>(() => {
    if (!polledEvents || polledEvents.length === 0) {
      return snapshot;
    }
    const state = createAssistantUiExternalStoreFromAgUiEvents(polledEvents);
    if (state.messages.length === 0) {
      return snapshot;
    }
    return {
      ...snapshot,
      status: state.status,
      isRunning: state.isRunning,
      messages: state.messages,
    };
  }, [polledEvents, snapshot]);

  return React.createElement(HydratedShell, {
    store,
    snapshot: mergedSnapshot,
    onComposerSubmit: handleSubmit,
    onCancel: handleCancel,
  });
}

export default App;
