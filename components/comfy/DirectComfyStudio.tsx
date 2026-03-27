"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import extractJsonFromString from "extract-json-from-string";

type WorkflowName = "base" | "illustration" | "edit" | "radiance";

type LoraItem = {
  name: string;
  top_tag: string | null;
  trained_words?: string[];
  image_url?: string | null;
  civitai_base_model?: string | null;
  model_url?: string | null;
};

type GenerationHistoryItem = {
  id: string;
  taskId: string;
  createdAt: string;
  params: {
    workflowName: WorkflowName;
    prompt: string;
    negativePrompt: string;
    inputImage: string[];
    width: number;
    height: number;
    steps: number;
    cfg: number;
    seed: number;
    samplerName: string;
    scheduler: string;
    loras: Array<{ name: string; strength_model: number; strength_clip: number }>;
  };
  images: string[];
};

type ComfyImage = {
  mimeType: string;
  data: string;
};

type GenerationProgressState = {
  taskId: string;
  status: "queued" | "running" | "completed" | "failed";
  percentage: number | null;
  node: string | null;
  value: number | null;
  max: number | null;
};

type StudioAssistantTaskEvent =
  | {
      taskId: string;
      status: "queued" | "running" | "completed";
      text: string;
    }
  | {
      taskId: string;
      status: "failed";
      error: string;
    };

type AssistantLoraOption = {
  modelId: number | null;
  name: string;
  model: string;
  likes: number;
  downloads: number;
  imageUrl: string | null;
  downloadUrl: string;
  fileName: string | null;
  modelUrl: string | null;
  trainedWords: string[];
  civitaiBaseModel: string;
  baseModel: "sdxl" | "illustrious" | "chroma" | "qwen";
};

type LoraDownloadProgress = {
  phase: "starting" | "downloading" | "saving" | "completed";
  downloadedBytes: number;
  totalBytes: number | null;
  percentage: number | null;
};

type LoraDownloadStreamEvent =
  | ({ type: "progress" } & LoraDownloadProgress)
  | {
      type: "completed";
      ok?: boolean;
      installedPath?: string;
      bytes?: number;
    }
  | {
      type: "error";
      error?: string;
    };

type ParsedAssistantOptions = {
  cleanText: string;
  items: AssistantLoraOption[];
  alternativeQueries: string[];
};

type AssistantPromptEnhance = {
  workflowName: WorkflowName;
  enhancedPrompt: string;
  negativePrompt: string;
  notes: string;
};

type ParsedAssistantPayload = {
  loraItems: AssistantLoraOption[];
  promptEnhance: AssistantPromptEnhance | null;
  alternativeQueries: string[];
};

const samplerOptions = [
  "euler",
  "euler_cfg_pp",
  "euler_ancestral",
  "euler_ancestral_cfg_pp",
  "heun",
  "heunpp2",
  "exp_heun_2_x0",
  "exp_heun_2_x0_sde",
  "dpm_2",
  "dpm_2_ancestral",
  "lms",
  "dpm_fast",
  "dpm_adaptive",
  "dpmpp_2s_ancestral",
  "dpmpp_2s_ancestral_cfg_pp",
  "dpmpp_sde",
  "dpmpp_sde_gpu",
  "dpmpp_2m",
  "dpmpp_2m_cfg_pp",
  "dpmpp_2m_sde",
  "dpmpp_2m_sde_gpu",
  "dpmpp_2m_sde_heun",
  "dpmpp_2m_sde_heun_gpu",
  "dpmpp_3m_sde",
  "dpmpp_3m_sde_gpu",
  "ddpm",
  "lcm",
  "ipndm",
  "ipndm_v",
  "deis",
  "res_multistep",
  "res_multistep_cfg_pp",
  "res_multistep_ancestral",
  "res_multistep_ancestral_cfg_pp",
  "gradient_estimation",
  "gradient_estimation_cfg_pp",
  "er_sde",
  "seeds_2",
  "seeds_3",
  "sa_solver",
  "sa_solver_pece",
  "ddim",
  "uni_pc",
  "uni_pc_bh2",
  "legacy_rk",
  "rk",
  "rk_beta",
  "deis_3m_ode",
  "deis_2m_ode",
  "deis_3m",
  "deis_2m",
  "res_6s_ode",
  "res_5s_ode",
  "res_3s_ode",
  "res_2s_ode",
  "res_3m_ode",
  "res_2m_ode",
  "res_6s",
  "res_5s",
  "res_3s",
  "res_2s",
  "res_3m",
] as const;

const schedulerOptions = [
  "simple",
  "sgm_uniform",
  "karras",
  "exponential",
  "ddim_uniform",
  "beta",
  "normal",
  "linear_quadratic",
  "kl_optimal",
  "ays",
  "ays+",
  "ays_30",
  "ays_30+",
  "gits",
  "beta_1_1",
  "beta_33",
  "beta_44",
  "beta_57",
  "beta_32",
  "beta_42",
  "power_shift",
  "radiance_shift",
  "bong_tangent",
  "beta57",
] as const;

const workflowDefaults: Record<
  WorkflowName,
  {
    width: number;
    height: number;
    steps: number;
    cfg: number;
    samplerName: string;
    scheduler: string;
  }
> = {
  base: {
    width: 768,
    height: 1024,
    steps: 25,
    cfg: 1,
    samplerName: "euler",
    scheduler: "simple",
  },
  illustration: {
    width: 768,
    height: 1024,
    steps: 30,
    cfg: 3.5,
    samplerName: "dpmpp_2m_sde",
    scheduler: "karras",
  },
  edit: {
    width: 512,
    height: 768,
    steps: 4,
    cfg: 1,
    samplerName: "euler_ancestral",
    scheduler: "beta",
  },
  radiance: {
    width: 1024,
    height: 1024,
    steps: 22,
    cfg: 1,
    samplerName: "er_sde",
    scheduler: "power_shift",
  },
};

const toDataUrlFromComfyImage = (image: ComfyImage) =>
  `data:${image.mimeType};base64,${image.data}`;

const extractComfyImages = (value: unknown): ComfyImage[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is ComfyImage =>
      !!item &&
      typeof item === "object" &&
      "mimeType" in item &&
      typeof (item as { mimeType?: unknown }).mimeType === "string" &&
      "data" in item &&
      typeof (item as { data?: unknown }).data === "string",
  );
};

const loraOptionsBlockPattern =
  /\[\[LORA_OPTIONS\]\]\s*([\s\S]*?)\s*\[\[\/LORA_OPTIONS\]\]/;

const normalizeAssistantLoraItems = (value: unknown): AssistantLoraOption[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const record = item as Record<string, unknown>;
      const baseModel =
        record.baseModel === "sdxl" ||
        record.baseModel === "illustrious" ||
        record.baseModel === "chroma" ||
        record.baseModel === "qwen"
          ? record.baseModel
          : null;
      if (
        typeof record.name !== "string" ||
        typeof record.model !== "string" ||
        typeof record.likes !== "number" ||
        typeof record.downloads !== "number" ||
        typeof record.downloadUrl !== "string" ||
        !baseModel
      ) {
        return null;
      }

      return {
        name: record.name,
        modelId:
          typeof record.modelId === "number" && Number.isFinite(record.modelId)
            ? record.modelId
            : null,
        model: record.model,
        likes: record.likes,
        downloads: record.downloads,
        imageUrl: typeof record.imageUrl === "string" ? record.imageUrl : null,
        downloadUrl: record.downloadUrl,
        fileName: typeof record.fileName === "string" ? record.fileName : null,
        modelUrl: typeof record.modelUrl === "string" ? record.modelUrl : null,
        trainedWords: Array.isArray(record.trainedWords)
          ? record.trainedWords.filter(
              (word): word is string => typeof word === "string" && word.trim().length > 0,
            )
          : [],
        civitaiBaseModel:
          typeof record.civitaiBaseModel === "string" && record.civitaiBaseModel.trim().length > 0
            ? record.civitaiBaseModel.trim()
            : "Unknown",
        baseModel,
      } satisfies AssistantLoraOption;
    })
    .filter((item): item is AssistantLoraOption => item !== null);
};

const HISTORY_PAGE_SIZE = 3;

const normalizeAssistantPromptEnhance = (value: unknown): AssistantPromptEnhance | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const workflowName =
    record.workflowName === "base" ||
    record.workflowName === "illustration" ||
    record.workflowName === "edit" ||
    record.workflowName === "radiance"
      ? record.workflowName
      : null;
  if (
    !workflowName ||
    typeof record.enhancedPrompt !== "string" ||
    typeof record.negativePrompt !== "string"
  ) {
    return null;
  }

  return {
    workflowName,
    enhancedPrompt: record.enhancedPrompt,
    negativePrompt: record.negativePrompt,
    notes: typeof record.notes === "string" ? record.notes : "",
  };
};

const parseAssistantLoraOptions = (text: string): ParsedAssistantOptions => {
  const source = text.trim();
  const match = source.match(loraOptionsBlockPattern);

  const sanitizeAssistantLoraJson = (input: string) => {
    // Some model outputs break JSON specifically around trainedWords content.
    // If that happens, keep payload parseable by collapsing trainedWords to [].
    return input.replace(
      /"trainedWords"\s*:\s*[\s\S]*?,"civitaiBaseModel"/g,
      '"trainedWords":[],"civitaiBaseModel"',
    );
  };

  const tryParse = (jsonText: string, cleanText: string): ParsedAssistantOptions | null => {
    const normalizedJsonText = sanitizeAssistantLoraJson(jsonText);
    try {
      const parsed = JSON.parse(jsonText) as {
        items?: unknown;
        alternativeQueries?: unknown;
      };
      return {
        cleanText,
        items: normalizeAssistantLoraItems(parsed.items),
        alternativeQueries: Array.isArray(parsed.alternativeQueries)
          ? parsed.alternativeQueries.filter(
              (query): query is string =>
                typeof query === "string" && query.trim().length > 0,
            )
          : [],
      };
    } catch {
      try {
        const parsed = JSON.parse(normalizedJsonText) as {
          items?: unknown;
          alternativeQueries?: unknown;
        };
        return {
          cleanText,
          items: normalizeAssistantLoraItems(parsed.items),
          alternativeQueries: Array.isArray(parsed.alternativeQueries)
            ? parsed.alternativeQueries.filter(
                (query): query is string =>
                  typeof query === "string" && query.trim().length > 0,
              )
            : [],
        };
      } catch {
        return null;
      }
    }
  };

  if (match?.[1]) {
    const parsedFromBlock = tryParse(
      match[1],
      source.replace(loraOptionsBlockPattern, "").trim(),
    );
    if (parsedFromBlock) {
      return parsedFromBlock;
    }
  }

  const parsedAsRaw = tryParse(source, "");
  if (parsedAsRaw) {
    return parsedAsRaw;
  }

  const fencedMatch = source.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    const parsedFromFence = tryParse(
      fencedMatch[1],
      source.replace(/```(?:json)?\s*[\s\S]*?\s*```/i, "").trim(),
    );
    if (parsedFromFence) {
      return parsedFromFence;
    }
  }

  return {
    cleanText: source,
    items: [],
    alternativeQueries: [],
  };
};

const parseAssistantPayload = (text: string): ParsedAssistantPayload => {
  const source = text.trim();
  const parsedLora = parseAssistantLoraOptions(source);
  if (parsedLora.items.length > 0) {
    return {
      loraItems: parsedLora.items,
      promptEnhance: null,
      alternativeQueries: parsedLora.alternativeQueries,
    };
  }

  const extractedCandidates = extractJsonFromString(source);
  for (const candidate of extractedCandidates) {
    const promptEnhance = normalizeAssistantPromptEnhance(candidate);
    if (promptEnhance) {
      return {
        loraItems: [],
        promptEnhance,
        alternativeQueries: [],
      };
    }
  }

  const directPromptEnhance = normalizeAssistantPromptEnhance(
    (() => {
      try {
        return JSON.parse(source) as unknown;
      } catch {
        return null;
      }
    })(),
  );
  if (directPromptEnhance) {
    return {
      loraItems: [],
      promptEnhance: directPromptEnhance,
      alternativeQueries: [],
    };
  }

  return {
    loraItems: [],
    promptEnhance: null,
    alternativeQueries: [],
  };
};

const formatByteSize = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

export function DirectComfyStudio() {
  const [workflowName, setWorkflowName] = useState<WorkflowName>("base");
  const [positivePrompt, setPositivePrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [uploadedInputImages, setUploadedInputImages] = useState<string[]>([]);

  const [width, setWidth] = useState(workflowDefaults.base.width);
  const [height, setHeight] = useState(workflowDefaults.base.height);
  const [steps, setSteps] = useState(workflowDefaults.base.steps);
  const [cfg, setCfg] = useState(workflowDefaults.base.cfg);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1_000_000));
  const [samplerName, setSamplerName] = useState(workflowDefaults.base.samplerName);
  const [scheduler, setScheduler] = useState(workflowDefaults.base.scheduler);

  const [availableLoras, setAvailableLoras] = useState<LoraItem[]>([]);
  const [selectedLoras, setSelectedLoras] = useState<
    Record<string, { strength_model: number; strength_clip: number }>
  >({});

  const [history, setHistory] = useState<GenerationHistoryItem[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyHasMore, setHistoryHasMore] = useState(true);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isLoadingLoras, setIsLoadingLoras] = useState(false);
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generationProgress, setGenerationProgress] =
    useState<GenerationProgressState | null>(null);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const [splitPresetIndex, setSplitPresetIndex] = useState(0);
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [assistantNotice, setAssistantNotice] = useState<string | null>(null);
  const [assistantLoraOptions, setAssistantLoraOptions] = useState<AssistantLoraOption[]>([]);
  const [assistantPromptEnhance, setAssistantPromptEnhance] =
    useState<AssistantPromptEnhance | null>(null);
  const [assistantAlternativeQueries, setAssistantAlternativeQueries] = useState<
    string[]
  >([]);
  const [downloadingLoraUrl, setDownloadingLoraUrl] = useState<string | null>(null);
  const [deletingLoraName, setDeletingLoraName] = useState<string | null>(null);
  const [downloadProgressByUrl, setDownloadProgressByUrl] = useState<
    Record<string, LoraDownloadProgress>
  >({});
  const [isAssistantRunning, setIsAssistantRunning] = useState(false);
  const [deletingHistoryId, setDeletingHistoryId] = useState<string | null>(null);
  const [editingHistoryId, setEditingHistoryId] = useState<string | null>(null);
  const assistantStreamRef = useRef<EventSource | null>(null);
  const historyScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const historyLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const isLoadingHistoryRef = useRef(false);

  const [widthInput, setWidthInput] = useState(String(workflowDefaults.base.width));
  const [heightInput, setHeightInput] = useState(String(workflowDefaults.base.height));
  const [stepsInput, setStepsInput] = useState(String(workflowDefaults.base.steps));
  const [cfgInput, setCfgInput] = useState(String(workflowDefaults.base.cfg));
  const [seedInput, setSeedInput] = useState(String(seed));

  const controlClassName =
    "mt-1 w-full rounded-xl border border-[hsl(var(--aui-border))] bg-white/90 px-3 py-2 text-base md:text-sm";

  const splitPresets = [
    {
      key: "form-large",
      mobileForm: "75%",
      mobileHistory: "25%",
      formClass: "lg:basis-[75%]",
      historyClass: "lg:basis-[25%]",
    },
    {
      key: "form-small",
      mobileForm: "25%",
      mobileHistory: "75%",
      formClass: "lg:basis-[25%]",
      historyClass: "lg:basis-[75%]",
    },
  ] as const;

  const suggestLoraBaseModel = (workflow: WorkflowName): "sdxl" | "illustrious" | "qwen" => {
    if (workflow === "edit") {
      return "qwen";
    }
    if (workflow === "illustration") {
      return "illustrious";
    }
    return "sdxl";
  };

  useEffect(() => {
    const defaults = workflowDefaults[workflowName];
    setWidth(defaults.width);
    setHeight(defaults.height);
    setSteps(defaults.steps);
    setCfg(defaults.cfg);
    setSamplerName(defaults.samplerName);
    setScheduler(defaults.scheduler);
    setWidthInput(String(defaults.width));
    setHeightInput(String(defaults.height));
    setStepsInput(String(defaults.steps));
    setCfgInput(String(defaults.cfg));
  }, [workflowName]);

  useEffect(() => {
    setSeedInput(String(seed));
  }, [seed]);

  useEffect(() => {
    return () => {
      assistantStreamRef.current?.close();
      assistantStreamRef.current = null;
    };
  }, []);

  const loadHistoryPage = useCallback(
    async (offset: number, { reset = false }: { reset?: boolean } = {}) => {
      if (isLoadingHistoryRef.current) {
        return;
      }
      isLoadingHistoryRef.current = true;
      setIsLoadingHistory(true);
      try {
        const response = await fetch(
          `/api/comfy/studio-history?limit=${HISTORY_PAGE_SIZE}&offset=${Math.max(
            0,
            Math.floor(offset),
          )}`,
        );
        if (!response.ok) {
          throw new Error(`Failed to load Direct Comfy history (${response.status})`);
        }

        const data = (await response.json()) as {
          items?: GenerationHistoryItem[];
          total?: number;
          nextOffset?: number;
          hasMore?: boolean;
        };
        const items = Array.isArray(data.items) ? data.items : [];
        const total = Number.isFinite(data.total ?? NaN) ? Number(data.total) : 0;
        const nextOffset = Number.isFinite(data.nextOffset ?? NaN)
          ? Number(data.nextOffset)
          : offset + items.length;

        setHistory((previous) => {
          if (reset) {
            return items;
          }
          const existingIds = new Set(previous.map((entry) => entry.id));
          const appended = items.filter((entry) => !existingIds.has(entry.id));
          return [...previous, ...appended];
        });
        setHistoryTotal(total);
        setHistoryOffset(Math.max(0, nextOffset));
        setHistoryHasMore(Boolean(data.hasMore));
      } catch (nextError) {
        setHistoryHasMore(false);
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Failed to load Direct Comfy history.",
        );
      } finally {
        isLoadingHistoryRef.current = false;
        setIsLoadingHistory(false);
      }
    },
    [],
  );

  useEffect(() => {
    void loadHistoryPage(0, { reset: true });
  }, [loadHistoryPage]);

  useEffect(() => {
    const root = historyScrollContainerRef.current;
    const target = historyLoadMoreRef.current;
    if (!root || !target) {
      return;
    }
    if (isLoadingHistory || !historyHasMore) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            continue;
          }
          if (isLoadingHistory || !historyHasMore) {
            continue;
          }
          void loadHistoryPage(historyOffset);
          break;
        }
      },
      {
        root,
        rootMargin: "200px 0px 200px 0px",
        threshold: 0.1,
      },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [historyHasMore, historyOffset, isLoadingHistory, loadHistoryPage]);

  useEffect(() => {
    let cancelled = false;

    const loadLoras = async () => {
      setIsLoadingLoras(true);
      try {
        const response = await fetch(`/api/comfy/loras?workflowName=${workflowName}`);
        if (!response.ok) {
          throw new Error(`Failed to load LoRAs (${response.status})`);
        }

        const data = (await response.json()) as { items?: LoraItem[] };
        if (cancelled) {
          return;
        }

        setAvailableLoras(Array.isArray(data.items) ? data.items : []);
        setSelectedLoras((previous) => {
          const next: Record<string, { strength_model: number; strength_clip: number }> = {};
          for (const key of Object.keys(previous)) {
            if ((data.items ?? []).some((item) => item.name === key)) {
              next[key] = previous[key];
            }
          }
          return next;
        });
      } catch (nextError) {
        if (!cancelled) {
          setAvailableLoras([]);
          setError(nextError instanceof Error ? nextError.message : "Failed to load LoRAs.");
        }
      } finally {
        if (!cancelled) {
          setIsLoadingLoras(false);
        }
      }
    };

    void loadLoras();

    return () => {
      cancelled = true;
    };
  }, [workflowName]);

  const selectedLoraList = useMemo(
    () =>
      Object.entries(selectedLoras).map(([name, value]) => ({
        name,
        strength_model: value.strength_model,
        strength_clip: value.strength_clip,
      })),
    [selectedLoras],
  );

  const syncNumericInput = (
    raw: string,
    fallback: number,
    apply: (value: number) => void,
    setRaw: (value: string) => void,
    {
      min,
      max,
      integerOnly = false,
    }: { min?: number; max?: number; integerOnly?: boolean } = {},
  ) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      apply(fallback);
      setRaw(String(fallback));
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      apply(fallback);
      setRaw(String(fallback));
      return;
    }
    let nextValue = parsed;
    if (integerOnly) {
      nextValue = Math.round(nextValue);
    }
    if (typeof min === "number") {
      nextValue = Math.max(min, nextValue);
    }
    if (typeof max === "number") {
      nextValue = Math.min(max, nextValue);
    }
    apply(nextValue);
    setRaw(String(nextValue));
  };

  const applyHistoryParams = (item: GenerationHistoryItem) => {
    const params = item.params;
    setWorkflowName(params.workflowName);
    setPositivePrompt(params.prompt);
    setNegativePrompt(params.negativePrompt);
    setUploadedInputImages(params.inputImage);

    setWidth(params.width);
    setHeight(params.height);
    setSteps(params.steps);
    setCfg(params.cfg);
    setSeed(params.seed);
    setSamplerName(params.samplerName);
    setScheduler(params.scheduler);

    setWidthInput(String(params.width));
    setHeightInput(String(params.height));
    setStepsInput(String(params.steps));
    setCfgInput(String(params.cfg));
    setSeedInput(String(params.seed));

    const mappedLoras: Record<
      string,
      { strength_model: number; strength_clip: number }
    > = {};
    for (const lora of params.loras) {
      mappedLoras[lora.name] = {
        strength_model: lora.strength_model,
        strength_clip: lora.strength_clip,
      };
    }
    setSelectedLoras(mappedLoras);
  };

  const appendTriggerWordToPrompt = (word: string) => {
    const nextWord = word.trim();
    if (!nextWord) {
      return;
    }
    setPositivePrompt((previous) => {
      const trimmed = previous.trim();
      if (!trimmed) {
        return nextWord;
      }
      if (trimmed.toLowerCase().includes(nextWord.toLowerCase())) {
        return previous;
      }
      return `${trimmed}, ${nextWord}`;
    });
  };

  const deleteLoraItem = async (item: LoraItem) => {
    setError(null);
    setDeletingLoraName(item.name);
    try {
      const response = await fetch("/api/comfy/loras", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: item.name }),
      });

      const data = (await response.json()) as { deleted?: boolean; error?: string };
      if (!response.ok || !data.deleted) {
        throw new Error(data.error ?? `Failed to delete LoRA (${response.status})`);
      }

      setAvailableLoras((previous) => previous.filter((entry) => entry.name !== item.name));
      setSelectedLoras((previous) => {
        const next = { ...previous };
        delete next[item.name];
        return next;
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to delete LoRA.");
    } finally {
      setDeletingLoraName(null);
    }
  };

  const deleteHistoryItem = async (item: GenerationHistoryItem) => {
    setError(null);
    setDeletingHistoryId(item.id);
    try {
      const response = await fetch(
        `/api/comfy/studio-history?id=${encodeURIComponent(item.id)}`,
        {
          method: "DELETE",
        },
      );
      const data = (await response.json()) as { deleted?: boolean; error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? `Failed to delete history item (${response.status})`);
      }
      if (!data.deleted) {
        throw new Error("History item was not deleted.");
      }
      let removed = false;
      setHistory((previous) => {
        const next = previous.filter((entry) => entry.id !== item.id);
        removed = next.length !== previous.length;
        return next;
      });
      if (removed) {
        setHistoryTotal((previous) => Math.max(0, previous - 1));
        setHistoryOffset((previous) => Math.max(0, previous - 1));
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to delete history item.");
    } finally {
      setDeletingHistoryId(null);
    }
  };

  const editFromHistoryItem = async (item: GenerationHistoryItem) => {
    setError(null);
    if (item.images.length === 0) {
      setError("This history item has no generated image to use for edit.");
      return;
    }

    setEditingHistoryId(item.id);
    try {
      const firstImage = item.images[0];
      const imageResponse = await fetch(firstImage);
      if (!imageResponse.ok) {
        throw new Error("Failed to read history image.");
      }
      const imageBlob = await imageResponse.blob();
      const extension = imageBlob.type.includes("png") ? "png" : "jpg";
      const formData = new FormData();
      formData.append(
        "files",
        new File([imageBlob], `history-edit-${item.id}.${extension}`, {
          type: imageBlob.type || "image/png",
        }),
      );

      const uploadResponse = await fetch("/api/comfy/upload", {
        method: "POST",
        body: formData,
      });
      const uploadData = (await uploadResponse.json()) as {
        files?: string[];
        error?: string;
      };
      if (!uploadResponse.ok) {
        throw new Error(uploadData.error ?? `Upload failed (${uploadResponse.status})`);
      }

      const nextFiles = Array.isArray(uploadData.files) ? uploadData.files : [];
      if (nextFiles.length === 0) {
        throw new Error("Uploaded image file was not returned.");
      }

      setWorkflowName("edit");
      setUploadedInputImages((previous) => {
        const merged = [...nextFiles, ...previous];
        return merged.filter((value, index, list) => list.indexOf(value) === index);
      });
      setAssistantNotice("Switched to edit workflow and added image from history as input.");
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Failed to prepare edit from history.",
      );
    } finally {
      setEditingHistoryId(null);
    }
  };

  const toNormalizedNumber = (
    raw: string,
    fallback: number,
    {
      min,
      max,
      integerOnly = false,
    }: { min?: number; max?: number; integerOnly?: boolean } = {},
  ) => {
    const parsed = Number(raw.trim());
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    let value = integerOnly ? Math.round(parsed) : parsed;
    if (typeof min === "number") {
      value = Math.max(min, value);
    }
    if (typeof max === "number") {
      value = Math.min(max, value);
    }
    return value;
  };

  const onUploadInputImages = async (event: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const fileList = event.target.files;
    if (!fileList || fileList.length === 0) {
      return;
    }

    const formData = new FormData();
    for (const file of Array.from(fileList)) {
      formData.append("files", file);
    }

    setIsUploadingImages(true);
    try {
      const response = await fetch("/api/comfy/upload", {
        method: "POST",
        body: formData,
      });
      const data = (await response.json()) as { files?: string[]; error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? `Upload failed (${response.status})`);
      }

      setUploadedInputImages((previous) => {
        const merged = [...previous, ...(data.files ?? [])];
        return merged.filter((item, index, arr) => arr.indexOf(item) === index);
      });
      event.target.value = "";
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to upload image.");
    } finally {
      setIsUploadingImages(false);
    }
  };

  const onSubmitAssistant = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAssistantError(null);
    setAssistantNotice(null);

    const message = assistantInput.trim();
    if (!message) {
      setAssistantError("Assistant input is required.");
      return;
    }

    assistantStreamRef.current?.close();
    assistantStreamRef.current = null;
    setIsAssistantRunning(true);
    setAssistantLoraOptions([]);
    setAssistantPromptEnhance(null);
    setAssistantAlternativeQueries([]);

    try {
      const response = await fetch("/api/comfy/studio-assistant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message }),
      });

      const data = (await response.json()) as { taskId?: string; error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? `Assistant request failed (${response.status})`);
      }

      const taskId = typeof data.taskId === "string" ? data.taskId : "";
      if (!taskId) {
        throw new Error("Assistant task id is missing.");
      }

      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const timeout = setTimeout(() => {
          if (settled) {
            return;
          }
          settled = true;
          assistantStreamRef.current?.close();
          assistantStreamRef.current = null;
          reject(new Error("Assistant request timed out."));
        }, 180_000);

        const source = new EventSource(`/api/chat/task/${taskId}/events`);
        assistantStreamRef.current = source;

        const finish = (handler: () => void) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeout);
          source.close();
          if (assistantStreamRef.current === source) {
            assistantStreamRef.current = null;
          }
          handler();
        };

        source.addEventListener("task", (event) => {
          try {
            const payload = JSON.parse((event as MessageEvent<string>).data) as StudioAssistantTaskEvent;
            if (payload.status === "failed") {
              finish(() => reject(new Error(payload.error || "Assistant failed.")));
              return;
            }

            const parsed = parseAssistantPayload(payload.text ?? "");
            setAssistantLoraOptions(parsed.loraItems);
            setAssistantPromptEnhance(parsed.promptEnhance);
            setAssistantAlternativeQueries(parsed.alternativeQueries);

            if (payload.status === "completed") {
              if (
                parsed.loraItems.length === 0 &&
                parsed.promptEnhance === null
              ) {
                setAssistantError(
                  "Assistant did not return a supported structured payload. Try rephrasing your request.",
                );
              }
              finish(() => resolve());
            }
          } catch {
            // ignore malformed events
          }
        });

        source.onerror = () => {
          finish(() => reject(new Error("Assistant stream disconnected.")));
        };
      });
    } catch (nextError) {
      setAssistantError(
        nextError instanceof Error ? nextError.message : "Assistant request failed.",
      );
    } finally {
      setIsAssistantRunning(false);
    }
  };

  const onDownloadLora = async (item: AssistantLoraOption) => {
    setAssistantError(null);
    setAssistantNotice(null);
    setDownloadingLoraUrl(item.downloadUrl);
    const civitaiModelUrl =
      item.modelUrl ??
      (typeof item.modelId === "number" && Number.isFinite(item.modelId)
        ? `https://civitai.com/models/${item.modelId}`
        : null);
    setDownloadProgressByUrl((previous) => ({
      ...previous,
      [item.downloadUrl]: {
        phase: "starting",
        downloadedBytes: 0,
        totalBytes: null,
        percentage: null,
      },
    }));

    try {
      const response = await fetch("/api/comfy/studio-assistant/download", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: item.downloadUrl,
          baseModel: item.baseModel,
          fileName: item.fileName ?? undefined,
          modelId:
            typeof item.modelId === "number" && Number.isFinite(item.modelId)
              ? item.modelId
              : undefined,
          modelUrl: civitaiModelUrl ?? undefined,
          civitaiBaseModel: item.civitaiBaseModel,
          imageUrl: item.imageUrl ?? undefined,
          trainedWords: item.trainedWords,
        }),
      });

      if (!response.ok) {
        const data = (await response.json()) as {
          ok?: boolean;
          installedPath?: string;
          error?: string;
        };
        throw new Error(data.error ?? `Download failed (${response.status})`);
      }

      if (!response.body) {
        throw new Error("Download stream is not available.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffered = "";
      let completedInstalledPath: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffered += decoder.decode(value, { stream: true });
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }

          let event: LoraDownloadStreamEvent;
          try {
            event = JSON.parse(trimmed) as LoraDownloadStreamEvent;
          } catch {
            continue;
          }

          if (event.type === "progress") {
            setDownloadProgressByUrl((previous) => ({
              ...previous,
              [item.downloadUrl]: {
                phase: event.phase,
                downloadedBytes: event.downloadedBytes,
                totalBytes: event.totalBytes,
                percentage: event.percentage,
              },
            }));
            continue;
          }

          if (event.type === "error") {
            throw new Error(event.error ?? "LoRA download failed.");
          }

          if (event.type === "completed") {
            completedInstalledPath =
              typeof event.installedPath === "string" ? event.installedPath : null;
            setDownloadProgressByUrl((previous) => ({
              ...previous,
              [item.downloadUrl]: {
                phase: "completed",
                downloadedBytes: Number.isFinite(event.bytes ?? NaN)
                  ? Number(event.bytes)
                  : previous[item.downloadUrl]?.downloadedBytes ?? 0,
                totalBytes: previous[item.downloadUrl]?.totalBytes ?? null,
                percentage: 100,
              },
            }));
          }
        }
      }

      if (!completedInstalledPath) {
        throw new Error("Download completed without install confirmation.");
      }

      setAssistantNotice(`Installed: ${completedInstalledPath}`);
      setIsLoadingLoras(true);
      try {
        const loraResponse = await fetch(`/api/comfy/loras?workflowName=${workflowName}`);
        const loraData = (await loraResponse.json()) as { items?: LoraItem[] };
        if (loraResponse.ok) {
          setAvailableLoras(Array.isArray(loraData.items) ? loraData.items : []);
        }
      } finally {
        setIsLoadingLoras(false);
      }
    } catch (nextError) {
      setAssistantError(
        nextError instanceof Error ? nextError.message : "LoRA download failed.",
      );
    } finally {
      setDownloadingLoraUrl(null);
      setDownloadProgressByUrl((previous) => {
        const next = { ...previous };
        delete next[item.downloadUrl];
        return next;
      });
    }
  };
  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const nextWidth = toNormalizedNumber(widthInput, width, {
      min: 64,
      max: 2048,
      integerOnly: true,
    });
    const nextHeight = toNormalizedNumber(heightInput, height, {
      min: 64,
      max: 2048,
      integerOnly: true,
    });
    const nextSteps = toNormalizedNumber(stepsInput, steps, {
      min: 1,
      max: 1000,
      integerOnly: true,
    });
    const nextCfg = toNormalizedNumber(cfgInput, cfg, { min: 0, max: 3.5 });
    const nextSeed = toNormalizedNumber(seedInput, seed, { min: 1, integerOnly: true });

    setWidth(nextWidth);
    setHeight(nextHeight);
    setSteps(nextSteps);
    setCfg(nextCfg);
    setSeed(nextSeed);
    setWidthInput(String(nextWidth));
    setHeightInput(String(nextHeight));
    setStepsInput(String(nextSteps));
    setCfgInput(String(nextCfg));
    setSeedInput(String(nextSeed));

    const trimmedPrompt = positivePrompt.trim();
    if (!trimmedPrompt) {
      setError("Positive prompt is required.");
      return;
    }

    setIsGenerating(true);
    setGenerationProgress(null);
    try {
      const inputPayload = {
        positivePrompt: trimmedPrompt,
        negativePrompt,
        inputImage: uploadedInputImages,
        width: nextWidth,
        height: nextHeight,
        steps: nextSteps,
        cfg: nextCfg,
        seed: nextSeed,
        samplerName,
        scheduler,
        loras: selectedLoraList,
      };

      const response = await fetch("/api/comfy/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workflowName,
          input: inputPayload,
        }),
      });

      const data = (await response.json()) as {
        error?: string;
        taskId?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? `Generation failed (${response.status})`);
      }

      const taskId = typeof data.taskId === "string" ? data.taskId : "";
      if (!taskId) {
        throw new Error("Comfy task id is missing from generate response.");
      }

      setGenerationProgress({
        taskId,
        status: "queued",
        percentage: 0,
        node: null,
        value: null,
        max: null,
      });

      const comfyImages = await new Promise<ComfyImage[]>((resolve, reject) => {
        const timeoutMs = 180_000;
        let settled = false;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        const eventSource = new EventSource(`/api/comfy/task/${taskId}/events`);

        const finish = (handler: () => void) => {
          if (settled) {
            return;
          }
          settled = true;
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          eventSource.close();
          handler();
        };

        const handleTaskEvent = (rawData: string) => {
          try {
            const payload = JSON.parse(rawData) as {
              status?: "queued" | "running" | "completed" | "failed";
              error?: string;
              images?: unknown;
              progress?: {
                value: number | null;
                max: number | null;
                percentage: number | null;
                node: string | null;
              };
            };

            setGenerationProgress({
              taskId,
              status: payload.status ?? "queued",
              percentage: payload.progress?.percentage ?? null,
              node: payload.progress?.node ?? null,
              value: payload.progress?.value ?? null,
              max: payload.progress?.max ?? null,
            });

            if (payload.status === "failed") {
              finish(() =>
                reject(new Error(payload.error ?? "Generation failed.")),
              );
              return;
            }

            if (payload.status === "completed") {
              finish(() => resolve(extractComfyImages(payload.images)));
            }
          } catch {
            // Ignore malformed events.
          }
        };

        eventSource.addEventListener("task", (event) => {
          handleTaskEvent((event as MessageEvent<string>).data);
        });

        eventSource.onmessage = (event) => {
          handleTaskEvent(event.data);
        };

        eventSource.onerror = () => {
          finish(() =>
            reject(new Error("Comfy task stream disconnected before completion.")),
          );
        };

        timeoutId = setTimeout(() => {
          finish(() =>
            reject(new Error("Comfy task timed out while waiting for completion.")),
          );
        }, timeoutMs);
      });

      const images = comfyImages.map(toDataUrlFromComfyImage);
      if (!images.length) {
        throw new Error("No images returned from Comfy.");
      }

      setHistory((previous) => {
        const nextItem: GenerationHistoryItem = {
          id: taskId,
          taskId,
          createdAt: new Date().toISOString(),
          params: {
            workflowName,
            prompt: trimmedPrompt,
            negativePrompt,
            inputImage: [...uploadedInputImages],
            width: nextWidth,
            height: nextHeight,
            steps: nextSteps,
            cfg: nextCfg,
            seed: nextSeed,
            samplerName,
            scheduler,
            loras: selectedLoraList.map((item) => ({ ...item })),
          },
          images,
        };
        const filtered = previous.filter((item) => item.taskId !== taskId);
        return [nextItem, ...filtered];
      });
      setHistoryTotal((previous) => previous + 1);
      setHistoryOffset((previous) => previous + 1);
      setGenerationProgress((previous) =>
        previous
          ? {
              ...previous,
              status: "completed",
              percentage: 100,
            }
          : null,
      );
    } catch (nextError) {
      setGenerationProgress((previous) =>
        previous
          ? {
              ...previous,
              status: "failed",
            }
          : null,
      );
      setError(nextError instanceof Error ? nextError.message : "Generation failed.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <main className="h-[100dvh] w-full overflow-hidden px-4 py-4 md:px-6 md:py-6">
      {isAssistantOpen ? (
        <section className="h-full w-full overflow-hidden rounded-3xl border border-white/60 bg-white/78 p-4 shadow-[0_18px_45px_rgba(73,56,145,0.12)] backdrop-blur-md">
          <header className="mb-3 flex items-start justify-between gap-2">
            <div>
              <h1 className="text-lg font-semibold text-[hsl(var(--aui-foreground))]">Studio Assistant</h1>
              <p className="text-xs text-[hsl(var(--aui-muted-foreground))]">
                Find LoRAs or enhance prompts per workflow.
              </p>
            </div>
            <button
              type="button"
              className="rounded-lg border border-[hsl(var(--aui-border))] bg-white/90 px-2.5 py-1 text-xs font-medium"
              onClick={() => setIsAssistantOpen(false)}
            >
              Back to Studio
            </button>
          </header>

          <div className="h-[calc(100%-2.5rem)] overflow-y-auto pr-1">
            <form className="space-y-2" onSubmit={onSubmitAssistant}>
              <label className="block text-xs font-medium text-[hsl(var(--aui-foreground))]">
                Ask assistant
                <textarea
                  className={`${controlClassName} h-20 resize-y`}
                  value={assistantInput}
                  onChange={(event) => setAssistantInput(event.target.value)}
                  placeholder="Find LoRA for Nolan (Illustrious) or enhance this prompt for edit workflow..."
                />
              </label>
              <button
                type="submit"
                className="rounded-lg border border-[hsl(var(--aui-border))] bg-white/90 px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                disabled={isAssistantRunning}
              >
                {isAssistantRunning ? "Working..." : "Ask Assistant"}
              </button>
            </form>

            {assistantError ? (
              <p className="mt-2 rounded-lg border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-700">
                {assistantError}
              </p>
            ) : null}

            {assistantNotice ? (
              <p className="mt-2 rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs text-emerald-700">
                {assistantNotice}
              </p>
            ) : null}

            {assistantPromptEnhance ? (
              <article className="mt-2 rounded-lg border border-[hsl(var(--aui-border))] bg-white p-2">
                <p className="text-xs font-semibold text-[hsl(var(--aui-foreground))]">
                  Prompt Enhancement ({assistantPromptEnhance.workflowName})
                </p>
                <p className="mt-1 text-[11px] text-[hsl(var(--aui-muted-foreground))]">
                  {assistantPromptEnhance.notes || "Ready to apply to Direct Comfy form."}
                </p>
                <div className="mt-2 space-y-2 rounded-md border border-[hsl(var(--aui-border))] bg-white/70 p-2">
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wide text-[hsl(var(--aui-muted-foreground))]">
                      Enhanced Prompt
                    </p>
                    <p className="text-xs text-[hsl(var(--aui-foreground))]">
                      {assistantPromptEnhance.enhancedPrompt}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wide text-[hsl(var(--aui-muted-foreground))]">
                      Negative Prompt
                    </p>
                    <p className="text-xs text-[hsl(var(--aui-foreground))]">
                      {assistantPromptEnhance.negativePrompt}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className="mt-2 rounded-md border border-[hsl(var(--aui-border))] bg-white/90 px-2 py-1 text-xs font-medium"
                  onClick={() => {
                    setWorkflowName(assistantPromptEnhance.workflowName);
                    setPositivePrompt(assistantPromptEnhance.enhancedPrompt);
                    setNegativePrompt(assistantPromptEnhance.negativePrompt);
                    setAssistantNotice("Applied enhanced prompt to Direct Comfy form.");
                  }}
                >
                  Apply to Form
                </button>
              </article>
            ) : null}

            {assistantAlternativeQueries.length > 0 ? (
              <article className="mt-2 rounded-lg border border-[hsl(var(--aui-border))] bg-white p-2">
                <p className="text-xs font-semibold text-[hsl(var(--aui-foreground))]">
                  Suggested Alternative Queries
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {assistantAlternativeQueries.map((query, index) => (
                    <button
                      key={`${query}-${index}`}
                      type="button"
                      className="rounded-full border border-[hsl(var(--aui-border))] bg-white/90 px-2.5 py-1 text-xs text-[hsl(var(--aui-foreground))]"
                      onClick={() => {
                        setAssistantInput(query);
                        setAssistantNotice("Inserted suggested query.");
                      }}
                      title={`Use query: ${query}`}
                    >
                      {query}
                    </button>
                  ))}
                </div>
              </article>
            ) : null}

            <div className="mt-2">
              {isAssistantRunning &&
              assistantLoraOptions.length === 0 &&
              assistantPromptEnhance === null ? (
                <div className="rounded-lg border border-[hsl(var(--aui-border))] bg-white/80 p-3">
                  <div className="flex items-center gap-2 text-xs font-medium text-[hsl(var(--aui-foreground))]">
                    <span className="inline-block h-2 w-2 animate-ping rounded-full bg-[hsl(var(--aui-primary))]" />
                    Preparing structured result...
                  </div>
                  <div className="mt-3 space-y-2">
                    <div className="h-3 w-2/3 animate-pulse rounded bg-[hsl(var(--aui-muted))]" />
                    <div className="h-3 w-full animate-pulse rounded bg-[hsl(var(--aui-muted))]" />
                    <div className="h-20 w-full animate-pulse rounded bg-[hsl(var(--aui-muted))]" />
                  </div>
                </div>
              ) : null}

              {assistantLoraOptions.length === 0 &&
              assistantPromptEnhance === null &&
              !isAssistantRunning ? (
                <div className="rounded-lg border border-dashed border-[hsl(var(--aui-border))] bg-white/70 p-2 text-xs text-[hsl(var(--aui-muted-foreground))]">
                  Structured assistant results will appear here.
                </div>
              ) : assistantLoraOptions.length > 0 ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {assistantLoraOptions.map((item, index) => {
                    const ratio = item.downloads > 0 ? item.likes / item.downloads : 0;
                    const downloadProgress = downloadProgressByUrl[item.downloadUrl] ?? null;
                    const civitaiModelUrl =
                      item.modelUrl ??
                      (typeof item.modelId === "number" && Number.isFinite(item.modelId)
                        ? `https://civitai.com/models/${item.modelId}`
                        : null);
                    return (
                      <article
                        key={`${item.downloadUrl}-${index}`}
                        className="group relative overflow-hidden rounded-xl border border-white/20 bg-[#10151f] shadow-[0_10px_28px_rgba(0,0,0,0.35)]"
                      >
                        {item.imageUrl ? (
                          <div className="relative aspect-[4/5] w-full bg-[#182132]">
                            <img
                              src={item.imageUrl}
                              alt=""
                              aria-hidden="true"
                              className="absolute inset-0 h-full w-full scale-105 object-cover opacity-35 blur-sm"
                            />
                            <img
                              src={item.imageUrl}
                              alt={item.name}
                              className="absolute inset-0 h-full w-full object-contain p-1 transition-transform duration-300 group-hover:scale-[1.02]"
                            />
                          </div>
                        ) : (
                          <div className="flex aspect-[4/5] w-full items-center justify-center bg-[#182132] text-xs text-white/60">
                            No preview image
                          </div>
                        )}

                        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />

                        <div className="absolute left-2 top-2 flex items-center gap-1">
                          <span className="rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                            LoRA
                          </span>
                          <span className="rounded-full bg-blue-500/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                            {item.civitaiBaseModel || item.baseModel}
                          </span>
                        </div>

                        <div className="absolute inset-x-0 bottom-0 p-3">
                          <p className="line-clamp-2 text-base font-semibold leading-tight text-white">
                            {item.name}
                          </p>
                          <p className="mt-1 truncate text-xs text-white/75">{item.model}</p>

                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <span className="rounded-md bg-white/15 px-1.5 py-0.5 text-[11px] text-white">
                              likes {item.likes}
                            </span>
                            <span className="rounded-md bg-white/15 px-1.5 py-0.5 text-[11px] text-white">
                              dl {item.downloads}
                            </span>
                            <span className="rounded-md bg-white/15 px-1.5 py-0.5 text-[11px] text-white">
                              ratio {ratio.toFixed(3)}
                            </span>
                          </div>

                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              className="rounded-lg border border-white/30 bg-black/40 px-2 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                              onClick={() => {
                                if (!civitaiModelUrl) {
                                  return;
                                }
                                window.open(civitaiModelUrl, "_blank", "noopener,noreferrer");
                              }}
                              disabled={!civitaiModelUrl}
                            >
                              Open Civitai
                            </button>
                            <button
                              type="button"
                              className="rounded-lg border border-white/20 bg-white/90 px-2 py-1.5 text-xs font-semibold text-[#0d1522] disabled:opacity-50"
                              onClick={() => onDownloadLora(item)}
                              disabled={downloadingLoraUrl === item.downloadUrl}
                            >
                              {downloadingLoraUrl === item.downloadUrl
                                ? "Downloading..."
                                : "Download LoRA"}
                            </button>
                          </div>
                          {downloadProgress ? (
                            <div className="mt-2 space-y-1">
                              <div className="flex items-center justify-between text-[11px] text-white/85">
                                <span className="capitalize">{downloadProgress.phase}</span>
                                <span>
                                  {downloadProgress.percentage !== null
                                    ? `${downloadProgress.percentage}%`
                                    : "--"}
                                </span>
                              </div>
                              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/20">
                                <div
                                  className="h-full rounded-full bg-white/90 transition-all"
                                  style={{
                                    width: `${Math.max(
                                      4,
                                      Math.min(100, downloadProgress.percentage ?? 8),
                                    )}%`,
                                  }}
                                />
                              </div>
                              <p className="text-[10px] text-white/70">
                                {formatByteSize(downloadProgress.downloadedBytes)}
                                {downloadProgress.totalBytes !== null
                                  ? ` / ${formatByteSize(downloadProgress.totalBytes)}`
                                  : ""}
                              </p>
                            </div>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : (
      <div className="flex h-full w-full flex-col gap-4 lg:flex-row">
        <section
          className={`flex min-h-0 w-full flex-col overflow-hidden rounded-3xl border border-white/60 bg-white/78 p-4 shadow-[0_18px_45px_rgba(73,56,145,0.12)] backdrop-blur-md lg:shrink-0 ${splitPresets[splitPresetIndex]?.formClass ?? "lg:basis-[42.857%]"}`}
          style={{ flexBasis: splitPresets[splitPresetIndex]?.mobileForm }}
        >
          <header className="mb-3 shrink-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h1 className="text-lg font-semibold text-[hsl(var(--aui-foreground))]">Direct Comfy</h1>
                <p className="text-xs text-[hsl(var(--aui-muted-foreground))]">
                  Direct generation without assistant routing.
                </p>
              </div>
              <button
                type="button"
                className="rounded-lg border border-[hsl(var(--aui-border))] bg-white/90 px-2.5 py-1 text-xs font-medium"
                onClick={() => setIsAssistantOpen((previous) => !previous)}
              >
                Studio Assistant
              </button>
            </div>
          </header>
          <form className="min-h-0 space-y-3 overflow-y-auto pr-1" onSubmit={onSubmit}>
            <label className="block text-xs font-medium text-[hsl(var(--aui-foreground))]">
              Workflow
              <select
                className={controlClassName}
                value={workflowName}
                onChange={(event) => setWorkflowName(event.target.value as WorkflowName)}
              >
                <option value="base">base</option>
                <option value="illustration">illustration</option>
                <option value="edit">edit</option>
                <option value="radiance">radiance</option>
              </select>
            </label>

            <label className="block text-xs font-medium text-[hsl(var(--aui-foreground))]">
              <span className="flex items-center justify-between gap-2">
                <span>Positive Prompt</span>
                <button
                  type="button"
                  className="rounded-md border border-[hsl(var(--aui-border))] bg-white/90 px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--aui-muted-foreground))]"
                  onClick={() => {
                    const base = `Enhance prompt for ${workflowName}:\n\n`;
                    const existing = positivePrompt.trim();
                    setAssistantInput(existing ? `${base}${existing}` : base);
                    setIsAssistantOpen(true);
                  }}
                  title="Open Studio Assistant with enhance template"
                  aria-label="Help with prompt"
                >
                  Help
                </button>
              </span>
              <textarea
                className={`${controlClassName} h-28 resize-y`}
                value={positivePrompt}
                onChange={(event) => setPositivePrompt(event.target.value)}
                placeholder="Describe what you want..."
              />
            </label>

            <label className="block text-xs font-medium text-[hsl(var(--aui-foreground))]">
              Negative Prompt
              <textarea
                className={`${controlClassName} h-20 resize-y`}
                value={negativePrompt}
                onChange={(event) => setNegativePrompt(event.target.value)}
                placeholder="Optional artifact guards..."
              />
            </label>

            <label className="block text-xs font-medium text-[hsl(var(--aui-foreground))]">
              Input Image Upload
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={onUploadInputImages}
                className={controlClassName}
              />
            </label>

            {uploadedInputImages.length > 0 ? (
              <div className="rounded-xl border border-[hsl(var(--aui-border))] bg-white/70 p-2">
                <p className="mb-1 text-xs font-medium text-[hsl(var(--aui-foreground))]">
                  Uploaded Input Images ({uploadedInputImages.length})
                </p>
                <div className="max-h-24 space-y-1 overflow-y-auto">
                  {uploadedInputImages.map((name) => (
                    <div key={name} className="flex items-center justify-between gap-2 text-xs">
                      <span className="break-all text-[hsl(var(--aui-muted-foreground))]">{name}</span>
                      <button
                        type="button"
                        className="rounded-md border border-[hsl(var(--aui-border))] px-2 py-0.5"
                        onClick={() =>
                          setUploadedInputImages((previous) =>
                            previous.filter((item) => item !== name),
                          )
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs font-medium text-[hsl(var(--aui-foreground))]">Width
                <input
                  className={controlClassName}
                  type="number"
                  inputMode="numeric"
                  min={64}
                  max={2048}
                  value={widthInput}
                  onChange={(event) => setWidthInput(event.target.value)}
                  onBlur={() =>
                    syncNumericInput(widthInput, width, setWidth, setWidthInput, {
                      min: 64,
                      max: 2048,
                      integerOnly: true,
                    })
                  }
                />
              </label>
              <label className="text-xs font-medium text-[hsl(var(--aui-foreground))]">Height
                <input
                  className={controlClassName}
                  type="number"
                  inputMode="numeric"
                  min={64}
                  max={2048}
                  value={heightInput}
                  onChange={(event) => setHeightInput(event.target.value)}
                  onBlur={() =>
                    syncNumericInput(heightInput, height, setHeight, setHeightInput, {
                      min: 64,
                      max: 2048,
                      integerOnly: true,
                    })
                  }
                />
              </label>
              <label className="text-xs font-medium text-[hsl(var(--aui-foreground))]">Steps
                <input
                  className={controlClassName}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={1000}
                  value={stepsInput}
                  onChange={(event) => setStepsInput(event.target.value)}
                  onBlur={() =>
                    syncNumericInput(stepsInput, steps, setSteps, setStepsInput, {
                      min: 1,
                      max: 1000,
                      integerOnly: true,
                    })
                  }
                />
              </label>
              <label className="text-xs font-medium text-[hsl(var(--aui-foreground))]">CFG
                <input
                  className={controlClassName}
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min={0}
                  max={3.5}
                  value={cfgInput}
                  onChange={(event) => setCfgInput(event.target.value)}
                  onBlur={() =>
                    syncNumericInput(cfgInput, cfg, setCfg, setCfgInput, {
                      min: 0,
                      max: 3.5,
                    })
                  }
                />
              </label>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
              <label className="text-xs font-medium text-[hsl(var(--aui-foreground))]">Seed
                <input
                  className={controlClassName}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={seedInput}
                  onChange={(event) => setSeedInput(event.target.value)}
                  onBlur={() =>
                    syncNumericInput(seedInput, seed, setSeed, setSeedInput, {
                      min: 1,
                      integerOnly: true,
                    })
                  }
                />
              </label>
              <button
                className="self-end rounded-xl border border-[hsl(var(--aui-border))] bg-white/90 px-3 py-2 text-xs font-medium"
                type="button"
                onClick={() => setSeed(Math.floor(Math.random() * 1_000_000))}
              >
                Randomize
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs font-medium text-[hsl(var(--aui-foreground))]">Sampler
                <select
                  className={controlClassName}
                  value={samplerName}
                  onChange={(event) => setSamplerName(event.target.value)}
                >
                  {samplerOptions.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium text-[hsl(var(--aui-foreground))]">Scheduler
                <select
                  className={controlClassName}
                  value={scheduler}
                  onChange={(event) => setScheduler(event.target.value)}
                >
                  {schedulerOptions.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </label>
            </div>

            <section className="rounded-2xl border border-[hsl(var(--aui-border))] bg-white/70 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-[hsl(var(--aui-foreground))]">
                  Manual LoRAs {isLoadingLoras ? "(loading...)" : `(${availableLoras.length})`}
                </p>
                <button
                  type="button"
                  className="rounded-md border border-[hsl(var(--aui-border))] bg-white/90 px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--aui-muted-foreground))]"
                  onClick={() => {
                    const concept = positivePrompt.trim();
                    const baseModel = suggestLoraBaseModel(workflowName);
                    const template = [
                      "Find loras",
                      `concept: ${concept}`,
                      `base model: ${baseModel}`,
                    ].join("\n");
                    setAssistantInput(template);
                    setIsAssistantOpen(true);
                  }}
                  title="Open Studio Assistant with LoRA search template"
                  aria-label="Search LoRAs with assistant"
                >
                  Search LoRAs
                </button>
              </div>
              <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
                {availableLoras.map((item) => {
                  const selected = selectedLoras[item.name];
                  const isDeleting = deletingLoraName === item.name;
                  const trainedWords = Array.isArray(item.trained_words)
                    ? item.trained_words.filter(
                        (word): word is string =>
                          typeof word === "string" && word.trim().length > 0,
                      )
                    : [];
                  return (
                    <div key={item.name} className="rounded-xl border border-[hsl(var(--aui-border))] bg-white/80 p-2">
                      <div className="flex items-start justify-between gap-2">
                        <label className="flex items-start gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={Boolean(selected)}
                            disabled={isDeleting}
                            onChange={(event) => {
                              setSelectedLoras((previous) => {
                                const next = { ...previous };
                                if (event.target.checked) {
                                  next[item.name] = { strength_model: 1, strength_clip: 1 };
                                } else {
                                  delete next[item.name];
                                }
                                return next;
                              });
                            }}
                          />
                          <span className="flex min-w-0 items-start gap-2">
                            {item.image_url ? (
                              <img
                                src={item.image_url}
                                alt={item.name}
                                className="h-10 w-10 shrink-0 rounded-md border border-[hsl(var(--aui-border))] object-cover"
                              />
                            ) : null}
                            <span className="min-w-0">
                              <span className="block break-all">{item.name}</span>
                              {item.civitai_base_model ? (
                                <span className="mt-0.5 block text-[10px] text-[hsl(var(--aui-muted-foreground))]">
                                  {item.civitai_base_model}
                                </span>
                              ) : null}
                            </span>
                          </span>
                        </label>
                        <button
                          type="button"
                          className="rounded-md border border-red-300 bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700 disabled:opacity-50"
                          onClick={() => void deleteLoraItem(item)}
                          disabled={isDeleting}
                          title="Delete this LoRA from disk"
                        >
                          {isDeleting ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                      {trainedWords.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {trainedWords.slice(0, 6).map((word) => (
                            <button
                              key={`${item.name}-${word}`}
                              type="button"
                              className="rounded-md border border-[hsl(var(--aui-border))] bg-white px-1.5 py-0.5 text-[10px] text-[hsl(var(--aui-muted-foreground))]"
                              onClick={() => appendTriggerWordToPrompt(word)}
                              title={`Copy trigger word: ${word}`}
                            >
                              {word}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {selected ? (
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <input
                            className="rounded-lg border border-[hsl(var(--aui-border))] bg-white px-2 py-1 text-base md:text-xs"
                            type="number"
                            step="0.1"
                            value={selected.strength_model}
                            onChange={(event) => {
                              const value = Number(event.target.value);
                              setSelectedLoras((previous) => ({
                                ...previous,
                                [item.name]: {
                                  ...(previous[item.name] ?? { strength_model: 1, strength_clip: 1 }),
                                  strength_model: value,
                                },
                              }));
                            }}
                          />
                          <input
                            className="rounded-lg border border-[hsl(var(--aui-border))] bg-white px-2 py-1 text-base md:text-xs"
                            type="number"
                            step="0.1"
                            value={selected.strength_clip}
                            onChange={(event) => {
                              const value = Number(event.target.value);
                              setSelectedLoras((previous) => ({
                                ...previous,
                                [item.name]: {
                                  ...(previous[item.name] ?? { strength_model: 1, strength_clip: 1 }),
                                  strength_clip: value,
                                },
                              }));
                            }}
                          />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>

            {error ? (
              <p className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
            ) : null}

            <button
              className="w-full rounded-xl bg-[hsl(var(--aui-primary))] px-3 py-2 text-sm font-semibold text-[hsl(var(--aui-primary-foreground))] disabled:opacity-50"
              disabled={isGenerating || isUploadingImages}
              type="submit"
            >
              {isUploadingImages
                ? "Uploading images..."
                : isGenerating
                  ? "Generating..."
                  : "Generate"}
            </button>

            {generationProgress ? (
              <div className="rounded-xl border border-[hsl(var(--aui-border))] bg-white/75 px-3 py-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-[hsl(var(--aui-foreground))]">
                    {generationProgress.status === "queued"
                      ? "Queued"
                      : generationProgress.status === "running"
                        ? "Running"
                        : generationProgress.status === "completed"
                          ? "Completed"
                          : "Failed"}
                  </span>
                  <span className="text-[hsl(var(--aui-muted-foreground))]">
                    {generationProgress.percentage !== null
                      ? `${generationProgress.percentage}%`
                      : "--"}
                  </span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[hsl(var(--aui-muted))]">
                  <div
                    className="h-full rounded-full bg-[hsl(var(--aui-primary))] transition-all"
                    style={{
                      width: `${Math.max(
                        0,
                        Math.min(100, generationProgress.percentage ?? 0),
                      )}%`,
                    }}
                  />
                </div>
                <p className="mt-2 text-[hsl(var(--aui-muted-foreground))]">
                  {generationProgress.node
                    ? `Node: ${generationProgress.node}`
                    : generationProgress.value !== null && generationProgress.max !== null
                      ? `Step: ${generationProgress.value}/${generationProgress.max}`
                      : `Task: ${generationProgress.taskId}`}
                </p>
              </div>
            ) : null}
          </form>
        </section>

        <div className="flex min-h-0 items-center justify-center px-2 lg:min-h-0 lg:px-0">
          <button
            type="button"
            className="inline-flex h-6 w-full items-center justify-center rounded-xl border border-[hsl(var(--aui-border))] bg-white/85 text-[hsl(var(--aui-foreground))] shadow-sm lg:h-8"
            onClick={() =>
              setSplitPresetIndex((previous) => (previous + 1) % splitPresets.length)
            }
            title={
              splitPresets[splitPresetIndex]?.key === "form-large"
                ? "Switch to compact form (1/4)"
                : "Switch to large form (3/4)"
            }
            aria-label={
              splitPresets[splitPresetIndex]?.key === "form-large"
                ? "Switch to compact form"
                : "Switch to large form"
            }
          >
            {splitPresets[splitPresetIndex]?.key === "form-large" ? (
              <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 lg:h-4 lg:w-4" fill="none" aria-hidden="true">
                <rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
                <path d="M3 8h14" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            ) : (
              <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 lg:h-4 lg:w-4" fill="none" aria-hidden="true">
                <rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
                <path d="M3 12h14" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            )}
          </button>
        </div>

        <section
          className={`min-h-0 w-full overflow-hidden rounded-3xl border border-white/60 bg-white/78 p-4 shadow-[0_18px_45px_rgba(73,56,145,0.12)] backdrop-blur-md lg:grow ${splitPresets[splitPresetIndex]?.historyClass ?? "lg:basis-[57.143%]"}`}
          style={{ flexBasis: splitPresets[splitPresetIndex]?.mobileHistory }}
        >
          <header className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[hsl(var(--aui-foreground))]">Created Images</h2>
            <span className="text-xs text-[hsl(var(--aui-muted-foreground))]">{historyTotal} runs</span>
          </header>

          <div ref={historyScrollContainerRef} className="h-[calc(100%-2rem)] overflow-y-auto pr-1">
            {history.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[hsl(var(--aui-border))] bg-white/70 p-6 text-sm text-[hsl(var(--aui-muted-foreground))]">
                {isLoadingHistory ? "Loading history..." : "Your generated images will appear here."}
              </div>
            ) : (
              <div className="space-y-4">
                {history.map((item) => (
                  <article key={item.id} className="rounded-2xl border border-[hsl(var(--aui-border))] bg-white/80 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2 text-xs text-[hsl(var(--aui-muted-foreground))]">
                      <span>{item.params.workflowName}</span>
                      <span>{new Date(item.createdAt).toLocaleString()}</span>
                    </div>
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <p className="line-clamp-2 text-xs text-[hsl(var(--aui-foreground))]">{item.params.prompt}</p>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          className="rounded-lg border border-[hsl(var(--aui-border))] bg-white/90 px-2 py-1 text-[11px] font-medium"
                          onClick={() => applyHistoryParams(item)}
                        >
                          Copy Params
                        </button>
                        <button
                          type="button"
                          className="rounded-lg border border-[hsl(var(--aui-border))] bg-white/90 px-2 py-1 text-[11px] font-medium disabled:opacity-50"
                          onClick={() => void editFromHistoryItem(item)}
                          disabled={editingHistoryId === item.id}
                        >
                          {editingHistoryId === item.id ? "Editing..." : "Edit"}
                        </button>
                        <button
                          type="button"
                          className="rounded-lg border border-red-300 bg-red-50 px-2 py-1 text-[11px] font-medium text-red-700 disabled:opacity-50"
                          onClick={() => void deleteHistoryItem(item)}
                          disabled={deletingHistoryId === item.id}
                        >
                          {deletingHistoryId === item.id ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {item.images.map((src, index) => (
                        <button
                          key={`${item.id}-${index}`}
                          type="button"
                          className="overflow-hidden rounded-xl border border-[hsl(var(--aui-border))] bg-white"
                          onClick={() => setFullscreenImage(src)}
                        >
                          <img
                            alt={`Generated ${index + 1}`}
                            className="w-full object-cover"
                            src={src}
                          />
                        </button>
                      ))}
                    </div>
                  </article>
                ))}
                {isLoadingHistory ? (
                  <div className="rounded-xl border border-[hsl(var(--aui-border))] bg-white/70 px-3 py-2 text-center text-xs text-[hsl(var(--aui-muted-foreground))]">
                    Loading more runs...
                  </div>
                ) : null}
                {historyHasMore ? (
                  <div ref={historyLoadMoreRef} className="h-2 w-full" aria-hidden="true" />
                ) : history.length > 0 ? (
                  <div className="rounded-xl border border-dashed border-[hsl(var(--aui-border))] bg-white/60 px-3 py-2 text-center text-xs text-[hsl(var(--aui-muted-foreground))]">
                    End of history
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </section>
      </div>
      )}

      {fullscreenImage ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setFullscreenImage(null)}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Escape" || event.key === "Enter" || event.key === " ") {
              setFullscreenImage(null);
            }
          }}
        >
          <button
            type="button"
            className="absolute right-4 top-4 rounded-lg border border-white/40 bg-black/40 px-3 py-1 text-sm text-white"
            onClick={() => setFullscreenImage(null)}
          >
            Close
          </button>
          <img
            src={fullscreenImage}
            alt="Fullscreen generated"
            className="max-h-full max-w-full rounded-xl object-contain"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      ) : null}
    </main>
  );
}
