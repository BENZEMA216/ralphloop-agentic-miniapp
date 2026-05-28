export type PermissionPromptInput = {
  kind: "user_confirm" | "owner_approve" | "blocked";
  actionSummary: string;
};

export type PermissionPromptModel = {
  kind: PermissionPromptInput["kind"];
  label: string;
  actionSummary: string;
};

const labels: Record<PermissionPromptInput["kind"], string> = {
  user_confirm: "需要你确认",
  owner_approve: "需要分享者确认",
  blocked: "已被安全策略阻止",
};

export function createPermissionPrompt(input?: PermissionPromptInput): PermissionPromptModel | undefined {
  if (!input) {
    return undefined;
  }

  return {
    kind: input.kind,
    label: labels[input.kind],
    actionSummary: input.actionSummary,
  };
}
