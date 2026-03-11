import { Workflow } from "@stable-canvas/comfyui-client";
import { WorkflowInput } from "./types";

const withDefaults = (input: Partial<WorkflowInput>): WorkflowInput => {
  return {
    positivePrompt: input.positivePrompt || "",
    negativePrompt: input.negativePrompt || "",
    width: input.width || 1024,
    height: input.height || 1024,
    steps: input.steps || 25,
    cfg: input.cfg || 2,
    seed: input.seed || Math.floor(Math.random() * 1000000),
    samplerName: input.samplerName || "euler",
    scheduler: input.scheduler || "simple",
    loras: input.loras || [],
  };
};

export function buildQuickChromaWorkflow(_input: WorkflowInput) {
  const input = withDefaults(_input);
  const workflow = new Workflow();
  const cls = workflow.classes;
  /*EmptySD3LatentImage*/
  const [LATENT_1] = cls.EmptySD3LatentImage({
    width: input.width,
    height: input.height,
    batch_size: 1,
  });
  /*Load CLIP*/
  const [CLIP_1] = cls.CLIPLoader({
    clip_name: "flan_t5_xxl_TE-only_FP8.safetensors",
    type: "chroma",
    device: "default",
  });
  /*Load Diffusion Model*/
  const [MODEL_2] = cls.UNETLoader({
    unet_name: "Chroma1-HD-fp8mixed.safetensors",
    weight_dtype: "default",
  });
  /*Load LoRA (Model and CLIP)*/
  const [MODEL_3, CLIP_3] = cls.LoraLoader({
    lora_name: "hardy_v2\\chroma_tom_hardy_000004250.safetensors",
    strength_model: 1,
    strength_clip: 1,
    model: MODEL_2,
    clip: CLIP_1,
  });
  /*T5TokenizerOptions*/
  const [CLIP_2] = cls.T5TokenizerOptions({
    min_padding: 1,
    min_length: 0,
    clip: CLIP_3,
  });
  /*CLIP Text Encode (Negative Prompt)*/
  const [CONDITIONING_2] = cls.CLIPTextEncode({
    text: input.negativePrompt,
    clip: CLIP_2,
  });
  /*CLIP Text Encode (Positive Prompt)*/
  const [CONDITIONING_1] = cls.CLIPTextEncode({
    text: input.positivePrompt,
    clip: CLIP_2,
  });
  /*Flow Shift*/
  const [MODEL_1] = cls.ModelSamplingAuraFlow({
    shift: 1,
    model: MODEL_3,
  });
  /*BasicScheduler*/
  const [SIGMAS_1] = cls.BasicScheduler({
    scheduler: input.scheduler,
    steps: input.steps,
    denoise: 1,
    model: MODEL_1,
  });
  /*CFGGuider*/
  const [GUIDER_1] = cls.CFGGuider({
    cfg: input.cfg,
    model: MODEL_1,
    positive: CONDITIONING_1,
    negative: CONDITIONING_2,
  });
  /*SEED*/
  const [NOISE_1] = cls.RandomNoise({
    noise_seed: input.seed,
  });
  /*Load VAE*/
  const [VAE_1] = cls.VAELoader({
    vae_name: "ae.safetensors",
  });
  /*KSamplerSelect*/
  const [SAMPLER_1] = cls.KSamplerSelect({
    sampler_name: input.samplerName,
  });
  /*SamplerCustomAdvanced*/
  const [LATENT_2, LATENT_3] = cls.SamplerCustomAdvanced({
    noise: NOISE_1,
    guider: GUIDER_1,
    sampler: SAMPLER_1,
    sigmas: SIGMAS_1,
    latent_image: LATENT_1,
  });
  /*VAE Decode*/
  const [IMAGE_1] = cls.VAEDecode({
    samples: LATENT_2,
    vae: VAE_1,
  });
  /*Save Image*/
  const [] = cls.SaveImage({
    filename_prefix: "ComfyUI",
    images: IMAGE_1,
  });
  return workflow;
}
