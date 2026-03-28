import { Workflow } from "@stable-canvas/comfyui-client";
import { toComfyLoraPath, WorkflowInput } from "./types";

const withDefaults = (input: Partial<WorkflowInput>): WorkflowInput => {
  return {
    positivePrompt: input.positivePrompt || "",
    negativePrompt:
      input.negativePrompt ||
      "very low quality. ugly. deformed. cartoon. illustration. art. artistic.",
    inputImage: input.inputImage || [],
    referenceStrength: input.referenceStrength ?? 0,
    width: input.width || 1024,
    height: input.height || 1024,
    steps: input.steps || 22,
    cfg: input.cfg || 1,
    seed: input.seed || Math.floor(Math.random() * 1000000),
    samplerName: input.samplerName || "er_sde",
    scheduler: input.scheduler || "power_shift",
    loras: input.loras || [],
  };
};

export function buildRadianceWorkflow(_input: WorkflowInput) {
  const input = withDefaults(_input);
  const workflow = new Workflow();
  const cls = workflow.classes;

  const sourceImagePath = input.inputImage.find(Boolean);

  /*AdvancedNoise*/
  const [OUT_0_3] = cls.AdvancedNoise({
    alpha: 1,
    k: 1,
    noise_seed: input.seed,
    noise_type: "wavelet",
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
    vae_name: "pixel_space",
  });
  /*Load CLIP*/
  const [CLIP_2] = cls.CLIPLoader({
    clip_name: "flan_t5_xxl_TE-only_FP8.safetensors",
    type: "chroma",
    device: "default",
  });
  /*Load CLIP*/
  const [CLIP_1] = cls.CLIPLoader({
    clip_name: "clip_l.safetensors",
    type: "sd3",
    device: "default",
  });
  /*Load Diffusion Model*/
  const [MODEL_1] = cls.UNETLoader({
    unet_name: "chroma-radiance-x0.safetensors",
    weight_dtype: "default",
  });
  /*ChromaRadianceOptions*/
  const [OUT_0_6] = cls.ChromaRadianceOptions({
    preserve_wrapper: true,
    start_sigma: 1,
    end_sigma: 0,
    nerf_tile_size: 768,
    model: MODEL_1,
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
    model: OUT_0_6,
    clip: CLIP_2,
  } as any;
  const [OUT_0_2, OUT_1_1] = cls["Power Lora Loader (rgthree)"](
    powerLoraLoaderInput,
  );
  let currentModel = OUT_0_2;
  let currentClip = OUT_1_1;

  for (const lora of input.loras) {
    [currentModel, currentClip] = cls.LoraLoader({
      lora_name: toComfyLoraPath(lora.name),
      strength_model: lora.strength_model,
      strength_clip: lora.strength_clip,
      model: currentModel,
      clip: currentClip,
    });
  }

  /*AdaptiveProjectedGuidance*/
  const [OUT_0_1] = cls.AdaptiveProjectedGuidance({
    momentum: 0.5,
    eta: 1,
    norm_threshold: 15,
    mode: "normal",
    adaptive_momentum: 0.18,
    model: currentModel,
  });
  /*ModelSamplingAuraFlow*/
  const [MODEL_2] = cls.ModelSamplingAuraFlow({
    shift: 3,
    model: OUT_0_1,
  });
  /*Power Shift Scheduler*/
  const [OUT_0_7] = cls.PowerShiftScheduler({
    steps: input.steps,
    power: 2.3,
    midpoint_shift: 0.9,
    discard_penultimate: true,
    denoise: 1,
    model: MODEL_2,
  });
  /*Sigmas Rescale*/
  const [OUT_0_4] = cls["Sigmas Rescale"]({
    start: 0.99,
    end: 0,
    sigmas: OUT_0_7,
  });
  /*CLIP L  (Prompt)*/
  const [CONDITIONING_3] = cls.CLIPTextEncode({
    text: input.negativePrompt,
    clip: CLIP_1,
  });
  /*CLIP L (Prompt)*/
  const [CONDITIONING_1] = cls.CLIPTextEncode({
    text: "high quality, professinal photo, raw, candid, 1man, male solo, awe, masterpiece",
    clip: CLIP_1,
  });
  /*T5 (Prompt)*/
  const [CONDITIONING_4] = cls.CLIPTextEncode({
    text: "",
    clip: currentClip,
  });
  /*Conditioning (Concat)*/
  const [CONDITIONING_6] = cls.ConditioningConcat({
    conditioning_to: CONDITIONING_3,
    conditioning_from: CONDITIONING_4,
  });
  /*ConditioningZeroOut*/
  const [CONDITIONING_7] = cls.ConditioningZeroOut({
    conditioning: CONDITIONING_6,
  });
  /*T5 (Prompt)*/
  const [CONDITIONING_2] = cls.CLIPTextEncode({
    text: input.positivePrompt,
    clip: currentClip,
  });
  /*Conditioning (Concat)*/
  const [CONDITIONING_5] = cls.ConditioningConcat({
    conditioning_to: CONDITIONING_1,
    conditioning_from: CONDITIONING_2,
  });

  let positiveConditioning = CONDITIONING_5;
  let negativeConditioning = CONDITIONING_7;

  if (sourceImagePath) {
    /*Load Image*/
    const [IMAGE_2] = cls.LoadImage({
      image: sourceImagePath,
    });
    /*ResizeAndPadImage*/
    const [OUT_0_5] = cls.ResizeAndPadImage({
      target_width: input.width,
      target_height: input.height,
      padding_color: "white",
      interpolation: "area",
      image: IMAGE_2,
    });
    /*Load ControlNet Model*/
    const [CONTROL_NET_1] = cls.ControlNetLoader({
      control_net_name: "flux1DevControlnetUnion_v10.safetensors",
    });
    /*SetUnionControlNetType*/
    const [CONTROL_NET_2] = cls.SetUnionControlNetType({
      type: "openpose",
      control_net: CONTROL_NET_1,
    });
    /*Apply Controlnet with VAE*/
    [positiveConditioning, negativeConditioning] = cls.ControlNetApplySD3({
      strength: input.referenceStrength,
      start_percent: 0,
      end_percent: 0.6,
      positive: CONDITIONING_5,
      negative: CONDITIONING_7,
      control_net: CONTROL_NET_2,
      vae: VAE_1,
      image: OUT_0_5,
    });
  }

  /*CFGGuider*/
  const [GUIDER_1] = cls.CFGGuider({
    cfg: input.cfg,
    model: MODEL_2,
    positive: positiveConditioning,
    negative: negativeConditioning,
  });
  /*SamplerCustomAdvanced*/
  const [LATENT_1] = cls.SamplerCustomAdvanced({
    noise: OUT_0_3,
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
  /*Save Image*/
  const [] = cls.SaveImage({
    filename_prefix: "ComfyUI",
    images: IMAGE_1,
  });

  return workflow;
}
