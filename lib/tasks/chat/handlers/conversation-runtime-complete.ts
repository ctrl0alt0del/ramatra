import { applyCompactionMarkersToText } from "@/lib/tasks/chat/text/compaction-markers";
import { finalizeConversationPostStream } from "@/lib/tasks/chat/handlers/conversation-postprocess";
import type {
  ChatResponse,
  ChatTask,
  ConversationRuntimeDeps,
} from "@/lib/tasks/chat/handlers/conversation-runtime.types";

export const completeConversationRuntimeAfterStreaming = ({
  task,
  parsedCommand,
  text,
  reasoning,
  finalResponse,
  promptMode,
  moodId,
  requestedContextLength,
  continuationCount,
  compactThresholdRatio,
  summaryCallsInCurrentRequest,
  inRequestCompactionBreakOffsets,
  persistConversationStreamResult,
  maybeEnqueueTitleGenerationTask,
  finalizeConversationViaStreamTask,
  setGroupTaskStatusByKind,
  updateThread,
}: {
  task: ChatTask;
  parsedCommand: { command: unknown | null };
  text: string;
  reasoning: string;
  finalResponse: ChatResponse | null;
  promptMode: import("@/lib/lmstudio/prompt-modes").PromptMode;
  moodId: string | null;
  requestedContextLength: number;
  continuationCount: number;
  compactThresholdRatio: number;
  summaryCallsInCurrentRequest: number;
  inRequestCompactionBreakOffsets: number[];
  persistConversationStreamResult: ConversationRuntimeDeps["persistConversationStreamResult"];
  maybeEnqueueTitleGenerationTask: ConversationRuntimeDeps["maybeEnqueueTitleGenerationTask"];
  finalizeConversationViaStreamTask: ConversationRuntimeDeps["finalizeConversationViaStreamTask"];
  setGroupTaskStatusByKind: ConversationRuntimeDeps["setGroupTaskStatusByKind"];
  updateThread: ConversationRuntimeDeps["updateThread"];
}) => {
  const finalTextWithMarkers = applyCompactionMarkersToText(
    text,
    inRequestCompactionBreakOffsets,
  );

  finalizeConversationPostStream({
    task,
    parsedCommand,
    text,
    reasoning,
    finalTextWithMarkers,
    finalResponseId: finalResponse?.response_id ?? null,
    summaryCallsInCurrentRequest,
    finalResponse,
    promptMode,
    moodId,
    requestedContextLength,
    continuationCount,
    compactThresholdRatio,
    persistConversationStreamResult,
    finalizeConversationViaStreamTask,
    setGroupTaskStatusByKind: ({
      taskId,
      kind,
      status,
    }: {
      taskId: string;
      kind: "chat.stream";
      status: "completed";
    }) => setGroupTaskStatusByKind({ taskId, kind, status }),
    updateThread,
    maybeEnqueueTitleGenerationTask,
  });
};
