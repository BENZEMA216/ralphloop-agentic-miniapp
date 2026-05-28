import type { AgentAdapterInfo } from "../adapters/types.ts";

type AdapterInventory = {
  detectAll(): Promise<AgentAdapterInfo[]>;
};

export type JsonResponse<TBody> = {
  status: number;
  body: TBody;
};

export async function listOwnerAdapters(
  inventory: AdapterInventory,
): Promise<JsonResponse<{ adapters: AgentAdapterInfo[] }>> {
  return {
    status: 200,
    body: {
      adapters: await inventory.detectAll(),
    },
  };
}
