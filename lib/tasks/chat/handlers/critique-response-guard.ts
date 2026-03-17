import type { CritiqueChatResponse } from "@/lib/tasks/chat/handlers/critique-streaming.types";

export const ensureCritiqueOkResponse = async ({
  response,
  fallbackMessage,
}: {
  response: Response;
  fallbackMessage: string;
}) => {
  if (response.ok) {
    return;
  }

  const bodyText = await response.text();
  let data: CritiqueChatResponse | null = null;
  try {
    data = JSON.parse(bodyText) as CritiqueChatResponse;
  } catch {
    data = null;
  }

  throw new Error(data?.error?.message ?? bodyText ?? fallbackMessage);
};

export const ensureCritiqueResponseBody = ({
  response,
  fallbackMessage,
}: {
  response: Response;
  fallbackMessage: string;
}) => {
  if (!response.body) {
    throw new Error(
      `${fallbackMessage.replace(" request failed.", "")} stream body is missing.`,
    );
  }
  return response.body;
};
