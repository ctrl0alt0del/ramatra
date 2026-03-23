import type { LmStudioInputItem } from "@/lib/tasks/chat/input/types";
import {
  sanitizeLmStudioSamplingParams,
  stripForbiddenLmStudioSamplingParams,
  type LmStudioSamplingParams,
} from "@/lib/tasks/chat/policies/lmstudio-sampling";

export type RequestLmStudioChatArgs = {
  model: string;
  contextLength: number;
  input: string | LmStudioInputItem[];
  previousResponseId?: string;
  systemPrompt: string;
  forceSystemPrompt?: boolean;
  stream?: boolean;
  integrations?: unknown[];
  sampling?: LmStudioSamplingParams;
};

type LmStudioChatPayload = {
  model: string;
  context_length: number;
  input: string | LmStudioInputItem[];
  previous_response_id?: string;
  system_prompt?: string;
  integrations: unknown[];
  stream: boolean;
};

const getLmStudioChatUrl = () => {
  const rawBaseUrl = process.env.LM_STUDIO_BASE_URL;
  if (!rawBaseUrl) {
    throw new Error("LM_STUDIO_BASE_URL is not configured.");
  }

  const url = new URL(rawBaseUrl);
  url.pathname = "/api/v1/chat";
  return url.toString();
};

const buildLmStudioChatPayload = ({
  model,
  contextLength,
  input,
  previousResponseId,
  systemPrompt,
  forceSystemPrompt = false,
  stream = false,
  integrations,
  sampling,
}: RequestLmStudioChatArgs): LmStudioChatPayload => ({
  model,
  context_length: contextLength,
  input,
  previous_response_id: previousResponseId,
  ...(previousResponseId && !forceSystemPrompt
    ? {}
    : { system_prompt: systemPrompt }),
  integrations: integrations ?? [],
  ...sanitizeLmStudioSamplingParams(sampling),
  stream,
});

export const requestLmStudioChat = async ({
  model,
  contextLength,
  input,
  previousResponseId,
  systemPrompt,
  forceSystemPrompt = false,
  stream = false,
  integrations,
  sampling,
}: RequestLmStudioChatArgs) => {
  const payload = stripForbiddenLmStudioSamplingParams(
    buildLmStudioChatPayload({
      model,
      contextLength,
      input,
      previousResponseId,
      systemPrompt,
      forceSystemPrompt,
      stream,
      integrations,
      sampling,
    }),
  );

  console.info("[lmstudio-chat] request", {
    model,
    contextLength,
    previousResponseId: payload.previous_response_id ?? null,
    hasSystemPrompt:
      typeof payload.system_prompt === "string" && payload.system_prompt.length > 0,
    stream: payload.stream,
  });

  return fetch(getLmStudioChatUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.LM_STUDIO_TOKEN
        ? { Authorization: `Bearer ${process.env.LM_STUDIO_TOKEN}` }
        : {}),
    },
    body: JSON.stringify(payload),
  });
};
