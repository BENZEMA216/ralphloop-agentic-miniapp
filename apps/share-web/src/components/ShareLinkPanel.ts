export type ShareLinkPanelInput = {
  baseUrl: string;
  shareLink?: {
    token: string;
    status: string;
  };
};

export type ShareLinkPanelModel = {
  status: "empty" | string;
  copyableUrl?: string;
};

export function createShareLinkPanel(input: ShareLinkPanelInput): ShareLinkPanelModel {
  if (!input.shareLink) {
    return { status: "empty" };
  }

  return {
    status: input.shareLink.status,
    copyableUrl: `${input.baseUrl.replace(/\/$/, "")}/share/${input.shareLink.token}`,
  };
}
