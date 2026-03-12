type LoadedInstance = {
  id: string;
  config: {
    context_length: number;
  };
};

export type ModelEntry = {
  key: string;
  loaded_instances: LoadedInstance[];
};

export type ListModelsResponse = {
  models: ModelEntry[];
};

export type LoadedLmStudioModelInstance = {
  instanceId: string;
  modelKey: string;
  contextLength: number;
};

const isLmStudioModelDebugEnabled = () =>
  process.env.LM_STUDIO_DEBUG_MODEL_ROUTING === "true";

const logLmStudioModelDebug = (
  phase: string,
  payload: Record<string, unknown>,
) => {
  if (!isLmStudioModelDebugEnabled()) {
    return;
  }

  console.info(`[lmstudio-model-debug] ${phase}`, payload);
};

const getLmStudioApiUrl = (pathname: string) => {
  const rawBaseUrl = process.env.LM_STUDIO_BASE_URL;
  if (!rawBaseUrl) {
    throw new Error("LM_STUDIO_BASE_URL is not configured.");
  }

  const url = new URL(rawBaseUrl);
  url.pathname = pathname;
  return url.toString();
};

const getLmStudioHeaders = () => ({
  "Content-Type": "application/json",
  ...(process.env.LM_STUDIO_TOKEN
    ? { Authorization: `Bearer ${process.env.LM_STUDIO_TOKEN}` }
    : {}),
});

export const listLmStudioModels = async () => {
  const response = await fetch(getLmStudioApiUrl("/api/v1/models"), {
    method: "GET",
    headers: getLmStudioHeaders(),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Failed to list LM Studio models: HTTP ${response.status}`);
  }

  return (await response.json()) as ListModelsResponse;
};

export const listLoadedLmStudioModels = async (): Promise<
  LoadedLmStudioModelInstance[]
> => {
  const data = await listLmStudioModels();

  return data.models.flatMap((model) =>
    model.loaded_instances.map((instance) => ({
      instanceId: instance.id,
      modelKey: model.key,
      contextLength: instance.config.context_length,
    })),
  );
};

export const formatLoadedLmStudioModelsForDebug = (
  models: LoadedLmStudioModelInstance[],
) =>
  models.map((model) => ({
    modelKey: model.modelKey,
    instanceId: model.instanceId,
    contextLength: model.contextLength,
  }));

export const getLoadedChatInstanceId = async (modelKey: string) => {
  const data = await listLmStudioModels();
  const directMatch = data.models.find((model) => model.key === modelKey);
  const byKey = directMatch?.loaded_instances[0]?.id;
  if (byKey) return byKey;

  const byInstanceId = data.models
    .flatMap((model) => model.loaded_instances)
    .find((instance) => instance.id === modelKey);

  return byInstanceId?.id ?? null;
};

export const findLoadedLmStudioModelInstance = async ({
  modelKey,
  contextLength,
}: {
  modelKey: string;
  contextLength?: number | null;
}) => {
  const loadedModels = await listLoadedLmStudioModels();

  return (
    loadedModels.find((model) => {
      if (model.modelKey !== modelKey && model.instanceId !== modelKey) {
        return false;
      }

      if (contextLength === undefined || contextLength === null) {
        return true;
      }

      return model.contextLength === contextLength;
    }) ?? null
  );
};

export const resolveLmStudioModelTarget = async (modelKey: string) => {
  return (await getLoadedChatInstanceId(modelKey)) ?? modelKey;
};

export const listLoadedLmStudioInstanceIds = async () => {
  const models = await listLoadedLmStudioModels();
  return models.map((model) => model.instanceId);
};

export const isLmStudioInstanceLoaded = async (instanceId: string) => {
  const instanceIds = await listLoadedLmStudioInstanceIds();
  return instanceIds.includes(instanceId);
};

export const resolvePreferredLmStudioModelTarget = async ({
  preferredInstanceId,
  modelKey,
}: {
  preferredInstanceId?: string | null;
  modelKey: string;
}) => {
  if (preferredInstanceId && (await isLmStudioInstanceLoaded(preferredInstanceId))) {
    return preferredInstanceId;
  }

  return resolveLmStudioModelTarget(modelKey);
};

export const unloadLmStudioModel = async (instanceId: string) => {
  logLmStudioModelDebug("unload:start", { instanceId });
  const response = await fetch(getLmStudioApiUrl("/api/v1/models/unload"), {
    method: "POST",
    headers: getLmStudioHeaders(),
    body: JSON.stringify({
      instance_id: instanceId,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to unload LM Studio model: HTTP ${response.status}`);
  }

  logLmStudioModelDebug("unload:done", { instanceId });
};

export const unloadAllLmStudioModels = async () => {
  const instanceIds = await listLoadedLmStudioInstanceIds();
  for (const instanceId of instanceIds) {
    await unloadLmStudioModel(instanceId);
  }
};

export const loadLmStudioModel = async (
  modelKey: string,
  input?: {
    contextLength?: number;
  },
) => {
  logLmStudioModelDebug("load:start", { modelKey });
  const response = await fetch(getLmStudioApiUrl("/api/v1/models/load"), {
    method: "POST",
    headers: getLmStudioHeaders(),
    body: JSON.stringify({
      model: modelKey,
      context_length: input?.contextLength,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to load LM Studio model: HTTP ${response.status}`);
  }

  logLmStudioModelDebug("load:done", { modelKey });
};

export const ensureLmStudioModelLoaded = async ({
  modelKey,
  contextLength,
}: {
  modelKey: string;
  contextLength?: number | null;
}) => {
  const exactMatch = await findLoadedLmStudioModelInstance({
    modelKey,
    contextLength,
  });

  if (exactMatch) {
    logLmStudioModelDebug("ensure:reuse", {
      modelKey,
      contextLength: contextLength ?? null,
      instanceId: exactMatch.instanceId,
    });
    return exactMatch;
  }

  const loadedModels = await listLoadedLmStudioModels();
  const sameModelDifferentContext = loadedModels.filter(
    (model) =>
      (model.modelKey === modelKey || model.instanceId === modelKey) &&
      contextLength !== undefined &&
      contextLength !== null &&
      model.contextLength !== contextLength,
  );

  for (const model of sameModelDifferentContext) {
    await unloadLmStudioModel(model.instanceId);
  }

  if (sameModelDifferentContext.length > 0) {
    logLmStudioModelDebug("ensure:replaced-context", {
      modelKey,
      contextLength,
      unloaded: formatLoadedLmStudioModelsForDebug(sameModelDifferentContext),
    });
  }

  await loadLmStudioModel(modelKey, {
    contextLength: contextLength ?? undefined,
  });

  const loaded = await findLoadedLmStudioModelInstance({
    modelKey,
    contextLength,
  });

  if (!loaded) {
    throw new Error(
      `LM Studio loaded model did not appear with expected context length (${contextLength ?? "default"}).`,
    );
  }

  logLmStudioModelDebug("ensure:loaded", {
    modelKey,
    contextLength: contextLength ?? null,
    instanceId: loaded.instanceId,
  });

  return loaded;
};

const parseModelSelectorList = (rawValue: string | undefined) => {
  return (rawValue ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
};

const escapeRegExp = (value: string) => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const matchesModelSelector = (value: string, selector: string) => {
  if (selector === "*") {
    return true;
  }

  if (!selector.includes("*")) {
    return value === selector;
  }

  const pattern = `^${selector.split("*").map(escapeRegExp).join(".*")}$`;
  return new RegExp(pattern, "i").test(value);
};

export const cleanupRedundantLmStudioModels = async ({
  activeModelKey,
  redundantSelectors = parseModelSelectorList(
    process.env.LM_STUDIO_REDUNDANT_MODELS,
  ),
  keepSelectors = parseModelSelectorList(process.env.LM_STUDIO_KEEP_MODELS),
}: {
  activeModelKey: string;
  redundantSelectors?: string[];
  keepSelectors?: string[];
}) => {
  logLmStudioModelDebug("cleanup:start", {
    activeModelKey,
    redundantSelectors,
    keepSelectors,
  });

  if (!redundantSelectors.length) {
    const loadedModels = await listLoadedLmStudioModels();
    const duplicateActiveInstances = loadedModels.filter(
      (model) => model.modelKey === activeModelKey,
    );
    const toUnload = duplicateActiveInstances.slice(1);

    for (const model of toUnload) {
      await unloadLmStudioModel(model.instanceId);
    }

    logLmStudioModelDebug("cleanup:done", {
      strategy: "duplicates_only",
      loadedModels: formatLoadedLmStudioModelsForDebug(loadedModels),
      unloaded: formatLoadedLmStudioModelsForDebug(toUnload),
    });

    return toUnload;
  }

  const loadedModels = await listLoadedLmStudioModels();
  const primaryActiveInstanceId =
    loadedModels.find((model) => model.modelKey === activeModelKey)?.instanceId ??
    null;

  const toUnload = loadedModels.filter((model) => {
    if (
      model.modelKey === activeModelKey &&
      primaryActiveInstanceId &&
      model.instanceId !== primaryActiveInstanceId
    ) {
      return true;
    }

    const isRedundant = redundantSelectors.some(
      (selector) =>
        matchesModelSelector(model.modelKey, selector) ||
        matchesModelSelector(model.instanceId, selector),
    );
    if (!isRedundant) {
      return false;
    }

    const isProtected =
      model.instanceId === primaryActiveInstanceId ||
      keepSelectors.some(
        (selector) =>
          matchesModelSelector(model.modelKey, selector) ||
          matchesModelSelector(model.instanceId, selector),
      ) ||
      (!keepSelectors.length &&
        (matchesModelSelector(model.modelKey, activeModelKey) ||
          matchesModelSelector(model.instanceId, activeModelKey)));

    if (isProtected) {
      return false;
    }

    const matchesActiveModel =
      matchesModelSelector(model.modelKey, activeModelKey) ||
      matchesModelSelector(model.instanceId, activeModelKey);

    return !matchesActiveModel;
  });

  const uniqueToUnload = toUnload.filter(
    (model, index, models) =>
      models.findIndex((candidate) => candidate.instanceId === model.instanceId) ===
      index,
  );

  for (const model of uniqueToUnload) {
    await unloadLmStudioModel(model.instanceId);
  }

  logLmStudioModelDebug("cleanup:done", {
    strategy: "selectors",
    loadedModels: formatLoadedLmStudioModelsForDebug(loadedModels),
    unloaded: formatLoadedLmStudioModelsForDebug(uniqueToUnload),
  });

  return uniqueToUnload;
};
