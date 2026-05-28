import { randomUUID } from "node:crypto";

import type { JsonResponse } from "./adapters.ts";

export type ShareLinkStatus = "active" | "paused" | "revoked" | "expired";
export type PermissionMode = "user_identity" | "owner_delegated_explicit";
export type DesktopPreviewMode = "read_only" | "interactive";
export type HighRiskActionMode = "block" | "user_confirm" | "owner_approve";

export type SharePolicy = {
  maxTotalBudget: number;
  maxTaskBudget: number;
  maxConcurrentSessions: number;
  allowDesktopPreview: boolean;
  desktopPreviewMode: DesktopPreviewMode;
  defaultPermissionMode: PermissionMode;
  allowUserIdentityConnectors: boolean;
  allowOwnerDelegatedPermissions: boolean;
  highRiskActionMode: HighRiskActionMode;
  approvalRequiredActions: string[];
  blockedActions: string[];
};

export type ShareLink = {
  id: string;
  token: string;
  adapterId: string;
  name: string;
  status: ShareLinkStatus;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
  policy: SharePolicy;
};

export type CreateShareLinkInput = {
  adapterId: string;
  name?: string;
  expiresAt?: string;
  policy?: Partial<SharePolicy>;
};

type CreateShareLinkOptions = {
  store: ShareLinkStore;
  input: CreateShareLinkInput;
  tokenFactory?: () => string;
  now?: () => Date;
};

export class ShareLinkStore {
  readonly #linksByToken = new Map<string, ShareLink>();

  create(link: ShareLink): ShareLink {
    this.#linksByToken.set(link.token, link);
    return link;
  }

  findByToken(token: string): ShareLink | undefined {
    return this.#linksByToken.get(token);
  }

  updateStatus(token: string, status: ShareLinkStatus): ShareLink | undefined {
    const link = this.findByToken(token);
    if (!link) {
      return undefined;
    }

    link.status = status;
    if (status === "revoked") {
      link.revokedAt = new Date().toISOString();
    }
    return link;
  }
}

export function createOwnerShareLink(
  options: CreateShareLinkOptions,
): JsonResponse<{ shareLink: ShareLink }> {
  const now = options.now?.() ?? new Date();
  const token = options.tokenFactory?.() ?? randomUUID();
  const shareLink = options.store.create({
    id: randomUUID(),
    token,
    adapterId: options.input.adapterId,
    name: options.input.name ?? "Shared Agent",
    status: "active",
    createdAt: now.toISOString(),
    expiresAt: options.input.expiresAt ?? new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    policy: {
      ...defaultSharePolicy(),
      ...options.input.policy,
    },
  });

  return {
    status: 201,
    body: { shareLink },
  };
}

export function getSharedAgentPage(
  input: { store: ShareLinkStore; token: string; now?: () => Date },
): JsonResponse<
  | { available: true; agent: { name: string; adapterId: string; previewMode: DesktopPreviewMode } }
  | { available: false; error: string }
> {
  const link = input.store.findByToken(input.token);
  const unavailable = unavailableResponse(link, input.now?.() ?? new Date());
  if (unavailable) {
    return unavailable;
  }

  return {
    status: 200,
    body: {
      available: true,
      agent: {
        name: link.name,
        adapterId: link.adapterId,
        previewMode: link.policy.desktopPreviewMode,
      },
    },
  };
}

export function pauseShareLink(input: { store: ShareLinkStore; token: string }): JsonResponse<{ ok: boolean }> {
  return {
    status: input.store.updateStatus(input.token, "paused") ? 200 : 404,
    body: { ok: Boolean(input.store.findByToken(input.token)) },
  };
}

export function revokeShareLink(input: { store: ShareLinkStore; token: string }): JsonResponse<{ ok: boolean }> {
  return {
    status: input.store.updateStatus(input.token, "revoked") ? 200 : 404,
    body: { ok: Boolean(input.store.findByToken(input.token)) },
  };
}

export function getAvailableShareLink(
  input: { store: ShareLinkStore; token: string; now?: () => Date },
): { link?: ShareLink; response?: JsonResponse<{ error: string }> } {
  const link = input.store.findByToken(input.token);
  const unavailable = unavailableResponse(link, input.now?.() ?? new Date());
  if (unavailable) {
    return {
      response: {
        status: unavailable.status,
        body: { error: "share_link_unavailable" },
      },
    };
  }

  return { link };
}

function unavailableResponse(
  link: ShareLink | undefined,
  now: Date,
): JsonResponse<{ available: false; error: string }> | undefined {
  if (!link || link.status === "revoked") {
    return { status: 404, body: { available: false, error: "share_link_unavailable" } };
  }

  if (link.status === "paused") {
    return { status: 423, body: { available: false, error: "share_link_paused" } };
  }

  if (link.status === "expired" || Date.parse(link.expiresAt) <= now.getTime()) {
    return { status: 410, body: { available: false, error: "share_link_expired" } };
  }

  return undefined;
}

function defaultSharePolicy(): SharePolicy {
  return {
    maxTotalBudget: 20,
    maxTaskBudget: 2,
    maxConcurrentSessions: 1,
    allowDesktopPreview: true,
    desktopPreviewMode: "read_only",
    defaultPermissionMode: "user_identity",
    allowUserIdentityConnectors: true,
    allowOwnerDelegatedPermissions: false,
    highRiskActionMode: "owner_approve",
    approvalRequiredActions: [
      "send_message",
      "purchase",
      "delete_file",
      "owner_account_access",
      "sensitive_secret_read",
    ],
    blockedActions: ["destructive_shell"],
  };
}
