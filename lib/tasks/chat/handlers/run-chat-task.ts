import { collapseThreadContext } from "@/lib/tasks/chat/handlers/context-compaction";
import { executeSystemChatTask } from "@/lib/tasks/chat/handlers/system";
import { assertChatRunnableShape } from "@/lib/tasks/chat/guards";
import { prepareChatExecutionContext } from "@/lib/tasks/chat/handlers/execution-context";
import { dispatchChatTaskHandlers } from "@/lib/tasks/chat/handlers/dispatch";
import type { RunChatTaskPipelineArgs } from "@/lib/tasks/chat/handlers/run-chat-task.types";

const CONTEXT_COMPACT_THRESHOLD_RATIO = 0.9;

export const runChatTaskPipeline = async ({
  task,
  taskKind,
  getChatModelKey,
  getThreadById,
  updateThreadById,
  setGroupTaskStatusByKind,
  updateRunningTask,
  updateChatTaskPayload,
  getPendingChatStreams,
}: RunChatTaskPipelineArgs) => {
  if (
    await executeSystemChatTask({
      task,
      taskKind,
      collapseThreadContext: async ({ threadId, promptMode, interruption }) =>
        collapseThreadContext({ threadId, promptMode, interruption }),
    })
  ) {
    return true;
  }

  assertChatRunnableShape({ taskKind, task });
  const {
    thread,
    promptMode,
    moodId,
    isPersistentConversation,
    requestedContextLength,
  } = await prepareChatExecutionContext({
    task,
    taskKind,
    getThreadById,
    updateThreadById,
  });

  return dispatchChatTaskHandlers({
    task,
    taskKind,
    thread,
    promptMode,
    moodId,
    requestedContextLength,
    isPersistentConversation,
    compactThresholdRatio: CONTEXT_COMPACT_THRESHOLD_RATIO,
    getChatModelKey,
    setGroupTaskStatusByKind,
    updateRunningTask,
    updateChatTaskPayload,
    updateThread: updateThreadById,
    getPendingChatStreams,
  });
};
