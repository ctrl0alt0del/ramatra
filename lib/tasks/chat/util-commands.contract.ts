import assert from "node:assert/strict";
import {
  parseChatStreamCommandFromOutputs,
  parseUtilPromptFlags,
} from "@/lib/tasks/chat/util-commands";

const run = () => {
  {
    const parsed = parseChatStreamCommandFromOutputs({
      text: `[[util_task@persistent@stateless]]
stage: img_gen_plain_finalize
context_text: Positive Prompt: X; Negative Prompt: Y
[[/util_task]]`,
      reasoning: "",
      allowReasoningFallback: false,
    });
    assert.equal(parsed.source, "text");
    assert.equal(parsed.command?.stage, "img_gen_plain_finalize");
    assert.equal(parsed.command?.persistent, true);
    assert.equal(parsed.command?.stateless, true);
    assert.equal(
      parsed.command?.context_text,
      "Positive Prompt: X; Negative Prompt: Y",
    );
  }

  {
    const parsed = parseChatStreamCommandFromOutputs({
      text: `[[util_task]]
stage: img_gen_<WORKFLOW>_finalize
context_text: abc
[[/util_task]]`,
      reasoning: "",
      allowReasoningFallback: false,
    });
    assert.equal(parsed.command, null);
  }

  {
    const parsed = parseChatStreamCommandFromOutputs({
      text: "normal text only",
      reasoning: `[[util_task]]
stage: img_gen_loras
context_text: Improved visual brief is test
[[/util_task]]`,
      allowReasoningFallback: true,
    });
    assert.equal(parsed.source, "reasoning");
    assert.equal(parsed.command?.stage, "img_gen_loras");
    assert.equal(parsed.cleanText, "normal text only");
  }

  {
    const result = parseUtilPromptFlags(
      "You finalize image generation @stateless",
    );
    assert.equal(result.isStateless, true);
    assert.equal(result.prompt.includes("@stateless"), false);
  }

  {
    const longContext = "a".repeat(1400);
    const parsed = parseChatStreamCommandFromOutputs({
      text: JSON.stringify({
        __type: "chat.stream_signal",
        route: "util_task",
        stage: "img_gen_workflow",
        context_text: longContext,
        persistent: true,
      }),
      reasoning: "",
      allowReasoningFallback: false,
    });
    assert.equal(parsed.command?.stage, "img_gen_workflow");
    assert.equal(parsed.command?.persistent, true);
    assert.equal(parsed.command?.context_text?.length, 1000);
  }
};

run();
console.log("util-commands.contract: OK");
