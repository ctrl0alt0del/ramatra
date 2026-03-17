import { getGeneratedImagesForThread } from "@/lib/comfy/thread-generated-images";
import {
  buildLmStudioInput,
  getAdaptiveGeneratedImageLimit,
  type LmStudioInputItem,
} from "@/lib/tasks/chat/lm-input";
import { resolveConversationPreviousResponseId } from "@/lib/tasks/chat/handlers/conversation-prepare-response-id";
import type { MessagePart } from "@/lib/chat/message-content";
import type { TaskGroupPayloadMap } from "@/lib/tasks/types";

type ConversationPayload = Extract<TaskGroupPayloadMap["chat"], { kind: "conversation" }>;

export const prepareConversationInput = ({
  payload,
  thread,
  requestedContextLength,
}: {
  payload: ConversationPayload;
  thread:
    | {
        messages: Array<{
          role: "user" | "assistant" | "system";
          content: MessagePart[];
        }>;
        lmstudioResponseId: string | null;
        conversationSummary: string | null;
      }
    | null;
  requestedContextLength: number;
}): {
  userInput: string | LmStudioInputItem[];
  effectivePreviousResponseId: string | null;
  generatedImageLimit: number;
} => {
  const generatedImageLimit = getAdaptiveGeneratedImageLimit({
    contextLength: requestedContextLength,
    userMessage: payload.userMessage,
  });

  const effectivePreviousResponseId = resolveConversationPreviousResponseId({
    payload,
    threadResponseId: thread?.lmstudioResponseId ?? null,
  });

  const userInput = buildLmStudioInput({
    summary: thread?.conversationSummary ?? null,
    previousResponseId: effectivePreviousResponseId,
    generatedImages: thread
      ? getGeneratedImagesForThread(thread.messages, generatedImageLimit)
      : [],
    userMessage: payload.userMessage,
  });

  return {
    userInput,
    effectivePreviousResponseId,
    generatedImageLimit,
  };
};
