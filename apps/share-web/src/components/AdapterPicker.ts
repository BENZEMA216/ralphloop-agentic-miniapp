import type { AgentAdapterInfo } from "../../../share-gateway/src/adapters/types.ts";

export type AdapterPickerOption = {
  id: string;
  label: string;
  status: AgentAdapterInfo["status"];
  disabled: boolean;
  caption: string;
};

export type AdapterPickerModel = {
  options: AdapterPickerOption[];
  selectedAdapterId?: string;
};

export function createAdapterPicker(adapters: readonly AgentAdapterInfo[]): AdapterPickerModel {
  const options = adapters.map((adapter) => ({
    id: adapter.id,
    label: adapter.displayName,
    status: adapter.status,
    disabled: adapter.status !== "available",
    caption: adapter.version ?? adapter.status,
  }));
  const available = options.filter((option) => !option.disabled);

  return {
    options,
    selectedAdapterId: available.length === 1 ? available[0].id : available[0]?.id,
  };
}
