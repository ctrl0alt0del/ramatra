type LoadedInstance = {
  id: string;
  config: {
    context_length: number;
  };
};

type ModelEntry = {
  key: string;
  loaded_instances: LoadedInstance[];
};

type ListModelsResponse = {
  models: ModelEntry[];
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
  const data = await listLmStudioModels();
  return data.models.flatMap((model) =>
    model.loaded_instances.map((instance) => instance.id),
  );
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
