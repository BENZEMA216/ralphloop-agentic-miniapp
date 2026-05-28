export type PermissionSource = "user_identity" | "owner_delegated" | "runtime_internal";
export type HighRiskDecision = "allow" | "block" | "user_confirm" | "owner_approve";

export type ActionClassificationInput = {
  action: string;
  permissionSource: PermissionSource;
  summary: string;
  command?: string;
};

export type ActionClassification = {
  decision: HighRiskDecision;
  reason: string;
};

const userConfirmActions = new Set([
  "send_email",
  "send_message",
  "post_comment",
  "purchase",
  "place_order",
  "user_account_access",
]);

const ownerApprovalActions = new Set([
  "owner_account_access",
  "overwrite_file",
]);

const blockedActions = new Set([
  "delete_file",
  "move_file",
  "read_secret",
]);

const destructiveShellPatterns = [
  /\brm\s+-rf\b/,
  /\bchmod\s+-R\s+777\b/,
  /\bdd\s+if=/,
  /\bmkfs\b/,
  /\bDROP\s+TABLE\b/i,
];

export function classifyHighRiskAction(input: ActionClassificationInput): ActionClassification {
  if (input.action === "shell" && isDestructiveShell(input.command ?? input.summary)) {
    return { decision: "block", reason: "destructive_shell" };
  }

  if (blockedActions.has(input.action)) {
    return decisionForSource(input.permissionSource, "blocked_action");
  }

  if (ownerApprovalActions.has(input.action)) {
    return input.permissionSource === "owner_delegated"
      ? { decision: "owner_approve", reason: "owner_delegated_permission" }
      : decisionForSource(input.permissionSource, "sensitive_owner_action");
  }

  if (userConfirmActions.has(input.action)) {
    return decisionForSource(input.permissionSource, "external_side_effect");
  }

  return { decision: "allow", reason: "not_high_risk" };
}

function decisionForSource(source: PermissionSource, reason: string): ActionClassification {
  if (source === "owner_delegated") {
    return { decision: "owner_approve", reason };
  }

  if (source === "user_identity") {
    return { decision: "user_confirm", reason };
  }

  return { decision: "block", reason };
}

function isDestructiveShell(command: string): boolean {
  return destructiveShellPatterns.some((pattern) => pattern.test(command));
}
