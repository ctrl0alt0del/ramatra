import {
  getChatStopSignals,
  getUsedContextTokens,
  isContextOverflowSignal,
  isFailedStopText,
} from "@/lib/tasks/chat/policies/stream-stop";

const assert = (condition: unknown, message: string) => {
  if (!condition) {
    throw new Error(message);
  }
};

const run = () => {
  {
    const used = getUsedContextTokens({
      usage: { input_tokens: 100, output_tokens: 30 },
    });
    assert(used === 130, "Expected input+output token sum.");
  }

  {
    const used = getUsedContextTokens({
      usage: { total_tokens: 222 },
    });
    assert(used === 222, "Expected total_tokens fallback.");
  }

  {
    const stop = getChatStopSignals({
      stop_reason: "length",
      finish_reason: "length",
    });
    assert(stop.stopReason === "length", "Expected stop reason extraction.");
    assert(stop.finishReason === "length", "Expected finish reason extraction.");
  }

  {
    const overflow = isContextOverflowSignal({
      stopReason: "max_tokens",
      finishReason: null,
    });
    assert(overflow === true, "Expected overflow from max_tokens reason.");
  }

  {
    assert(isFailedStopText("failed") === true, "Expected failed text detection.");
    assert(
      isFailedStopText("completed") === false,
      "Expected non-failed text detection.",
    );
  }
};

run();
console.log("stream-stop.contract: OK");
