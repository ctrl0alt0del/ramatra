import { Workflow } from "@stable-canvas/comfyui-client";
import { toComfyLoraPath, WorkflowInput } from "./types";

const withDefaults = (input: Partial<WorkflowInput>): WorkflowInput => {
  return {
    positivePrompt: input.positivePrompt || "",
    negativePrompt:
      input.negativePrompt ||
      "((text)), ((watermark)), ((cappedlimb:1.5)), breasts, censorship, clothed, mosaic, lowres, bad anatomy, poorly drawn, watermark, signature, extra limbs, text, embedding:ng_deepnegative_v1_75t, text, bubble speach",
    inputImage: input.inputImage || [],
    referenceStrength: input.referenceStrength ?? 0,
    width: input.width || 1024,
    height: input.height || 1024,
    steps: input.steps || 30,
    cfg: input.cfg || 3.5,
    seed: input.seed || 804361959903663,
    samplerName: input.samplerName || "dpmpp_2m_sde",
    scheduler: input.scheduler || "karras",
    loras: input.loras || [],
  };
};

export function buildHoloEdenScribbleWorkflow(_input: WorkflowInput) {
  const input = withDefaults(_input);
  const workflow = new Workflow();
  const cls = workflow.classes;
  const sourceImagePath = input.inputImage.find(
    (value) => typeof value === "string" && value.trim().length > 0,
  );

  /*Load ControlNet Model*/
  const [CONTROL_NET_1] = cls.ControlNetLoader({
    control_net_name:
      "SDXL\\controlnet-scribble-sdxl-1.0-anime\\diffusion_pytorch_model.safetensors",
  });
  /*UltralyticsDetectorProvider*/
  const [OUT_0_2] = cls.UltralyticsDetectorProvider({
    model_name: "bbox/face_yolov8m.pt",
  });
  /*Load Upscale Model*/
  const [UPSCALE_MODEL_1] = cls.UpscaleModelLoader({
    model_name: "RealESRGAN_x4plus_anime_6B.pth",
  });
  /*Empty Latent Image*/
  const [LATENT_2] = cls.EmptyLatentImage({
    width: input.width,
    height: input.height,
    batch_size: 1,
  });
  /*Load Checkpoint*/
  const [MODEL_1, CLIP_1, VAE_1] = cls.CheckpointLoaderSimple({
    ckpt_name: "hyphoriaIlluNAI_v001.safetensors",
  });
  /*CLIP Set Last Layer*/
  const [CLIP_2] = cls.CLIPSetLastLayer({
    stop_at_clip_layer: -2,
    clip: CLIP_1,
  });
  let currentModel = MODEL_1;
  let currentClip = CLIP_2;
  for (const lora of input.loras) {
    [currentModel, currentClip] = cls.LoraLoader({
      lora_name: toComfyLoraPath(lora.name),
      strength_model: lora.strength_model,
      strength_clip: lora.strength_clip,
      model: currentModel,
      clip: currentClip,
    });
  }

  /*CLIP NegPip*/
  const [OUT_0_3, OUT_1_1] = cls.CLIPNegPip({
    model: currentModel,
    clip: currentClip,
  });
  /*CLIP Text Encode (BREAK)*/
  const [OUT_0_4] = cls.CLIPTextEncodeBREAK({
    text: input.positivePrompt,
    clip: OUT_1_1,
  });
  /*PerturbedAttentionGuidance*/
  const [MODEL_2] = cls.PerturbedAttentionGuidance({
    scale: 2.5,
    model: OUT_0_3,
  });
  /*Negative Prompt*/
  const [CONDITIONING_1] = cls.CLIPTextEncode({
    text: input.negativePrompt,
    clip: OUT_1_1,
  });

  let positiveConditioning = OUT_0_4;
  let negativeConditioning = CONDITIONING_1;

  if (sourceImagePath) {
    /*Load Image*/
    const [IMAGE_3] = cls.LoadImage({
      image: sourceImagePath,
    });
    /*Apply ControlNet*/
    [positiveConditioning, negativeConditioning] = cls.ControlNetApplyAdvanced({
      strength: input.referenceStrength,
      start_percent: 0,
      end_percent: 0.8,
      positive: OUT_0_4,
      negative: CONDITIONING_1,
      control_net: CONTROL_NET_1,
      image: IMAGE_3,
    });
  }

  /*KSampler*/
  const [LATENT_1] = cls.KSampler({
    seed: input.seed,
    steps: input.steps,
    cfg: input.cfg,
    sampler_name: input.samplerName,
    scheduler: input.scheduler,
    denoise: 1,
    model: MODEL_2,
    positive: positiveConditioning,
    negative: negativeConditioning,
    latent_image: LATENT_2,
  });
  /*VAE Decode*/
  const [IMAGE_1] = cls.VAEDecode({
    samples: LATENT_1,
    vae: VAE_1,
  });
  /*FaceDetailer*/
  const [OUT_0_1] = cls.FaceDetailer({
    guide_size: 512,
    guide_size_for: true,
    max_size: 1024,
    seed: input.seed + 1,
    steps: 30,
    cfg: 8,
    sampler_name: "euler_ancestral",
    scheduler: "karras",
    denoise: 0.5,
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
    clip: OUT_1_1,
    vae: VAE_1,
    positive: positiveConditioning,
    negative: negativeConditioning,
    bbox_detector: OUT_0_2,
  });
  /*Upscale Image (using Model)*/
  const [IMAGE_2] = cls.ImageUpscaleWithModel({
    upscale_model: UPSCALE_MODEL_1,
    image: OUT_0_1,
  });
  /*Save Image*/
  const [] = cls.SaveImage({
    filename_prefix: "ComfyUI",
    images: IMAGE_2,
  });

  return workflow;
}
