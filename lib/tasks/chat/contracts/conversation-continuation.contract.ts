import assert from "node:assert/strict";
import { handleConversationOverflowContinuation } from "@/lib/tasks/chat/handlers/conversation-continuation";
import type { TaskGroup } from "@/lib/tasks/types";

type Enqueued = Pick<TaskGroup, "id">;

const run = () => {
  const calls: {
    enqueued: Array<Record<string, unknown>>;
    transferred: Array<Record<string, unknown>>;
    completed: Array<Record<string, unknown>>;
  } = {
    enqueued: [],
    transferred: [],
    completed: [],
  };

  let enqueueCounter = 0;
  const orchestration = {
    enqueueChatTask: (payload: Record<string, unknown>) => {
      calls.enqueued.push(payload);
      enqueueCounter += 1;
      return { id: `tg-${enqueueCounter}` } as Enqueued as TaskGroup;
    },
    transferTaskByKind: (args: Record<string, unknown>) => {
      calls.transferred.push(args);
      return null;
    },
    markTaskCompleted: (taskId: string, result?: TaskGroup["result"]) => {
      calls.completed.push({ taskId, ...(result ?? {}) });
      return null;
    },
  };

  const task = {
    id: "task-1",
    type: "chat" as const,
    payload: {
      kind: "conversation" as const,
      threadId: "thread-1",
      promptMode: "artist",
      userMessage: [{ type: "text" as const, text: "hello" }],
      tasks: [{ id: "stream-1", kind: "chat.stream", status: "running" }],
      continuationIndex: 0,
    },
  };

  const breakOffsets: number[] = [];
  const continued = handleConversationOverflowContinuation({
    task: task as never,
    promptMode: "artist",
    moodId: null,
    requestedContextLength: 4096,
    summaryCallsInCurrentRequest: 0,
    continuationCount: 0,
    overflowDetected: true,
    nearLimitDetected: false,
    streamedText: "partial response text",
    streamedReasoning: "thinking",
    finalResponse: { response_id: "resp-1" },
    inRequestCompactionBreakOffsets: breakOffsets,
    toolEventsTranscript: "",
    orchestration,
  });

  assert.equal(continued, true);
  assert.equal(calls.enqueued.length, 2);
  assert.equal(calls.transferred.length, 1);
  assert.equal(calls.completed.length, 1);
  assert.equal(breakOffsets.length, 1);
};

run();
console.log("conversation-continuation.contract: OK");
