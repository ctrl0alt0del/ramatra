"use client";

import { Thread, ThreadList } from "@assistant-ui/react-ui";

import { AssistantText } from "./AssistantText";

export function ChatLayout() {
  return (
    <div className="aui-root flex h-[100dvh] w-full overflow-hidden bg-[hsl(var(--aui-background))] text-[hsl(var(--aui-foreground))]">
      <aside className="w-80 shrink-0 border-r border-[hsl(var(--aui-border))] p-4">
        <ThreadList />
      </aside>

      <section className="flex-1">
        <Thread
          welcome={{
            message: "Hi. Describe the image you want to generate.",
          }}
          assistantMessage={{
            components: {
              Text: AssistantText,
            },
          }}
        />
      </section>
    </div>
  );
}
