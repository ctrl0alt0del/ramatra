export const workflowNames = ["base", "illustration"] as const;

export type WorkflowName = (typeof workflowNames)[number];

export type WorkflowInput = {
  positivePrompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  seed: number;
  samplerName: string;
  scheduler: string;
  loras: {
    name: string;
    strength_model: number;
    strength_clip: number;
  }[];
};
