import type { RuntimeEvent } from "../adapters/types.ts";

export type AgUiMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool" | "reasoning";
  content: string;
};

export type AgUiEvent =
  | {
    type: "RUN_STARTED";
    threadId: string;
    runId: string;
    input?: { messages: AgUiMessage[] };
  }
  | {
    type: "RUN_FINISHED";
    threadId: string;
    runId: string;
    result?: { status: "completed" | "cancelled" };
  }
  | {
    type: "RUN_ERROR";
    message: string;
    code?: string;
  }
  | {
    type: "TEXT_MESSAGE_START";
    messageId: string;
    role: "assistant";
  }
  | {
    type: "TEXT_MESSAGE_CONTENT";
    messageId: string;
    delta: string;
  }
  | {
    type: "TEXT_MESSAGE_END";
    messageId: string;
  }
  | {
    type: "CUSTOM";
    name: string;
    value: Record<string, unknown>;
  };

export function runtimeEventsToAgUiEvents(input: {
  threadId: string;
  runId: string;
  prompt?: string;
  events: RuntimeEvent[];
}): AgUiEvent[] {
  const events: AgUiEvent[] = [];
  const assistantMessageId = `${input.runId}:assistant`;
  let assistantMessageStarted = false;
  let assistantOutputChunks = 0;

  const runStarted: AgUiEvent = {
    type: "RUN_STARTED",
    threadId: input.threadId,
    runId: input.runId,
  };
  if (input.prompt) {
    runStarted.input = {
      messages: [{ id: `${input.runId}:user`, role: "user", content: input.prompt }],
    };
  }
  events.push(runStarted);

  const closeAssistantMessage = () => {
    if (!assistantMessageStarted) {
      return;
    }
    events.push({ type: "TEXT_MESSAGE_END", messageId: assistantMessageId });
    assistantMessageStarted = false;
  };

  const appendAssistantContent = (text: string) => {
    if (!text) {
      return;
    }
    if (!assistantMessageStarted) {
      events.push({
        type: "TEXT_MESSAGE_START",
        messageId: assistantMessageId,
        role: "assistant",
      });
      assistantMessageStarted = true;
    }
    events.push({
      type: "TEXT_MESSAGE_CONTENT",
      messageId: assistantMessageId,
      delta: assistantOutputChunks > 0 ? `\n${text}` : text,
    });
    assistantOutputChunks += 1;
  };

  for (const event of input.events) {
    switch (event.type) {
      case "task.accepted":
        break;
      case "task.output":
        appendAssistantContent(event.text);
        break;
      case "task.plan":
      case "task.progress":
        events.push({
          type: "CUSTOM",
          name: `ralphloop.${event.type}`,
          value: { threadId: input.threadId, runId: input.runId, text: event.text },
        });
        break;
      case "task.needs_user_auth":
        events.push({
          type: "CUSTOM",
          name: "ralphloop.task.needs_user_auth",
          value: {
            threadId: input.threadId,
            runId: input.runId,
            provider: event.provider,
            scopeSummary: event.scopeSummary,
          },
        });
        break;
      case "task.needs_user_confirm":
      case "task.needs_owner_approval":
        events.push({
          type: "CUSTOM",
          name: `ralphloop.${event.type}`,
          value: {
            threadId: input.threadId,
            runId: input.runId,
            actionSummary: event.actionSummary,
          },
        });
        break;
      case "task.completed":
        closeAssistantMessage();
        events.push({
          type: "RUN_FINISHED",
          threadId: input.threadId,
          runId: input.runId,
          result: { status: "completed" },
        });
        break;
      case "task.failed":
        closeAssistantMessage();
        events.push({
          type: "RUN_ERROR",
          message: event.message,
          code: "task_failed",
        });
        break;
      case "task.cancelled":
        closeAssistantMessage();
        events.push({
          type: "CUSTOM",
          name: "ralphloop.run.cancelled",
          value: { threadId: input.threadId, runId: input.runId },
        });
        events.push({
          type: "RUN_FINISHED",
          threadId: input.threadId,
          runId: input.runId,
          result: { status: "cancelled" },
        });
        break;
    }
  }

  return events;
}
