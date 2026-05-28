import type { AgentAdapter } from "../adapters/types.ts";
import type { JsonResponse } from "./adapters.ts";
import { ShareLinkStore, getAvailableShareLink } from "./shareLinks.ts";

export type TaskResponseBody =
  | { task: { id: string; status: string } }
  | { error: string };

export async function submitSharedTask(input: {
  store: ShareLinkStore;
  token: string;
  prompt: string;
  adapters: Record<string, AgentAdapter>;
}): Promise<JsonResponse<TaskResponseBody>> {
  const { link, response } = getAvailableShareLink({
    store: input.store,
    token: input.token,
  });

  if (response || !link) {
    return response ?? { status: 404, body: { error: "share_link_unavailable" } };
  }

  const adapter = input.adapters[link.adapterId];
  if (!adapter) {
    return { status: 503, body: { error: "adapter_unavailable" } };
  }

  const runtime = await adapter.start({ adapterId: link.adapterId });
  const task = await adapter.submitTask({
    runtime,
    prompt: input.prompt,
  });

  return {
    status: 202,
    body: {
      task: {
        id: task.taskId,
        status: task.status,
      },
    },
  };
}
