import type { FriendAuthProvider } from "./types.ts";

export type FriendAuthPendingState =
  | {
    id: string;
    provider: "manual";
    status: "pending";
    prompt: string;
  }
  | {
    id: string;
    provider: "file";
    status: "pending";
    accept: string[];
    maxBytes: number;
  };

const supportedProviders = new Set<FriendAuthProvider>(["manual", "file"]);

export function parseFriendAuthProvider(value: string): FriendAuthProvider | undefined {
  if (supportedProviders.has(value as FriendAuthProvider)) {
    return value as FriendAuthProvider;
  }
  return undefined;
}

export function buildPendingAuthState(input: { id: string; provider: FriendAuthProvider }): FriendAuthPendingState {
  if (input.provider === "manual") {
    return {
      id: input.id,
      provider: "manual",
      status: "pending",
      prompt: "请在当前网页里继续使用你的账号完成授权（V0 stub）。",
    };
  }

  return {
    id: input.id,
    provider: "file",
    status: "pending",
    accept: ["application/json", "text/plain"],
    maxBytes: 256 * 1024,
  };
}
