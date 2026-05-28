export type TaskComposerModel = {
  title: string;
  inputVisible: boolean;
  submitLabel: string;
  disabled: boolean;
};

export function createTaskComposer(input: { disabled?: boolean } = {}): TaskComposerModel {
  return {
    title: "给 Agent 一个任务",
    inputVisible: true,
    submitLabel: "提交任务",
    disabled: input.disabled ?? false,
  };
}
