"use client";

import { useMessagePartReasoning } from "@assistant-ui/react";

export function AssistantReasoning() {
  const part = useMessagePartReasoning();
  const text = part.text.trim();

  if (!text) {
    return null;
  }

  return (
    <details className="mb-3 rounded-xl border border-[hsl(var(--aui-border))] bg-[hsl(var(--aui-muted))] px-4 py-3">
      <summary className="cursor-pointer text-sm font-medium text-[hsl(var(--aui-foreground))]">
        Thinking
      </summary>
      <div className="mt-3 whitespace-pre-wrap text-sm text-[hsl(var(--aui-muted-foreground))]">
        {text}
      </div>
    </details>
  );
}
