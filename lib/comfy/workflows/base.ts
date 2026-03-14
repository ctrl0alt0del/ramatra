import { Workflow } from "@stable-canvas/comfyui-client";
import { WorkflowInput } from "./types";

const withDefaults = (input: Partial<WorkflowInput>): WorkflowInput => {
  return {
    positivePrompt: input.positivePrompt || "",
    negativePrompt: input.negativePrompt || "",
    width: input.width || 1024,
    height: input.height || 1512,
    steps: input.steps || 25,
    cfg: input.cfg || 1,
    seed: input.seed || Math.floor(Math.random() * 1000000),
    samplerName: input.samplerName || "res_2s",
    scheduler: input.scheduler || "bong_tangent",
    loras: input.loras || [],
  };
};

export function buildBaseWorkflow(_input: WorkflowInput) {
  const input = withDefaults(_input);
  const workflow = new Workflow();
  const cls = workflow.classes;

  /*AdvancedNoise*/
  const [OUT_0_6] = cls.AdvancedNoise({
    alpha: 1,
    k: 1,
    noise_seed: input.seed,
    noise_type: "wavelet",
  });
  /*SAM*/
  const [OUT_0_3] = cls.SAMLoader({
    model_name: "sam_vit_b_01ec64.pth",
    device_mode: "AUTO",
  });
  /*Empty Latent Image*/
  const [LATENT_3] = cls.EmptyLatentImage({
    width: input.width,
    height: input.height,
    batch_size: 1,
  });
  /*KSamplerSelect*/
  const [SAMPLER_1] = cls.KSamplerSelect({
    sampler_name: input.samplerName,
  });
  /*Load VAE*/
  const [VAE_1] = cls.VAELoader({
    vae_name: "ae.safetensors",
  });
  /*Load CLIP*/
  const [CLIP_2] = cls.CLIPLoader({
    clip_name: "flan_t5_xxl_TE-only_FP8.safetensors",
    type: "chroma",
    device: "default",
  });
  /*UltralyticsDetectorProvider*/
  const [OUT_0_1] = cls.UltralyticsDetectorProvider({
    model_name: "bbox/face_yolov8m.pt",
  });
  /*Load CLIP*/
  const [CLIP_1] = cls.CLIPLoader({
    clip_name: "clip_l.safetensors",
    type: "sd3",
    device: "default",
  });
  /*CLIP L (Prompt)*/
  const [CONDITIONING_7] = cls.CLIPTextEncode({
    text: "high quality, professinal photo, raw, candid, 1man, male solo, awe, masterpiece",
    clip: CLIP_1,
  });
  /*CLIP L  (Prompt)*/
  const [CONDITIONING_2] = cls.CLIPTextEncode({
    text:
      input.negativePrompt ||
      "very low quality. ugly. deformed. cartoon. illustration. art. artistic.",
    clip: CLIP_1,
  });
  /*Load Diffusion Model*/
  const [MODEL_1] = cls.UNETLoader({
    unet_name: "Chroma1-HD-fp8mixed.safetensors",
    weight_dtype: "default",
  });
  /*Power Lora Loader (rgthree)*/
  const powerLoraLoaderInput = {
    PowerLoraLoaderHeaderWidget: {
      type: "PowerLoraLoaderHeaderWidget",
    },
    lora_1: {
      on: true,
      lora: "chroma-flash-heun_r64-fp32.safetensors",
      strength: 1,
    },
    lora_2: {
      on: true,
      lora: "lenovo_chroma.safetensors",
      strength: 0.8,
    },
    lora_3: {
      on: true,
      lora: "- Chroma - profphotos_atmo_pref_s_m_4.0.safetensors",
      strength: 0.3,
    },
    "\u2795 Add Lora": "",
    model: MODEL_1,
    clip: CLIP_2,
  } as any;
  const [OUT_0_5, OUT_1_1] = cls["Power Lora Loader (rgthree)"](
    powerLoraLoaderInput,
  );
  let currentModel = OUT_0_5;
  let currentClip = OUT_1_1;

  for (const lora of input.loras) {
    [currentModel, currentClip] = cls.LoraLoader({
      lora_name: lora.name,
      strength_model: lora.strength_model,
      strength_clip: lora.strength_clip,
      model: currentModel,
      clip: currentClip,
    });
  }
  /*T5 (Prompt)*/
  const [CONDITIONING_6] = cls.CLIPTextEncode({
    text: input.positivePrompt,
    clip: currentClip,
  });
  /*Conditioning (Concat)*/
  const [CONDITIONING_3] = cls.ConditioningConcat({
    conditioning_to: CONDITIONING_7,
    conditioning_from: CONDITIONING_6,
  });
  /*AdaptiveProjectedGuidance*/
  const [OUT_0_2] = cls.AdaptiveProjectedGuidance({
    momentum: 0.5,
    eta: 1,
    norm_threshold: 15,
    mode: "normal",
    adaptive_momentum: 0.18,
    model: currentModel,
  });
  /*ModelSamplingAuraFlow*/
  const [MODEL_2] = cls.ModelSamplingAuraFlow({
    shift: 1.0000000000000002,
    model: OUT_0_2,
  });
  /*BetaSamplingScheduler*/
  const [SIGMAS_2] = cls.BetaSamplingScheduler({
    steps: input.steps,
    alpha: 0.45,
    beta: 0.45,
    model: MODEL_2,
  });
  /*Sigmas Rescale*/
  const [OUT_0_4] = cls["Sigmas Rescale"]({
    start: 0.99,
    end: 0,
    sigmas: SIGMAS_2,
  });
  /*BasicScheduler*/
  const [] = cls.BasicScheduler({
    scheduler: input.scheduler,
    steps: input.steps,
    denoise: 1,
    model: MODEL_2,
  });
  /*T5 (Prompt)*/
  const [CONDITIONING_1] = cls.CLIPTextEncode({
    text: "",
    clip: currentClip,
  });
  /*Conditioning (Concat)*/
  const [CONDITIONING_4] = cls.ConditioningConcat({
    conditioning_to: CONDITIONING_2,
    conditioning_from: CONDITIONING_1,
  });
  /*ConditioningZeroOut*/
  const [CONDITIONING_5] = cls.ConditioningZeroOut({
    conditioning: CONDITIONING_4,
  });
  /*CFGGuider*/
  const [GUIDER_1] = cls.CFGGuider({
    cfg: input.cfg,
    model: MODEL_2,
    positive: CONDITIONING_3,
    negative: CONDITIONING_5,
  });
  /*SamplerCustomAdvanced*/
  const [LATENT_1] = cls.SamplerCustomAdvanced({
    noise: OUT_0_6,
    guider: GUIDER_1,
    sampler: SAMPLER_1,
    sigmas: OUT_0_4,
    latent_image: LATENT_3,
  });
  /*VAE Decode*/
  const [IMAGE_1] = cls.VAEDecode({
    samples: LATENT_1,
    vae: VAE_1,
  });
  /*FaceDetailer*/
  const [OUT_0_7] = cls.FaceDetailer({
    guide_size: 512,
    guide_size_for: true,
    max_size: 1024,
    seed: 300000,
    steps: 6,
    cfg: 1,
    sampler_name: "lcm",
    scheduler: "karras",
    denoise: 0.2,
    feather: 5,
    noise_mask: true,
    force_inpaint: true,
    bbox_threshold: 0.5,
    bbox_dilation: 10,
    bbox_crop_factor: 3,
    sam_detection_hint: "center-1",
    sam_dilation: 0,
    sam_threshold: 0.93,
    sam_bbox_expansion: 0,
    sam_mask_hint_threshold: 0.7,
    sam_mask_hint_use_negative: "False",
    drop_size: 10,
    wildcard: "",
    cycle: 1,
    inpaint_model: false,
    noise_mask_feather: 20,
    tiled_encode: false,
    tiled_decode: false,
    image: IMAGE_1,
    model: MODEL_2,
    clip: CLIP_2,
    vae: VAE_1,
    positive: CONDITIONING_3,
    negative: CONDITIONING_5,
    bbox_detector: OUT_0_1,
    sam_model_opt: OUT_0_3,
  });
  /*Save Image*/
  const [] = cls.SaveImage({
    filename_prefix: "ComfyUI",
    images: OUT_0_7,
  });

  return workflow;
}
