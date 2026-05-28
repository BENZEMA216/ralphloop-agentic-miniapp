export type FriendTaskStatus =
  | "idle"
  | "waiting"
  | "running"
  | "needs_input"
  | "needs_user_confirm"
  | "needs_owner_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type TaskTimelineModel = {
  status: FriendTaskStatus;
  statusLabel: string;
  items: string[];
};

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

export function createTaskTimeline(input: {
  status?: FriendTaskStatus;
  prompt?: string;
  items?: string[];
} = {}): TaskTimelineModel {
  const status = input.status ?? "idle";
  return {
    status,
    statusLabel: statusLabels[status],
    items: input.items ?? (input.prompt ? [input.prompt] : []),
  };
}
