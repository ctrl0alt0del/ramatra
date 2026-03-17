import { runChatStreamTask as runChatStreamTaskWithReducer } from "@/lib/tasks/chat/stream/run-chat-stream";

export const consumeConversationChatStream = async ({
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
}) => {
  return runChatStreamTaskWithReducer({
    stream,
    taskId,
    threadId,
    modelTarget,
    onReasoningDelta: (delta) => {
      onReasoningDelta(delta);
    },
    onMessageDelta: (delta) => {
      onMessageDelta(delta);
    },
    onPublishRunningResult,
  });
};
