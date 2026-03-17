type ChatResponse = {
  error?: {
    message?: string;
  };
};

export const resolveConversationStreamResponseBody = async ({
  response,
  taskId,
  threadId,
  modelTarget,
  requestedContextLength,
}: {
  response: Response;
  taskId: string;
  threadId: string | null;
  modelTarget: string;
  requestedContextLength: number;
}) => {
  if (!response.ok) {
    const bodyText = await response.text();
    let data: ChatResponse | null = null;
    try {
      data = JSON.parse(bodyText) as ChatResponse;
    } catch {
      data = null;
    }

    console.error("[chat-runner] generate:non-2xx-response", {
      taskId,
      threadId,
      status: response.status,
      selectedModelTarget: modelTarget,
      requestedContextLength,
      contentType: response.headers.get("content-type"),
      data,
      rawBody: bodyText,
    });
    throw new Error(
      data?.error?.message ||
        bodyText ||
        `LM Studio chat request failed: HTTP ${response.status}`,
    );
  }
  if (!response.body) {
    throw new Error("LM Studio did not return a stream body.");
  }

  return response.body;
};
