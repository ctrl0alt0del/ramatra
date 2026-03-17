import assert from "node:assert/strict";
import { handleCritiqueStreamTask } from "@/lib/tasks/chat/handlers/critique-stream";

const run = () => {
  let continueCalled = false;
  let statusCompletedCalled = false;
  let runningUpdated = false;

  const task = {
    id: "tg-1",
    type: "chat" as const,
    payload: {
      kind: "critique" as const,
      threadId: "thread-1",
      comfyTaskId: "comfy-1",
      imageIndex: 0,
    },
    result: {
      text: `[[util_task]]
stage: img_gen_plain_finalize
context_text: Positive Prompt: A; Negative Prompt: B
[[/util_task]]`,
      reasoning: "",
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
    continueCritiqueCommand: () => {
      continueCalled = true;
      return { continued: true };
    },
  });

  assert.equal(continued, true);
  assert.equal(continueCalled, true);
  assert.equal(statusCompletedCalled, false);
  assert.equal(runningUpdated, false);
};

run();
console.log("critique-stream-handoff.contract: OK");
