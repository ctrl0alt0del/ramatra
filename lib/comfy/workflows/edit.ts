import { Workflow } from "@stable-canvas/comfyui-client";
import { WorkflowInput } from "./types";

const withDefaults = (input: Partial<WorkflowInput>): WorkflowInput => {
  return {
    positivePrompt: input.positivePrompt || "",
    negativePrompt: input.negativePrompt || "",
    inputImage: input.inputImage || [],
    width: input.width || 1024,
    height: input.height || 1024,
    steps: input.steps || 40,
    cfg: input.cfg || 4,
    seed: input.seed || Math.floor(Math.random() * 1000000),
    samplerName: input.samplerName || "euler",
    scheduler: input.scheduler || "simple",
    loras: input.loras || [],
  };
};

export function buildEditWorkflow(_input: WorkflowInput) {
  const input = withDefaults(_input);
  if (!input.inputImage.length) {
    throw new Error("The 'edit' workflow requires at least one input image.");
  }

  const workflow = new Workflow();
  const cls = workflow.classes;

  const sourceImagePath = input.inputImage.find(Boolean);
  if (!sourceImagePath) {
    throw new Error("The 'edit' workflow requires a valid input image path.");
  }

  /*Enable 4steps LoRA?*/
  const [BOOLEAN_1] = cls.PrimitiveBoolean({
    value: "true",
  });

  /*Steps*/
  const [INT_2] = cls.PrimitiveInt({
    value: 40,
  });

  /*Steps*/
  const [INT_1] = cls.PrimitiveInt({
    value: 4,
  });

  /*Switch (Steps)*/
  const [OUT_0_5] = cls.ComfySwitchNode({
    switch: BOOLEAN_1,
    on_false: INT_2,
    on_true: INT_1,
  });

  /*Load CLIP*/
  const [CLIP_1] = cls.CLIPLoader({
    clip_name: "qwen_2.5_vl_7b_fp8_scaled.safetensors",
    type: "qwen_image",
    device: "default",
  });

  /*Load Diffusion Model*/
  const [MODEL_4] = cls.UNETLoader({
    unet_name: "qwen_image_edit_2511_fp8_e4m3fn.safetensors",
    weight_dtype: "default",
  });

  /*ModelSamplingAuraFlow*/
  const [MODEL_1] = cls.ModelSamplingAuraFlow({
    shift: 3.1,
    model: MODEL_4,
  });

  /*CFGNorm*/
  const [MODEL_2] = cls.CFGNorm({
    strength: 1,
    model: MODEL_1,
  });

  /*Load LoRA*/
  const [MODEL_3] = cls.LoraLoaderModelOnly({
    lora_name: "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors",
    strength_model: 1,
    model: MODEL_2,
  });

  /*Switch (Model)*/
  const [OUT_0_3] = cls.ComfySwitchNode({
    switch: BOOLEAN_1,
    on_false: MODEL_2,
    on_true: MODEL_3,
  });

  let currentModel = OUT_0_3;
  for (const lora of input.loras) {
    [currentModel] = cls.LoraLoaderModelOnly({
      lora_name: lora.name,
      strength_model: lora.strength_model,
      model: currentModel,
    });
  }

  /*CFG*/
  const [FLOAT_2] = cls.PrimitiveFloat({
    value: 1,
  });

  /*CFG*/
  const [FLOAT_1] = cls.PrimitiveFloat({
    value: 4,
  });

  /*Switch (CFG)*/
  const [OUT_0_4] = cls.ComfySwitchNode({
    switch: BOOLEAN_1,
    on_false: FLOAT_1,
    on_true: FLOAT_2,
  });

  /*Load VAE*/
  const [VAE_1] = cls.VAELoader({
    vae_name: "qwen_image_vae.safetensors",
  });

  /*Load Image*/
  const [IMAGE_1] = cls.LoadImage({
    image: sourceImagePath,
  });

  /*FluxKontextImageScale*/
  const [IMAGE_3] = cls.FluxKontextImageScale({
    image: IMAGE_1,
  });

  /*VAE Encode*/
  const [LATENT_1] = cls.VAEEncode({
    pixels: IMAGE_3,
    vae: VAE_1,
  });

  /*TextEncodeQwenImageEditPlus (Positive)*/
  const [OUT_0_2] = cls.TextEncodeQwenImageEditPlus({
    prompt: input.positivePrompt,
    clip: CLIP_1,
    vae: VAE_1,
    image1: IMAGE_3,
  });

  /*Edit Model Reference Method*/
  const [CONDITIONING_2] = cls.FluxKontextMultiReferenceLatentMethod({
    reference_latents_method: "index_timestep_zero",
    conditioning: OUT_0_2,
  });

  /*TextEncodeQwenImageEditPlus*/
  const [OUT_0_1] = cls.TextEncodeQwenImageEditPlus({
    prompt: input.negativePrompt,
    clip: CLIP_1,
    vae: VAE_1,
    image1: IMAGE_3,
  });

  /*Edit Model Reference Method*/
  const [CONDITIONING_1] = cls.FluxKontextMultiReferenceLatentMethod({
    reference_latents_method: "index_timestep_zero",
    conditioning: OUT_0_1,
  });

  /*KSampler*/
  const [LATENT_2] = cls.KSampler({
    seed: input.seed,
    steps: OUT_0_5,
    cfg: OUT_0_4,
    sampler_name: "euler",
    scheduler: "simple",
    denoise: 1,
    model: currentModel,
    positive: CONDITIONING_2,
    negative: CONDITIONING_1,
    latent_image: LATENT_1,
  });

  /*VAE Decode*/
  const [IMAGE_2] = cls.VAEDecode({
    samples: LATENT_2,
    vae: VAE_1,
  });

  /*Save Image*/
  const [] = cls.SaveImage({
    filename_prefix: "Qwen_Edit_2511_edited",
    images: IMAGE_2,
  });

  return workflow;
}

