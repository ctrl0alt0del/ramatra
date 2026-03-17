import { getStoredGeneration } from "@/lib/comfy/generations";
import { getTask } from "@/lib/tasks/store";
import type { LmStudioInputItem } from "@/lib/tasks/chat/input/types";

const getCritiqueSourceData = ({
  comfyTaskId,
  imageIndex,
}: {
  comfyTaskId: string;
  imageIndex: number;
}) => {
  const comfyTask = getTask(comfyTaskId);
  if (!comfyTask || comfyTask.type !== "comfy") {
    throw new Error("Critique source comfy task not found.");
  }

  const jobId = comfyTask.result?.jobId ?? null;
  if (!jobId) {
    throw new Error("Critique source task has no generation job id.");
  }

  const generation = getStoredGeneration(jobId);
  if (!generation || generation.status !== "completed") {
    throw new Error("Critique source generation is not completed.");
  }

  const image = generation.images[imageIndex];
  if (!image) {
    throw new Error("Critique source image index is out of range.");
  }

  return { comfyTask, image };
};

export const buildUnbiasedCritiqueLmStudioInput = ({
  comfyTaskId,
  imageIndex,
}: {
  comfyTaskId: string;
  imageIndex: number;
}): LmStudioInputItem[] => {
  const { image } = getCritiqueSourceData({ comfyTaskId, imageIndex });

  return [
    {
      type: "text",
      content: [
        "Audit this AI-generated image without any prompt/context.",
        "Return sections:",
        "1) Anatomical issues",
        "2) Graphical/rendering issues",
        "3) Composition/lighting issues",
        "4) Realism/style consistency issues",
      ].join("\n"),
    },
    {
      type: "image",
      data_url: `data:${image.mimeType};base64,${image.data}`,
    },
  ];
};

export const buildBiasedCritiqueLmStudioInput = ({
  comfyTaskId,
  imageIndex,
  savedIntent,
  unbiasedCritique,
}: {
  comfyTaskId: string;
  imageIndex: number;
  savedIntent: string;
  unbiasedCritique: string;
}): LmStudioInputItem[] => {
  const { comfyTask, image } = getCritiqueSourceData({
    comfyTaskId,
    imageIndex,
  });

  const critiqueInputText = [
    "Saved user intent:",
    savedIntent.trim() || "(not available)",
    "",
    "Unbiased critique (image-only):",
    unbiasedCritique.trim() || "(not available)",
    "",
    "Generation setup to evaluate against:",
    JSON.stringify(
      {
        workflowName: comfyTask.payload.workflowName,
        positivePrompt: comfyTask.payload.prompt,
        negativePrompt: comfyTask.payload.negativePrompt,
        width: comfyTask.payload.width,
        height: comfyTask.payload.height,
        steps: comfyTask.payload.steps,
        cfg: comfyTask.payload.cfg,
        seed: comfyTask.payload.seed,
        samplerName: comfyTask.payload.samplerName,
        scheduler: comfyTask.payload.scheduler,
        loras: comfyTask.payload.loras,
        inputImage: comfyTask.payload.inputImage,
        sourceTaskId: comfyTask.id,
        sourceJobId: comfyTask.result?.jobId ?? null,
        selectedImageIndex: imageIndex,
      },
      null,
      2,
    ),
    "",
    "Return sections:",
    "1) Summary",
    "2) Intent mismatch bullets",
    "3) Anatomical issues bullets",
    "4) Graphical issues bullets",
    "5) Corrected positivePrompt",
    "6) Corrected negativePrompt",
  ].join("\n");

  return [
    {
      type: "text",
      content: critiqueInputText,
    },
    {
      type: "image",
      data_url: `data:${image.mimeType};base64,${image.data}`,
    },
  ];
};
