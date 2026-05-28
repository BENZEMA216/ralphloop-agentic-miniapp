export type PreviewPanelModel = {
  available: boolean;
  mode: "read_only" | "interactive";
  readOnly: boolean;
  expanded: boolean;
};

export function createPreviewPanel(input: {
  mode: "read_only" | "interactive";
  expanded?: boolean;
}): PreviewPanelModel {
  return {
    available: true,
    mode: input.mode,
    readOnly: input.mode === "read_only",
    expanded: input.expanded ?? false,
  };
}
