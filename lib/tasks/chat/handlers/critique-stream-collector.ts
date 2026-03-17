import { parseSseEvents } from "@/lib/tasks/chat/stream/sse";
import { taskRepository } from "@/lib/tasks/chat/adapters/task-repository";
import type {
  ChatTask,
  CritiqueChatResponse,
  CritiqueLmStudioOutput,
} from "@/lib/tasks/chat/handlers/critique-streaming.types";

export const collectCritiqueStreamResult = async ({
  task,
  responseBody,
  streamingErrorMessage,
  getAssistantText,
  getAssistantReasoning,
}: {
  task: ChatTask;
  responseBody: ReadableStream<Uint8Array>;
  streamingErrorMessage: string;
  getAssistantText: (output: CritiqueLmStudioOutput[] | undefined) => string;
  getAssistantReasoning: (output: CritiqueLmStudioOutput[] | undefined) => string;
}) => {
  let streamedText = "";
  let streamedReasoning = "";
  let finalOutput: CritiqueLmStudioOutput[] = [];
  let finalResponseId: string | null = null;

  await parseSseEvents<CritiqueChatResponse>({
    stream: responseBody,
    onEvent: (event) => {
      if (event.type === "message.delta" && typeof event.content === "string") {
        streamedText += event.content;
        taskRepository.updateRunningTask(task.id, {
          result: {
            ...(taskRepository.getById(task.id)?.result ?? {}),
            text: streamedText,
            reasoning: streamedReasoning,
            responseId: finalResponseId,
            summaryCallsInCurrentRequest: 0,
          },
        });
        return;
      }

      if (event.type === "reasoning.delta" && typeof event.content === "string") {
        streamedReasoning += event.content;
        taskRepository.updateRunningTask(task.id, {
          result: {
            ...(taskRepository.getById(task.id)?.result ?? {}),
            text: streamedText,
            reasoning: streamedReasoning,
            responseId: finalResponseId,
            summaryCallsInCurrentRequest: 0,
          },
        });
        return;
      }

      if (event.type === "chat.end") {
        finalOutput = event.result.output ?? [];
        finalResponseId = event.result.response_id ?? null;
        return;
      }

      if (event.type === "error") {
        throw new Error(event.error?.message ?? streamingErrorMessage);
      }
    },
  });

  const finalText =
    finalOutput.length > 0
      ? getAssistantText(finalOutput).trim()
      : streamedText.trim();
  const finalReasoning =
    finalOutput.length > 0
      ? getAssistantReasoning(finalOutput).trim()
      : streamedReasoning.trim();

  return {
    finalText,
    finalReasoning,
    finalResponseId,
  };
};
