import { Workflow } from "@stable-canvas/comfyui-client";
import { WorkflowInput } from "./types";

const withDefaults = (input: Partial<WorkflowInput>): WorkflowInput => {
  return {
    positivePrompt: input.positivePrompt || "",
    negativePrompt: input.negativePrompt || "",
    inputImage: input.inputImage || [],
    width: input.width || 1024,
    height: input.height || 1024,
    steps: input.steps || 8,
    cfg: input.cfg || 1,
    seed: input.seed || Math.floor(Math.random() * 1000000),
    samplerName: input.samplerName || "sa_solver",
    scheduler: input.scheduler || "beta",
    loras: input.loras || [],
  };
};

const mapQwenImageInputs = (images: unknown[]) => {
  const mapped: Record<string, unknown> = {};
  if (images[0]) mapped.image1 = images[0];
  if (images[1]) mapped.image2 = images[1];
  if (images[2]) mapped.image3 = images[2];
  return mapped;
};

export function buildEditWorkflow(_input: WorkflowInput) {
  const input = withDefaults(_input);
  if (!input.inputImage.length) {
    throw new Error("The 'edit' workflow requires at least one input image.");
  }

  const workflow = new Workflow();
  const cls = workflow.classes;

  const sourcePaths = input.inputImage.filter(Boolean).slice(0, 3);
  const loadedImages = sourcePaths.map((imagePath) => {
    const [image] = cls.LoadImage({
      image: imagePath,
    });
    return image;
  });
  const primaryImage = loadedImages[0];

  /*Get Image Size*/
  const [OUT_0_3, OUT_1_1] = cls.GetImageSize({
    image: primaryImage,
  });
  /*Final Image Size*/
  const [LATENT_2] = cls.EmptyLatentImage({
    width: OUT_0_3,
    height: OUT_1_1,
    batch_size: 1,
  });
  /*Load Checkpoint*/
  const [MODEL_1, CLIP_1, VAE_1] = cls.CheckpointLoaderSimple({
    ckpt_name: "Qwen-Rapid-AIO-NSFW-v23.safetensors",
  });

  let currentModel = MODEL_1;
  for (const lora of input.loras) {
    [currentModel] = cls.LoraLoaderModelOnly({
      lora_name: lora.name,
      strength_model: lora.strength_model,
      model: currentModel,
    });
  }

  const qwenImageInputs = mapQwenImageInputs(loadedImages);

  /*TextEncodeQwenImageEditPlus Negative*/
  const [OUT_0_2] = cls.TextEncodeQwenImageEditPlus({
    prompt: input.negativePrompt,
    clip: CLIP_1,
    vae: VAE_1,
    ...qwenImageInputs,
  });
  /*TextEncodeQwenImageEditPlus Positive*/
  const [OUT_0_1] = cls.TextEncodeQwenImageEditPlus({
    prompt: input.positivePrompt,
    clip: CLIP_1,
    vae: VAE_1,
    ...qwenImageInputs,
  });
  /*KSampler*/
  const [LATENT_1] = cls.KSampler({
    seed: input.seed,
    steps: input.steps,
    cfg: input.cfg,
    sampler_name: input.samplerName,
    scheduler: input.scheduler,
    denoise: 1,
    model: currentModel,
    positive: OUT_0_1,
    negative: OUT_0_2,
    latent_image: LATENT_2,
  });
  /*VAE Decode*/
  const [IMAGE_1] = cls.VAEDecode({
    samples: LATENT_1,
    vae: VAE_1,
  });
  /*Save Image*/
  const [] = cls.SaveImage({
    filename_prefix: "ComfyUI",
    images: IMAGE_1,
  });

  return workflow;
}
