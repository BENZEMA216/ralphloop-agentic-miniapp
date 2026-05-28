import type { AgUiEvent, AgUiMessage } from "../../../share-gateway/src/productization/agUiEvents.ts";
import type { FriendTaskStatus } from "../components/TaskTimeline.ts";

type AssistantUiTextPart = {
  type: "text";
  text: string;
};

type AssistantUiMessageStatus =
  | { type: "running" }
  | { type: "complete" }
  | { type: "incomplete"; reason: "error" | "cancelled" };

export type AssistantUiExternalStoreMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: AssistantUiTextPart[];
  status?: AssistantUiMessageStatus;
  metadata: {
    source: "ag-ui";
    threadId?: string;
    runId?: string;
  };
};

export type AssistantUiExternalStoreState = {
  currentThreadId?: string;
  currentRunId?: string;
  status: FriendTaskStatus;
  isRunning: boolean;
  messages: AssistantUiExternalStoreMessage[];
  customEvents: Array<{ name: string; value: Record<string, unknown> }>;
  error?: {
    message: string;
    code?: string;
  };
};

const secretLikeKeys = new Set([
  "bootstrap",
  "budget",
  "cost",
  "devicekey",
  "tokenhash",
]);

function assistantUiRole(role: AgUiMessage["role"]): AssistantUiExternalStoreMessage["role"] | undefined {
  if (role === "user" || role === "assistant" || role === "system") {
    return role;
  }
  return undefined;
}

function textFromMessage(message: AgUiMessage): string {
  return String(message.content ?? "");
}

function safeCustomValue(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !secretLikeKeys.has(key.toLowerCase())),
  );
}

function upsertTextMessage(
  messages: AssistantUiExternalStoreMessage[],
  input: {
    id: string;
    role: AssistantUiExternalStoreMessage["role"];
    text: string;
    threadId?: string;
    runId?: string;
    status?: AssistantUiMessageStatus;
  },
) {
  const existing = messages.find((message) => message.id === input.id);
  if (existing) {
    existing.content = [{ type: "text", text: input.text }];
    if (input.status) {
      existing.status = input.status;
    } else {
      delete existing.status;
    }
    existing.metadata = {
      source: "ag-ui",
      threadId: input.threadId,
      runId: input.runId,
    };
    return;
  }
  const message: AssistantUiExternalStoreMessage = {
    id: input.id,
    role: input.role,
    content: [{ type: "text", text: input.text }],
    metadata: {
      source: "ag-ui",
      threadId: input.threadId,
      runId: input.runId,
    },
  };
  if (input.status) {
    message.status = input.status;
  }
  messages.push(message);
}

export function createAssistantUiExternalStoreFromAgUiEvents(
  events: readonly AgUiEvent[],
): AssistantUiExternalStoreState {
  const messages: AssistantUiExternalStoreMessage[] = [];
  const assistantTextByMessageId = new Map<string, string>();
  const assistantMessageOrder: string[] = [];
  const customEvents: AssistantUiExternalStoreState["customEvents"] = [];
  let currentThreadId: string | undefined;
  let currentRunId: string | undefined;
  let status: FriendTaskStatus = "idle";
  let assistantTerminalStatus: AssistantUiMessageStatus | undefined;
  let error: AssistantUiExternalStoreState["error"] | undefined;

  for (const event of events) {
    switch (event.type) {
      case "RUN_STARTED":
        currentThreadId = event.threadId;
        currentRunId = event.runId;
        status = "running";
        for (const message of event.input?.messages ?? []) {
          const role = assistantUiRole(message.role);
          if (!role) {
            continue;
          }
          upsertTextMessage(messages, {
            id: message.id,
            role,
            text: textFromMessage(message),
            threadId: currentThreadId,
            runId: currentRunId,
          });
        }
        break;
      case "TEXT_MESSAGE_START":
        if (!assistantTextByMessageId.has(event.messageId)) {
          assistantTextByMessageId.set(event.messageId, "");
          assistantMessageOrder.push(event.messageId);
        }
        break;
      case "TEXT_MESSAGE_CONTENT":
        if (!assistantTextByMessageId.has(event.messageId)) {
          assistantTextByMessageId.set(event.messageId, "");
          assistantMessageOrder.push(event.messageId);
        }
        assistantTextByMessageId.set(
          event.messageId,
          `${assistantTextByMessageId.get(event.messageId) ?? ""}${event.delta}`,
        );
        break;
      case "RUN_FINISHED":
        currentThreadId = event.threadId;
        currentRunId = event.runId;
        status = event.result?.status === "cancelled" ? "cancelled" : "completed";
        assistantTerminalStatus = event.result?.status === "cancelled"
          ? { type: "incomplete", reason: "cancelled" }
          : { type: "complete" };
        break;
      case "RUN_ERROR":
        status = "failed";
        error = { message: event.message, code: event.code };
        assistantTerminalStatus = { type: "incomplete", reason: "error" };
        break;
      case "CUSTOM":
        customEvents.push({
          name: event.name,
          value: safeCustomValue(event.value),
        });
        if (event.name === "ralphloop.run.cancelled") {
          status = "cancelled";
          assistantTerminalStatus = { type: "incomplete", reason: "cancelled" };
        }
        break;
      case "TEXT_MESSAGE_END":
        break;
    }
  }

  const running = status === "running";
  const assistantStatus = assistantTerminalStatus ?? (running ? { type: "running" as const } : undefined);
  for (const messageId of assistantMessageOrder) {
    const text = assistantTextByMessageId.get(messageId) ?? "";
    if (!text) {
      continue;
    }
    upsertTextMessage(messages, {
      id: messageId,
      role: "assistant",
      text,
      threadId: currentThreadId,
      runId: currentRunId,
      status: assistantStatus,
    });
  }

  return {
    currentThreadId,
    currentRunId,
    status,
    isRunning: running,
    messages,
    customEvents,
    error,
  };
}
