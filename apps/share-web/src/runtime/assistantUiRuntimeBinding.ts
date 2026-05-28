import type { FriendAssistantUiExternalStoreAdapter } from "./friendAgUiRuntimeStore.ts";

type RuntimeStore = {
  getAssistantUiExternalStoreAdapter(): FriendAssistantUiExternalStoreAdapter;
};

export function createAssistantUiRuntimeOptions(store: RuntimeStore): FriendAssistantUiExternalStoreAdapter {
  return store.getAssistantUiExternalStoreAdapter();
}
