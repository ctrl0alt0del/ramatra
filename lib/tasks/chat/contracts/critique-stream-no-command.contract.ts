import assert from "node:assert/strict";
import { handleCritiqueStreamTask } from "@/lib/tasks/chat/handlers/critique-stream";

const run = () => {
  let statusCompletedCalled = false;
  let runningUpdated = false;

  const task = {
    id: "tg-2",
    type: "chat" as const,
    payload: {
      kind: "critique" as const,
      threadId: "thread-1",
      comfyTaskId: "comfy-1",
      imageIndex: 0,
    },
    result: {
      text: "regular critique output",
      reasoning: "some reasoning",
      unbiasedCritique: "critique text",
    },
  };

  const continued = handleCritiqueStreamTask({
    task: task as never,
    requestedContextLength: 4096,
    moodId: "mood-1",
    buildUtilHistorySnapshot: () => "snapshot",
    updateChatTaskPayload: () => null,
    updateRunningTask: () => {
      runningUpdated = true;
    },
    setGroupTaskStatusByKind: () => {
      statusCompletedCalled = true;
    },
    continueCritiqueCommand: () => ({ continued: false }),
  });

  assert.equal(continued, true);
  assert.equal(statusCompletedCalled, true);
  assert.equal(runningUpdated, true);
};

run();
console.log("critique-stream-no-command.contract: OK");
