import type { AgentAdapterInfo } from "../../../../share-gateway/src/adapters/types.ts";
import { createAdapterPicker } from "../../components/AdapterPicker.ts";
import { createShareLinkPanel } from "../../components/ShareLinkPanel.ts";

export type OwnerPageModelInput = {
  adapters: readonly AgentAdapterInfo[];
  baseUrl: string;
  shareLink?: {
    token: string;
    status: string;
  };
};

export function createOwnerPageModel(input: OwnerPageModelInput) {
  const adapterPicker = createAdapterPicker(input.adapters);

  return {
    layout: "workspace" as const,
    heroMarketing: false,
    adapterPicker,
    shareLinkPanel: createShareLinkPanel({
      baseUrl: input.baseUrl,
      shareLink: input.shareLink,
    }),
    canGenerateShareLink: Boolean(adapterPicker.selectedAdapterId),
    advancedSettingsRequired: false,
  };
}
