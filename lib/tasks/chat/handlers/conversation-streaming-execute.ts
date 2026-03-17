import { runConversationChatStream } from "@/lib/tasks/chat/handlers/conversation-streaming-runner";
import { takePendingConversationStream } from "@/lib/tasks/chat/handlers/conversation-pending-stream";
import type { PendingChatStreamState } from "@/lib/tasks/chat/handlers/conversation-runtime.types";

export const executePendingConversationStream = async ({
  taskId,
  threadId,
  modelTarget,
  getPendingChatStreams,
  onReasoningDelta,
  onMessageDelta,
  onPublishRunningResult,
}: {
  taskId: string;
  threadId: string | null;
  modelTarget: string;
  getPendingChatStreams: () => Map<string, PendingChatStreamState>;
  onReasoningDelta: (delta: string) => void;
  onMessageDelta: (delta: string) => void;
  onPublishRunningResult: (responseId: string | null) => void;
}) => {
  const { pendingStream, clear } = takePendingConversationStream({
    taskId,
    getPendingChatStreams,
  });

  try {
    return await runConversationChatStream({
      stream: pendingStream.stream,
      taskId,
      threadId,
      modelTarget,
      onReasoningDelta,
      onMessageDelta,
      onPublishRunningResult,
    });
  } finally {
    clear();
  }
};
