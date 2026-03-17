import { consumeConversationChatStream } from "@/lib/tasks/chat/handlers/conversation-stream";
import type { ChatResponse } from "@/lib/tasks/chat/handlers/conversation-runtime.types";

export const runConversationChatStream = async ({
  stream,
  taskId,
  threadId,
  modelTarget,
  onReasoningDelta,
  onMessageDelta,
  onPublishRunningResult,
}: {
  stream: ReadableStream<Uint8Array>;
  taskId: string;
  threadId: string | null;
  modelTarget: string;
  onReasoningDelta: (delta: string) => void;
  onMessageDelta: (delta: string) => void;
  onPublishRunningResult: (responseId: string | null) => void;
}): Promise<{
  overflowDetected: boolean;
  usedTokens: number | null;
  finalResponse: ChatResponse | null;
  toolEventsTranscript: string;
}> => {
  const result = await consumeConversationChatStream({
    stream,
    taskId,
    threadId,
    modelTarget,
    onReasoningDelta,
    onMessageDelta,
    onPublishRunningResult,
  });

  return {
    ...result,
    finalResponse: result.finalResponse as ChatResponse | null,
  };
};
