import {
  balanceIntentWithPrevious,
  normalizeIntentToNaturalLanguage,
} from "@/lib/tasks/chat/intent-normalization";

const assert = (condition: unknown, message: string) => {
  if (!condition) {
    throw new Error(message);
  }
};

const run = () => {
  {
    const raw = `{"a":"Keep photoreal style","b":{"c":"Use strong rim light"}}`;
    const normalized = normalizeIntentToNaturalLanguage(raw);
    assert(
      normalized.includes("Keep photoreal style."),
      "Expected first JSON string leaf sentence.",
    );
    assert(
      normalized.includes("Use strong rim light."),
      "Expected nested JSON string leaf sentence.",
    );
  }

  {
    const plain = "Just keep it concise";
    const normalized = normalizeIntentToNaturalLanguage(plain);
    assert(normalized === plain, "Plain text should pass through trimmed.");
  }

  {
    const next = balanceIntentWithPrevious({
      previousIntent: "Use photoreal portrait with natural skin detail.",
      nextIntent: "Use photoreal portrait with natural skin detail and warm light.",
    });
    assert(
      next === "Use photoreal portrait with natural skin detail and warm light.",
      "High overlap should keep next intent as-is.",
    );
  }

  {
    const blended = balanceIntentWithPrevious({
      previousIntent: "Prefer photoreal portrait style.",
      nextIntent: "Now switch to cyberpunk neon city composition.",
    });
    assert(
      blended.includes("Prefer photoreal portrait style."),
      "Low overlap should include prior sentence.",
    );
    assert(
      blended.includes("Now switch to cyberpunk neon city composition."),
      "Low overlap should include latest sentence.",
    );
  }
};

run();
console.log("intent-normalization.contract: OK");
