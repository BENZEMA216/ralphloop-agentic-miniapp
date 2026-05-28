import { createPermissionPrompt } from "../../components/PermissionPrompt.ts";
import { createPreviewPanel } from "../../components/PreviewPanel.ts";
import type { FriendTaskStatus } from "../../components/TaskTimeline.ts";
import type { AgUiEvent } from "../../../../share-gateway/src/productization/agUiEvents.ts";
import { createAssistantUiExternalStoreFromAgUiEvents } from "../../runtime/agUiExternalStore.ts";

export type SharePageModelInput = {
  token: string;
  agent: {
    name: string;
    adapterId: string;
    previewMode: "read_only" | "interactive";
  };
  task?: {
    id: string;
    status: FriendTaskStatus;
    prompt: string;
  };
  permissionPrompt?: {
    kind: "user_confirm" | "owner_approve" | "blocked";
    actionSummary: string;
  };
  agUiEvents?: AgUiEvent[];
};

export function createSharePageModel(input: SharePageModelInput) {
  const externalStore = input.agUiEvents
    ? createAssistantUiExternalStoreFromAgUiEvents(input.agUiEvents)
    : undefined;
  const status = externalStore?.status ?? input.task?.status ?? "idle";
  const statusLabels: Record<FriendTaskStatus, string> = {
    idle: "等待中",
    waiting: "等待中",
    running: "运行中",
    needs_input: "需要补充信息",
    needs_user_confirm: "需要你确认",
    needs_owner_approval: "需要分享者确认",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
  };
  return {
    token: input.token,
    experienceLabel: "Agent Chat",
    agentName: input.agent.name,
    adapterId: input.agent.adapterId,
    sessionSidebar: {
      visible: true,
      newSessionLabel: "新会话",
    },
    chatThread: {
      visible: true,
      status,
      statusLabel: statusLabels[status],
      messages: externalStore
        ? externalStore.messages.map((message) => ({
          role: message.role,
          content: message.content.map((part) => part.text).join(""),
        }))
        : input.task?.prompt ? [{ role: "user", content: input.task.prompt }] : [],
    },
    chatComposer: {
      inputVisible: true,
      placeholder: "给 Agent 发送消息",
      submitLabel: "发送",
      disabled: false,
    },
    previewDrawer: {
      ...createPreviewPanel({ mode: input.agent.previewMode }),
      open: false,
    },
    permissionPrompt: createPermissionPrompt(input.permissionPrompt),
    directFrameworkUiExposed: false,
  };
}
