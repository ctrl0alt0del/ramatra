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

export const listLoadedLmStudioInstanceIds = async () => {
  const models = await listLoadedLmStudioModels();
  return models.map((model) => model.instanceId);
};

export const unloadLmStudioModel = async (instanceId: string) => {
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
};

export const unloadAllLmStudioModels = async () => {
  const instanceIds = await listLoadedLmStudioInstanceIds();
  for (const instanceId of instanceIds) {
    await unloadLmStudioModel(instanceId);
  }
};

export const loadLmStudioModel = async (modelKey: string) => {
  const response = await fetch(getLmStudioApiUrl("/api/v1/models/load"), {
    method: "POST",
    headers: getLmStudioHeaders(),
    body: JSON.stringify({
      model: modelKey,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to load LM Studio model: HTTP ${response.status}`);
  }
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
  if (!redundantSelectors.length) {
    const loadedModels = await listLoadedLmStudioModels();
    const duplicateActiveInstances = loadedModels.filter(
      (model) => model.modelKey === activeModelKey,
    );
    const toUnload = duplicateActiveInstances.slice(1);

    for (const model of toUnload) {
      await unloadLmStudioModel(model.instanceId);
    }

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

  return uniqueToUnload;
};
